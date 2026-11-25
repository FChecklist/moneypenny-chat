// S-041: Cloudflare Access login for /team and /v1/team/*. Access puts a signed token (RS256) in the header `cf-access-jwt-assertion`.
// We check the signature against the team's public keys, the issuer, the audience and the times. Without a valid token the answer is 401.
import { unb64url } from './crypto.js';
const DOMAIN = /^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/;
const b64bytes = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export function accessAuth({ domain, aud, fetchJwks = async (u) => (await fetch(u)).json(), now = Date.now }) {
  if (!DOMAIN.test(domain || '') || typeof aud !== 'string' || aud.length < 8) return async () => false; // not configured: fail closed
  let cache = { at: 0, keys: [] };
  const keys = async (force) => { if (force || !cache.at || now() - cache.at > 3600e3) { const j = await fetchJwks(`https://${domain}/cdn-cgi/access/certs`); cache = { at: now(), keys: Array.isArray(j?.keys) ? j.keys : [] }; } return cache.keys; };
  return async (req) => {
    try {
      const parts = (req.headers.get('cf-access-jwt-assertion') || '').split('.'); if (parts.length !== 3) return false;
      const head = JSON.parse(unb64url(parts[0])); if (head.alg !== 'RS256' || typeof head.kid !== 'string') return false;
      let jwk = (await keys(false)).find((k) => k.kid === head.kid);
      if (!jwk && now() - cache.at > 60e3) jwk = (await keys(true)).find((k) => k.kid === head.kid); // keys may have rotated
      if (!jwk) return false;
      const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64bytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])))) return false;
      const p = JSON.parse(unb64url(parts[1])), t = now() / 1000;
      return p.iss === `https://${domain}` && (Array.isArray(p.aud) ? p.aud : [p.aud]).includes(aud) && typeof p.exp === 'number' && p.exp > t && (p.nbf === undefined || p.nbf <= t);
    } catch { return false; }
  };
}
