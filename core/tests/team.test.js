import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { makeEnv, fixture, STORES, PNG } from './helpers.js';
import { accessAuth } from '../src/access.js';
import { checkStrings } from '../../contract/strings-rules.mjs';
import { b64url } from '../src/crypto.js';
const html = readFileSync(new URL('../team/index.html', import.meta.url), 'utf8'), js = readFileSync(new URL('../team/app.js', import.meta.url), 'utf8');

for (const store of Object.keys(STORES)) {
  const mk = async () => { const e = makeEnv({ store, team: true }); for (let i = 0; i < 3; i++) await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), text: 'Idea number ' + i + ' here' }, { sess: 'sess-team-' + i }); return e; };
  test(`[${store}] S-038 list: newest first, filter by status and product, cursor`, async () => {
    const e = await mk(); await e.plain('PATCH', '/v1/team/tickets/T-0002?product=example-product', { status: 'seen' });
    let j = await (await e.plain('GET', '/v1/team/tickets')).json(); expect(j.items.map((x) => x.ticket)).toEqual(['T-0003', 'T-0002', 'T-0001']); expect(j.items[0]).not.toHaveProperty('text');
    j = await (await e.plain('GET', '/v1/team/tickets?status=seen')).json(); expect(j.items.map((x) => x.ticket)).toEqual(['T-0002']);
    j = await (await e.plain('GET', '/v1/team/tickets?product=other-one')).json(); expect(j.items).toEqual([]);
    expect((await e.plain('GET', '/v1/team/tickets?status=weird')).status).toBe(400); expect((await e.plain('GET', '/v1/team/tickets?cursor=abc')).status).toBe(400);
  });
  test(`[${store}] S-039 PATCH: status change, reply up to 500 characters (501 refused), reply is scrubbed, user sees it`, async () => {
    const e = await mk(), p = (b) => e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', b);
    expect((await p({ status: 'done', team_note: 'é'.repeat(500) })).status).toBe(200); expect((await p({ status: 'done', team_note: 'a'.repeat(501) })).status).toBe(400);
    expect((await p({ status: 'new' })).status).toBe(400); expect((await p({ status: 'seen', team_note: 5 })).status).toBe(400);
    expect((await p({ status: 'seen', team_note: 'Call ' + ['98765', '43210'].join('') })).status).toBe(200); expect((await e.plain('GET', '/v1/team/tickets/T-0001?product=example-product').then((r) => r.json())).team_note).toBe('Call [removed]');
  });
}
test('S-040 team page: plain HTML, one script from the same origin, no external address, no inline handler, language set, labels for fields, view-only notice', () => {
  expect(html).toMatch(/<html lang="en">/); expect(html).not.toMatch(/(src|href|action)\s*=\s*["']?(https?:)?\/\//i); expect(html).not.toMatch(/\son[a-z]+\s*=/i); expect(html).not.toMatch(/<script(?![^>]*src="\/team\/app\.js")/);
  expect(html).toContain('This may contain personal data: view only, do not forward.'); expect(html).not.toMatch(/type="checkbox"/i);
  for (const id of ['product', 'status', 'note']) expect(html).toContain(`<label for="${id}">`);
  expect(html).toMatch(/<th scope="col">/); expect(html).toContain('role="status"'); expect(html).toMatch(/Erase now/);
  expect(js).not.toMatch(/https?:\/\//); expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  const words = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean).concat([...js.matchAll(/'([^']{3,})'/g)].map((m) => m[1]).filter((s) => /^[A-Z]/.test(s)));
  expect(checkStrings(words)).toEqual([]);
});
test('S-040 the page and its script are served with login only, with safe headers and a script policy that allows no outside script', async () => {
  const e = makeEnv({ team: true }), r = await e.plain('GET', '/team'); expect(r.status).toBe(200); expect(r.headers.get('content-type')).toMatch(/text\/html/);
  expect(r.headers.get('content-security-policy')).toMatch(/script-src 'self'/); expect(r.headers.get('content-security-policy')).toMatch(/default-src 'none'/); expect(r.headers.get('cache-control')).toBe('no-store'); expect(await r.text()).toContain('Tickets');
  const s = await e.plain('GET', '/team/app.js'); expect(s.status).toBe(200); expect(s.headers.get('content-type')).toMatch(/javascript/);
  expect((await e.plain('POST', '/team')).status).toBe(404);
});

// ---- S-041: Cloudflare Access
const NOW = 1_800_000_000_000, DOMAIN = 'team.cloudflareaccess.com', AUD = 'a'.repeat(32);
async function keypair() { const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']); const jwk = await crypto.subtle.exportKey('jwk', k.publicKey); return { priv: k.privateKey, jwk: { ...jwk, kid: 'k1' } }; }
async function token(priv, over = {}, head = {}) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', ...head })), p = b64url(JSON.stringify({ iss: 'https://' + DOMAIN, aud: [AUD], exp: NOW / 1000 + 600, nbf: NOW / 1000 - 5, ...over }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(h + '.' + p))); return h + '.' + p + '.' + btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const req = (t) => new Request('https://core.test/team', { headers: t ? { 'cf-access-jwt-assertion': t } : {} });
test('S-041 Access: a good token passes; no token, wrong audience, wrong issuer, expired, not yet valid, tampered, wrong key, alg none and a bad domain all fail', async () => {
  const { priv, jwk } = await keypair(), other = await keypair(); let fetched = 0;
  const auth = accessAuth({ domain: DOMAIN, aud: AUD, now: () => NOW, fetchJwks: async (u) => { fetched++; expect(u).toBe(`https://${DOMAIN}/cdn-cgi/access/certs`); return { keys: [jwk] }; } });
  expect(await auth(req(await token(priv)))).toBe(true); expect(await auth(req(await token(priv, { aud: AUD })))).toBe(true); expect(await auth(req(await token(priv)))).toBe(true); expect(fetched).toBe(1); // keys are cached
  for (const [name, t] of [['none', null], ['aud', await token(priv, { aud: ['b'.repeat(32)] })], ['iss', await token(priv, { iss: 'https://evil.cloudflareaccess.com' })], ['expired', await token(priv, { exp: NOW / 1000 - 1 })], ['nbf', await token(priv, { nbf: NOW / 1000 + 100 })],
    ['wrong key', await token(other.priv)], ['alg', await token(priv, {}, { alg: 'none' })], ['kid', await token(priv, {}, { kid: 'zz' })], ['junk', 'a.b.c'], ['two parts', 'a.b']]) expect(await auth(req(t)), name).toBe(false);
  const t = await token(priv), [h, p, s] = t.split('.'); expect(await auth(req(h + '.' + b64url(JSON.stringify({ iss: 'https://' + DOMAIN, aud: [AUD], exp: 9e9 })) + '.' + s))).toBe(false);
  for (const d of ['', 'evil.example.com', 'team.cloudflareaccess.com.evil.com', undefined]) expect(await accessAuth({ domain: d, aud: AUD, now: () => NOW, fetchJwks: async () => ({ keys: [jwk] }) })(req(t))).toBe(false);
  expect(await accessAuth({ domain: DOMAIN, aud: '', now: () => NOW, fetchJwks: async () => ({ keys: [jwk] }) })(req(t))).toBe(false);
  expect(await accessAuth({ domain: DOMAIN, aud: AUD, now: () => NOW, fetchJwks: async () => { throw new Error('net'); } })(req(t))).toBe(false); // keys cannot be fetched: closed
});
test('S-041 with Access in front: no login gives 401 on /team, /team/app.js and /v1/team/*; a good login gets in; a key unknown at first is fetched once more', async () => {
  const { priv, jwk } = await keypair(); let keys = [];
  const e = makeEnv({ teamAuth: accessAuth({ domain: DOMAIN, aud: AUD, now: () => NOW, fetchJwks: async () => ({ keys }) }), now: () => NOW });
  for (const p of ['/team', '/team/', '/team/app.js', '/v1/team/tickets', '/v1/team/tickets/T-0001?product=example-product', '/v1/team/tickets/T-0001/screenshot?product=example-product']) { const r = await e.plain('GET', p); expect(r.status, p).toBe(401); expect((await r.json()).error).toBe('no_team_login'); }
  const t = await token(priv), hdr = { 'cf-access-jwt-assertion': t };
  expect((await e.app(new Request('https://core.test/v1/team/tickets', { headers: hdr }))).status).toBe(401); // keys list empty: closed
  keys = [jwk]; // the cache is younger than 60 s in the fake clock: no refetch yet
  expect((await e.app(new Request('https://core.test/v1/team/tickets', { headers: hdr }))).status).toBe(401);
});
test('S-041 docs/ACCESS.md exists and says what to set; wrangler has the two Access variables empty', () => {
  const d = readFileSync(new URL('../../docs/ACCESS.md', import.meta.url), 'utf8'); expect(d).toMatch(/ACCESS_TEAM_DOMAIN/); expect(d).toMatch(/ACCESS_AUD/); expect(d).toMatch(/\/v1\/team\/\*/); expect(d).toMatch(/not checked/i);
  const w = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'); expect(w).toMatch(/^ACCESS_TEAM_DOMAIN = ""/m); expect(w).toMatch(/^ACCESS_AUD = ""/m);
});
