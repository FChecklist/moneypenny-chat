// S-016: refuse before buffering (declared length first), then a bounded read. Limits come from the contract: 8 KB JSON, 2 MB screenshots.
export const MAX = { json: 8 * 1024, screenshot: 2 * 1024 * 1024 };
export async function readBytes(req, max) {
  const cl = Number(req.headers.get('content-length') || 0);
  if (cl > max) return null;
  if (!req.body) return new Uint8Array(0);
  const rd = req.body.getReader(), parts = []; let n = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    n += value.length;
    if (n > max) { try { await rd.cancel(); } catch {} return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}
export const readText = async (req, max) => { const b = await readBytes(req, max); return b === null ? null : new TextDecoder().decode(b); };
// A JSON body must be one object.
export function parseJsonObject(text) {
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, value: v } : { ok: false }; } catch { return { ok: false }; }
}
