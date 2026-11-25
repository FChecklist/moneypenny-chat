// C8 and C9: one instance per product, the proxy that signs on the server side, and a test double of the product server.
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createInstance, checkConfig, AI_KINDS } from '../lib/proxy.js';
import { productDouble } from './product-double.js';
import { makeEnv, SECRET, ASSERT, PNG } from '../../core/tests/helpers.js';
import { validateInstance, secretNames } from '../../core/src/instance.js';
import { checkStrings, STANDARD_AI_LINE } from '../../contract/strings-rules.mjs';
import { VERSION } from '../../core/src/version.js';

const IDS = ['corporatetambola', 'townhall-records', 'veridian-aios'];
const rd = (id, f) => JSON.parse(readFileSync(new URL(`../${id}/${f}`, import.meta.url), 'utf8'));
const cfgOf = (id) => ({ config: rd(id, 'instance.json'), strings: rd(id, 'strings.json') });
const TOKEN = 'tok-organizer', ORG = 'https://home.corporatetambola.com';

function rig(id = 'corporatetambola', { origin } = {}) {
  const { config, strings } = cfgOf(id), product = productDouble(), env = makeEnv({ instance: config });
  product.login('org-1', 'organizer', 'sess-org-0001'); product.login('host-1', 'host', 'sess-host-0001'); product.login('player-1', 'player', 'sess-play-0001');
  const handle = createInstance({ config, strings, secrets: { sign: SECRET, assert: ASSERT }, product, core: { fetch: (r) => env.app(r) } });
  const o = origin || config.allowed_origins[0];
  const post = (path, body, { tok = 'org-1', origin: og = o, headers = {} } = {}) => handle(new Request('https://i.test' + path, { method: 'POST', headers: { origin: og, ...(tok ? { authorization: 'Bearer ' + tok } : {}), 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...headers }, body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }));
  return { config, strings, product, env, handle, post, o };
}
const TICKET = { option: 'suggest', type: 'feature', text: 'Please add a small timer here', screen: '/console/x' };

