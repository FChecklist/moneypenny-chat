// Real-browser tests of the BUILT widget bundle (Playwright Chromium). They replace the weak checks of 0.4.0 and 0.4.1 (a regex over the cookie source, comment stripping,
// a small fake DOM, a fake fetch). Here the bundle is loaded by a real page, a person clicks it, and the real instance Worker and the real core (on the real SQL schema) answer.
// See tests/browser/rig.mjs for what is real and what is replaced (only the network wire). Run: bun run test:browser
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { launchBrowser, makeRig, ui, EVIL } from './rig.mjs';
import { STANDARD_AI_LINE, checkStrings } from '../../contract/strings-rules.mjs';
import { NOTICE } from '../../core/src/strings.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let browser, built;
beforeAll(async () => {
  browser = await launchBrowser();
  // the file the build script writes for one instance, exactly as `bun scripts/build-widget.mjs corporatetambola` makes it (the first test serves this very file)
  const out = mkdtempSync(join(tmpdir(), 'mpc-built-')), r = Bun.spawnSync(['bun', 'scripts/build-widget.mjs', 'corporatetambola', '--out', out], { cwd: new URL('../../', import.meta.url).pathname });
  if (r.exitCode !== 0) throw new Error('build script failed: ' + r.stderr.toString()); built = { out, file: join(out, 'corporatetambola', 'widget.js') };
});
afterAll(async () => { if (browser) await browser.close(); if (built) rmSync(built.out, { recursive: true, force: true }); });
const T = 120_000, H = 3600e3;
const AI_URL = /^https:\/\/home\.corporatetambola\.com\/ai\/[A-Za-z0-9_-]{22}\?k=mpk_[A-Za-z0-9]{40}$/;
const ORG = { role: 'organizer', user_id: 'user-1001' };
async function person(rig, o = {}) { const sid = o.sid || 'sid-org'; rig.login(sid, o.who || ORG); return rig.open(browser, { sid, ...o }); }
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const ticketResponse = (page) => page.waitForResponse((r) => r.url().endsWith('/mpc/v1/tickets') && r.request().method() === 'POST');
const stuck = async (page, what = 'The link does not open for players') => { // the stuck flow, ending on "Sent. Thank you."
  await ui.tap(page, 'Stuck: tell where'); await ui.tap(page, 'Yes, this screen'); await ui.tap(page, 'A link does not work'); await ui.type(page, 'What happened', what); await ui.tap(page, 'Next');
  const done = ticketResponse(page); await ui.tap(page, 'Send'); const res = await (await done).json(); await page.locator('.panel h2', { hasText: 'Sent. Thank you.' }).waitFor(); return res;
};
const bytes = (s) => [...new TextEncoder().encode(s)];

