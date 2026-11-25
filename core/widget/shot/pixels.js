// C12: pixel work on a plain image {width, height, data: Uint8ClampedArray RGBA}. No canvas needed, so it is testable without a browser.
export const MODES = ['hide', 'blur'];
const BLOCK = 12;
export const copyImage = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const num = Number.isFinite;

// Clamps a box {x,y,w,h} into the image. Returns null for a bad or empty box (never a silent default).
export function clampBox(img, b) {
  if (!b || ![b.x, b.y, b.w, b.h].every(num)) return null;
  const x0 = Math.max(0, Math.floor(Math.min(b.x, b.x + b.w))), y0 = Math.max(0, Math.floor(Math.min(b.y, b.y + b.h)));
  const x1 = Math.min(img.width, Math.ceil(Math.max(b.x, b.x + b.w))), y1 = Math.min(img.height, Math.ceil(Math.max(b.y, b.y + b.h)));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
// Returns a NEW image with the boxes burned in. Hide: opaque black. Blur: coarse blocks of 12 px (hide is the safe one for secrets).
export function applyBoxes(img, boxes) {
  const out = copyImage(img), d = out.data;
  for (const raw of boxes) {
    if (!MODES.includes(raw.mode)) throw new Error('unknown mode: ' + raw.mode);
    const b = clampBox(img, raw); if (!b) continue;
    if (raw.mode === 'hide') { for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const i = (y * img.width + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255; } continue; }
    for (let by = b.y; by < b.y + b.h; by += BLOCK) for (let bx = b.x; bx < b.x + b.w; bx += BLOCK) {
      const ye = Math.min(by + BLOCK, b.y + b.h), xe = Math.min(bx + BLOCK, b.x + b.w); let r = 0, g = 0, bl = 0, n = 0;
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * img.width + x) * 4; r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * img.width + x) * 4; d[i] = r / n; d[i + 1] = g / n; d[i + 2] = bl / n; d[i + 3] = 255; }
    }
  }
  return out;
}
// Scales down so the longest side is at most max (never up). Box average per output pixel; alpha is forced opaque.
export function fitImage(img, max = 1600) {
  const s = Math.min(1, max / Math.max(img.width, img.height)); if (s === 1) return img;
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s)), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.min(img.width, Math.ceil((x + 1) / s))), y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.min(img.height, Math.ceil((y + 1) / s)));
    let r = 0, g = 0, b = 0, n = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
    const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}
