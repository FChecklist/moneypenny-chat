import { test, expect } from 'bun:test';
import { makeEnv, fixture, STORES, PNG } from './helpers.js';
import { sweep, eraseTicketNow } from '../src/retention.js';
for (const store of Object.keys(STORES)) {
  const T = 1_800_000_000_000, H = 3600e3;
  test(`[${store}] S-030 sweep: ticket row, file, notes, calls and mail queue are gone; the erasure log row stays; audit rows are written`, async () => {
    let t = T; const e = makeEnv({ store, now: () => t, mail: { send: async () => { throw new Error('down'); } } });
    const up = await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png' })).json();
    const tk = await (await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: up.screenshot_id })).json();
    const key = 'k'.repeat(64).replace(/k/g, '1'), link = await (await e.call('POST', '/v1/ai-links', { ticket: tk.ticket, screen: '/', scopes: ['read_ticket', 'report'], key_hash: key, product_key_id: 'pk1' }, { token: tk.status_token })).json();
    await e.store.addNote(link.id, 'plan', 'x', t); await e.store.addCall({ link_id: link.id, at: t, method: 'GET', path_class: 'ai/context', code: 200 });
    expect(e.blobs.keys().length).toBe(1); expect((await e.store.dueMail(t + 2 * H, 5)).length).toBe(1);
    t = T + 24 * H - 1; expect(await sweep({ ...e.ctx(), now: () => t })).toEqual({ shots: 0, tickets: 0 });
    t = T + 24 * H; expect(await sweep({ ...e.ctx(), now: () => t })).toEqual({ shots: 1, tickets: 1 });
    expect(await e.store.getTicket('example-product', tk.ticket, 0)).toBeNull(); expect(e.blobs.keys()).toEqual([]);
    expect(await e.store.listNotes(link.id)).toEqual([]); expect(await e.store.listCalls(link.id)).toEqual([]); expect(await e.store.dueMail(t + 99 * H, 5)).toEqual([]);
    expect(await e.store.erasureLog()).toEqual([{ ticket: tk.ticket, instance: 'example-product', erased_at: t }]);
    const acts = (await e.store.listAudit()).map((a) => a.action); expect(acts).toContain('ticket_erased'); expect(acts).toContain('screenshot_erased'); expect(acts).toContain('ticket_created');
    expect(JSON.stringify(await e.store.listAudit())).not.toMatch(/Idea|@|text/); // no text, no person in audit rows
  });
  test(`[${store}] S-030 records class: ticket open for 90 days is erased; a file that cannot be deleted keeps the ticket for the next sweep`, async () => {
    let t = T; const rec = { ...fixture('instance-example.json'), retention_class: 'records' }; const e = makeEnv({ store, now: () => t, instance: rec });
    const up = await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png' })).json();
    await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: up.screenshot_id });
    t = T + 90 * 864e5; const ok = e.blobs.delete; e.blobs.delete = async () => { throw new Error('r2 down'); };
    await expect(sweep({ ...e.ctx(), now: () => t })).rejects.toThrow();
    expect(await e.store.getTicket('example-product', 'T-0001', T)).not.toBeNull(); // still there: retried next hour
    e.blobs.delete = ok; expect((await sweep({ ...e.ctx(), now: () => t })).tickets).toBe(1);
  });
  test(`[${store}] Erase now: team erases one ticket at once; unknown ticket is 404; a log row remains`, async () => {
    const e = makeEnv({ store, team: true }); await e.call('POST', '/v1/tickets', fixture('ticket-help.json'));
    expect((await e.plain('PATCH', '/v1/team/tickets/T-0009?product=example-product', { erase: true })).status).toBe(404);
    expect((await e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', { erase: true, status: 'done' })).status).toBe(400);
    expect((await e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', { erase: 'yes' })).status).toBe(400);
    const r = await e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', { erase: true }); expect(r.status).toBe(200); expect(await r.json()).toEqual({ ticket: 'T-0001', erased: true });
    expect(await e.store.getTicket('example-product', 'T-0001', Date.now())).toBeNull(); expect((await e.store.erasureLog()).length).toBe(1);
    expect((await e.store.listAudit()).some((a) => a.action === 'ticket_erased' && a.who === 'team')).toBe(true);
  });
  test(`[${store}] team status changes leave an audit row`, async () => {
    const e = makeEnv({ store, team: true }); await e.call('POST', '/v1/tickets', fixture('ticket-help.json'));
    await e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', { status: 'seen' }); await e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', { status: 'done' });
    expect((await e.store.listAudit()).map((a) => a.action)).toEqual(['ticket_created', 'mail_sent', 'team_seen', 'team_done']);
  });
}