test('LOADS: the built file is served with the right headers and mounts one shadow-root host; nothing lands in the page; no cookie, storage or console error', async () => {
  const rig = await makeRig({ widgetFile: built.file }), { page, context, errors, requests } = await person(rig);
  const js = requests.find((r) => r.path === '/mpc/widget.js'); expect(js.status).toBe(200);
  expect(await page.evaluate(async () => (await fetch('/mpc/widget.js')).text())).toBe(readFileSync(built.file, 'utf8')); // the browser got the built file, byte for byte
  expect(js.resHeaders['content-type']).toStartWith('text/javascript'); expect(js.resHeaders['cache-control']).toBe('public, max-age=300');
  expect(js.resHeaders['set-cookie']).toBeUndefined(); expect(js.resHeaders['access-control-allow-origin']).toBeUndefined();
  const dom = await page.evaluate(() => { const hosts = [...document.body.children].filter((e) => e.shadowRoot); const fab = hosts[0].shadowRoot.querySelector('.fab'), r = fab.getBoundingClientRect();
    return { hosts: hosts.length, light: hosts[0].children.length, zone: hosts[0].hasAttribute('data-mpc-hide-zone'), mode: hosts[0].shadowRoot.mode, styles: document.querySelectorAll('style').length, fab: fab.textContent, w: r.width, h: r.height, popup: fab.getAttribute('aria-haspopup') }; });
  expect({ hosts: dom.hosts, light: dom.light, zone: dom.zone, mode: dom.mode, styles: dom.styles, fab: dom.fab, popup: dom.popup }).toEqual({ hosts: 1, light: 0, zone: true, mode: 'open', styles: 1 /* the product's own */, fab: 'Moneypenny', popup: 'dialog' });
  expect(dom.w).toBeGreaterThanOrEqual(44); expect(dom.h).toBeGreaterThanOrEqual(44);
  const cookies = async () => (await context.cookies()).map((c) => c.name + '=' + c.value);
  const before = await cookies(); await ui.open(page); await ui.suggest(page); await ui.tap(page, 'Copy link');
  expect(await cookies()).toEqual(before); expect(before).toEqual(['sid=sid-org']); // the widget set no cookie; the product's own one is unchanged
  const store = await page.evaluate(async () => ({ doc: document.cookie, local: localStorage.length, session: sessionStorage.length, idb: (await indexedDB.databases()).length, caches: (await caches.keys()).length }));
  expect(store).toEqual({ doc: '', local: 0, session: 0, idb: 0, caches: 0 }); // HttpOnly cookie is invisible to the page, and nothing is stored in the browser
  for (const r of requests.filter((x) => x.path.startsWith('/mpc/'))) expect(r.resHeaders['set-cookie']).toBeUndefined();
  expect(errors).toEqual([]);
}, T);

test('LOADS: page CSS cannot reach the widget (a hostile product style sheet hides every button, heading and label and shrinks all text); the widget keeps its own look', async () => {
  const rig = await makeRig(); rig.hostile.on = true; const { page } = await person(rig);
  const control = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize); expect(control).toBe('3px'); // the hostile style sheet really is active on the page
  const fab = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('[data-mpc-hide-zone]').shadowRoot.querySelector('.fab')); return { d: c.display, bg: c.backgroundColor, fg: c.color, fs: c.fontSize }; });
  expect(fab).toEqual({ d: 'block', bg: 'rgb(31, 78, 140)', fg: 'rgb(255, 255, 255)', fs: '16px' });
  await ui.open(page);
  const inside = await page.evaluate(() => { const r = document.querySelector('[data-mpc-hide-zone]').shadowRoot, q = (s) => getComputedStyle(r.querySelector(s));
    return { h2: q('.panel h2').display + '/' + q('.panel h2').fontSize, p: q('.panel p').display, btn: q('.panel button:not(header button)').display + '/' + q('.panel button:not(header button)').backgroundColor, panel: q('.panel').display }; });
  expect(inside.h2).toBe('block/17.6px'); expect(inside.p).toBe('block'); expect(inside.btn).toBe('block/rgb(31, 78, 140)'); expect(inside.panel).toBe('block');
  expect(await ui.text(page)).toContain('What do you need?');
}, T);

