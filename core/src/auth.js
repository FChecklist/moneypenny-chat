// S-012: signature between instance and core. sig = HMAC-SHA256(secret, method \n path \n ts \n nonce \n sha256(body)). Max time gap 300 s; nonce used once (kept 10 minutes).
import { hmacHex, sha256hex, timingEqual } from './crypto.js';
export const MAX_SKEW_S = 300, NONCE_TTL_S = 600;
// x-mpc-ip is added as a sixth line only when the header is present, so it cannot be changed after signing.
export const canonical = async ({ method, path, ts, nonce, body, ip }) => [String(method).toUpperCase(), path, ts, nonce, await sha256hex(body), ...(ip ? [ip] : [])].join('\n');
export const sign = async (secret, parts) => hmacHex(secret, await canonical(parts));
export const nonceStore = (limiter) => ({ take: async (key) => (await limiter('n:' + key, { op: 'take', delta: 1, cap: 1, ttl: NONCE_TTL_S })).ok === true });

// headers: object with get(). secrets: list of active secrets (rotation). Returns {ok:true} or {ok:false, why}.
export async function verifySignature({ headers, method, path, body, secrets, nonces, now = Date.now() }) {
  const instance = headers.get('x-mpc-instance') || '', ts = headers.get('x-mpc-ts') || '', nonce = headers.get('x-mpc-nonce') || '', sig = headers.get('x-mpc-sig') || '';
  if (!/^\d{9,12}$/.test(ts) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig) || !secrets.length) return { ok: false, why: 'shape' };
  if (Math.abs(now / 1000 - Number(ts)) > MAX_SKEW_S) return { ok: false, why: 'old' };
  const expected = await Promise.all(secrets.map((s) => sign(s, { method, path, ts, nonce, body, ip: headers.get('x-mpc-ip') || '' })));
  let good = false; for (const e of expected) if (timingEqual(e, sig)) good = true; // no early exit
  if (!good) return { ok: false, why: 'signature' };
  if (!(await nonces.take(instance + ':' + nonce))) return { ok: false, why: 'replay' }; // only a valid signature may use up a nonce
  return { ok: true };
}
