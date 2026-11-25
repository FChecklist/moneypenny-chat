// S-049: the standard line is the owner's line, byte for byte, and it is the same string everywhere it is defined.
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { STANDARD_AI_LINE as RULE } from '../contract/strings-rules.mjs';
import { STANDARD_AI_LINE as CORE } from '../core/src/strings.js';
const OWNER = [67, 111, 112, 121, 32, 116, 104, 105, 115, 32, 108, 105, 110, 107, 32, 97, 110, 100, 32, 112, 97, 115, 116, 101, 32, 105, 110, 32, 121, 111, 117, 114, 32, 65, 73, 32, 116, 111, 32, 119, 111, 114, 107, 46]; // "Copy this link and paste in your AI to work."
test('S-049 the line equals the owner line byte for byte: 44 ASCII bytes, full stop, no trailing space or newline', () => {
  for (const s of [RULE, CORE]) { expect([...new TextEncoder().encode(s)]).toEqual(OWNER); expect(s.length).toBe(44); expect(s).toBe('Copy this link and paste in your AI to work.'); }
  expect(RULE).toBe(CORE);
});
test('S-049 the line is written out in only these two files of the core and the contract; every other place imports it', () => {
  const hits = []; // dist folders are built bundles (generated, git-ignored); they hold the imported line and are skipped
  const walk = (dir) => { for (const d of readdirSync(dir, { withFileTypes: true })) { if (d.name === 'node_modules' || d.name === '.git' || d.name === 'dist') continue; const p = dir + '/' + d.name; if (d.isDirectory()) walk(p); else if (/\.(js|mjs|md|html|json|toml)$/.test(d.name) && readFileSync(p, 'utf8').includes('Copy this link and paste in your AI to work.')) hits.push(p.replace(new URL('..', import.meta.url).pathname, '')); } };
  walk(new URL('..', import.meta.url).pathname.replace(/\/$/, ''));
  const allowed = new Set(['contract/strings-rules.mjs', 'core/src/strings.js', 'tests/standard-line.test.mjs', 'tests/strings.test.js', 'docs/DECISIONS.md', 'CHANGELOG.md', 'core/CHANGELOG.md', 'contract/README.md', 'README.md']);
  expect(hits.filter((h) => !allowed.has(h))).toEqual([]); expect(hits).toContain('core/src/strings.js'); expect(hits).toContain('contract/strings-rules.mjs');
});
test('S-049 the AI page does not carry the line (the widget shows it); the page names no other "your"', () => {
  expect(readFileSync(new URL('../core/templates/ai-page.md', import.meta.url), 'utf8')).not.toMatch(/\b(my|mine|your|yours)\b/i);
});
