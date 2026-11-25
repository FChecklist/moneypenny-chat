import { test, expect } from 'bun:test';
import { fakeD1, SCHEMA } from './helpers.js';
test('S-017 the migration applies on an empty database, twice, and makes the tables', () => {
  const d = fakeD1(); d.raw.exec(SCHEMA);
  const names = d.raw.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['ticket', 'idempotency', 'erasure_log', 'counter']) expect(names).toContain(t);
});
test('S-017 no column holds a person: no name, e-mail, phone, ip or user agent', () => {
  const cols = fakeD1().raw.query('PRAGMA table_info(ticket)').all().map((c) => c.name).join(' ');
  expect(cols).not.toMatch(/name|mail|phone|\bip\b|agent|cookie/);
  expect(cols).toContain('token_hash'); expect(cols).not.toMatch(/\btoken\b/);
});
test('S-017 an instance cannot have two tickets with the same number; idempotency key is unique', () => {
  const d = fakeD1().raw, ins = "INSERT INTO ticket (instance,number,option,screen,screen_label,text,role,created,updated,erase_at,token_hash) VALUES ('a','T-0001','stuck','/','x','',  'organizer',1,1,2,'h')";
  d.exec(ins); expect(() => d.exec(ins)).toThrow();
  d.exec("INSERT INTO idempotency VALUES ('a','k','b','{}',1)"); expect(() => d.exec("INSERT INTO idempotency VALUES ('a','k','c','{}',1)")).toThrow();
});
