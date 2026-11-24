// C3: tickets. Create (S-021), idempotency (S-022), limits (S-023), read with status token (S-024), erase_at (S-025); team list and close.
import { randomToken, sha256hex, timingEqual, encryptText, decryptText } from './crypto.js';
import { parseKey, keyHash, bodyHash } from './idem.js';
import { cleanPath, segmentsFromRoutes, screenLabel } from './path.js';
import { scrub } from './scrub.js';
import { eraseAtCreate, eraseAtDone } from './retention.js';
import { FALLBACK_SCREEN } from './strings.js';

export const OPTIONS = ['help_more', 'suggest', 'stuck'];
export const TYPES = ['option', 'feature', 'wording'];
export const TICKET_LIMITS = { sessHour: 5, sessDay: 15, ipHour: 10, ipDay: 30, instanceDay: 500 }; // F4
const H = 3600e3, D = 24 * H;
const TOPIC = /^[a-z0-9][a-z0-9-]{0,39}$/;
const iso = (ms) => new Date(ms).toISOString();
const len = (s) => [...s].length;
const clean = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();

// Returns {ok:true, value} or {ok:false, field}.
export function validateTicket(b, inst) {
  const bad = (field) => ({ ok: false, field });
  if (!OPTIONS.includes(b.option)) return bad('option');
  const type = b.type ?? null;
  if (b.option === 'suggest' ? !TYPES.includes(type) : type !== null) return bad('type');
  const topic = b.topic ?? null;
  if (topic !== null && !(typeof topic === 'string' && TOPIC.test(topic) && (topic.match(/\d/g) || []).length < 8)) return bad('topic'); // 8 or more digits in total: refused, like scrub
  if (b.text !== undefined && typeof b.text !== 'string') return bad('text');
  const text = clean(b.text ?? ''), n = len(text);
  if (n > 600) return bad('text');
  if (b.option === 'suggest' && n < 10) return bad('text');
  if (b.option === 'help_more' && topic === null) return bad('topic');
  if (b.option === 'stuck' && topic === null && n === 0) return bad('text');
  if (b.screen !== undefined && (typeof b.screen !== 'string' || b.screen.length > 200)) return bad('screen');
  if (b.screen_label !== undefined && (typeof b.screen_label !== 'string' || b.screen_label.length > 60)) return bad('screen_label');
  if (b.screenshot_id !== undefined && b.screenshot_id !== null) return bad('screenshot_id'); // screenshots arrive in a later version
  if (b.role !== 'organizer' && b.role !== 'co-organizer') return bad('role');
  let client = { class: null, w: null };
  if (b.client !== undefined) {
    const c = b.client;
    if (!c || typeof c !== 'object' || !Number.isInteger(c.w) || c.w < 1 || c.w > 10000 || !Number.isInteger(c.h) || c.h < 1 || c.h > 10000 || !['mobile', 'desktop'].includes(c.ua_class)) return bad('client');
    client = { class: c.ua_class, w: c.w };
  }
  const allowed = segmentsFromRoutes(inst.routes), screen = cleanPath(b.screen || '/', allowed);
  return { ok: true, value: { option: b.option, type, topic, text, screen, label: screenLabel(screen, inst.routes, allowed) || FALLBACK_SCREEN, role: b.role, client } };
}

// F4 counters. Order: session, address, instance. A refused call gives back what it took; so does a replay.
async function takeLimits(ctx, inst, sess, ip, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const sh = (await sha256hex(inst.id + '|' + sess)).slice(0, 16), ih = (await sha256hex(day + '|' + ip)).slice(0, 16); // address hash rotates daily
  const checks = [['s', sh, H, TICKET_LIMITS.sessHour], ['s', sh, D, TICKET_LIMITS.sessDay], ['i', ih, H, TICKET_LIMITS.ipHour], ['i', ih, D, TICKET_LIMITS.ipDay], ['n', inst.id, D, inst.tickets_per_day || TICKET_LIMITS.instanceDay]];
  const taken = [];
  for (const [k, id, span, cap] of checks) {
    const key = `tk:${k}:${id}:${span === H ? 'h' : 'd'}${Math.floor(now / span)}`;
    const r = await ctx.limiter(key, { op: 'take', delta: 1, cap, ttl: span / 1000 + 60 });
    if (!r.ok) { await give(ctx, taken); return { ok: false, retryAfter: Math.max(1, Math.ceil(((Math.floor(now / span) + 1) * span - now) / 1000)) }; }
    taken.push(key);
  }
  return { ok: true, taken };
}
const give = (ctx, keys) => Promise.all(keys.map((key) => ctx.limiter(key, { op: 'add', delta: -1 })));

// Turn a stored response back into the one the visitor gets: decrypt the token. If no secret fits, the status token is lost: fail closed.
async function open(ctx, inst, r) {
  const t = await decryptText(ctx.secrets(inst.id, 'sign'), r.status_token);
  if (t === null) throw new Error('idempotency response cannot be opened');
  return { ...r, status_token: t };
}

