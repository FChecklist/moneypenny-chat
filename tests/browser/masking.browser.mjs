// Real-browser tests of screenshot masking: the REAL capture library (core/widget/shot) runs on a real page in Chromium, with real layout, real canvas, real pointer drags and
// real image encoding. The DOM-to-pixels engine is the one thing not shipped yet (owner decision), so the test uses the browser's own screenshot of the page as the engine:
// it is taken at the moment the library has blanked the secret fields, which is exactly when a real engine would read the page.
// "Not readable" is shown two ways: every pixel of a masked field box is the same black in the picture, and the same box in an unmasked picture of the same page is full of text.
// Run: bun run test:browser
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { launchBrowser, makeRig, ui, SECRETS } from './rig.mjs';

let browser, captureJs;
beforeAll(async () => {
  browser = await launchBrowser();
  const r = await Bun.build({ entrypoints: [new URL('./capture-entry.js', import.meta.url).pathname], target: 'browser', format: 'esm' });
  if (!r.success) throw new Error('capture test bundle failed: ' + r.logs.join(' '));
  captureJs = await r.outputs[0].text();
});
afterAll(async () => { if (browser) await browser.close(); });
const T = 120_000;

// A page with the widget and the real capture library, and a picture engine made from Playwright's screenshot.
async function setup() {
  const rig = await makeRig(); rig.login('sid-org', { role: 'organizer', user_id: 'user-1001' });
  const { page, requests, errors } = await rig.open(browser, { sid: 'sid-org', viewport: { width: 900, height: 620 } });
  await page.exposeFunction('__pwShot', async () => (await page.screenshot({ type: 'png' })).toString('base64'));
  await page.addScriptTag({ type: 'module', content: captureJs }); await page.waitForFunction(() => !!window.__mpcShot);
  await page.evaluate(() => { // helpers that live in the page
    const decode = async (blobOrB64) => { const blob = typeof blobOrB64 === 'string' ? new Blob([Uint8Array.from(atob(blobOrB64), (c) => c.charCodeAt(0))], { type: 'image/png' }) : blobOrB64;
      const bmp = await createImageBitmap(blob), c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, bmp.width, bmp.height); return { width: d.width, height: d.height, data: d.data }; };
    window.__decode = decode;
    window.__render = async () => decode(await window.__pwShot()); // the engine: what the page looks like right now
    window.__toBlob = (img, type, q) => new Promise((res) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0); c.toBlob(res, type, q); });
    // distinct colours and how many pixels are not opaque black inside a box
    window.__stats = (img, r) => { const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(img.width, Math.ceil(r.x + r.w)), y1 = Math.min(img.height, Math.ceil(r.y + r.h)); const seen = new Set(); let nonBlack = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.width + x) * 4, d = img.data; seen.add((d[i] << 24 | d[i + 1] << 16 | d[i + 2] << 8 | d[i + 3]) >>> 0); if (!(d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 255)) nonBlack++; n++; }
      return { n, distinct: seen.size, nonBlack }; };
    // lossy files (JPEG) smear the edge of a box a little: look at the inside, 6 px in from every side. Any bright pixel there would be something that was not hidden.
    window.__interior = (img, r, inset = 6) => { const x0 = Math.ceil(r.x + inset), y0 = Math.ceil(r.y + inset), x1 = Math.floor(r.x + r.w - inset), y1 = Math.floor(r.y + r.h - inset); let n = 0, bright = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.width + x) * 4; n++; if (Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) > 24) bright++; } return { n, bright }; };
    const rect = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    window.__rects = () => ({ title: rect('#title'), pw: rect('#pw'), em: rect('#em'), card: rect('#card'), note: rect('#note') });
  });
  return { rig, page, requests, errors };
}
const MASKED = ['pw', 'em', 'card', 'note'];