test('LOADS: keyboard and size: every control is 44 px or more, Tab reaches the buttons in order, Enter works, Escape closes and puts focus back on the button; text and buttons have enough contrast', async () => {
  const rig = await makeRig(), { page } = await person(rig);
  await ui.open(page);
  const small = await page.evaluate(() => [...document.querySelector('[data-mpc-hide-zone]').shadowRoot.querySelectorAll('.panel button')].map((b) => [b.textContent, Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
  expect(small).toEqual([]);
  const focused = () => page.evaluate(() => { const a = document.querySelector('[data-mpc-hide-zone]').shadowRoot.activeElement; return a ? a.tagName + ':' + a.textContent : null; });
  expect(await focused()).toBe('H2:Moneypenny Chat'); // focus lands on the title
  const order = []; for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); order.push(await focused()); }
  expect(order).toEqual(['BUTTON:Close', 'BUTTON:Need help', 'BUTTON:Suggest an option or feature', 'BUTTON:Stuck: tell where']);
  await page.keyboard.press('Enter'); await page.locator('.panel h2', { hasText: 'Stuck on this screen?' }).waitFor(); // Enter on the focused "Stuck" button opens its page
  await page.keyboard.press('Escape'); await page.locator('.panel').waitFor({ state: 'hidden' }); expect(await focused()).toBe('BUTTON:Moneypenny'); // Escape closes; focus returns to the opener
  const lum = (c) => { const v = c.match(/\d+/g).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  await ui.open(page); await ui.tap(page, 'Back'); await ui.tap(page, 'Suggest an option or feature'); await ui.tap(page, 'Option'); // the panel kept its place: back to home, then the idea page
  const colours = await page.evaluate(() => { const r = document.querySelector('[data-mpc-hide-zone]').shadowRoot, c = (s) => getComputedStyle(r.querySelector(s)); const prim = c('.panel button:not(header button)');
    return { text: [c('.panel p').color, c('.panel').backgroundColor], button: [prim.color, prim.backgroundColor], fab: [c('.fab').color, c('.fab').backgroundColor], link: [c('.panel header button').color, c('.panel').backgroundColor] }; });
  for (const [name, [fg, bg]] of Object.entries(colours)) expect([name, ratio(fg, bg) >= 4.5]).toEqual([name, true]);
}, T);

test('CONSENT STEP: sending shares the text only after Send; the notice has a Terms link and no tick box; no word of agreeing, no Hindi; every screen passes the owner word rules', async () => {
  const strings = { terms_url: 'https://home.corporatetambola.com/terms' }, rig = await makeRig({ strings }), { page, context, requests } = await person(rig);
  await ui.open(page); await ui.tap(page, 'Suggest an option or feature'); await ui.tap(page, 'Option');
  const notice = page.locator('.panel p.notice'); expect(await notice.innerText()).toBe(NOTICE);
  const a = notice.locator('a'); expect(await a.count()).toBe(1); expect(await a.innerText()).toBe('Terms'); expect(await a.getAttribute('href')).toBe(strings.terms_url);
  expect(await a.getAttribute('target')).toBe('_blank'); expect(await a.getAttribute('rel')).toBe('noopener noreferrer');
  const [tab] = await Promise.all([context.waitForEvent('page'), a.click()]); await tab.waitForLoadState(); expect(new URL(tab.url()).pathname).toBe('/terms'); expect(await tab.evaluate(() => window.opener)).toBeNull(); await tab.close();
  const send = page.getByRole('button', { name: 'Send', exact: true });
  expect(await send.isDisabled()).toBe(true); await ui.type(page, 'The idea', '123456789'); expect(await send.isDisabled()).toBe(true); await ui.type(page, 'The idea', 'Please add a small timer'); expect(await send.isDisabled()).toBe(false);
  expect(requests.filter((r) => r.method === 'POST' && r.path.startsWith('/mpc/v1/')).length).toBe(0); // typed, not sent: nothing leaves the page until Send
  await send.click(); await page.locator('.panel h2', { hasText: 'Sent. Thank you.' }).waitFor(); // no tick needed
  expect(requests.filter((r) => r.method === 'POST' && r.path === '/mpc/v1/tickets').length).toBe(1);

  // every screen, in the real DOM (a fresh page for each branch, so the widget starts from home)
  const seen = []; const grab = async () => { seen.push({ title: await ui.title(page), text: await ui.text(page), html: await page.locator('.panel').evaluate((p) => ({ inputs: [...p.querySelectorAll('input')].map((i) => i.type), roles: [...p.querySelectorAll('[role]')].map((e) => e.getAttribute('role')), aria: [...p.querySelectorAll('[aria-checked],[aria-pressed],[aria-selected]')].length })) }); };
  const fresh = async () => { await page.reload(); await page.locator('.fab').waitFor(); await ui.open(page); };
  await fresh(); await grab();                                                                                       // home
  await ui.tap(page, 'Need help'); await grab(); await ui.tap(page, 'Price of a game'); await grab();                 // help topics, help answer
  await fresh(); await ui.tap(page, 'Need help'); await ui.tap(page, 'Something else'); await grab();                 // help: a few words
  await fresh(); await ui.tap(page, 'Suggest an option or feature'); await grab(); await ui.tap(page, 'Wording'); await grab(); // suggest type, suggest write
  await ui.type(page, 'The idea', 'Please add a small timer'); await ui.tap(page, 'Send'); await page.locator('.panel h2', { hasText: 'Sent. Thank you.' }).waitFor(); await grab(); // suggest sent
  await fresh(); await ui.tap(page, 'Stuck: tell where'); await grab(); await ui.tap(page, 'Yes, this screen'); await grab(); await ui.tap(page, 'A link does not work'); await grab(); // stuck where, what, write
  await ui.type(page, 'What happened', 'Players cannot open it'); await ui.tap(page, 'Next'); await grab();           // check and send
  await ui.tap(page, 'Send'); await page.locator('.panel h2', { hasText: 'Sent. Thank you.' }).waitFor(); await grab(); // stuck sent
  await ui.tap(page, 'Check status'); await page.locator('.panel', { hasText: /Ticket T-\d+: new\./ }).waitFor(); await grab(); // status
  expect(seen.length).toBe(13);
  for (const s of seen) {
    expect([s.title, s.html.inputs.filter((t) => t !== 'text')]).toEqual([s.title, []]); expect(s.html.roles.filter((r) => ['checkbox', 'radio', 'switch', 'option'].includes(r))).toEqual([]); expect(s.html.aria).toBe(0);
    expect(s.text).not.toMatch(/\b(agree|accept|consent|tick|checkbox|check box)\b/i); expect(s.text).not.toMatch(/[\u0900-\u097F]/); // no tick box, no "I agree", no Hindi line
    expect(checkStrings(s.text.split('\n').filter(Boolean)), s.title).toEqual([]); // my/your, host, we/our/us, bare ID, nickname
  }
}, T);

test('CONSENT STEP: with no Terms page given (the shipped records) the notice has no link, as the owner decided; the screen still has no tick box', async () => {
  const rig = await makeRig(), { page } = await person(rig);
  await ui.open(page); await ui.tap(page, 'Stuck: tell where'); await ui.tap(page, 'Yes, this screen'); await ui.tap(page, 'Game will not start'); await ui.tap(page, 'Next');
  const n = page.locator('.panel p.notice'); expect(await n.innerText()).toBe(NOTICE.replace(' Read the Terms.', '')); expect(await n.locator('a').count()).toBe(0);
  expect(await page.locator('.panel').evaluate((p) => p.querySelectorAll('input,[role=checkbox],[role=radio]').length)).toBe(0);
  expect(rig.strings.terms_url).toBeNull();
}, T);

test('STANDARD LINE: exact on the help answer, the sent idea and the sent problem, never on home; Copy link puts a working AI link on the clipboard (with and without a ticket)', async () => {
  const rig = await makeRig(), { page, requests, context } = await person(rig);
  await ui.open(page); const home = await ui.text(page); expect(home).not.toContain('Copy link'); expect(home).not.toContain(STANDARD_AI_LINE);
  const line = async () => { const t = await ui.text(page); expect(t.split('\n')).toContain(STANDARD_AI_LINE); return t; };
  // 1. a help answer: no ticket exists, so the link is for the screen only
  await ui.tap(page, 'Need help'); await ui.tap(page, 'Price of a game'); await line(); await ui.tap(page, 'Copy link');
  await page.locator('.panel [role=status]').filter({ hasText: 'Link copied.' }).waitFor(); const c1 = await clip(page); expect(c1).toMatch(AI_URL);
  const l1 = requests.filter((r) => r.path === '/mpc/ai-link').at(-1); expect([l1.status, l1.headers['x-mpc-status-token']]).toEqual([201, undefined]);
  // 2. a sent idea: the link is for that ticket and carries its status token as a header
  await ui.tap(page, 'Got it'); const made = ticketResponse(page); await ui.suggest(page); const tk = await (await made).json(); await line();
  await ui.tap(page, 'Copy link'); await page.locator('.panel [role=status]').filter({ hasText: 'Link copied.' }).waitFor(); const c2 = await clip(page); expect(c2).toMatch(AI_URL); expect(c2).not.toBe(c1);
  const l2 = requests.filter((r) => r.path === '/mpc/ai-link').at(-1); expect([l2.status, l2.headers['x-mpc-status-token']]).toEqual([201, tk.status_token]);
  // 3. a sent problem
  await ui.tap(page, 'Done'); await stuck(page); await line(); await ui.tap(page, 'Copy link'); await page.locator('.panel [role=status]').filter({ hasText: 'Link copied.' }).waitFor(); expect(await clip(page)).toMatch(AI_URL);
  // the line is the owner's bytes, in the real DOM (44 ASCII bytes)
  const domLine = await page.locator('.panel p', { hasText: 'Copy this link' }).innerText(); expect(bytes(domLine)).toEqual(bytes(STANDARD_AI_LINE)); expect(domLine.length).toBe(44);
  // what the AI is given: the page opens for the link, shows the ticket of link 2 and says "none" for link 1; the key itself is not in the page
  const ai = await context.newPage(); const get = (u) => ai.evaluate(async (x) => { const r = await fetch(x, { credentials: 'omit' }); return { status: r.status, type: r.headers.get('content-type'), body: await r.text() }; }, u);
  await ai.goto(rig.origin + '/terms');
  const p1 = await get(c1), p2 = await get(c2); expect([p1.status, p2.status]).toEqual([200, 200]); expect(p1.type).toStartWith('text/markdown');
  expect(p1.body).toContain('ticket: none'); expect(p2.body).toContain('ticket: ' + tk.ticket); expect(p2.body).not.toContain(new URL(c2).searchParams.get('k'));
  expect(p2.body).toContain('You must NEVER: make or start a payment'); // the rules of the page the AI reads
}, T);

test('SESSION ADAPTER: the role comes from the product server session, not the page; a co-organizer is stored as co-organizer; no or bad session sends nothing; a product fault fails closed and recovers', async () => {
  const rig = await makeRig(), seen = rig.product.seen;
  // a host (the product word) is a co-organizer; the page tries to claim organizer in the body and in a header
  const { page } = await person(rig, { sid: 'sid-host', who: { role: 'host', user_id: 'user-2002' } });
  const forged = await page.evaluate(async () => { const r = await fetch('/mpc/v1/tickets', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'x-mpc-role': 'organizer', 'x-role': 'organizer' }, body: JSON.stringify({ option: 'suggest', type: 'feature', text: 'Please add a small timer here', screen: '/console/x', role: 'organizer' }) }); return { status: r.status, body: await r.json() }; });
  expect(forged.status).toBe(201); expect((await rig.core.store.getTicket('corporatetambola', forged.body.ticket, rig.now())).role).toBe('co-organizer');
  const asked = seen.filter((s) => s.path === '/mpc/session').at(-1); expect(Object.keys(asked.headers)).toEqual(['cookie']); expect(asked.headers.cookie).toBe('sid=sid-host'); // the product is told the cookie and nothing the page wrote
  // widget path, organizer
  const org = await person(rig, { sid: 'sid-org' }); await ui.open(org.page); await ui.suggest(org.page, 'Please add a second timer'); const t2 = await rig.core.store.getTicket('corporatetambola', 'T-0002', rig.now()); expect(t2.role).toBe('organizer');
  // no cookie at all: the product is not even asked, the person is told in plain words, nothing is stored
  const none = await rig.open(browser, {}); const before = seen.length, count = async () => (await rig.core.store.listTickets({ instance: 'corporatetambola', now: rig.now() })).items.length, n0 = await count();
  await ui.open(none.page); await ui.tap(none.page, 'Suggest an option or feature'); await ui.tap(none.page, 'Option'); await ui.type(none.page, 'The idea', 'Please add a third timer'); await ui.tap(none.page, 'Send');
  await none.page.locator('.panel .err').waitFor(); expect(await none.page.locator('.panel .err').innerText()).toBe('Not sent. Try again.'); expect(seen.length).toBe(before); expect(await count()).toBe(n0);
  expect(none.requests.find((r) => r.path === '/mpc/v1/tickets').status).toBe(403);
  // a cookie the product does not know
  const bad = await rig.open(browser, { sid: 'sid-unknown' }); await ui.open(bad.page); await ui.tap(bad.page, 'Suggest an option or feature'); await ui.tap(bad.page, 'Option'); await ui.type(bad.page, 'The idea', 'Please add a fourth timer'); await ui.tap(bad.page, 'Send');
  await bad.page.locator('.panel .err').waitFor(); expect(await count()).toBe(n0); expect(JSON.parse(bad.requests.find((r) => r.path === '/mpc/v1/tickets').reply).error).toBe('role');
  // a role the instance does not know (the product says "player"): refused, no default role
  rig.login('sid-player', { role: 'player', user_id: 'user-3003' }); const pl = await rig.open(browser, { sid: 'sid-player' }); await ui.open(pl.page); await ui.tap(pl.page, 'Suggest an option or feature'); await ui.tap(pl.page, 'Option'); await ui.type(pl.page, 'The idea', 'Please add a fifth timer'); await ui.tap(pl.page, 'Send');
  await pl.page.locator('.panel .err').waitFor(); expect(await count()).toBe(n0);
  // the product is down: the widget retries with one key, then says so; nothing is stored. When it is back, one tap sends one ticket.
  rig.product.state.fault = true; const down = await person(rig, { sid: 'sid-org' }); await ui.open(down.page); await ui.tap(down.page, 'Suggest an option or feature'); await ui.tap(down.page, 'Option'); await ui.type(down.page, 'The idea', 'Please add a sixth timer'); await ui.tap(down.page, 'Send');
  await down.page.locator('.panel .err').waitFor({ timeout: 15000 }); expect(await down.page.locator('.panel .err').innerText()).toBe('Not sent. Try again.'); expect(await count()).toBe(n0);
  const posts = down.requests.filter((r) => r.path === '/mpc/v1/tickets'); expect(posts.length).toBe(3); expect(posts.map((p) => p.status)).toEqual([503, 503, 503]); expect(new Set(posts.map((p) => p.headers['idempotency-key'])).size).toBe(1); // 3 tries, one key
  rig.product.state.fault = false; await ui.tap(down.page, 'Send'); await down.page.locator('.panel h2', { hasText: 'Sent. Thank you.' }).waitFor(); expect(await count()).toBe(n0 + 1);
}, T);

