const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256hex = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
export async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
export function timingEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export const b64url = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
export const randomToken = (bytes = 32) => { const a = crypto.getRandomValues(new Uint8Array(bytes)); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