test('MASKING: a masked field box is one flat black in the picture, while the same box in an unmasked picture of the page is full of text; the other fields stay readable; the widget is not in the picture', async () => {
  const { page, requests } = await setup(); await ui.open(page); // the widget panel is open: it must not be in the picture
  const out = await page.evaluate(async () => {
    const rects = window.__rects(), control = await window.__render(); // the same page, nothing masked: the secrets are on the screen
    const p = await window.__mpcShot.takePicture({ doc: document, render: window.__render });
    const brand = (img) => { let n = 0; for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 31 && img.data[i + 1] === 78 && img.data[i + 2] === 140) n++; return n; };
    const pic = {}, ctl = {}; for (const k of Object.keys(rects)) { pic[k] = window.__stats(p.image, rects[k]); ctl[k] = window.__stats(control, rects[k]); }
    return { pic, ctl, masked: p.masked, boxes: p.secretBoxes.length, brandInPicture: brand(p.image), brandInControl: brand(control), size: [p.image.width, p.image.height],
      back: { pw: document.querySelector('#pw').value, em: document.querySelector('#em').value, card: document.querySelector('#card').value, vis: document.querySelector('#pw').style.visibility, note: document.querySelector('#note').style.visibility, host: document.querySelector('[data-mpc-hide-zone]').style.visibility } };
  });
  for (const k of MASKED) {
    expect([k, out.pic[k].distinct, out.pic[k].nonBlack]).toEqual([k, 1, 0]);                 // one colour, and it is black: nothing of the text can be read
    expect([k, out.ctl[k].distinct >= 4, out.ctl[k].nonBlack > 20]).toEqual([k, true, true]); // the same box, unmasked, has text: the check can fail
  }
  expect(out.pic.title.distinct).toBeGreaterThanOrEqual(4); expect(out.pic.title.nonBlack).toBeGreaterThan(out.pic.title.n / 2); // a plain field is left alone and readable
  expect(out.masked).toBe(4); expect(out.boxes).toBe(4); expect(out.size).toEqual([900, 620]);
  expect(out.brandInControl).toBeGreaterThan(500); expect(out.brandInPicture).toBe(0); // the widget button (brand colour) is in the control and not in the picture
  expect(out.back).toEqual({ pw: SECRETS.password, em: SECRETS.email, card: SECRETS.card, vis: '', note: '', host: '' }); // the page is put back exactly
  expect(await page.locator('#pw').inputValue()).toBe(SECRETS.password); expect(await page.locator('.fab').isVisible()).toBe(true);
  expect(requests.filter((r) => r.method === 'POST').length).toBe(0); // nothing is sent from the library
}, T);

test('MASKING: second line of defence: if the picture engine ignores the blank and draws the secrets, the boxes are still burned black', async () => {
  const { page } = await setup();
  const out = await page.evaluate(async () => {
    const rects = window.__rects(), unmasked = await window.__render(); // taken BEFORE masking: the secrets are in the pixels
    const p = await window.__mpcShot.takePicture({ doc: document, render: async () => unmasked }); const pic = {}, before = {};
    for (const k of Object.keys(rects)) { pic[k] = window.__stats(p.image, rects[k]); before[k] = window.__stats(unmasked, rects[k]); }
    return { pic, before };
  });
  for (const k of MASKED) { expect([k, out.before[k].distinct >= 4]).toEqual([k, true]); expect([k, out.pic[k].distinct, out.pic[k].nonBlack]).toEqual([k, 1, 0]); }
  expect(out.pic.title.distinct).toBeGreaterThanOrEqual(4);
}, T);