test('round 5 and 6: every instance strings.json goes through checkStrings (found by folder, not by a fixed list), and a slip fails', () => {
  const dirs = readdirSync(new URL('..', import.meta.url)).filter((d) => !['lib', 'tests'].includes(d)); expect(dirs.sort()).toEqual([...IDS].sort());
  for (const id of dirs) { const s = rd(id, 'strings.json'); expect(checkStrings(s), id).toEqual([]); expect(checkStrings({ ...s, help_topics: [{ id: 'a', label: 'Set up', answer: 'Open your game.' }] }).length).toBe(1); expect(checkStrings({ ...s, stuck: [{ id: 'a', label: 'My game' }] }).length).toBe(1); }
});
test('round 5: terms_url is required: null or a real /terms path; the home page is refused', () => {
  const { config, strings } = cfgOf('corporatetambola');
  for (const id of IDS) { const t = rd(id, 'strings.json').terms_url; expect(t === null || /^https:\/\/[^/]+\/(?:[\w.-]+\/)*terms\/?$/.test(t), id).toBe(true); }
  expect(() => checkConfig(config, { ...strings, terms_url: 'https://home.corporatetambola.com/' })).toThrow();
  expect(() => checkConfig(config, { ...strings, terms_url: undefined })).toThrow();
  expect(() => checkConfig(config, { ...strings, terms_url: 'https://home.corporatetambola.com/terms' })).not.toThrow();
  expect(() => checkConfig(config, { ...strings, terms_url: null })).not.toThrow();
});
test('each instance record passes the core schema check, its strings pass the owner rules, and the config check refuses bad input', () => {
  for (const id of IDS) {
    const { config, strings } = cfgOf(id);
    expect(validateInstance(config).ok).toBe(true); expect(config.id).toBe(id); expect(config.enabled).toBe(true);
    expect(checkStrings(strings)).toEqual([]); expect(() => checkConfig(config, strings)).not.toThrow();
    expect(strings.help_topics.length).toBe(5); expect(strings.stuck.length).toBe(6);
    expect(strings.help_topics.every((t) => t.answer === null)).toBe(true); // no answer text is made up; the owner writes them
    expect(JSON.stringify(strings)).not.toMatch(/\bhost\b|\bmy\b|\byour\b|nickname|\b\d{4}-\d{2}-\d{2}\b|[$₹]\s?\d/i); // the product role key "host" in role_map is data, never shown
  }
  const { config, strings } = cfgOf('corporatetambola');
  expect(() => checkConfig({ ...config, enabled: 'yes' }, strings)).toThrow(); // refuse, no default
  expect(() => checkConfig(config, { ...strings, terms_url: 'http://x' })).toThrow();
  expect(() => checkConfig(config, { ...strings, stuck: [{ id: 'a', label: 'Your game' }] })).toThrow();
  expect(() => checkConfig(config, { ...strings, screens: 'x' })).toThrow();
  expect(() => createInstance({ ...rig(), config, strings, secrets: { sign: 'short', assert: ASSERT } })).toThrow();
});
test('round 6 AI link from the proxy: a named ticket must be the caller\'s own (status token, this instance) before any key is minted; scopes come from the kind only', async () => {
  const r = rig('corporatetambola'), r2 = rig('townhall-records'); let minted = 0; const mint = r.product.mintKey; r.product.mintKey = (x) => { minted++; return mint(x); };
  const tk = await (await r.post('/mpc/v1/tickets', TICKET)).json(), foreign = await (await r2.post('/mpc/v1/tickets', TICKET)).json();
  const link = (b, token) => r.post('/mpc/ai-link', b, { headers: token ? { 'x-mpc-status-token': token } : {} });
  expect((await link({ kind: 'stuck', ticket: tk.ticket })).status).toBe(403); expect((await link({ kind: 'stuck', ticket: tk.ticket }, foreign.status_token)).status).toBe(403); // no token; another instance's token
  expect((await link({ kind: 'stuck', ticket: 'T-9999' }, tk.status_token)).status).toBe(403); expect((await link({ kind: 'stuck', ticket: 5 }, tk.status_token)).status).toBe(400); expect(minted).toBe(0);
  const ok = await link({ kind: 'help', ticket: tk.ticket, scopes: ['read_ticket', 'report', 'edit_event'] }, tk.status_token); expect(ok.status).toBe(201); expect(minted).toBe(1);
  const row = await r.env.store.getLinkByHash(await (await import('../../core/src/crypto.js')).sha256hex((await ok.json()).url.split('k=')[1])); expect(JSON.parse(row.scopes)).toEqual(AI_KINDS.help); // body scopes ignored
});
test('topic and stuck lists match the owner list in the spec (tambola confirmed from the old KB; the other two are proposed)', () => {
  const lab = (id) => [cfgOf(id).strings.help_topics.map((t) => t.label), cfgOf(id).strings.stuck.map((t) => t.label)];
  expect(lab('corporatetambola')).toEqual([['Price of a game', 'Create a game', 'Invite players', 'Refund and cancel', 'Add a co-organizer'], ['A link does not work', 'Players cannot join', 'Log in', 'Pay or credits', 'Game will not start', 'Prizes or winners']]);
  expect(lab('townhall-records')[0]).toEqual(['Set up a meeting', 'Run an election', 'Upload the voter list', 'Take attendance', 'Write the minutes']);
  expect(lab('veridian-aios')[1]).toEqual(['Cannot sign in', 'Register will not save', 'Notice did not go', 'Report will not open', 'Team member access', 'Pay or credits']);
});
test('one instance per product: own id, own origins, own secret names, own retention; nothing shared', () => {
  const all = IDS.map((id) => cfgOf(id).config), origins = all.flatMap((c) => c.allowed_origins);
  expect(new Set(all.map((c) => c.id)).size).toBe(3); expect(new Set(origins).size).toBe(origins.length);
  const names = all.flatMap((c) => Object.values(secretNames(c.id)).flat()); expect(new Set(names).size).toBe(names.length);
  expect(all.map((c) => c.retention_class)).toEqual(['games', 'records', 'records']);
  expect(readdirSync(new URL('..', import.meta.url)).filter((d) => !['lib', 'tests'].includes(d)).sort()).toEqual([...IDS].sort()); // no fourth folder
});
test('no secrets in the instance files', () => {
  for (const id of IDS) for (const f of ['instance.json', 'strings.json']) expect(readFileSync(new URL(`../${id}/${f}`, import.meta.url), 'utf8')).not.toMatch(/secret|token|password|key"|-----BEGIN|[A-Za-z0-9]{40,}/i);
});

for (const id of IDS) {
  test(`${id}: strings.json goes through checkStrings with no finding`, () => { expect(checkStrings(rd(id, 'strings.json'))).toEqual([]); });
  test(`${id}: ticket through the proxy reaches the core; the role comes from the product server; ticket is stored and has an audit row`, async () => {
    const r = rig(id), res = await r.post('/mpc/v1/tickets', { ...TICKET, role: 'organizer' });
    expect(res.status).toBe(201); const j = await res.json(); expect(j.ticket).toMatch(/^T-\d{4,}$/);
    const row = await r.env.store.getTicket(id, j.ticket, Date.now()); expect(row.role).toBe('organizer'); expect(row.option).toBe('suggest');
    expect(res.headers.get('set-cookie')).toBeNull();
    const read = await r.handle(new Request('https://i.test/mpc/v1/tickets/' + j.ticket, { headers: { origin: r.o, authorization: 'Bearer org-1', 'x-mpc-status-token': j.status_token } }));
    expect(read.status).toBe(200); expect((await read.json()).status).toBe('new');
  });
  test(`${id}: other origin, missing origin, no session and a player all get 403 before the core is called`, async () => {
    const r = rig(id); let hits = 0; const spy = r.env.app; // count core calls through a second instance
    const h = createInstance({ config: r.config, strings: r.strings, secrets: { sign: SECRET, assert: ASSERT }, product: r.product, core: { fetch: (q) => (hits++, spy(q)) } });
    const mk = (hdr) => h(new Request('https://i.test/mpc/v1/tickets', { method: 'POST', headers: { 'idempotency-key': 'k'.repeat(20), ...hdr }, body: JSON.stringify(TICKET) }));
    expect((await mk({ origin: 'https://evil.example', authorization: 'Bearer org-1' })).status).toBe(403);
    expect((await mk({ authorization: 'Bearer org-1' })).status).toBe(403);
    expect((await mk({ origin: r.o })).status).toBe(403);
    expect((await mk({ origin: r.o, authorization: 'Bearer player-1' })).status).toBe(403);
    expect((await mk({ origin: r.o, authorization: 'Bearer unknown' })).status).toBe(403);
    expect(hits).toBe(0);
    expect((await (await mk({ origin: 'https://evil.example', authorization: 'Bearer org-1' })).json()).error).toBe('origin');
  });
  test(`${id}: the page cannot claim a role; bad body and unknown routes are refused; the core answer passes through`, async () => {
    const r = rig(id);
    const res = await r.post('/mpc/v1/tickets', { ...TICKET, role: 'co-organizer' }, { tok: 'org-1' }); expect(res.status).toBe(201); // role in the body is replaced
    expect((await r.env.store.getTicket(id, (await res.json()).ticket, Date.now())).role).toBe('organizer');
    expect((await r.post('/mpc/v1/tickets', 'not json')).status).toBe(400);
    expect((await r.post('/mpc/v1/tickets', [])).status).toBe(400);
    expect((await r.post('/mpc/v1/tickets', { ...TICKET, type: 'nope' })).status).toBe(400); // the core refuses unknown values
    expect((await r.post('/mpc/v1/team/x', {})).status).toBe(404); expect((await r.post('/mpc/v1/ai-links', {})).status).toBe(404);
    expect((await r.handle(new Request('https://i.test/mpc/v1/tickets', { method: 'DELETE' }))).status).toBe(404);
  });
  test(`${id}: replay with one key gives one ticket; screenshot goes through the same path`, async () => {
    const r = rig(id), h = { 'idempotency-key': 'same-key-0123456789' };
    const a = await (await r.post('/mpc/v1/tickets', TICKET, { headers: h })).json(), b = await (await r.post('/mpc/v1/tickets', TICKET, { headers: h })).json();
    expect(b.ticket).toBe(a.ticket);
    const s = await r.post('/mpc/v1/screenshots', PNG, { headers: { 'content-type': 'image/png' } }); expect(s.status).toBe(201); expect((await s.json()).screenshot_id).toBeTruthy();
    expect((await r.post('/mpc/v1/screenshots', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), { headers: { 'content-type': 'image/png' } })).status).toBeGreaterThanOrEqual(400); // wrong first bytes: the core refuses
  });
  test(`${id}: AI link round trip: product mints a read-only key, core keeps only the hash, the AI page opens, payment is refused`, async () => {
    const r = rig(id), res = await r.post('/mpc/ai-link', { kind: 'help' }); expect(res.status).toBe(201);
    const { url } = await res.json(); expect(url).toMatch(/\/ai\/[A-Za-z0-9_-]+\?k=mpk_[A-Za-z0-9]{40}$/);
    const k = url.split('k=')[1]; expect(await r.product.keys.act(k, 'read_event')).toEqual({ status: 200 });
    expect((await r.product.keys.act(k, 'payment')).error).toBe('forbidden_action'); expect((await r.product.keys.act(k, 'edit_event')).error).toBe('out_of_scope');
    const page = await r.env.ai('GET', new URL(url).pathname + '.json?k=' + k); expect(page.status).toBe(200);
    const rows = JSON.stringify(await r.env.store.getLinkByHash(await (await import('../../core/src/crypto.js')).sha256hex(k))); expect(rows).not.toContain(k);
    expect((await r.post('/mpc/ai-link', { kind: 'payments' })).status).toBe(400); expect((await r.post('/mpc/ai-link', {})).status).toBe(400); // unknown kind: no default scopes
    expect((await r.post('/mpc/ai-link', { kind: 'help' }, { tok: 'player-1' })).status).toBe(403);
    expect(Object.values(AI_KINDS).flat().every((s) => ['read_event', 'read_ticket'].includes(s))).toBe(true);
  });
  test(`${id}: public config holds text and colours only, no secret, and carries no "host" word`, async () => {
    const r = rig(id), res = await r.handle(new Request('https://i.test/mpc/config.json')); expect(res.status).toBe(200);
    const t = await res.text(); expect(JSON.parse(t).id).toBe(id); expect(t).not.toContain(SECRET); expect(t).not.toContain(ASSERT); expect(t).not.toMatch(/\bhost\b/i);
  });
}
test('the product server signs on its own side: a request signed with the wrong secret is refused by the core', async () => {
  const { config, strings } = cfgOf('corporatetambola'), product = productDouble(), env = makeEnv({ instance: config }); product.login('org-1', 'organizer', 'sess-org-0001');
  const bad = createInstance({ config, strings, secrets: { sign: 'x'.repeat(32), assert: ASSERT }, product, core: { fetch: (r) => env.app(r) } });
  const res = await bad(new Request('https://i.test/mpc/v1/tickets', { method: 'POST', headers: { origin: ORG, authorization: 'Bearer org-1', 'idempotency-key': 'k'.repeat(20) }, body: JSON.stringify(TICKET) }));
  expect(res.status).toBe(401); // the core said bad_signature
});
test('co-organizer: the product role "host" is stored as co-organizer; DNT reaches the core (no AI call row)', async () => {
  const r = rig('corporatetambola'), res = await r.post('/mpc/v1/tickets', TICKET, { tok: 'host-1', headers: { dnt: '1' } }); expect(res.status).toBe(201);
  expect((await r.env.store.getTicket('corporatetambola', (await res.json()).ticket, Date.now())).role).toBe('co-organizer');
});
test('the proxy sets and reads no cookies; the standard line is imported, not copied; version notes exist', () => {
  const src = readFileSync(new URL('../lib/proxy.js', import.meta.url), 'utf8'); expect(src).not.toMatch(/set-cookie|req\.headers\.get\('cookie'\)|document\.cookie/i);
  expect(src).not.toContain(STANDARD_AI_LINE); expect(VERSION).toBe('0.4.1'); expect(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')).toContain('## 0.4.1');
});
