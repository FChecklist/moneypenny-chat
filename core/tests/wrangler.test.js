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