test('MASKING: the whole capture with the editor: a real mouse drag hides one more part, Use picture gives a re-encoded file (PNG and JPEG) with the masked boxes black, no EXIF, within the size cap; Discard sends nothing', async () => {
  const { page, requests } = await setup();
  const start = (type) => page.evaluate(async (type) => { // opens the capture; the editor goes into a plain overlay so it can be driven with the mouse
    const target = document.createElement('div'); target.id = 'ed'; target.style.cssText = 'position:fixed;inset:0;overflow:auto;background:#fff;z-index:99999;font:16px system-ui';
    document.body.append(target); window.__rects0 = window.__rects();
    window.__done = window.__mpcShot.makeCapture({ doc: document, target, render: window.__render, toBlob: window.__toBlob, type })(); }, type);
  const analyse = (names) => page.evaluate(async (names) => { const blob = await window.__done; if (!blob) return null; const img = await window.__decode(blob), r = window.__rects0, u8 = new Uint8Array(await blob.arrayBuffer());
    const has = (a, seq) => { outer: for (let i = 0; i + seq.length <= a.length; i++) { for (let j = 0; j < seq.length; j++) if (a[i + j] !== seq[j]) continue outer; return true; } return false; };
    const stats = {}, inner = {}; for (const k of names) { stats[k] = window.__stats(img, r[k]); inner[k] = window.__interior(img, r[k]); }
    return { type: blob.type, bytes: blob.size, size: [img.width, img.height], stats, inner, exif: has(u8, [0x45, 0x78, 0x69, 0x66]) || has(u8, [0x65, 0x58, 0x49, 0x66]) /* "Exif" in JPEG, "eXIf" chunk in PNG */, head: [...u8.slice(0, 4)] }; }, names);
  const dialog = page.getByRole('dialog', { name: 'Hide parts before sending' });
  const dragOver = async (rect) => { const cv = dialog.locator('canvas'); await cv.scrollIntoViewIfNeeded(); const b = await cv.boundingBox(); expect(b.width).toBeGreaterThan(800); // shown at its own size
    await page.mouse.move(b.x + rect.x - 2, b.y + rect.y - 2); await page.mouse.down(); await page.mouse.move(b.x + rect.x + rect.w / 2, b.y + rect.y + rect.h / 2, { steps: 5 }); await page.mouse.move(b.x + rect.x + rect.w + 2, b.y + rect.y + rect.h + 2, { steps: 5 }); await page.mouse.up(); };
  // PNG: hide the plain "Game title" field by hand as well
  await start('image/png'); await dialog.waitFor(); expect(await dialog.locator('canvas').getAttribute('aria-label')).toBe('Picture preview');
  const rects = await page.evaluate(() => window.__rects0); await dragOver(rects.title);
  await dialog.getByRole('button', { name: 'Use picture', exact: true }).click(); const png = await analyse([...MASKED, 'title']);
  expect(png.type).toBe('image/png'); expect(png.head).toEqual([0x89, 0x50, 0x4e, 0x47]); expect(png.exif).toBe(false);
  for (const k of [...MASKED, 'title']) expect([k, png.stats[k].distinct, png.stats[k].nonBlack]).toEqual([k, 1, 0]); // the masked boxes, and the box the person hid with the mouse
  expect(png.bytes).toBeLessThanOrEqual(1.5 * 1024 * 1024); expect(await page.locator('#ed canvas').count()).toBe(0); // the editor closed itself and dropped the pixels
  // JPEG (the default type): lossy, so "black" means near black; still re-encoded from pixels, so no EXIF
  await page.locator('#ed').evaluate((e) => e.remove()); await start('image/jpeg'); await dialog.waitFor(); await dialog.getByRole('button', { name: 'Use picture', exact: true }).click();
  const jpg = await analyse(MASKED); expect(jpg.type).toBe('image/jpeg'); expect(jpg.head.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]); expect(jpg.exif).toBe(false); expect(Math.max(...jpg.size)).toBeLessThanOrEqual(1600);
  for (const k of MASKED) expect([k, jpg.inner[k].n > 200, jpg.inner[k].bright]).toEqual([k, true, 0]); // inside every masked box: no bright pixel at all, so no text
  // Discard: no file, nothing sent
  await page.locator('#ed').evaluate((e) => e.remove()); await start('image/jpeg'); await dialog.waitFor(); await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  expect(await analyse(['pw'])).toBeNull(); expect(requests.filter((r) => r.method === 'POST').length).toBe(0);
  expect(await page.locator('#pw').inputValue()).toBe(SECRETS.password); // the page is whole after every path
}, T);

test('MASKING: the shipped bundle has no screenshot button yet (the owner has not approved a picture engine), so no picture can leave the page', async () => {
  const { page, requests } = await setup(); await ui.open(page); await ui.tap(page, 'Suggest an option or feature'); await ui.tap(page, 'Option');
  expect(await ui.text(page)).not.toMatch(/screenshot|picture/i); expect(await page.getByRole('button', { name: /screenshot/i }).count()).toBe(0);
  await ui.type(page, 'The idea', 'Please add a small timer here'); await ui.tap(page, 'Send'); await page.locator('.panel h2', { hasText: 'Sent. Thank you.' }).waitFor();
  expect(requests.some((r) => r.path === '/mpc/v1/screenshots')).toBe(false);
}, T);
