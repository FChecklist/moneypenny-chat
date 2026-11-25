// 0.4.2 fix 3: does the proxy have to pass the status token? Decision: YES, to the core only, and only on the calls that prove a ticket is the caller's own.
// Evidence, all in this repo: (1) the core answers 404 without the token when a ticket is read and when a link is made for a ticket; (2) a ticket row keeps no session, only the
// hash of the token (core/schema.sql), and ticket numbers run in order, so the session and the number cannot prove ownership; (3) in a real browser the widget never sent the token on
// the link call, so every link for a sent ticket was refused with 403 not_yours (tests/browser/widget.browser.mjs). Safe choice: keep the refusal, fix the sender, narrow the pass-through.
// The same real browser showed that "Check status" (a same-origin GET) carries no Origin header, so the proxy refused it with 403 origin; that rule is tested here too.
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createInstance } from '../lib/proxy.js';
import { httpAdapter } from '../lib/adapter.js';
import { makeEnv, SECRET, ASSERT, PNG } from '../../core/tests/helpers.js';
import { mockProduct } from '../../core/tests/mock-product/index.js';

const rd = (id, f) => JSON.parse(readFileSync(new URL(`../${id}/${f}`, import.meta.url), 'utf8'));
const ID = 'corporatetambola', config = rd(ID, 'instance.json'), strings = rd(ID, 'strings.json'), ORIGIN = config.allowed_origins[0];
const TICKET = { option: 'suggest', type: 'feature', text: 'Please add a small timer here', screen: '/console/x' };

