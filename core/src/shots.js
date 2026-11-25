// C4: screenshots. S-026 key naming, S-027 type and magic bytes, S-028 size and one-per-ticket, S-029 unattached for 1 hour then erased.
import { randomToken, sha256hex } from './crypto.js';
import { keyHash, parseKey } from './idem.js';
import { audit } from './audit.js';
export const SHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const SHOT_ID = /^[A-Za-z0-9_-]{22}$/;
export const UNATTACHED_MS = 3600e3;
export const SHOT_UPLOADS_PER_HOUR = 10; // F4
const iso = (ms) => new Date(ms).toISOString();
const eq = (b, at, s) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
// The type the first bytes really show, or null.
export function sniff(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && eq(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && eq(b, 0, 'RIFF') && eq(b, 8, 'WEBP')) return 'image/webp';
  return null;
}
export const shotKey = (instance, id) => `${instance}/${id}`; // random id, never a user file name
// Who may attach a file to a ticket: the session that uploaded it, in this instance. Stored as a hash, never the session id itself (same idea as the AI link owner).
export const shotSess = (inst, sess) => sha256hex(inst.id + '|shot|' + sess);

// bytes: Uint8Array (already within the 2 MB read limit). sess: the session of the verified role proof (the owner of the file). Returns {status, body, headers} | {error, extra}.
export async function uploadShot(ctx, inst, { bytes, contentType, idemHeader, ip, sess }) {
  const now = ctx.now(), key = parseKey(idemHeader);
  if (typeof sess !== 'string' || !sess) return { error: 'no_assertion' }; // a file with no owner could be claimed by nobody: refuse it up front
  if (!key) return { error: 'bad_request', extra: { field: 'idempotency-key' } };
  if (!ctx.blobs) return { error: 'try_later' };
  const ctype = String(contentType || '').split(';')[0].trim().toLowerCase();
  const kind = sniff(bytes);
  if (!SHOT_TYPES.includes(ctype) || kind !== ctype) return { error: 'bad_type' }; // wrong header, or the bytes are not what the header says
  const kh = await keyHash(inst.id, 'shot|' + key), bh = await sha256hex(bytes);
  const hit = await ctx.store.peekIdem(inst.id, kh, now);
  if (hit) return hit.bodyHash === bh ? { status: 201, body: JSON.parse(hit.response), headers: { 'idempotent-replay': 'true' } } : { error: 'idempotency_conflict' };
  const day = new Date(now).toISOString().slice(0, 10), ih = (await sha256hex(day + '|' + ip)).slice(0, 16), lk = `up:${ih}:h${Math.floor(now / 3600e3)}`;
  const r = await ctx.limiter(lk, { op: 'take', delta: 1, cap: SHOT_UPLOADS_PER_HOUR, ttl: 3660 });
  if (!r.ok) { const ra = Math.max(1, Math.ceil(((Math.floor(now / 3600e3) + 1) * 3600e3 - now) / 1000)); return { error: 'rate', extra: { retry_after: ra }, headers: { 'retry-after': String(ra) } }; }
  const id = randomToken(16), k = shotKey(inst.id, id);
  try {
    await ctx.blobs.put(k, bytes, ctype);
    try { await ctx.store.putShot({ id, instance: inst.id, key: k, bytes: bytes.length, ctype, ticket: null, created: now, erase_at: now + UNATTACHED_MS, sess_hash: await shotSess(inst, sess) }); }
    catch (e) { await ctx.blobs.delete(k).catch(() => {}); throw e; }
    const body = { screenshot_id: id, bytes: bytes.length, expires: iso(now + UNATTACHED_MS) };
    await ctx.store.putIdem(inst.id, kh, bh, body, now); // two parallel uploads with one key may both store a file; the extra one is erased after 1 hour (see DECISIONS)
    await audit(ctx, inst.id, null, 'screenshot_uploaded', 'organizer');
    return { status: 201, body };
  } catch (e) { await ctx.limiter(lk, { op: 'add', delta: -1 }).catch(() => {}); throw e; }
}

// Team only: the file of one ticket. Never public.
export async function readShot(ctx, inst, number) {
  const t = await ctx.store.getTicket(inst.id, number, ctx.now()); if (!t || !t.screenshot_id) return null;
  const s = await ctx.store.getShot(inst.id, t.screenshot_id, ctx.now()); if (!s) return null;
  return ctx.blobs.get(s.key);
}
