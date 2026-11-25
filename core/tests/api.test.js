import { test, expect } from 'bun:test';
import { makeEnv, fixture, STORES } from './helpers.js';
import worker from '../src/index.js';

test('S-014 GET /v1/health and /v1/version', async () => {
  const e = makeEnv({ now: () => 1234 });
  let r = await e.plain('GET', '/v1/health'); expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true, core: '0.4.2', time: 1234 });
  expect(r.headers.get('x-mpc-core-version')).toBe('0.4.2');
  r = await e.plain('GET', '/v1/version'); expect(await r.json()).toEqual({ core: '0.4.2', api: 'v1', min_instance: '0.1' });
});
test('S-014 unknown path, wrong method, and tickets without signature', async () => {
  const e = makeEnv();
  expect((await e.plain('GET', '/v1/nope')).status).toBe(404);
  expect((await e.plain('POST', '/v1/health')).status).toBe(404);
  expect((await e.plain('DELETE', '/v1/tickets')).status).toBe(404);
  const r = await e.plain('POST', '/v1/tickets', {}); expect(r.status).toBe(401); expect((await r.json()).error).toBe('bad_signature');
});
test('S-014 the Worker entry with no bindings says try_later (503), no detail', async () => {
  const r = await worker.fetch(new Request('https://x.test/v1/health'), {}); expect(r.status).toBe(503); expect((await r.json()).error).toBe('try_later');
});
test('S-014 the Worker entry runs with D1 and Durable Object bindings and a signed ticket call', async () => {
  const { fakeD1, fakeNamespace, SECRET, ASSERT } = await import('./helpers.js'); const { sign } = await import('../src/auth.js'); const { signAssertion } = await import('../src/assertion.js');
  const inst = fixture('instance-example.json'), env = { DB: fakeD1(), LIMITS: fakeNamespace(), INSTANCES: JSON.stringify([inst]), SECRET_EXAMPLE_PRODUCT: SECRET, SECRET_EXAMPLE_PRODUCT_ASSERT: ASSERT };
  const raw = JSON.stringify(fixture('ticket-suggest.json')), ts = String(Math.floor(Date.now() / 1000)), nonce = '1'.repeat(32);
  const h = { 'x-mpc-instance': inst.id, 'x-mpc-ts': ts, 'x-mpc-nonce': nonce, 'x-mpc-sig': await sign(SECRET, { method: 'POST', path: '/v1/tickets', ts, nonce, body: raw }), 'idempotency-key': crypto.randomUUID(), 'x-mpc-assertion': await signAssertion(ASSERT, { product: inst.id, role: 'organizer', sess: 'session-0001', exp: Math.floor(Date.now() / 1000) + 600 }) };
  const r = await worker.fetch(new Request('https://x.test/v1/tickets', { method: 'POST', headers: h, body: raw }), env);
  expect(r.status).toBe(201); expect((await r.json()).ticket).toBe('T-0001');
});
test('signed route: unknown instance, wrong secret, old time, replayed nonce, big body', async () => {
  const e = makeEnv(), b = fixture('ticket-suggest.json');
  expect((await e.call('POST', '/v1/tickets', b, { instance: 'nobody-here' })).status).toBe(401);
  expect((await e.call('POST', '/v1/tickets', b, { secret: 'q'.repeat(32) })).status).toBe(401);
  expect((await e.call('POST', '/v1/tickets', b, { ts: 1000 })).status).toBe(401);
  const n = 'f'.repeat(32); expect((await e.call('POST', '/v1/tickets', b, { nonce: n })).status).toBe(201);
  const r = await e.call('POST', '/v1/tickets', b, { nonce: n }); expect(r.status).toBe(401); expect((await r.json()).error).toBe('bad_signature');
  const big = await e.call('POST', '/v1/tickets', { text: 'a'.repeat(9000) }); expect(big.status).toBe(413); expect((await big.json()).error).toBe('too_large');
});
test('signed route: store down gives try_later and no detail', async () => {
  const e = makeEnv(); e.store.peekIdem = async () => { throw new Error('secret database detail'); };
  const r = await e.call('POST', '/v1/tickets', fixture('ticket-suggest.json')); expect(r.status).toBe(503);
  expect(JSON.stringify(await r.json())).not.toContain('secret database');
});
test('the three options exist in the contract fixtures and are accepted by both stores', async () => {
  for (const s of Object.keys(STORES)) { const e = makeEnv({ store: s }); for (const f of ['ticket-help.json', 'ticket-suggest.json', 'ticket-stuck.json']) expect((await e.call('POST', '/v1/tickets', fixture(f), { sess: 'sess-' + f.replace(/\W/g, '') })).status, s + f).toBe(201); }
});
