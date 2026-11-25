// S-026: private file storage port. put(key, bytes, ctype), get(key) -> {bytes, ctype} | null, delete(key) (no error when the key is missing).
// The bucket has no public URL and no route here serves a key; only the team screenshot route reads it (see index.js).
export function memoryBlobs() {
  const m = new Map();
  return { async put(k, bytes, ctype) { m.set(k, { bytes: new Uint8Array(bytes), ctype }); }, async get(k) { const v = m.get(k); return v ? { bytes: new Uint8Array(v.bytes), ctype: v.ctype } : null; }, async delete(k) { m.delete(k); }, keys: () => [...m.keys()] };
}
// Cloudflare R2 bucket binding (`SHOTS`, bucket `mpc-shots`).
export const r2Blobs = (bucket) => ({
  async put(k, bytes, ctype) { await bucket.put(k, bytes, { httpMetadata: { contentType: ctype } }); },
  async get(k) { const o = await bucket.get(k); return o ? { bytes: new Uint8Array(await o.arrayBuffer()), ctype: o.httpMetadata?.contentType || 'application/octet-stream' } : null; },
  async delete(k) { await bucket.delete(k); },
});
