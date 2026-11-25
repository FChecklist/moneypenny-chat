// C12: the capture library. The picture engine (DOM to pixels) is injected as render(doc) -> {width,height,data}; the MIT engine is not
// vendored yet (spec S-060). Order: mask secrets -> render -> restore the page -> burn the masked fields black in the pixels
// (a second line if the engine ignores the blank) -> editor -> shrink -> encode. Nothing is sent from here.
import { maskSecrets } from './mask.js';
import { applyBoxes, fitImage } from './pixels.js';
import { mountEditor } from './editor.js';
import { EDITOR } from './strings.js';
export const CAP = { maxSide: 1600, maxBytes: 1.5 * 1024 * 1024 };
const TYPES = ['image/jpeg', 'image/webp', 'image/png']; // the core accepts these three

// Returns {image, secretBoxes} or null when blocked. The page is always restored, even if render throws.
export async function takePicture({ doc, render, blocked }) {
  if (blocked && blocked()) return null;
  const m = maskSecrets(doc); let img;
  try { img = await render(doc); } finally { m.restore(); }
  if (!img || !(img.width > 0) || !(img.height > 0) || img.data.length !== img.width * img.height * 4) throw new Error('render gave a bad image');
  const vw = (doc.defaultView && doc.defaultView.innerWidth) || img.width, s = img.width / vw;
  const secretBoxes = m.rects.map((r) => ({ x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s, mode: 'hide' }));
  return { image: applyBoxes(img, secretBoxes), secretBoxes, masked: m.count };
}
// Shrinks to maxSide and encodes with toBlob(image, type, quality) -> Blob|null; steps quality down until it fits maxBytes. null if it never fits.
export async function encodePicture(image, toBlob, { type = 'image/jpeg', ...cap } = {}) {
  const c = { ...CAP, ...cap }; if (!TYPES.includes(type)) throw new Error('unknown type: ' + type);
  const small = fitImage(image, c.maxSide);
  for (const q of type === 'image/png' ? [undefined] : [0.85, 0.7, 0.5, 0.3]) { const b = await toBlob(small, type, q); if (b && b.size > 0 && b.size <= c.maxBytes) return b; }
  return null;
}
// The function the widget takes as cfg.capture: resolves a Blob, or null (blocked, discarded, or failed). Never throws into the widget.
export function makeCapture({ doc, render, toBlob, target, blocked, imageData, type }) {
  return async function capture() {
    try {
      const p = await takePicture({ doc, render, blocked }); if (!p) return null;
      const edited = await new Promise((res) => mountEditor({ doc, target: target || doc.body, image: p.image, secretBoxes: p.secretBoxes, onDone: res, imageData }));
      return edited ? await encodePicture(edited, toBlob, { type }) : null;
    } catch { return null; }
  };
}
export { EDITOR };