function rig() {
  const env = makeEnv({ instance: config }), mock = mockProduct(), toProduct = [], toCore = [];
  const productFetch = async (req) => { // the product server: what it is sent is recorded in full
    const u = new URL(req.url), body = req.method === 'POST' ? await req.clone().text() : ''; toProduct.push({ url: req.url, headers: Object.fromEntries(req.headers), body });
    if (u.pathname === '/mpc/session') return new Response(JSON.stringify({ role: 'organizer', user_id: 'user-42' }));
    const k = await mock.mintKey(JSON.parse(body)); return new Response(JSON.stringify(k.body), { status: k.status });
  };
  const handle = createInstance({ config, strings, secrets: { sign: SECRET, assert: ASSERT }, product: httpAdapter({ productFetch }),
    core: { fetch: (q) => { toCore.push({ method: q.method, path: new URL(q.url).pathname, token: q.headers.get('x-mpc-status-token') }); return env.app(q); } } });
  const call = (method, path, { body, headers = {}, origin = ORIGIN } = {}) => handle(new Request(ORIGIN + path, { method, headers: { ...(origin ? { origin } : {}), cookie: 'sid=1', 'content-type': 'application/json', ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }));
  return { env, call, toProduct, toCore, mock };
}

test('0.4.2 status token: the core gets it on the two ownership calls only; create, screenshot and a link with no ticket never carry it; the product and every answer never see it', async () => {
  const r = rig(), STRAY = 'stray-token-from-the-page', answers = []; // every answer after the ticket was made, as text
  const saw = async (p) => { const res = await p; answers.push(await res.clone().text()); return res; };
  const created = await r.call('POST', '/mpc/v1/tickets', { body: TICKET, headers: { 'x-mpc-status-token': STRAY } }); expect(created.status).toBe(201);
  const tk = await created.json(); expect(r.toCore.at(-1)).toEqual({ method: 'POST', path: '/v1/tickets', token: null }); // not sent on create
  expect((await r.call('POST', '/mpc/v1/screenshots', { body: PNG, headers: { 'content-type': 'image/png', 'x-mpc-status-token': STRAY } })).status).toBe(201);
  expect(r.toCore.at(-1)).toEqual({ method: 'POST', path: '/v1/screenshots', token: null });
  const read = await saw(r.call('GET', '/mpc/v1/tickets/' + tk.ticket, { headers: { 'x-mpc-status-token': tk.status_token } })); expect(read.status).toBe(200); // read: needs it
  expect(r.toCore.at(-1)).toEqual({ method: 'GET', path: '/v1/tickets/' + tk.ticket, token: tk.status_token });
  expect((await r.call('GET', '/mpc/v1/tickets/' + tk.ticket, { headers: { 'x-mpc-status-token': STRAY } })).status).toBe(404); // a wrong token is the core's 404, passed on
  r.toCore.length = 0;
  const link = await saw(r.call('POST', '/mpc/ai-link', { body: { kind: 'stuck', ticket: tk.ticket }, headers: { 'x-mpc-status-token': tk.status_token } })); expect(link.status).toBe(201);
  expect(r.toCore).toEqual([{ method: 'GET', path: '/v1/tickets/' + tk.ticket, token: tk.status_token }, { method: 'POST', path: '/v1/ai-links', token: tk.status_token }]); // the check, then the link: both with the token
  r.toCore.length = 0;
  expect((await r.call('POST', '/mpc/ai-link', { body: { kind: 'help' }, headers: { 'x-mpc-status-token': STRAY } })).status).toBe(201); // no ticket named: a stray token goes nowhere
  expect(r.toCore).toEqual([{ method: 'POST', path: '/v1/ai-links', token: null }]);
  const refused = await saw(r.call('POST', '/mpc/ai-link', { body: { kind: 'stuck', ticket: tk.ticket } })); expect(refused.status).toBe(403); expect(JSON.parse(answers.at(-1)).error).toBe('not_yours'); // no token: refused, not downgraded
  const wrong = await saw(r.call('POST', '/mpc/ai-link', { body: { kind: 'stuck', ticket: tk.ticket }, headers: { 'x-mpc-status-token': STRAY } })); expect(wrong.status).toBe(403);
  // the product server only ever got the cookie (and for a key, the session, scopes and time): the token is nowhere in what it saw
  expect(JSON.stringify(r.toProduct)).not.toContain(tk.status_token); expect(JSON.stringify(r.toProduct)).not.toContain(STRAY);
  for (const p of r.toProduct) expect(Object.keys(p.headers).sort()).toEqual(p.body ? ['content-type'] : ['cookie']);
  // and no answer except the ticket creation (by design) holds a token
  expect(answers.length).toBe(4); for (const a of answers) { expect(a).not.toContain(tk.status_token); expect(a).not.toContain(STRAY); }
});

test('0.4.2 origin rule: a browser sends no Origin on a same-origin GET, so a GET is accepted on the browser\'s own word (Sec-Fetch-Site, or a Referer of this origin); everything else keeps the old rule', async () => {
  const r = rig(), tk = await (await r.call('POST', '/mpc/v1/tickets', { body: TICKET })).json();
  const get = (headers, origin, path = '/mpc/v1/tickets/' + tk.ticket, method = 'GET') => r.call(method, path, { headers: { 'x-mpc-status-token': tk.status_token, ...headers }, origin, body: method === 'POST' ? JSON.stringify(TICKET) : undefined });
  const code = async (p) => (await p).status;
  expect(await code(get({ 'sec-fetch-site': 'same-origin' }, null))).toBe(200);                                  // what Chrome, Firefox and Safari send
  expect(await code(get({ referer: ORIGIN + '/console/create' }, null))).toBe(200);                              // no Sec-Fetch-Site (older browser): the Referer of this origin
  expect(await code(get({ 'sec-fetch-site': 'cross-site', referer: ORIGIN + '/console/create' }, null))).toBe(403); // the browser says cross-site: the Referer does not matter
  expect(await code(get({ 'sec-fetch-site': 'same-site' }, null))).toBe(403); expect(await code(get({ 'sec-fetch-site': 'none' }, null))).toBe(403);
  expect(await code(get({ referer: 'https://evil.example/page' }, null))).toBe(403); expect(await code(get({ referer: 'not a url' }, null))).toBe(403);
  expect(await code(get({ referer: 'blob:' + ORIGIN + '/1234-5678' }, null))).toBe(403); expect(await code(get({ referer: ORIGIN.replace('https:', 'http:') + '/console' }, null))).toBe(403); // a blob: address has the origin inside it; a plain http page is not this origin
  expect(await code(get({}, null))).toBe(403);                                                                    // curl: no Origin and nothing from a browser (as before)
  expect(await code(get({ 'sec-fetch-site': 'same-origin' }, 'https://evil.example'))).toBe(403);                 // a wrong Origin is refused whatever else is said
  expect(await code(get({}, ORIGIN))).toBe(200);                                                                  // an allowed Origin: as before
  expect((await (await get({}, null)).json()).error).toBe('origin');
  // only a GET: a POST with no Origin is refused even when the browser says same-origin (a browser always sends Origin on POST)
  expect(await code(get({ 'sec-fetch-site': 'same-origin' }, null, '/mpc/v1/tickets', 'POST'))).toBe(403); expect(await code(get({ 'sec-fetch-site': 'same-origin' }, null, '/mpc/ai-link', 'POST'))).toBe(403);
  // the host the request went to must itself be an allowed origin
  const odd = createInstance({ config, strings, secrets: { sign: SECRET, assert: ASSERT }, product: httpAdapter({ productFetch: async () => new Response(JSON.stringify({ role: 'organizer', user_id: 'user-42' })) }), core: { fetch: (q) => r.env.app(q) } });
  const q = new Request('https://other-host.example/mpc/v1/tickets/' + tk.ticket, { headers: { cookie: 'sid=1', 'sec-fetch-site': 'same-origin', 'x-mpc-status-token': tk.status_token } });
  expect((await odd(q)).status).toBe(403);
  expect(r.toProduct.every((p) => !p.url.includes('other-host'))).toBe(true); // refused before the product was asked
});
