import { test, expect } from 'bun:test';
import { ERRORS, STATUS, fail, json } from '../src/http.js';
import { ERROR_TEXT } from '../src/strings.js';
const F3 = { bad_request: 400, bad_signature: 401, no_assertion: 401, origin: 403, role: 403, not_found: 404, idempotency_conflict: 409, too_large: 413, bad_type: 415, rate: 429, try_later: 503 };
test('S-015 table over every F3 code: status, shape, version header, simple message', async () => {
  for (const [code, status] of Object.entries(F3)) {
    const r = fail(code); const b = await r.json();
    expect(r.status, code).toBe(status); expect(b.error).toBe(code); expect(b.message.length).toBeGreaterThan(3);
    expect(b.message.split('.').filter(Boolean).length, code).toBeLessThanOrEqual(2);
    expect(r.headers.get('x-mpc-core-version')).toBe('0.1.3'); expect(r.headers.get('content-type')).toBe('application/json');
  }
});
test('S-015 added code no_team_login is 401; extras are merged; unknown code becomes try_later', async () => {
  expect(STATUS.no_team_login).toBe(401);
  expect(await fail('bad_request', { field: 'text' }).json()).toEqual({ error: 'bad_request', message: ERROR_TEXT.bad_request, field: 'text' });
  const r = fail('made_up'); expect(r.status).toBe(503); expect((await r.json()).error).toBe('try_later');
});
test('S-015 every code has text, and json() sets no-store', () => {
  expect(Object.keys(ERRORS).sort()).toEqual(Object.keys(ERROR_TEXT).sort());
  expect(json({}).headers.get('cache-control')).toBe('no-store');
});
