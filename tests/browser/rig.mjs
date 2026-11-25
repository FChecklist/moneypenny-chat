// Real-browser rig. Chromium (Playwright) loads a product page that includes the BUILT widget bundle, and every request the browser makes is answered by the
// real code: the instance Worker (instances/lib/worker.js: widget file, origin check, product session, signing), the real core app on a real SQL schema
// (bun:sqlite) and a product double that follows the adapter contract. Only the network wire is replaced: Playwright routes the https page origin to these
// functions, so the browser still does its own Origin, Sec-Fetch, cookie, CORS, secure-context and clipboard rules.
// Server time is `Date.now() + skew`, so a test can travel in time (rig.travel) and run the same sweep the hourly cron runs (rig.sweep).
// Run: bun run test:browser   (needs Playwright and its Chromium; see KNOWLEDGE.md)
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { makeEnv, SECRET, ASSERT } from '../../core/tests/helpers.js';
import { makeWorker } from '../../instances/lib/worker.js';
import { secretNames } from '../../core/src/instance.js';
import { mockProduct } from '../../core/tests/mock-product/index.js';
import { buildBundle } from '../../scripts/build-widget.mjs';
import { sweep } from '../../core/src/retention.js';

const rd = (id, f) => JSON.parse(readFileSync(new URL(`../../instances/${id}/${f}`, import.meta.url), 'utf8'));

// Finds Playwright without a lock file or a local install: the project's own node_modules if there is one, then MPC_PLAYWRIGHT (a folder), NODE_PATH, and the global npm folder.
export async function loadPlaywright() {
  const tried = [];
  try { return await import('playwright'); } catch (e) { tried.push('project: ' + e.message.split('\n')[0]); }
  const req = createRequire(import.meta.url), dirs = [process.env.MPC_PLAYWRIGHT, ...(process.env.NODE_PATH || '').split(':')];
  try { const g = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }); if (g.status === 0) dirs.push(g.stdout.trim()); } catch { /* npm is not there: the other places are enough */ }
  for (const d of dirs.filter(Boolean)) for (const spec of [d, d + '/playwright']) { try { return req(spec); } catch (e) { tried.push(spec + ': ' + e.message.split('\n')[0]); } }
  throw new Error('The real-browser tests need Playwright with its Chromium: "npm i -g playwright && npx playwright install chromium" (no lock file is committed), or set MPC_PLAYWRIGHT to the playwright folder. Tried: ' + tried.join(' | '));
}
export async function launchBrowser() {
  const pw = await loadPlaywright(), chromium = pw.chromium || (pw.default && pw.default.chromium);
  if (!chromium) throw new Error('Playwright was found but has no chromium');
  return chromium.launch(); // headless; the browser files come from PLAYWRIGHT_BROWSERS_PATH or the Playwright default folder
}

