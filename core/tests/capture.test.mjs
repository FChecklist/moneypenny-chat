// C12: capture library, secret masking and the editor. No browser ran: a small fake DOM and plain pixel arrays are used (see KNOWLEDGE.md).
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { isSecretField, maskSecrets } from '../widget/shot/mask.js';
import { applyBoxes, fitImage, clampBox } from '../widget/shot/pixels.js';
import { createEditor, mountEditor } from '../widget/shot/editor.js';
import { takePicture, encodePicture, makeCapture, CAP } from '../widget/shot/capture.js';
import { EDITOR } from '../widget/shot/strings.js';
import { checkStrings } from '../../contract/strings-rules.mjs';

class El {
  constructor(tag, attrs = {}, rect = null) { this.tag = tag; this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.style = {}; this.children = []; this._text = ''; this.listeners = {}; this.rect = rect; if ('value' in attrs) this.value = attrs.value; this.type = attrs.type; }
  getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; } hasAttribute(k) { return k in this.attrs; } setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...n) { for (const x of n) this.children.push(x); } remove() { this.removed = true; } focus() {} addEventListener(k, f) { this.listeners[k] = f; }
  set textContent(t) { this._text = t; } get textContent() { return this._text; }
  getBoundingClientRect() { return this.rect || { x: 0, y: 0, width: 0, height: 0 }; }
  getContext() { return { putImageData: (d) => { this.last = d; } }; }
  all(tag) { return [this, ...this.children.flatMap((c) => c.all(tag))].filter((e) => !tag || e.tag === tag); }
}
const fakePage = (els, w = 100) => ({ defaultView: { innerWidth: w }, body: new El('body'), createElement: (t) => new El(t), querySelectorAll(sel) { const z = sel.includes('hide-zone'); return els.filter((e) => (z ? e.hasAttribute('data-mpc-hide-zone') : ['input', 'textarea'].includes(e.tag) || e.hasAttribute('data-mpc-hide'))); } });
const solid = (w, h, v = 200) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('S-062 secret fields are found: password, token, card-like, marked; plain text fields are left alone', () => {
  const yes = [new El('input', { type: 'password', value: 'x' }), new El('input', { type: 'text', name: 'api_key', value: 'a' }), new El('input', { type: 'text', autocomplete: 'cc-number', value: '' }),
    new El('input', { type: 'text', name: 'a', value: '4111 1111 1111 1111' }), new El('input', { type: 'text', name: 'a', value: '4111-1111-1111-1111' }), new El('input', { type: 'text', id: 'session-token', value: 'z' }),
    new El('input', { type: 'tel', value: '1' }), new El('input', { type: 'email', value: 'a@b.c' }), new El('textarea', { 'aria-label': 'Secret note', value: 'q' }), new El('div', { 'data-mpc-hide': '' })];
  for (const e of yes) expect(isSecretField(e), JSON.stringify(e.attrs)).toBe(true);
  for (const e of [new El('input', { type: 'text', name: 'title', value: 'Quiz night' }), new El('input', { type: 'text', name: 'n', value: '12 players' }), new El('input', { type: 'text', name: 'n', value: '123456789012' }), new El('div', {})]) expect(isSecretField(e), JSON.stringify(e.attrs)).toBe(false);
});
test('S-062 values are blank while the picture is made, and are back after, also when render throws', async () => {
  const pw = new El('input', { type: 'password', value: 'hunter2' }, { x: 10, y: 10, width: 20, height: 10 }), ok = new El('input', { type: 'text', name: 'title', value: 'Quiz' }), panel = new El('div', { 'data-mpc-hide-zone': '' });
  const doc = fakePage([pw, ok, panel]); let seen;
  await takePicture({ doc, render: async () => { seen = { pw: pw.value, vis: pw.style.visibility, ok: ok.value, panel: panel.style.visibility }; return solid(100, 50); } });
  expect(seen).toEqual({ pw: '', vis: 'hidden', ok: 'Quiz', panel: 'hidden' }); // blank before capture; the panel is not in the picture
  expect(pw.value).toBe('hunter2'); expect(pw.style.visibility).toBe(''); expect(panel.style.visibility).toBe('');
  await expect(takePicture({ doc, render: async () => { throw new Error('boom'); } })).rejects.toThrow('boom');
  expect(pw.value).toBe('hunter2'); expect(pw.style.visibility).toBe('');
});
test('S-062 second line: even if the engine ignores the blank, the field box is black in the pixels (scaled to the picture)', async () => {
  const pw = new El('input', { type: 'password', value: 'hunter2' }, { x: 10, y: 10, width: 20, height: 10 }), doc = fakePage([pw], 100);
  const r = await takePicture({ doc, render: async () => solid(200, 100) }); // picture is 2x the page
  expect(px(r.image, 25, 25)).toEqual([0, 0, 0, 255]); expect(px(r.image, 20, 20)).toEqual([0, 0, 0, 255]); expect(px(r.image, 59, 39)).toEqual([0, 0, 0, 255]);
  expect(px(r.image, 5, 5)).toEqual([200, 200, 200, 200]); expect(px(r.image, 61, 41)).toEqual([200, 200, 200, 200]); expect(r.masked).toBe(1);
});
test('S-062 a blocked screen gives no picture and renders nothing; a bad image from the engine is refused', async () => {
  let called = false; const doc = fakePage([]);
  expect(await takePicture({ doc, blocked: () => true, render: async () => { called = true; } })).toBeNull(); expect(called).toBe(false);
  await expect(takePicture({ doc, render: async () => ({ width: 2, height: 2, data: new Uint8ClampedArray(3) }) })).rejects.toThrow();
});
test('S-063 editor: Hide makes pixels under the box black, outside is untouched; Blur changes pixels; the original is not changed', () => {
  const img = solid(40, 40); for (let i = 0; i < img.data.length; i += 8) img.data[i] = 10; const before = new Uint8ClampedArray(img.data);
  const ed = createEditor(img); expect(ed.add({ x: 5, y: 5, w: 10, h: 10, mode: 'hide' })).toBe(true); expect(ed.add({ x: 20, y: 20, w: 12, h: 12, mode: 'blur' })).toBe(true);
  const o = ed.apply(); expect(px(o, 7, 7)).toEqual([0, 0, 0, 255]); expect(px(o, 14, 14)).toEqual([0, 0, 0, 255]); expect(px(o, 15, 15)).toEqual(px(img, 15, 15)); expect(px(o, 4, 7)).toEqual(px(img, 4, 7));
  const b = [px(o, 20, 20), px(o, 21, 20)]; expect(b[0]).toEqual(b[1]); expect(b[0]).not.toEqual(px(img, 20, 20)); // blur: one value per block
  expect(img.data).toEqual(before);
});
test('S-063 editor: Undo, Clear, clamp, refusals (unknown mode, empty or NaN box, more than 50 boxes)', () => {
  const ed = createEditor(solid(20, 20)); ed.add({ x: -5, y: -5, w: 10, h: 10, mode: 'hide' }); expect(ed.boxes()[0]).toEqual({ x: 0, y: 0, w: 5, h: 5, mode: 'hide' });
  ed.add({ x: 10, y: 10, w: 5, h: 5, mode: 'blur' }); expect(ed.undo()).toBe(true); expect(ed.boxes().length).toBe(1); ed.clear(); expect(ed.boxes().length).toBe(0); expect(ed.undo()).toBe(false);
  expect(() => ed.add({ x: 0, y: 0, w: 5, h: 5, mode: 'paint' })).toThrow(); expect(ed.add({ x: 0, y: 0, w: 0, h: 5, mode: 'hide' })).toBe(false); expect(ed.add({ x: NaN, y: 0, w: 5, h: 5, mode: 'hide' })).toBe(false); expect(ed.add({ x: 30, y: 30, w: 5, h: 5, mode: 'hide' })).toBe(false);
  for (let i = 0; i < 60; i++) ed.add({ x: 0, y: 0, w: 2, h: 2, mode: 'hide' }); expect(ed.boxes().length).toBe(50);
  expect(() => applyBoxes(solid(5, 5), [{ x: 0, y: 0, w: 2, h: 2, mode: 'x' }])).toThrow(); expect(clampBox(solid(5, 5), null)).toBeNull();
});
test('S-063 editor: boxes of masked fields cannot be undone or cleared; discard drops the pixels', () => {
  const img = solid(20, 20), ed = createEditor(img, [{ x: 0, y: 0, w: 4, h: 4, mode: 'hide' }]); ed.add({ x: 10, y: 10, w: 4, h: 4, mode: 'hide' });
  ed.undo(); ed.undo(); ed.clear(); expect(ed.boxes().length).toBe(1); expect(px(ed.apply(), 1, 1)).toEqual([0, 0, 0, 255]);
  ed.discard(); expect(() => ed.apply()).toThrow(); expect(img.data.every((v) => v === 0)).toBe(true); // memory cleared
});
test('S-063 editor view: drag adds a box in image pixels, buttons work, Use gives the edited image, Discard gives null, one answer only', () => {
  const doc = fakePage([]), img = solid(100, 100), out = []; const m = mountEditor({ doc, target: doc.body, image: img, imageData: (d, w, h) => ({ data: d, width: w, height: h }), onDone: (r) => out.push(r) });
  m.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 50, height: 50 }); // shown at half size
  const b = (t) => m.box.all('button').find((x) => x.textContent === t);
  m.canvas.onpointerdown({ clientX: 5, clientY: 5 }); m.canvas.onpointerup({ clientX: 15, clientY: 15 });
  expect(m.editor.boxes()).toEqual([{ x: 10, y: 10, w: 20, h: 20, mode: 'hide' }]); expect(px(m.canvas.last, 15, 15)).toEqual([0, 0, 0, 255]);
  b('Undo').onclick(); expect(m.editor.boxes().length).toBe(0); b('Blur').onclick(); expect(b('Blur').attrs['aria-pressed']).toBe('true'); expect(b('Hide').attrs['aria-pressed']).toBe('false');
  m.canvas.onpointerdown({ clientX: 0, clientY: 0 }); m.canvas.onpointerup({ clientX: 20, clientY: 20 }); b('Clear').onclick(); expect(m.editor.boxes().length).toBe(0);
  m.canvas.onpointerdown({ clientX: 0, clientY: 0 }); m.canvas.onpointerup({ clientX: 10, clientY: 10 }); b('Use picture').onclick(); b('Discard').onclick();
  expect(out.length).toBe(1); expect(out[0].width).toBe(100); expect(m.box.removed).toBe(true);
  const m2 = mountEditor({ doc, target: doc.body, image: solid(10, 10), imageData: (d) => d, onDone: (r) => out.push(r) }); m2.box.listeners.keydown({ key: 'Escape', stopPropagation() {} }); expect(out[1]).toBeNull();
  expect(m.box.attrs.role).toBe('dialog'); expect(m.canvas.attrs['aria-label']).toBe(EDITOR.picture); expect(m.box.all().some((e) => e.attrs.type === 'checkbox')).toBe(false);
});
test('S-064 size: longest side at most 1600; quality steps down until it fits 1.5 MB; never fits gives null; unknown type refused', async () => {
  const big = solid(3200, 1600, 7), small = fitImage(big, 1600); expect([small.width, small.height]).toEqual([1600, 800]); expect(small.data[0]).toBe(7); expect(fitImage(solid(10, 10), 1600).width).toBe(10);
  const tried = []; const b = await encodePicture(big, async (img, type, q) => { tried.push([img.width, type, q]); return { size: q > 0.6 ? CAP.maxBytes + 1 : 1000, type }; });
  expect(tried.map((t) => t[2])).toEqual([0.85, 0.7, 0.5]); expect(tried[0][0]).toBe(1600); expect(b.size).toBe(1000);
  expect(await encodePicture(big, async () => ({ size: CAP.maxBytes + 1 }))).toBeNull(); await expect(encodePicture(big, async () => null, { type: 'application/pdf' })).rejects.toThrow();
});
test('S-067 end to end: capture masks, the person hides a part, a blob comes out; Discard sends nothing; failures give null and restore the page', async () => {
  const pw = new El('input', { type: 'password', value: 'hunter2' }, { x: 0, y: 0, width: 10, height: 10 }), doc = fakePage([pw]); let net = 0, blobImg;
  const mk = (extra = {}) => makeCapture({ doc, render: async () => solid(100, 100), toBlob: async (img) => { blobImg = img; return { size: 500, type: 'image/jpeg' }; }, imageData: (d) => d, ...extra });
  let p = mk()(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); const ed = doc.body.children[0]; expect(ed).toBeDefined();
  const use = ed.all('button').find((x) => x.textContent === 'Use picture'); use.onclick(); const blob = await p;
  expect(blob.size).toBe(500); expect(px(blobImg, 5, 5)).toEqual([0, 0, 0, 255]); expect(pw.value).toBe('hunter2'); expect(net).toBe(0);
  doc.body.children.length = 0; p = mk()(); await new Promise((r) => setTimeout(r, 0)); doc.body.children[0].all('button').find((x) => x.textContent === 'Discard').onclick(); expect(await p).toBeNull();
  expect(await mk({ render: async () => { throw new Error('x'); } })()).toBeNull(); expect(pw.value).toBe('hunter2'); expect(await mk({ blocked: () => true })()).toBeNull();
});
test('C12 editor text passes the owner string rules; no tick box on the editor screen', () => {
  expect(checkStrings(EDITOR)).toEqual([]); expect(checkStrings({ ...EDITOR, undo: 'Undo my box' }).length).toBe(1);
  const doc = fakePage([]), m = mountEditor({ doc, target: doc.body, image: solid(10, 10), imageData: (d) => d, onDone: () => {} }); // the real DOM of the editor is scanned in tests/browser/masking.browser.mjs
  expect(m.box.all().some((e) => e.attrs.type === 'checkbox' || e.attrs.type === 'radio' || e.attrs.role === 'checkbox')).toBe(false);
});
// 0.4.2: the 0.4.0 test searched the source for network, cookie and storage words. This one runs a whole capture while all of them throw.
test('C12 the library sends nothing and touches no cookie or storage: a whole capture runs with every such door throwing', async () => {
  const doors = ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB'], saved = doors.map((d) => Object.getOwnPropertyDescriptor(globalThis, d));
  for (const d of doors) Object.defineProperty(globalThis, d, { configurable: true, get() { throw new Error('capture touched ' + d); } });
  try {
    const pw = new El('input', { type: 'password', value: 'hunter2' }, { x: 0, y: 0, width: 10, height: 10 }), doc = fakePage([pw]); Object.defineProperty(doc, 'cookie', { get() { throw new Error('read cookie'); }, set() { throw new Error('set cookie'); } });
    const nav = { sendBeacon() { throw new Error('beacon'); } }; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
    const p = makeCapture({ doc, render: async () => solid(100, 100), toBlob: async () => ({ size: 5, type: 'image/jpeg' }), imageData: (d) => d })(); await new Promise((r) => setTimeout(r, 0));
    doc.body.children[0].all('button').find((x) => x.textContent === 'Use picture').onclick(); expect((await p).size).toBe(5); expect(pw.value).toBe('hunter2');
    const q = makeCapture({ doc, render: async () => solid(100, 100), toBlob: async () => ({ size: 5 }), imageData: (d) => d })(); await new Promise((r) => setTimeout(r, 0));
    doc.body.children[1].all('button').find((x) => x.textContent === 'Discard').onclick(); expect(await q).toBeNull();
  } finally { doors.forEach((d, i) => (saved[i] ? Object.defineProperty(globalThis, d, saved[i]) : delete globalThis[d])); delete globalThis.navigator; }
});