test('SESSION ADAPTER: a page of another site cannot send a ticket or ask for a link with the person\'s session: no cookie goes with the request, the Origin is refused before the product is asked, and nothing is stored', async () => {
  const rig = await makeRig(); rig.login('sid-org', ORG); const { page, requests, context } = await rig.open(browser, { sid: 'sid-org', goto: false });
  await page.goto(EVIL + '/'); const count = async () => (await rig.core.store.listTickets({ instance: 'corporatetambola', now: rig.now() })).items.length, n0 = await count();
  // plain text POSTs are "simple" requests: a browser sends them across sites without asking first. They must still be refused.
  const body = JSON.stringify({ option: 'suggest', type: 'feature', text: 'Please add a small timer here', screen: '/x', role: 'organizer' });
  await page.evaluate(async ([target, b]) => { for (const [path, payload] of [['/mpc/v1/tickets', b], ['/mpc/ai-link', '{"kind":"help"}']]) { try { await fetch(target + path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: payload }); } catch { /* the page may not read the answer */ } } }, [rig.origin, body]);
  const sent = requests.filter((r) => r.method === 'POST' && r.headers.origin === EVIL); expect(sent.map((r) => [r.path, r.status, JSON.parse(r.reply).error])).toEqual([['/mpc/v1/tickets', 403, 'origin'], ['/mpc/ai-link', 403, 'origin']]);
  for (const r of sent) expect(r.headers.cookie).toBeUndefined(); // the session cookie is not sent across sites (SameSite)
  expect(await count()).toBe(n0); expect(rig.product.keys.keys.size).toBe(0); expect(rig.product.seen).toEqual([]); // refused before the product was asked and before any key was made
  await context.close();
}, T);