// What a page of the product looks like: fields a person could type a secret into, a marked block, and (optionally) CSS that tries to break the widget.
const email = ['pat', 'example.test'].join('@'); // built here so no address sits in the repo (secrets scan)
export const EVIL = 'https://evil.example';
export const SECRETS = { password: 'correct-horse-battery', email, card: '4111 1111 1111 1111', note: 'The safe code is seven three nine one' };
const HOSTILE = `button{display:none!important;background:#f00!important;color:#f00!important}h2,p,label{display:none!important}*{font-size:3px!important}[role=dialog]{display:none!important}.fab,.panel{display:none!important}`;
const productPage = (hostile) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Console</title>
<style>body{font:18px/1.4 system-ui,sans-serif;margin:24px;background:#fff;color:#111}label{display:block;margin:12px 0}input{font:inherit;width:360px;padding:8px;margin-left:8px}#note{margin:16px 0;padding:8px;border:1px solid #888;width:360px}${hostile ? HOSTILE : ''}</style></head><body>
<h1>Create a game</h1>
<form id="f" onsubmit="return false">
<label>Game title <input id="title" name="title" value="Quiz night"></label>
<label>Password <input id="pw" type="password" name="pw" value="${SECRETS.password}"></label>
<label>E-mail <input id="em" type="email" name="em" value="${SECRETS.email}"></label>
<label>Card number <input id="card" name="card_no" value="${SECRETS.card}"></label>
<div id="note" data-mpc-hide>${SECRETS.note}</div>
</form>
<script type="module" src="/mpc/widget.js"></script>
</body></html>`;

const bundles = new Map(); // one build per distinct record: the build takes a moment
const bundle = async (cfg, str) => { const k = JSON.stringify([cfg, str]); if (!bundles.has(k)) bundles.set(k, await buildBundle(cfg, str)); return bundles.get(k); };

export async function makeRig({ id = 'corporatetambola', store = 'd1', config = {}, strings = {} } = {}) {
  const cfg = { ...rd(id, 'instance.json'), ...config }, str = { ...rd(id, 'strings.json'), ...strings };
  const widgetJs = await bundle(cfg, str), origin = cfg.allowed_origins[0];
  const skew = { ms: 0 }, now = () => Date.now() + skew.ms;
  const core = makeEnv({ store, instance: cfg, now, team: true }); // team: true is the stub login of the test harness, only so a test can play the team
  const keys = mockProduct({ now }), logins = new Map(), seen = [], state = { fault: false };
  const PRODUCT = { // the product server behind the instance: session check and AI keys (contract/README.md)
    async fetch(req) {
      const u = new URL(req.url), body = req.method === 'GET' ? '' : await req.clone().text();
      seen.push({ method: req.method, path: u.pathname, headers: Object.fromEntries(req.headers), body });
      if (state.fault) return new Response('product down', { status: 500 });
      if (u.pathname === '/mpc/session') { const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.get('cookie') || ''); const who = sid && logins.get(sid[1]); return who ? new Response(JSON.stringify(who)) : new Response('', { status: 401 }); }
      if (u.pathname === '/mpc/ai-key') { const k = await keys.mintKey(JSON.parse(body)); return new Response(JSON.stringify(k.body), { status: k.status }); }
      return new Response('', { status: 404 });
    },
  };
  const n = secretNames(cfg.id), env = { [n.sign[0]]: SECRET, [n.assert[0]]: ASSERT, CORE: { fetch: (r) => core.app(r) }, PRODUCT };
  const worker = makeWorker({ config: cfg, strings: str, widgetJs, now }); // the instance signs with the same clock the core checks, so time travel keeps the signature valid
  const wire = []; // every request the browser sent, as the browser sent it
  const hostile = { on: false };

  async function dispatch(request) {
    const p = new URL(request.url).pathname;
    if (p.startsWith('/mpc/')) return worker.fetch(request, env);
    if (p.startsWith('/ai/') || p.startsWith('/v1/ai/')) return core.app(request); // the AI side of the core (the link points at the product host, see DECISIONS)
    if (p === '/' || p === '/console/create') return new Response(productPage(hostile.on), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (p === '/terms') return new Response('<!doctype html><title>Terms</title><h1>Terms</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('Not found', { status: 404 });
  }
  const rig = {
    cfg, strings: str, origin, widgetJs, core, product: { keys, logins, seen, state }, wire, hostile,
    login: (sid, who = { role: 'organizer', user_id: 'user-1001' }) => logins.set(sid, who),
    now, travel: (ms) => { skew.ms += ms; }, // move server time forward
    sweep: () => sweep(core.ctx()), // the hourly cron
    // A new browser context = a new person with their own cookies. sid: the product session cookie (set by the product, HttpOnly, never by the widget).
    async open(browser, { sid, path = '/console/create', viewport = { width: 1100, height: 800 }, goto = true } = {}) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }), page = await context.newPage(), errors = [], requests = [];
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      if (sid) await context.addCookies([{ name: 'sid', value: sid, url: origin, httpOnly: true, secure: true, sameSite: 'Lax' }]);
      await context.route('**/*', async (route) => {
        const r = route.request(), url = new URL(r.url());
        if (url.origin === EVIL) { // another site, to see what a page of another origin can and cannot do against the instance
          if (r.method() === 'GET' && url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>another site</title><h1>another site</h1>' });
        }
        if (url.origin !== origin) { const o = { method: r.method(), path: url.origin + url.pathname, headers: await r.allHeaders() }; requests.push(o); wire.push(o); return route.fulfill({ status: 404, contentType: 'text/plain', body: 'unknown host' }); }
        const headers = {}; for (const [k, v] of Object.entries(await r.allHeaders())) if (!k.startsWith(':')) headers[k] = v;
        const method = r.method(), data = r.postDataBuffer();
        const entry = { method, path: url.pathname, headers }; requests.push(entry); wire.push(entry);
        const res = await dispatch(new Request(r.url(), { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : data ?? undefined }));
        entry.status = res.status; entry.resHeaders = Object.fromEntries(res.headers); entry.reply = res.headers.get('content-type') && /json|text/.test(res.headers.get('content-type')) && res.status !== 200 ? await res.clone().text() : undefined; // the answer, kept for failures only
        await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
      });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      if (goto) { await page.goto(origin + path); await page.locator('.fab').waitFor(); }
      return { context, page, errors, requests };
    },
  };
  return rig;
}

// ---- what a person does with the widget (all through the real DOM)
export const ui = {
  open: async (page) => { await page.locator('.fab').click(); await page.locator('.panel:not([hidden]) h2').waitFor(); },
  tap: (page, name) => page.getByRole('button', { name, exact: true }).click(),
  text: (page) => page.locator('.panel').innerText(),
  type: (page, label, value) => page.getByLabel(label).fill(value),
  title: (page) => page.locator('.panel h2').innerText(),
  // Suggest an idea and send it. Returns the ticket number shown to the person.
  async suggest(page, idea = 'Please add a small timer here') {
    await ui.tap(page, 'Suggest an option or feature'); await ui.tap(page, 'Option'); await ui.type(page, 'The idea', idea); await ui.tap(page, 'Send');
    await page.locator('.panel h2', { hasText: 'Sent. Thank you.' }).waitFor(); return /T-\d{4,}/.exec(await ui.text(page))[0];
  },
};
