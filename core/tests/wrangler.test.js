import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
const t = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
test('S-004 wrangler.toml: Durable Object binding, migration, entry; no secret values, no ids', () => {
  expect(t).toMatch(/main = "src\/index\.js"/); expect(t).toMatch(/name = "LIMITS"/); expect(t).toMatch(/class_name = "Limits"/); expect(t).toMatch(/new_classes = \["Limits"\]/);
  expect(t).not.toMatch(/^database_id\s*=/m); expect(t).not.toMatch(/account_id/); expect(t).toMatch(/INSTANCES = "\[\]"/);
});
test('the money flag stays OFF and there is no payment code in the core', async () => {
  expect(t).toMatch(/^PAY_VIA_MONEYPENNY = "0"/m);
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(new URL('../src/', import.meta.url))) expect(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8'), f).not.toMatch(/razorpay|payee|PAY_VIA_MONEYPENNY/i);
});
test('audit: the D1 binding is commented out with a clear deploy note', () => {
  expect(t).toMatch(/# DEPLOY NOTE: the DB binding below is commented out/); expect(t).toMatch(/Before deploy/);
  expect(t).toMatch(/answers 503/); expect(t).toMatch(/^# \[\[d1_databases\]\]/m);
  for (const f of ['../../README.md', '../../docs/DECISIONS.md']) expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).toMatch(/binding[^\n]*(commented out|filled in)[^\n]*before deploy|before deploy[^\n]*binding/i);
});