test('STATUS TOKEN: a link for a sent ticket works; for a ticket that is not the person\'s own it is refused in the real browser, and no key is made', async () => {
  const rig = await makeRig(), a = await person(rig, { sid: 'sid-a', who: { role: 'organizer', user_id: 'user-a' } }), b = await person(rig, { sid: 'sid-b', who: { role: 'organizer', user_id: 'user-b' } });
  await ui.open(a.page); const mine = await stuck(a.page); await ui.open(b.page); const theirs = await stuck(b.page, 'Players cannot join the game');
  const keysBefore = rig.product.keys.keys.size;
  const ask = (page, body, token) => page.evaluate(async ([b, t]) => { const r = await fetch('/mpc/ai-link', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...(t ? { 'x-mpc-status-token': t } : {}) }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; }, [body, token]);
  for (const [name, token] of [['no token', null], ['the other person\'s token for my ticket', theirs.status_token], ['a made-up token', 'x'.repeat(43)]]) { const r = await ask(a.page, { kind: 'stuck', ticket: mine.ticket }, token); expect([name, r.status, r.body.error]).toEqual([name, 403, 'not_yours']); }
  const swapped = await ask(b.page, { kind: 'stuck', ticket: mine.ticket }, theirs.status_token); expect([swapped.status, swapped.body.error]).toEqual([403, 'not_yours']); // B names A's ticket number with B's own token: refused
  expect(rig.product.keys.keys.size).toBe(keysBefore); // refused before a key was made
  const ok = await ask(a.page, { kind: 'stuck', ticket: mine.ticket }, mine.status_token); expect(ok.status).toBe(201); expect(ok.body.url).toMatch(AI_URL); expect(rig.product.keys.keys.size).toBe(keysBefore + 1);
  expect(JSON.stringify(rig.product.seen)).not.toContain(mine.status_token); // the product server never saw the token
}, T);