// Returns {status, body, headers}. `raw` is the body text (hashed for idempotency); `b` the parsed object; `a` the verified assertion.
export async function createTicket(ctx, inst, { raw, b, a, idemHeader, ip }) {
  const now = ctx.now(), key = parseKey(idemHeader);
  if (!key) return { error: 'bad_request', extra: { field: 'idempotency-key' } };
  const v = validateTicket({ ...b, role: b.role ?? a.role }, inst);
  if (!v.ok) return { error: 'bad_request', extra: { field: v.field } };
  if (v.value.role !== a.role) return { error: 'role' }; // the body may not claim more than the proof says
  const t = v.value, id = { keyHash: await keyHash(inst.id, key), bodyHash: await bodyHash(raw) };
  const hit = await ctx.store.peekIdem(inst.id, id.keyHash, now); // a replay takes no limit
  if (hit) return hit.bodyHash === id.bodyHash ? { status: 201, body: await open(ctx, inst, JSON.parse(hit.response)), headers: { 'idempotent-replay': 'true' } } : { error: 'idempotency_conflict' };
  const lim = await takeLimits(ctx, inst, a.sess, ip, now);
  if (!lim.ok) return { error: 'rate', extra: { retry_after: lim.retryAfter }, headers: { 'retry-after': String(lim.retryAfter) } };
  const token = randomToken(32), tokenHash = await sha256hex(token), erase = eraseAtCreate(inst.retention_class, now);
  const sealed = await encryptText(ctx.secrets(inst.id, 'sign')[0], token);
  let res;
  try { res = await ctx.store.createTicket(inst.id, id, (number) => ({
    row: { number, option: t.option, type: t.type, topic: t.topic, screen: scrub(t.screen), screen_label: scrub(t.label), text: scrub(t.text), screenshot_id: null, role: t.role, client_class: t.client.class, client_w: t.client.w, status: 'new', team_note: '', created: now, updated: now, done_at: null, erase_at: erase, token_hash: tokenHash },
    response: { ticket: number, status_token: sealed, erase_at: iso(erase) }, // the stored copy holds the token only encrypted
  }), now); } catch (e) { await give(ctx, lim.taken).catch(() => {}); throw e; } // a throw gives the counters back
  if (res.status !== 'created') await give(ctx, lim.taken); // lost a race with the same key
  if (res.status === 'conflict') return { error: 'idempotency_conflict' };
  return { status: 201, body: await open(ctx, inst, res.response), headers: res.status === 'replay' ? { 'idempotent-replay': 'true' } : {} };
}

// S-024: wrong token and unknown ticket look the same (404).
export async function readTicket(ctx, inst, number, token) {
  const now = ctx.now(), row = await ctx.store.getTicket(inst.id, number, now);
  const ok = row && token && timingEqual(await sha256hex(token), row.token_hash);
  if (!ok) return { error: 'not_found' };
  return { status: 200, body: { ticket: row.number, status: row.status, team_note: row.team_note, updated: iso(row.updated) } };
}

const item = (r) => ({ ticket: r.number, product: r.instance, option: r.option, type: r.type, topic: r.topic, screen: r.screen, screen_label: r.screen_label, role: r.role, status: r.status, created: iso(r.created), updated: iso(r.updated), erase_at: iso(r.erase_at) });
export async function listTickets(ctx, { product, status, cursor }) {
  if (status && !['new', 'seen', 'done'].includes(status)) return { error: 'bad_request', extra: { field: 'status' } };
  const c = cursor ? Number(cursor) : undefined; if (cursor && !(Number.isInteger(c) && c > 0)) return { error: 'bad_request', extra: { field: 'cursor' } };
  const r = await ctx.store.listTickets({ instance: product || undefined, status: status || undefined, cursor: c, limit: 50, now: ctx.now() });
  return { status: 200, body: { items: r.items.map(item), cursor: r.cursor ? String(r.cursor) : null } };
}
export async function teamRead(ctx, product, number) {
  const r = await ctx.store.getTicket(product, number, ctx.now()); if (!r) return { error: 'not_found' };
  return { status: 200, body: { ...item(r), text: r.text, client_class: r.client_class, client_w: r.client_w, team_note: r.team_note } };
}
// Close or mark seen. `done` recomputes erase_at by the retention class.
export async function teamUpdate(ctx, inst, number, b) {
  if (!['seen', 'done'].includes(b.status)) return { error: 'bad_request', extra: { field: 'status' } };
  if (b.team_note !== undefined && (typeof b.team_note !== 'string' || len(clean(b.team_note)) > 500)) return { error: 'bad_request', extra: { field: 'team_note' } };
  const now = ctx.now(), cur = await ctx.store.getTicket(inst.id, number, now); if (!cur) return { error: 'not_found' };
  const patch = { status: b.status, updated: now };
  if (b.team_note !== undefined) patch.team_note = scrub(clean(b.team_note));
  if (b.status === 'done') { patch.done_at = cur.done_at ?? now; patch.erase_at = eraseAtDone(inst.retention_class, cur.created, patch.done_at); }
  const r = await ctx.store.updateTicket(inst.id, number, patch, now);
  return r ? { status: 200, body: item(r) } : { error: 'not_found' };
}
