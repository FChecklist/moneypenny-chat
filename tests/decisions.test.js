import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
const t = readFileSync(new URL('../docs/DECISIONS.md', import.meta.url), 'utf8');
test('S-001 every question I1 to I13 has a heading and an Answer line', () => {
  for (let i = 1; i <= 13; i++) {
    const m = t.match(new RegExp(`## I${i}\\. [^\\n]+\\n([\\s\\S]*?)(?=\\n## |$)`));
    expect(m, 'I' + i).not.toBeNull(); expect(m[1], 'I' + i).toMatch(/^Answer: .{10,}/m);
  }
});
test('S-001 says plainly that the owner has not confirmed; money flag and version rules are recorded', () => {
  expect(t).toMatch(/owner has not answered/i); expect(t).toMatch(/0\.1\.0/); expect(t).toMatch(/money flag stays OFF/);
});