test('STATUS: Check status shows what the team says, in a real browser (a same-origin GET has no Origin header); nobody else can read the ticket without its token', async () => {
  const rig = await makeRig(), { page, requests } = await person(rig); await ui.open(page); const t = await stuck(page);
  expect((await rig.core.plain('PATCH', `/v1/team/tickets/${t.ticket}?product=corporatetambola`, { status: 'seen', team_note: 'Looking at it.' })).status).toBe(200);
  await ui.tap(page, 'Check status'); await page.locator('.panel', { hasText: 'Ticket ' + t.ticket + ': seen.' }).waitFor(); expect(await ui.text(page)).toContain('Looking at it.');
  const get = requests.find((r) => r.method === 'GET' && r.path === '/mpc/v1/tickets/' + t.ticket);
  expect([get.status, get.headers.origin, get.headers['x-mpc-status-token']]).toEqual([200, undefined, t.status_token]); // no Origin header, as the fetch rule says; the token rides as a header, not in the address
  expect(get.path).not.toContain(t.status_token);
  const other = await person(rig, { sid: 'sid-other', who: { role: 'organizer', user_id: 'user-other' } });
  const peek = (tok) => other.page.evaluate(async ([n, tok]) => { const r = await fetch('/mpc/v1/tickets/' + n, { credentials: 'same-origin', headers: tok ? { 'x-mpc-status-token': tok } : {} }); return r.status; }, [t.ticket, tok]);
  expect([await peek(null), await peek('y'.repeat(43))]).toEqual([404, 404]); // a number alone, or a guess, shows nothing (and a ticket that does not exist looks the same)
}, T);

