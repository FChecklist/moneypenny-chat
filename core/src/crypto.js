const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256hex = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
async function hmacRaw(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
export const hmacHex = async (secret, msg) => hex(await hmacRaw(secret, msg));
export function timingEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export const b64url = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
export const randomToken = (bytes = 32) => { const a = crypto.getRandomValues(new Uint8Array(bytes)); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// Encrypt a short text with AES-GCM. The key is the raw 32 bytes of the HMAC-SHA-256 of a fixed label (256 bits). Output: b64url(iv + cipher).
const aesKey = async (secret) => crypto.subtle.importKey('raw', await hmacRaw(secret, 'mpc-idem-v1'), 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function encryptText(secret, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(text)));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  return btoa(String.fromCharCode(...all)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Tries each secret (rotation). Returns the text, or null when none fits.
export async function decryptText(secrets, packed) {
  let all; try { all = Uint8Array.from(atob(String(packed).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)); } catch { return null; }
  for (const s of secrets) { try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await aesKey(s), all.slice(12))); } catch {} }
  return null;
}
