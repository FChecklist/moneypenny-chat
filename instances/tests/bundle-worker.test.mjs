// C10 and C11: widget bundle, instance Worker entry, wrangler config, and the reference session adapter.
// No Cloudflare and no browser ran: the Worker logic is called as a function; the bundle is built with Bun and read as text.
import { test, expect, beforeAll } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { buildWidget, instanceIds } from '../../scripts/build-widget.mjs';
import { makeWorker } from '../lib/worker.js';
import { httpAdapter } from '../lib/adapter.js';
import { createInstance } from '../lib/proxy.js';
import { makeEnv, SECRET, ASSERT } from '../../core/tests/helpers.js';
import { mockProduct } from '../../core/tests/mock-product/index.js';
import { sha256hex } from '../../core/src/crypto.js';
import { secretNames } from '../../core/src/instance.js';

const IDS = ['corporatetambola', 'townhall-records', 'veridian-aios'];
const rd = (id, f) => JSON.parse(readFileSync(new URL(`../${id}/${f}`, import.meta.url), 'utf8'));
const bundles = {};
beforeAll(async () => { for (const id of IDS) bundles[id] = await buildWidget(id); });

test('C10 one built file per instance; it holds that instance only; no secret name or value, no other file needed', () => {
  expect(instanceIds().sort()).toEqual([...IDS].sort());
  for (const id of IDS) {
    const js = bundles[id], other = IDS.find((x) => x !== id);
    expect(js.length).toBeGreaterThan(2000); expect(js).toContain('"' + id + '"'); expect(js).not.toContain(other === 'veridian-aios' ? 'veridian-aios.com' : '"' + other + '"');
    expect(js).not.toMatch(/SECRET_|key_hash|assert|import\s*\(|^import /m); expect(js).toContain('/mpc/ai-link'); expect(js).toContain(rd(id, 'strings.json').help_topics[0].label);
    // cookies and storage: not a word search on the file; a real Chromium visit checks them (tests/browser/widget.browser.mjs)
  }
});
test('C10 the build refuses an unknown instance', async () => { await expect(buildWidget('nope')).rejects.toThrow('unknown instance'); await expect(buildWidget('lib')).rejects.toThrow('unknown instance'); });
test('C10 the built file runs: it mounts the widget once, with the instance text, a route label and the proxy link call', async () => {
  const { boot } = await import('../../core/widget/boot.js'); const got = [];
  const inst = { strings: rd('corporatetambola', 'strings.json'), routes: { '/console': 'Console' } }; const calls = [];
  globalThis.fetch = async (u, init) => { calls.push([u, JSON.parse(init.body), init.credentials]); return new Response(JSON.stringify({ url: 'https://core.test/ai/x?k=y' }), { status: 201 }); };
  boot(inst, { doc: {}, loc: { pathname: '/console' }, mount: (c) => { got.push(c); return {}; } });
  expect(got.length).toBe(1); expect(got[0].screenLabel).toBe('Console'); expect(got[0].page()).toBe('/console');
  expect(await got[0].aiLink('stuck', { ticket: 'T-0001' })).toBe('https://core.test/ai/x?k=y'); expect(calls[0][1]).toEqual({ kind: 'stuck', ticket: 'T-0001', screen: '/console' }); expect(calls[0][2]).toBe('same-origin');
  boot(inst, { doc: {}, loc: { pathname: '/other' }, mount: (c) => got.push(c) }); expect(got[1].screenLabel).toBeUndefined();
  globalThis.fetch = async () => new Response('{}', { status: 503 }); await expect(got[0].aiLink('help')).rejects.toThrow();
});
test('C10 /mpc/widget.js: one file, text/javascript, cached 300 s, same origin only, no cookie, no CORS; needs no secret or binding', async () => {
  const w = makeWorker({ config: rd('veridian-aios', 'instance.json'), strings: rd('veridian-aios', 'strings.json'), widgetJs: bundles['veridian-aios'] });
  const r = await w.fetch(new Request('https://app.veridian-aios.com/mpc/widget.js'), {}); // empty env: setup not done
  expect(r.status).toBe(200); expect(r.headers.get('content-type')).toStartWith('text/javascript'); expect(r.headers.get('cache-control')).toBe('public, max-age=300');
  expect(r.headers.get('set-cookie')).toBeNull(); expect(r.headers.get('access-control-allow-origin')).toBeNull(); expect(await r.text()).toBe(bundles['veridian-aios']);
  const c = await w.fetch(new Request('https://x.test/mpc/config.json'), {}); expect(c.status).toBe(200); expect((await c.json()).id).toBe('veridian-aios'); // read-only calls are not blocked by setup checks
  expect((await w.fetch(new Request('https://x.test/mpc/widget.js', { method: 'POST' }), {})).status).not.toBe(200);
  expect((await w.fetch(new Request('https://x.test/other'), {})).status).toBe(404);
});
test('C10 proxy calls answer 503 try_later until secrets and both bindings exist; a bad bundle or record stops at start', async () => {
  const id = 'corporatetambola', mk = () => makeWorker({ config: rd(id, 'instance.json'), strings: rd(id, 'strings.json'), widgetJs: bundles[id] });
  const req = () => new Request('https://home.corporatetambola.com/mpc/ai-link', { method: 'POST', headers: { origin: 'https://home.corporatetambola.com' }, body: '{}' });
  const n = secretNames(id), bind = { fetch: async () => new Response('{}') };
  for (const env of [{}, { [n.sign[0]]: SECRET, [n.assert[0]]: ASSERT }, { [n.sign[0]]: SECRET, [n.assert[0]]: ASSERT, CORE: bind }, { CORE: bind, PRODUCT: bind }]) { const r = await mk().fetch(req(), env); expect(r.status).toBe(503); expect((await r.json()).error).toBe('try_later'); }
  expect(() => makeWorker({ config: rd(id, 'instance.json'), strings: rd(id, 'strings.json'), widgetJs: '' })).toThrow();
  expect(() => makeWorker({ config: { ...rd(id, 'instance.json'), enabled: 'yes' }, strings: rd(id, 'strings.json'), widgetJs: 'x' })).toThrow();
});
test('C10 full path through the Worker entry: signed in person gets a link; the page cannot set a role; no session gives 403', async () => {
  const id = 'corporatetambola', config = rd(id, 'instance.json'), env = makeEnv({ instance: config }), keys = mockProduct(), n = secretNames(id);
  let asked = 0, role = 'host';
  const PRODUCT = { fetch: async (r) => { const u = new URL(r.url);
    if (u.pathname === '/mpc/session') { asked++; return r.headers.get('cookie') === 'sid=good' ? new Response(JSON.stringify({ role, user_id: 'user-42' })) : new Response('', { status: 401 }); }
    const b = await r.json(); const k = await keys.mintKey(b); return new Response(JSON.stringify(k.body), { status: k.status }); } };
  const w = makeWorker({ config, strings: rd(id, 'strings.json'), widgetJs: bundles[id] }), E = { [n.sign[0]]: SECRET, [n.assert[0]]: ASSERT, CORE: { fetch: (r) => env.app(r) }, PRODUCT };
  const post = (path, body, h = {}) => w.fetch(new Request('https://home.corporatetambola.com' + path, { method: 'POST', headers: { origin: config.allowed_origins[0], 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...h }, body: JSON.stringify(body) }), E);
  const T = { option: 'suggest', type: 'feature', text: 'Please add a small timer here', screen: '/console/x', role: 'organizer' }; // the page claims organizer
  let r = await post('/mpc/v1/tickets', T, { cookie: 'sid=good', 'x-mpc-role': 'organizer' }); expect(r.status).toBe(201);
  const stored = await env.store.getTicket(id, (await r.clone().json()).ticket, Date.now()); expect(stored.role).toBe('co-organizer'); // product said host; map says co-organizer
  r = await post('/mpc/ai-link', { kind: 'help' }, { cookie: 'sid=good' }); expect(r.status).toBe(201); expect((await r.json()).url).toContain('k=mpk_');
  expect((await post('/mpc/v1/tickets', T)).status).toBe(403); expect((await post('/mpc/v1/tickets', T, { cookie: 'sid=bad' })).status).toBe(403);
  expect((await post('/mpc/v1/tickets', T, { cookie: 'sid=good', origin: 'https://evil.test' })).status).toBe(403);
  role = 'player'; r = await post('/mpc/v1/tickets', T, { cookie: 'sid=good' }); expect(r.status).toBe(403); // unknown role from the product: refused
});
test('C10 wrangler config per instance: name, entry, build, routes for widget, proxy and core, CORE binding; no secret, no id, no flag on', () => {
  for (const id of IDS) {
    const t = readFileSync(new URL(`../${id}/wrangler.toml`, import.meta.url), 'utf8'), cfg = rd(id, 'instance.json');
    expect(t).toContain(`name = "moneypenny-chat-${id}"`); expect(t).toContain('main = "worker.js"'); expect(t).toContain(`build-widget.mjs ${id}"`);
    for (const o of cfg.allowed_origins) expect(t).toContain(`pattern = "${new URL(o).host}/mpc/*"`);
    expect(t).toMatch(/\[\[services\]\]\nbinding = "CORE"\nservice = "moneypenny-chat-core"/); expect(t).toMatch(/^# \[\[services\]\]  binding = "PRODUCT"/m);
    expect(t).not.toMatch(/account_id|database_id\s*=\s*"[^<]|API_TOKEN|PAY_VIA_MONEYPENNY\s*=\s*"1"/); expect(t).not.toMatch(/^[^#\n]*=\s*"[A-Za-z0-9+\/]{32,}"/m);
    expect(readFileSync(new URL(`../${id}/worker.js`, import.meta.url), 'utf8')).toContain("with { type: 'text' }");
  }
  expect(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')).toContain('dist/');
});

// ---- C11 reference adapter
const fakeProduct = (state = {}) => async (req) => {
  const u = new URL(req.url); state.last = req;
  if (u.pathname === '/mpc/session') return state.reply ? state.reply(req) : new Response(JSON.stringify({ role: 'organizer', user_id: 'user-42', extra: 'x' }));
  const k = await mockProduct().mintKey(await req.json()); return new Response(JSON.stringify(state.mint ? state.mint(k.body) : k.body), { status: k.status });
};
test('C11 session(): role and user id come from the product; only cookie and authorization go to it; sess is a one way id', async () => {
  const st = {}, a = httpAdapter({ productFetch: fakeProduct(st) });
  const s = await a.session(new Request('https://x.test/mpc/v1/tickets', { headers: { cookie: 'sid=1', authorization: 'Bearer t', 'x-mpc-role': 'organizer', 'x-role': 'organizer', origin: 'https://h' } }));
  expect(s).toEqual({ role: 'organizer', user_id: 'user-42', sess: (await sha256hex('mpc-sess|user-42')).slice(0, 32) }); expect(s.sess).toMatch(/^[A-Za-z0-9_-]{8,64}$/); expect(s.sess).not.toContain('user-42');
  expect([...st.last.headers.keys()].sort()).toEqual(['authorization', 'cookie']); expect(st.last.method).toBe('GET'); expect(new URL(st.last.url).search).toBe('');
});
test('C11 session(): the page cannot make a role. No cookie or token: the product is not even asked; product says no: null', async () => {
  let asked = 0; const a = httpAdapter({ productFetch: async (r) => { asked++; return new Response('', { status: 401 }); } });
  expect(await a.session(new Request('https://x.test/', { headers: { 'x-mpc-role': 'organizer' } }))).toBeNull(); expect(asked).toBe(0);
  for (const st of [401, 403, 204]) expect(await httpAdapter({ productFetch: async () => new Response('', { status: st }) }).session(new Request('https://x.test/', { headers: { cookie: 'a=b' } }))).toBeNull();
  const q = new Request('https://x.test/?role=organizer', { method: 'POST', headers: { cookie: 'a=b' }, body: JSON.stringify({ role: 'organizer' }) });
  expect((await httpAdapter({ productFetch: async () => new Response(JSON.stringify({ role: 'player', user_id: 'u1' })) }).session(q)).role).toBe('player');
});
test('C11 session(): a wrong shape is refused (no default role); a product fault throws (fail closed), it is not "signed out"', async () => {
  const mk = (b) => httpAdapter({ productFetch: async () => new Response(typeof b === 'string' ? b : JSON.stringify(b)) }), rq = () => new Request('https://x.test/', { headers: { cookie: 'a=b' } });
  for (const b of [{}, { role: 'organizer' }, { user_id: 'u1' }, { role: 'Organizer', user_id: 'u1' }, { role: 5, user_id: 'u1' }, { role: 'organizer', user_id: '' }, { role: 'organizer', user_id: 'has space' }, { role: 'organizer', user_id: 'x'.repeat(129) }, [], null]) expect(await mk(b).session(rq()), JSON.stringify(b)).toBeNull();
  await expect(mk('not json').session(rq())).rejects.toThrow(); await expect(httpAdapter({ productFetch: async () => new Response('', { status: 500 }) }).session(rq())).rejects.toThrow(); await expect(httpAdapter({ productFetch: async () => { throw new Error('down'); } }).session(rq())).rejects.toThrow();
  expect(() => httpAdapter({})).toThrow();
});
test('C11 through createInstance: product fault gives 503 try_later, not a role; a player is refused', async () => {
  const id = 'corporatetambola', config = rd(id, 'instance.json'), env = makeEnv({ instance: config });
  const mk = (reply) => createInstance({ config, strings: rd(id, 'strings.json'), secrets: { sign: SECRET, assert: ASSERT }, product: httpAdapter({ productFetch: fakeProduct({ reply }) }), core: { fetch: (r) => env.app(r) } });
  const call = (h) => h(new Request('https://i.test/mpc/ai-link', { method: 'POST', headers: { origin: config.allowed_origins[0], cookie: 'a=b' }, body: '{"kind":"help"}' }));
  expect((await call(mk(() => new Response('', { status: 500 })))).status).toBe(503);
  expect((await call(mk(() => new Response(JSON.stringify({ role: 'player', user_id: 'u1' }))))).status).toBe(403);
  expect((await call(mk(() => new Response(JSON.stringify({ role: 'organizer', user_id: 'u1' }))))).status).toBe(201);
});
test('C11 mintKey(): passes the raw user id to the product (not the hash); refuses wrong scopes, a changed hash, wider scopes, a bad key', async () => {
  const seen = []; const a = httpAdapter({ productFetch: async (r) => { const b = await r.clone().json(); seen.push(b); return fakeProduct()(r); } });
  const ok = await a.mintKey({ session: 'user-42', scopes: ['read_event'], ttl_s: 3600 }); expect(ok.status).toBe(201); expect(ok.body.key).toMatch(/^mpk_/); expect(seen[0].session).toBe('user-42');
  for (const bad of [{ session: '', scopes: ['read_event'], ttl_s: 60 }, { session: 's', scopes: [], ttl_s: 60 }, { session: 's', scopes: ['payment'], ttl_s: 60 }, { session: 's', scopes: 'read_event', ttl_s: 60 }]) expect((await a.mintKey(bad)).status).toBe(400);
  const q = { session: 's', scopes: ['read_event'], ttl_s: 3600 };
  expect((await httpAdapter({ productFetch: fakeProduct({ mint: (b) => ({ ...b, key_hash: '0'.repeat(64) }) }) }).mintKey(q)).status).toBe(502);
  expect((await httpAdapter({ productFetch: fakeProduct({ mint: (b) => ({ ...b, scopes: ['read_event', 'edit_event'] }) }) }).mintKey(q)).status).toBe(502);
  expect((await httpAdapter({ productFetch: fakeProduct({ mint: (b) => ({ ...b, key: 'short' }) }) }).mintKey(q)).status).toBe(502);
  expect((await httpAdapter({ productFetch: async () => new Response('', { status: 500 }) }).mintKey(q)).status).toBe(500);
});
test('C10 each instance worker.js entry loads with the built file next to it and serves it (the file wrangler bundles)', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  for (const id of IDS) {
    mkdirSync(new URL(`../${id}/dist/`, import.meta.url), { recursive: true }); writeFileSync(new URL(`../${id}/dist/widget.js`, import.meta.url), bundles[id]);
    const w = (await import(`../${id}/worker.js`)).default, r = await w.fetch(new Request('https://x.test/mpc/widget.js'), {});
    expect(r.status).toBe(200); expect(await r.text()).toBe(bundles[id]); expect(typeof w.fetch).toBe('function');
  }
});

test('0.4.2 boot: the link call sends the status token as a header, only when a ticket is named, and never in the body', async () => {
  const { boot } = await import('../../core/widget/boot.js'); const got = [], calls = [];
  const inst = { strings: rd('corporatetambola', 'strings.json'), routes: {} };
  globalThis.fetch = async (u, init) => { calls.push({ headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ url: 'https://core.test/ai/x?k=y' }), { status: 201 }); };
  boot(inst, { doc: {}, loc: { pathname: '/console' }, mount: (c) => { got.push(c); return {}; } });
  await got[0].aiLink('stuck', { ticket: 'T-0001', token: 'tok-secret-1' }); await got[0].aiLink('help', { token: 'tok-stray' }); await got[0].aiLink('help');
  expect(calls[0].headers['x-mpc-status-token']).toBe('tok-secret-1'); expect(calls[0].body).toEqual({ kind: 'stuck', ticket: 'T-0001', screen: '/console' });
  expect(calls[1].headers['x-mpc-status-token']).toBeUndefined(); expect(calls[1].body).toEqual({ kind: 'help', screen: '/console' }); // no ticket named: a stray token is not sent
  expect(calls[2].headers['x-mpc-status-token']).toBeUndefined();
  for (const c of calls) expect(JSON.stringify(c.body)).not.toContain('tok-'); expect(calls.every((c) => /^[0-9a-f-]{36}$/.test(c.headers['idempotency-key']))).toBe(true);
});
