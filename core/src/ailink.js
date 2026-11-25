// C6: AI links. S-043 create and revoke, S-046 context, S-047 notes. The key `k` is never stored: only its SHA-256 hash.
import { randomToken, sha256hex, timingEqual } from './crypto.js';
import { checkScopes, withinScopes, READ_ONLY_SCOPES, CLASS_SCOPES, WRITE_SCOPES } from './scopes.js';
import { cleanPath, segmentsFromRoutes, screenLabel } from './path.js';
import { scrub } from './scrub.js';
import { audit } from './audit.js';
import { sideRecord } from './privacy.js';
import { aiError, aiJson, pageModel, pageResponse } from './aipage.js';
import { AI_NEXT, FALLBACK_SCREEN } from './strings.js';
import { checkNoteText, plainNote } from './noterules.js';

export const LINK_LIMITS = { perHour: 5, notes: 20, noteChars: 800, ttlDefault: 7200, ttlMax: 86400, ttlMin: 60 };
export const NOTE_TYPES = ['plan', 'step', 'done', 'blocked'];
const TICKET = /^T-\d{4,}$/, HASH = /^[0-9a-f]{64}$/, KEYID = /^[A-Za-z0-9_-]{1,64}$/, LINK_ID = /^[A-Za-z0-9_-]{22}$/;
const iso = (ms) => new Date(ms).toISOString();
const bad = (field) => ({ error: 'bad_request', extra: { field } });
const sessHash = (inst, sess) => sha256hex(inst.id + '|ai|' + sess);

// POST /v1/ai-links. b: parsed body; a: verified role assertion; token: status token of the ticket (needed when a ticket is named).
export async function createLink(ctx, inst, { b, a, token }) {
  const now = ctx.now();
  if (b.ticket !== undefined && b.ticket !== null && !(typeof b.ticket === 'string' && TICKET.test(b.ticket))) return bad('ticket');
  const ticket = b.ticket ?? null;
  const sc = checkScopes(b.scopes); if (!sc.ok) return bad('scopes'); // payment, identity, delete and anything else outside the list: refused
  if (!ticket && !withinScopes(sc.value, READ_ONLY_SCOPES)) return bad('scopes'); // no ticket: read-only scopes only
  if (typeof b.key_hash !== 'string' || !HASH.test(b.key_hash)) return bad('key_hash');
  if (typeof b.product_key_id !== 'string' || !KEYID.test(b.product_key_id)) return bad('product_key_id');
  const ttl = b.ttl_s ?? LINK_LIMITS.ttlDefault;
  if (!Number.isInteger(ttl) || ttl < LINK_LIMITS.ttlMin || ttl > LINK_LIMITS.ttlMax) return bad('ttl_s');
  if (b.screen !== undefined && (typeof b.screen !== 'string' || b.screen.length > 200)) return bad('screen');
  if (ticket) { // sequential numbers must not let one organizer read another's ticket: the status token of that ticket is required
    const row = await ctx.store.getTicket(inst.id, ticket, now);
    if (!row || !token || !timingEqual(await sha256hex(token), row.token_hash)) return { error: 'not_found' };
    if (!withinScopes(sc.value, CLASS_SCOPES[row.option] || READ_ONLY_SCOPES)) return bad('scopes'); // not more than the ticket class allows
  }
  if (await ctx.store.getLinkByHash(b.key_hash)) return bad('key_hash'); // one key, one link
  const sh = await sessHash(inst, a.sess), lk = `al:${sh.slice(0, 16)}:h${Math.floor(now / 3600e3)}`;
  const r = await ctx.limiter(lk, { op: 'take', delta: 1, cap: LINK_LIMITS.perHour, ttl: 3660 });
  if (!r.ok) { const ra = Math.max(1, Math.ceil(((Math.floor(now / 3600e3) + 1) * 3600e3 - now) / 1000)); return { error: 'rate', extra: { retry_after: ra }, headers: { 'retry-after': String(ra) } }; }
  const id = randomToken(16), screen = scrub(cleanPath(b.screen || '/', segmentsFromRoutes(inst.routes))), expires = now + ttl * 1000;
  try {
    await ctx.store.createLink({ id, instance: inst.id, ticket, screen, scopes: JSON.stringify(sc.value), key_hash: b.key_hash, product_key_id: b.product_key_id, sess_hash: sh, created: now, expires });
    await audit(ctx, inst.id, ticket, 'ai_link_created', 'organizer');
  } catch (e) { await ctx.limiter(lk, { op: 'add', delta: -1 }).catch(() => {}); throw e; }
  return { status: 201, body: { link: `${inst.allowed_origins[0]}/ai/${id}?k=`, id, expires: iso(expires) } }; // the instance adds k itself
}
// The organizer session that made a link may stop it or approve its plan; anything else looks like "not found".
async function mine(ctx, inst, id, a) {
  const l = LINK_ID.test(id) ? await ctx.store.getLink(id) : null;
  return l && l.instance === inst.id && timingEqual(l.sess_hash, await sessHash(inst, a.sess)) ? l : null;
}
export async function revokeLink(ctx, inst, id, a) {
  const l = await mine(ctx, inst, id, a); if (!l) return { error: 'not_found' };
  if (!l.revoked) { await ctx.store.updateLink(id, { revoked: 1 }); await audit(ctx, inst.id, l.ticket, 'ai_link_revoked', 'organizer'); }
  return { status: 204, body: null };
}
// Added: the organizer approves the plan (E5 step 3 needs approved:true to become reachable).
export async function approveLink(ctx, inst, id, a) {
  const l = await mine(ctx, inst, id, a); if (!l) return { error: 'not_found' };
  if (!(await ctx.store.listNotes(id)).some((n) => n.type === 'plan')) return bad('plan');
  if (!l.approved) { await ctx.store.updateLink(id, { approved: 1 }); await audit(ctx, inst.id, l.ticket, 'ai_plan_approved', 'organizer'); }
  return { status: 200, body: { id, approved: true } };
}

