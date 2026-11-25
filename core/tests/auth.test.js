import { test, expect } from 'bun:test';
import { sign, verifySignature, nonceStore } from '../src/auth.js';
import { makeLimiter } from '../src/limits.js';
import { fakeNamespace } from './helpers.js';
const S = 's'.repeat(32), NOW = 1_800_000_000_000, ts = String(NOW / 1000), nonce = 'ab'.repeat(16);
const mk = async (o = {}) => {
  const p = { method: 'POST', path: '/v1/tickets', ts, nonce, body: '{"a":1}', ...o };
  const sig = await sign(o.secret ?? S, { ...p, body: o.signedBody ?? p.body });
  return { headers: new Headers({ 'x-mpc-instance': 'i1', 'x-mpc-ts': o.hts ?? p.ts, 'x-mpc-nonce': p.nonce, 'x-mpc-sig': sig }), method: p.method, path: p.path, body: p.body };
};
const run = (req, extra = {}) => verifySignature({ ...req, secrets: [S], nonces: extra.nonces || nonceStore(makeLimiter(fakeNamespace())), now: NOW, ...extra });
test('S-012 good signature passes', async () => expect((await run(await mk())).ok).toBe(true));
test('S-012 old (301 s) and future (301 s) timestamps fail; 300 s passes', async () => {
  for (const d of [-301, 301]) { const t = String(NOW / 1000 + d); expect((await run(await mk({ ts: t }))).why).toBe('old'); }
  expect((await run(await mk({ ts: String(NOW / 1000 - 300) }))).ok).toBe(true);
});
test('S-012 replayed nonce fails the second time', async () => {
  const nonces = nonceStore(makeLimiter(fakeNamespace())), r = await mk();
  expect((await run(r, { nonces })).ok).toBe(true);
  expect((await run(r, { nonces })).why).toBe('replay');
});
test('S-012 wrong body, method, path or secret fail', async () => {
  expect((await run(await mk({ signedBody: '{"a":2}' }))).why).toBe('signature');
  const r = await mk(); expect((await run({ ...r, method: 'GET' })).why).toBe('signature');
  expect((await run({ ...r, path: '/v1/tickets/T-0001' })).why).toBe('signature');
  expect((await run(await mk({ secret: 'z'.repeat(32) }))).why).toBe('signature');
});
test('S-012 a bad signature does not use up the nonce', async () => {
  const nonces = nonceStore(makeLimiter(fakeNamespace()));
  expect((await run(await mk({ secret: 'z'.repeat(32) }), { nonces })).ok).toBe(false);
  expect((await run(await mk(), { nonces })).ok).toBe(true);
});
test('S-012 two active secrets (rotation): either works', async () => {
  const old = await mk({ secret: 'o'.repeat(32), nonce: 'cd'.repeat(16) });
  expect((await run(old, { secrets: ['o'.repeat(32), S] })).ok).toBe(true);
  expect((await run(await mk({ nonce: 'ef'.repeat(16) }), { secrets: ['o'.repeat(32), S] })).ok).toBe(true);
});
test('S-012 missing or malformed headers fail; no secrets fails', async () => {
  expect((await run({ headers: new Headers(), method: 'POST', path: '/x', body: '' })).why).toBe('shape');
  expect((await run(await mk({ hts: 'abc' }))).why).toBe('shape');
  expect((await run(await mk(), { secrets: [] })).why).toBe('shape');
});
