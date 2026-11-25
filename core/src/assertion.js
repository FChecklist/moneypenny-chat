// S-018: role assertion. token = base64url(payload JSON) + "." + HMAC-SHA256(assert secret, base64url part).
// payload: {product, role, sess, exp (unix s)}. The product backend signs it after its own role check. Lifetime at most 1 hour.
import { b64url, unb64url, hmacHex, timingEqual } from './crypto.js';
export const MAX_LIFE_S = 3600;
export async function signAssertion(secret, payload) { const p = b64url(JSON.stringify(payload)); return p + '.' + (await hmacHex(secret, p)); }

// roleMap: product role to organizer or co-organizer (instance.role_map). Returns {ok:true, role, sess} or {ok:false, error:'no_assertion'|'role'}.
export async function verifyAssertion(token, { secrets, product, roleMap = {}, now = Date.now() }) {
  const bad = { ok: false, error: 'no_assertion' };
  const [p, mac, extra] = String(token || '').split('.');
  if (!p || !mac || extra !== undefined || !secrets.length) return bad;
  let good = false; for (const s of secrets) if (timingEqual(await hmacHex(s, p), mac)) good = true;
  if (!good) return bad;
  let d; try { d = JSON.parse(unb64url(p)); } catch { return bad; }
  const t = now / 1000;
  if (!d || d.product !== product || !Number.isFinite(d.exp) || d.exp <= t || d.exp > t + MAX_LIFE_S || typeof d.sess !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(d.sess)) return bad;
  const role = roleMap[d.role] || d.role;
  if (role !== 'organizer' && role !== 'co-organizer') return { ok: false, error: 'role' };
  return { ok: true, role, sess: d.sess };
}