// ---- the AI side
const state = (l, now) => (!l ? 'bad_link' : l.revoked ? 'revoked' : l.closed || l.expires <= now ? 'expired' : null);
// Page: /ai/{id}?k=. A wrong key or an unknown id gives the same answer, so ids cannot be probed.
export async function aiPage(ctx, id, k, format) {
  const now = ctx.now(), l = LINK_ID.test(id) && typeof k === 'string' && k.length >= 8 && k.length <= 200 ? await ctx.store.getLink(id) : null;
  if (!l || !timingEqual(await sha256hex(k), l.key_hash)) return aiError('bad_link');
  const bad = state(l, now); if (bad) return aiError(bad);
  const inst = ctx.instances.get(l.instance); if (!inst) return aiError('bad_link');
  const t = l.ticket ? await ctx.store.getTicket(l.instance, l.ticket, now) : null; if (l.ticket && !t) return aiError('ticket_gone');
  return pageResponse(pageModel({ inst, link: l, ticket: t, label: screenLabel(l.screen, inst.routes, segmentsFromRoutes(inst.routes)) || FALLBACK_SCREEN }), format);
}
async function bearer(ctx, req) {
  const m = /^Bearer (\S{8,200})$/i.exec(req.headers.get('authorization') || '');
  const l = m ? await ctx.store.getLinkByHash(await sha256hex(m[1])) : null, now = ctx.now(), why = state(l, now);
  return why ? { err: aiError(why) } : { l, now, inst: ctx.instances.get(l.instance) };
}
const logged = (ctx, req, l, method, pathClass, code, res) => sideRecord(req.headers, () => ctx.store.addCall({ link_id: l.id, at: ctx.now(), method, path_class: pathClass, code })).then(() => res);
const gone = async (ctx, l, now) => l.ticket && !(await ctx.store.getTicket(l.instance, l.ticket, now));

