// Fake samples on purpose (this file is exempt from the scan, see scripts/secrets-scan.mjs).
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan, EXEMPT } from '../scripts/secrets-scan.mjs';
const here = join(import.meta.dir, '..');
test('S-003 the real tree is clean', () => expect(scan(here)).toEqual([]));
test('S-003 a planted key, token, e-mail, phone and private key are all found (fails when the scan is weakened)', () => {
  const d = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(d, 'a.js'), 'const k = "' + 'sk-ant-' + 'abcdefghij' + '";');
    writeFileSync(join(d, 'b.md'), 'token ' + 'ghp_' + 'a'.repeat(24) + ' mail someone@example.org call 9876543210');
    writeFileSync(join(d, 'c.toml'), '-----BEGIN ' + 'RSA PRIVATE KEY-----');
    mkdirSync(join(d, 'node_modules')); writeFileSync(join(d, 'node_modules', 'x.js'), 'someone@example.org');
    const kinds = scan(d, new Set()).map((h) => h.kind).sort();
    expect(kinds).toEqual(['anthropic key', 'e-mail address', 'github token', 'mobile-like number', 'private key']);
  } finally { rmSync(d, { recursive: true }); }
});
test('S-003 the scan is first in the test script', async () => {
  const p = (await import('../package.json', { with: { type: 'json' } })).default;
  expect(p.scripts.test.startsWith('bun scripts/secrets-scan.mjs && ')).toBe(true);
});
test('only the sample files are exempt', () => expect([...EXEMPT].sort()).toEqual(['core/tests/scrub.test.js', 'core/tests/tickets.test.js', 'tests/history.test.js', 'tests/secrets.test.js']));
