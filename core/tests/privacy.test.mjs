import { test, expect } from 'bun:test';
import { makeEnv, fixture, STORES, PNG } from './helpers.js';
import { isPrivate } from '../src/privacy.js';
test('S-031 DNT and GPC are read: DNT 1, Sec-GPC 1; other values are not', () => {
  const h = (o) => new Headers(o); expect(isPrivate(h({ dnt: '1' }))).toBe(true); expect(isPrivate(h({ 'sec-gpc': '1' }))).toBe(true);
  expect(isPrivate(h({ dnt: '0' }))).toBe(false); expect(isPrivate(h({}))).toBe(false);
});
for (const store of Object.keys(STORES)) {
  const setup = async (headers) => {
    const e = makeEnv({ store }); const tk = await (await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { headers })).json();
    const hash = 'a'.repeat(64), l = await (await e.call('POST', '/v1/ai-links', { ticket: tk.ticket, scopes: ['read_ticket'], key_hash: hash, product_key_id: 'k1' }, { token: tk.status_token })).json();
    return { e, l, tk };
  };
  test(`[${store}] S-031 without a header the AI call is logged; with DNT or GPC the ticket and the call still work but no side record is written`, async () => {
    // the AI key is a bearer value whose hash is stored: use a known value
    const k = 'mpk_' + 'q'.repeat(40), { sha256hex } = await import('../src/crypto.js'), hash = await sha256hex(k);
    const run = async (headers) => {
      const e = makeEnv({ store }); const tk = await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { headers }); expect(tk.status).toBe(201); const t = await tk.json();
      const l = await (await e.call('POST', '/v1/ai-links', { ticket: t.ticket, scopes: ['read_ticket'], key_hash: hash, product_key_id: 'k1' }, { token: t.status_token, headers })).json();
      expect((await e.ai('GET', '/v1/ai/context', { k, headers })).status).toBe(200); return (await e.store.listCalls(l.id)).length;
    };
    expect(await run({})).toBe(1); expect(await run({ dnt: '1' })).toBe(0); expect(await run({ 'sec-gpc': '1' })).toBe(0);
  });
  test(`[${store}] S-032 no response sets a cookie; no stored row holds an address, user agent or visitor id`, async () => {
    const e = makeEnv({ store, team: true }); const seen = [];
    const keep = async (r) => { seen.push(r.clone()); return r; };
    const ip = { ip: '203.0.113.77', headers: { 'user-agent': 'TestBrowser/9.9 (X11)' } };
    const up = await (await keep(await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png', ...ip }))).json();
    const tk = await (await keep(await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: up.screenshot_id }, ip))).json();
    await keep(await e.call('GET', '/v1/tickets/' + tk.ticket, undefined, { token: tk.status_token, ...ip })); await keep(await e.call('POST', '/v1/tickets', { option: 'nope' }, ip));
    const k = 'mpk_' + 'z'.repeat(40), { sha256hex } = await import('../src/crypto.js');
    const l = await (await keep(await e.call('POST', '/v1/ai-links', { ticket: tk.ticket, scopes: ['read_ticket', 'report'], key_hash: await sha256hex(k), product_key_id: 'k1' }, { token: tk.status_token, ...ip }))).json();
    await keep(await e.ai('GET', '/v1/ai/context', { k })); await keep(await e.ai('GET', `/ai/${l.id}?k=${k}`)); await keep(await e.ai('GET', `/ai/${l.id}.json?k=${k}`)); await keep(await e.ai('GET', '/ai/short?k=bad'));
    await keep(await e.ai('POST', '/v1/ai/notes', { k, body: { type: 'plan', text: 'Read the ticket.' } }));
    await keep(await e.plain('GET', '/v1/team/tickets')); await keep(await e.plain('GET', '/v1/health')); await keep(await e.plain('GET', '/team')); await keep(await e.plain('GET', '/v1/team/tickets/T-0001?product=example-product'));
    for (const r of seen) expect(r.headers.get('set-cookie')).toBeNull();
    const dump = JSON.stringify({ tickets: (await e.store.listTickets({ now: 0, limit: 99 })).items, audit: await e.store.listAudit(), shots: await e.store.shotsOfTicket('example-product', tk.ticket), notes: await e.store.listNotes(l.id), calls: await e.store.listCalls(l.id), link: await e.store.getLink(l.id), log: await e.store.erasureLog() });
    expect(dump).not.toContain('203.0.113.77'); expect(dump).not.toContain('TestBrowser'); expect(dump).not.toContain(k); expect(dump).not.toMatch(/cookie|user.?agent/i);
    for (const r of seen) { const body = await r.clone().text(); expect(body).not.toContain('203.0.113.77'); expect(body).not.toContain(k.slice(4) + 'zz'); }
  });
}
test('S-032 D1: every table of the real schema, row by row, holds no address, agent or key', async () => {
  const { fakeD1 } = await import('./helpers.js'); const e = makeEnv({ store: 'd1' });
  const ip = { ip: '198.51.100.9', headers: { 'user-agent': 'AgentX/1' } }; const k = 'mpk_' + 'w'.repeat(40), { sha256hex } = await import('../src/crypto.js');
  const tk = await (await e.call('POST', '/v1/tickets', fixture('ticket-stuck.json'), ip)).json();
  await e.call('POST', '/v1/ai-links', { ticket: tk.ticket, scopes: ['read_ticket', 'report'], key_hash: await sha256hex(k), product_key_id: 'k1' }, { token: tk.status_token, ...ip });
  await e.ai('GET', '/v1/ai/context', { k }); await e.ai('POST', '/v1/ai/notes', { k, body: { type: 'plan', text: 'Look.' } });
  const raw = e.ctx().store; expect(raw).toBeDefined();
  const db = e.d1raw; if (db) { for (const { name } of db.query("SELECT name FROM sqlite_master WHERE type='table'").all()) { const rows = JSON.stringify(db.query(`SELECT * FROM ${name}`).all()); expect(rows, name).not.toContain('198.51.100.9'); expect(rows, name).not.toContain('AgentX'); expect(rows, name).not.toContain(k); } }
});