export async function aiContext(ctx, req) {
  const b = await bearer(ctx, req); if (b.err) return b.err;
  const { l, now, inst } = b; if (!inst) return aiError('bad_link');
  const scopes = JSON.parse(l.scopes);
  if (!scopes.includes('read_ticket')) return logged(ctx, req, l, 'GET', 'ai/context', 403, aiError('out_of_scope'));
  const t = l.ticket ? await ctx.store.getTicket(l.instance, l.ticket, now) : null;
  if (l.ticket && !t) return logged(ctx, req, l, 'GET', 'ai/context', 404, aiError('ticket_gone'));
  const body = { ticket: t ? { number: t.number, option: t.option, type: t.type, topic: t.topic, status: t.status, text: t.text } : null, screen: l.screen, scopes, expires: iso(l.expires), approved: !!l.approved, calls: inst.ai_calls || [] };
  return logged(ctx, req, l, 'GET', 'ai/context', 200, aiJson(body));
}
// A note must not ask for payments, identity changes or deleting, must carry no link to another site, and no secret-looking token.
// The word check is in noterules.js (0.4.2): strict for plan and step, precise for the reports done and blocked. It is a second layer; the scope list is the real guard (docs/DECISIONS.md).
const LINKY = /https?:\/\/|\bwww\./i, SECRETY = /\bmpk_[A-Za-z0-9]{8,}|[A-Za-z0-9_-]{32,}/;
export async function aiNote(ctx, req, raw) {
  const b = await bearer(ctx, req); if (b.err) return b.err;
  const { l, now } = b, fin = (code, status, res) => logged(ctx, req, l, 'POST', 'ai/notes', status, res);
  if (!JSON.parse(l.scopes).includes('report')) return fin('out_of_scope', 403, aiError('out_of_scope'));
  if (await gone(ctx, l, now)) return fin('gone', 404, aiError('ticket_gone'));
  if (raw === null) return fin('big', 413, aiError('too_large'));
  let p; try { p = JSON.parse(raw); } catch { p = null; }
  if (!p || typeof p !== 'object' || Array.isArray(p) || !NOTE_TYPES.includes(p.type) || typeof p.text !== 'string') return fin('bad', 422, aiError('bad_note'));
  // 0.4.6: the note is made plain (NFKC, zero-width characters removed) BEFORE the link, secret and word checks and is stored in that same form, so what is checked is what is kept. scrub() runs only at the store step: it can only swap an e-mail or a number for [removed].
  const text = plainNote(p.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')).trim(), n = [...text].length;
  if (n > LINK_LIMITS.noteChars) return fin('big', 413, aiError('too_large'));
  if (n < 1 || LINKY.test(text) || SECRETY.test(text)) return fin('bad', 422, aiError('bad_note'));
  if (checkNoteText(p.type, text)) return fin('forbidden', 403, aiError('forbidden_action'));
  if ((p.type === 'step' || p.type === 'done') && !l.approved && JSON.parse(l.scopes).some((s) => WRITE_SCOPES.includes(s))) return fin('plan', 409, aiError('plan_not_approved'));
  const left = Math.max(1, Math.ceil((l.expires - now) / 1000));
  const sec = await ctx.limiter(`an1:${l.id}:${Math.floor(now / 1000)}`, { op: 'take', delta: 1, cap: 1, ttl: 5 }); // 1 per second
  if (!sec.ok) return fin('slow', 429, aiError('slow_down', { retry_after: 1 }, { 'retry-after': '1' }));
  const tot = await ctx.limiter(`an:${l.id}`, { op: 'take', delta: 1, cap: LINK_LIMITS.notes, ttl: left + 60 }); // 20 per link
  if (!tot.ok) return fin('slow', 429, aiError('slow_down', { retry_after: left }, { 'retry-after': String(left) })); // accepted limit: the cap is for the whole link life, see DECISIONS
  const num = await ctx.store.addNote(l.id, p.type, scrub(text), now);
  if (p.type === 'done' || p.type === 'blocked') await ctx.store.updateLink(l.id, { closed: 1 });
  await audit(ctx, l.instance, l.ticket, 'ai_note_' + p.type, 'ai');
  return fin('ok', 201, aiJson({ note: num, next: AI_NEXT[p.type] }, 201));
}
