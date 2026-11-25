import { test, expect } from 'bun:test';
import { signAssertion, verifyAssertion } from '../src/assertion.js';
import { b64url } from '../src/crypto.js';
const S = 'a'.repeat(32), NOW = 1_800_000_000_000, t = NOW / 1000;
const pl = (o = {}) => ({ product: 'p1', role: 'organizer', sess: 'session-0001', exp: t + 600, ...o });
const v = (tok, o = {}) => verifyAssertion(tok, { secrets: [S], product: 'p1', now: NOW, ...o });
test('S-018 good assertion gives role and session', async () => expect(await v(await signAssertion(S, pl()))).toEqual({ ok: true, role: 'organizer', sess: 'session-0001' }));
test('S-018 tampered payload or mac is refused', async () => {
  const tok = await signAssertion(S, pl()), [p, m] = tok.split('.');
  expect((await v(b64url(JSON.stringify(pl({ role: 'co-organizer' }))) + '.' + m)).error).toBe('no_assertion');
  expect((await v(p + '.' + m.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).error).toBe('no_assertion');
  expect((await v(tok + '.x')).error).toBe('no_assertion');
});
test('S-018 expired, too long, and wrong product are refused', async () => {
  expect((await v(await signAssertion(S, pl({ exp: t - 1 })))).error).toBe('no_assertion');
  expect((await v(await signAssertion(S, pl({ exp: t + 3601 })))).error).toBe('no_assertion');
  expect((await v(await signAssertion(S, pl({ product: 'p2' })))).error).toBe('no_assertion');
});
test('S-018 wrong secret, missing token and bad session value are refused; rotation works', async () => {
  expect((await v(await signAssertion('b'.repeat(32), pl()))).error).toBe('no_assertion');
  for (const x of [null, '', 'abc']) expect((await v(x)).error).toBe('no_assertion');
  expect((await v(await signAssertion(S, pl({ sess: 'x' })))).error).toBe('no_assertion');
  expect((await v(await signAssertion('b'.repeat(32), pl()), { secrets: [S, 'b'.repeat(32)] })).ok).toBe(true);
});
test('S-018 role: maps through role_map; a player or unknown role is refused with role', async () => {
  expect((await v(await signAssertion(S, pl({ role: 'host' })), { roleMap: { host: 'co-organizer' } })).role).toBe('co-organizer');
  expect((await v(await signAssertion(S, pl({ role: 'player' })))).error).toBe('role');
  expect((await v(await signAssertion(S, pl({ role: 'host' })))).error).toBe('role'); // no map: the word host alone is not a role
});