test('EXPIRY: past the hour the AI is told the link has ended, and the sweep erases both kinds of link (with no ticket, and for a ticket) with their notes and calls; the ticket goes at 24 hours', async () => {
  const rig = await makeRig(), { page, context } = await person(rig); await ui.open(page);
  const copied = async () => { await ui.tap(page, 'Copy link'); await page.locator('.panel [role=status]').filter({ hasText: 'Link copied.' }).waitFor(); return clip(page); };
  await ui.tap(page, 'Need help'); await ui.tap(page, 'Price of a game'); const urlA = await copied();            // a link with no ticket: a help answer
  await ui.tap(page, 'Got it'); const t = await stuck(page); const urlB = await copied();                        // a link for a ticket: a sent problem. The page stays on this screen.
  const keyOf = (u) => new URL(u).searchParams.get('k'), idOf = (u) => new URL(u).pathname.split('/')[2], store = rig.core.store, idA = idOf(urlA), idB = idOf(urlB);
  // the AI side: it opens the page of each link; the link for the ticket also reads its context, which is logged. A note row is added for both
  // (links the widget makes carry the scopes read_event and read_ticket, not report: see DECISIONS, an open question for the owner)
  const ai = await context.newPage(); await ai.goto(rig.origin + '/terms');
  const get = (u, h = {}) => ai.evaluate(async ([x, hh]) => { const r = await fetch(x, { credentials: 'omit', headers: hh }); return { status: r.status, body: await r.text() }; }, [u, h]);
  const pageUrl = (u, ext = '') => rig.origin + '/ai/' + idOf(u) + ext + '?k=' + keyOf(u);
  expect([(await get(pageUrl(urlA))).status, (await get(pageUrl(urlB))).status]).toEqual([200, 200]);
  expect((await get(rig.origin + '/v1/ai/context', { authorization: 'Bearer ' + keyOf(urlB) })).status).toBe(200);
  for (const id of [idA, idB]) await store.addNote(id, 'plan', 'Read the screen.', rig.now());
  const rows = async (id) => ({ link: !!(await store.getLink(id)), notes: (await store.listNotes(id)).length, calls: (await store.listCalls(id)).length });
  expect(await rows(idA)).toEqual({ link: true, notes: 1, calls: 0 }); expect(await rows(idB)).toEqual({ link: true, notes: 1, calls: 1 });
  // a minute before the hour: valid, and the sweep keeps everything
  rig.travel(H - 60_000); expect((await get(pageUrl(urlA, '.json'))).status).toBe(200); await rig.sweep(); expect(await rows(idA)).toEqual({ link: true, notes: 1, calls: 0 }); expect(await rows(idB)).toEqual({ link: true, notes: 1, calls: 1 });
  // a minute past the hour: the AI is told, in a real page, that the link has ended; the sweep erases both links with their notes and calls
  rig.travel(120_000);
  const ended = await ai.goto(pageUrl(urlA, '.json')); expect(ended.status()).toBe(401); expect(JSON.parse(await ai.locator('body').innerText()).error).toBe('expired');
  expect((await ai.goto(pageUrl(urlB, '.json'))).status()).toBe(401);
  await rig.sweep(); expect(await rows(idA)).toEqual({ link: false, notes: 0, calls: 0 }); expect(await rows(idB)).toEqual({ link: false, notes: 0, calls: 0 });
  expect(await store.getTicket('corporatetambola', t.ticket, rig.now())).not.toBeNull(); // the ticket follows its own rule: 24 hours after receipt on a games product
  expect(JSON.parse((await get(pageUrl(urlB))).body).error).toBe('bad_link'); // the link is gone, not only ended
  await ui.tap(page, 'Check status'); await page.locator('.panel', { hasText: 'Ticket ' + t.ticket + ': new.' }).waitFor(); // the person still sees the ticket
  // 24 hours after receipt: the ticket is gone for the person and the sweep erases it, keeping only the erasure log
  rig.travel(24 * H); await rig.sweep();
  expect(await store.getTicket('corporatetambola', t.ticket, rig.now())).toBeNull(); expect((await store.erasureLog()).map((e) => e.ticket)).toEqual([t.ticket]);
  const gone = await page.evaluate(async (n) => (await fetch('/mpc/v1/tickets/' + n, { credentials: 'same-origin', headers: { 'x-mpc-status-token': 'x'.repeat(43) } })).status, t.ticket); expect(gone).toBe(404);
}, T);
