import { test, expect } from 'bun:test';
import { Limits, makeLimiter } from '../src/limits.js';
import { fakeNamespace } from './helpers.js';
test('S-013 take: exactly cap admitted under 50 parallel calls', async () => {
  const lim = makeLimiter(fakeNamespace());
  const r = await Promise.all(Array.from({ length: 50 }, () => lim('k', { op: 'take', delta: 1, cap: 7, ttl: 60 })));
  expect(r.filter((x) => x.ok).length).toBe(7);
  expect((await lim('k', { op: 'get' })).v).toBe(7);
});
test('S-013 add can give back; never below zero; keys expire', async () => {
  const lim = makeLimiter(fakeNamespace());
  await lim('a', { op: 'take', delta: 1, cap: 1, ttl: 60 });
  expect((await lim('a', { op: 'add', delta: -5 })).v).toBe(0);
  expect((await lim('a', { op: 'take', delta: 1, cap: 1, ttl: 60 })).ok).toBe(true);
  const real = Date.now; try { Date.now = () => real() + 61_000; expect((await lim('a', { op: 'get' })).v).toBe(0); } finally { Date.now = real; }
});
test('S-013 nonce store: first take wins, second fails, parallel gives exactly one', async () => {
  const lim = makeLimiter(fakeNamespace());
  const r = await Promise.all(Array.from({ length: 10 }, () => lim('n:x', { op: 'take', delta: 1, cap: 1, ttl: 600 })));
  expect(r.filter((x) => x.ok).length).toBe(1);
});
test('S-013 unknown op is an error; the class is the old one (alarm sweeps expired keys)', async () => {
  const lim = makeLimiter(fakeNamespace()); expect((await lim('z', { op: 'nope' })).error).toBe('op');
  const m = new Map([['old', { v: 1, exp: 1 }], ['new', { v: 1, exp: Date.now() + 1e6 }]]);
  await new Limits({ storage: { list: async () => new Map(m), delete: async (k) => void m.delete(k) } }).alarm();
  expect([...m.keys()]).toEqual(['new']);
});
const TEST_CAP = 3;
test('round 4: nonce cap per instance refuses new nonces (rate) until old ones expire; counters are not capped', async () => {
  const { makeEnv } = await import('./helpers.js');
  let t = Date.now(); const e = makeEnv({ nonceCap: TEST_CAP, now: () => t });
  for (let i = 0; i < TEST_CAP; i++) expect((await e.call('GET', '/v1/tickets/T-0001')).status).toBe(404);
  const r = await e.call('GET', '/v1/tickets/T-0001'); expect(r.status).toBe(429); expect((await r.json()).error).toBe('rate');
  const lim = makeLimiter(fakeNamespace({ nonceCap: 1 })); expect((await lim('c', { op: 'take', delta: 1, cap: 9, ttl: 60 })).ok).toBe(true); expect((await lim('c2', { op: 'take', delta: 1, cap: 9, ttl: 60 })).ok).toBe(true);
  const real = Date.now; try { Date.now = () => real() + 601_000; t += 601_000; expect((await e.call('GET', '/v1/tickets/T-0001')).status).toBe(404); } finally { Date.now = real; }
});
