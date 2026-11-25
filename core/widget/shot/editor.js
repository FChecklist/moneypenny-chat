// C12: the editor to hide parts before sending. Model first (pure), then a small view.
import { applyBoxes, clampBox, copyImage, MODES } from './pixels.js';
import { EDITOR } from './strings.js';
const MAX_BOXES = 50;

// The model keeps the original pixels untouched until apply(), so Undo and Clear work. discard() drops the pixels (nothing stays in memory).
export function createEditor(image, secretBoxes = []) {
  let img = image, boxes = secretBoxes.map((b) => ({ ...b, locked: true })); // boxes of masked fields cannot be undone away
  const alive = () => { if (!img) throw new Error('editor is closed'); return img; };
  return {
    boxes: () => boxes.map((b) => ({ ...b })),
    add(box) {
      alive(); if (!box || !MODES.includes(box.mode)) throw new Error('unknown mode: ' + (box && box.mode));
      const c = clampBox(img, box); if (!c || boxes.length >= MAX_BOXES) return false;
      boxes.push({ ...c, mode: box.mode }); return true;
    },
    undo() { alive(); for (let i = boxes.length - 1; i >= 0; i--) if (!boxes[i].locked) { boxes.splice(i, 1); return true; } return false; },
    clear() { alive(); boxes = boxes.filter((b) => b.locked); },
    apply: () => applyBoxes(alive(), boxes), // a new image; the original is not changed
    discard() { if (img) { img.data.fill(0); img = null; } boxes = []; },
  };
}

// View. image, secretBoxes in image pixels. Calls onDone(image | null) once. imageData(data,w,h) makes an ImageData (injected for tests).
export function mountEditor({ doc, target, image, secretBoxes = [], onDone, imageData = (d, w, h) => new ImageData(d, w, h) }) {
  const ed = createEditor(image, secretBoxes), box = doc.createElement('div'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', EDITOR.title);
  const h = doc.createElement('h2'); h.textContent = EDITOR.title; h.tabIndex = -1; box.append(h);
  for (const l of EDITOR.lines) { const p = doc.createElement('p'); p.textContent = l; box.append(p); }
  const cv = doc.createElement('canvas'); cv.width = image.width; cv.height = image.height; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', EDITOR.picture); box.append(cv);
  let mode = 'hide', finished = false, start = null;
  const paint = () => { const ctx = cv.getContext('2d'), o = ed.apply(); ctx.putImageData(imageData(o.data, o.width, o.height), 0, 0); };
  const btn = (label, fn) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; box.append(b); return b; };
  const bh = btn(EDITOR.hide, () => setMode('hide')), bb = btn(EDITOR.blur, () => setMode('blur'));
  function setMode(m) { mode = m; bh.setAttribute('aria-pressed', String(m === 'hide')); bb.setAttribute('aria-pressed', String(m === 'blur')); }
  setMode('hide');
  btn(EDITOR.undo, () => { ed.undo(); paint(); }); btn(EDITOR.clear, () => { ed.clear(); paint(); });
  const finish = (out) => { if (finished) return; finished = true; ed.discard(); if (box.remove) box.remove(); onDone(out); };
  btn(EDITOR.use, () => finish(ed.apply())); btn(EDITOR.discard, () => finish(null));
  // Drag: points are turned into image pixels with the canvas size on screen.
  const pt = (e) => { const r = cv.getBoundingClientRect(), sx = r.width ? image.width / r.width : 1, sy = r.height ? image.height / r.height : 1; return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }; };
  cv.onpointerdown = (e) => { start = pt(e); };
  cv.onpointerup = (e) => { if (!start) return; const p = pt(e); ed.add({ x: start.x, y: start.y, w: p.x - start.x, h: p.y - start.y, mode }); start = null; paint(); };
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } });
  paint(); target.append(box); h.focus();
  return { box, canvas: cv, editor: ed, discard: () => finish(null) };
}
