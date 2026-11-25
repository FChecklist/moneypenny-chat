import { test, expect } from 'bun:test';
import { makeEnv, fixture, STORES, PNG } from './helpers.js';
import { sweep } from '../src/retention.js';
import { sha256hex } from '../src/crypto.js';

const other = () => { const i = fixture('instance-example.json'); return { ...i, id: 'other-product', allowed_origins: ['https://other.example.test'] }; };
const ANOTHER = 'other-product', MINE = 'example-product';

for (const store of Object.keys(STORES)) {
  test(`[${store}] round 6 team routes: a ticket or picture of one instance cannot be read, changed, erased or fetched through the other`, async () => {
    const e = makeEnv({ store, team: true, others: [other()] });
    const up = await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png' })).json();
    const t1 = await (await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: up.screenshot_id })).json();
    const n = t1.ticket, p = (prod, m, path = '', b) => e.plain(m, `/v1/team/tickets/${n}${path}?product=${prod}`, b);
    expect((await p(MINE, 'GET')).status).toBe(200); expect((await p(MINE, 'GET', '/screenshot')).status).toBe(200);
    // the other instance holds no such ticket: every route answers not found or refuses, and nothing changes
    expect((await p(ANOTHER, 'GET')).status).toBe(404); expect((await p(ANOTHER, 'GET', '/screenshot')).status).toBe(404);
    expect((await p(ANOTHER, 'PATCH', '', { status: 'done' })).status).toBe(404); expect((await p(ANOTHER, 'PATCH', '', { erase: true })).status).toBe(404);
    // a product named in the body is ignored: the query decides, and an unknown product is refused
    expect((await p(ANOTHER, 'PATCH', '', { erase: true, product: MINE })).status).toBe(400); expect((await p(ANOTHER, 'PATCH', '', { status: 'done', product: MINE })).status).toBe(404);
    expect((await p('nope', 'GET', '/screenshot')).status).toBe(404); expect((await p('', 'PATCH', '', { erase: true })).status).toBe(400);
    const row = await e.store.getTicket(MINE, n, 0); expect(row.status).toBe('new');
    expect((await e.plain('GET', '/v1/team/tickets?product=' + ANOTHER).then((r) => r.json())).items).toEqual([]);
    expect((await p(MINE, 'PATCH', '', { erase: true })).status).toBe(200); expect(await e.store.getTicket(MINE, n, 0)).toBeNull();
  });
  test(`[${store}] round 6 ticketless AI link: link, notes and calls go at link expiry, in the sweep; a ticket link is left to its ticket`, async () => {
    let t = 1_800_000_000_000; const e = makeEnv({ store, now: () => t });
    const mk = async (k, extra = {}) => (await (await e.call('POST', '/v1/ai-links', { screen: '/', scopes: ['read_event', 'report'], key_hash: (await sha256hex(k)), product_key_id: 'pk1', ttl_s: 3600, ...extra })).json());
    const a = await mk('a'.repeat(40)); const tk = await (await e.call('POST', '/v1/tickets', fixture('ticket-help.json'))).json();
    const b = await (await e.call('POST', '/v1/ai-links', { ticket: tk.ticket, screen: '/', scopes: ['read_ticket'], key_hash: await sha256hex('b'.repeat(40)), product_key_id: 'pk1', ttl_s: 3600 }, { token: tk.status_token })).json();
    for (const l of [a, b]) { await e.store.addNote(l.id, 'plan', 'x', t); await e.store.addCall({ link_id: l.id, at: t, method: 'GET', path_class: 'ai/context', code: 200 }); }
    t += 3600e3 - 1; await sweep({ ...e.ctx(), now: () => t }); expect((await e.store.listNotes(a.id)).length).toBe(1); expect(await e.store.getLink(a.id)).not.toBeNull();
    t += 1; await sweep({ ...e.ctx(), now: () => t });
    expect(await e.store.getLink(a.id)).toBeNull(); expect(await e.store.listNotes(a.id)).toEqual([]); expect(await e.store.listCalls(a.id)).toEqual([]);
    expect(await e.store.getLink(b.id)).not.toBeNull(); expect((await e.store.listNotes(b.id)).length).toBe(1);
  });
}
test('round 6 AI note word list: synonyms for delete, pay, refund, cancel, remove, wipe, change e-mail or password, transfer are refused (whole words, any case); plain text passes', async () => {
  const bad = ['Refund the order', 'CANCEL the game', 'Please Remove the player', 'wipe all data', 'purge the list', 'destroy the record', 'transfer the credits to a new owner', 'Transferred it', 'Then change the e-mail on the account', 'change email now', 'update their password', 'reset the password', 'Charge the card', 'buy more', 'Payout is due', 'Razorpay link', 'cancelled', 'refunds'];
  for (const text of bad) { const e2 = makeEnv(), K2 = 'm'.repeat(40); await e2.call('POST', '/v1/ai-links', { screen: '/', scopes: ['report'], key_hash: await sha256hex(K2), product_key_id: 'pk1' }); const r = await e2.ai('POST', '/v1/ai/notes', { k: K2, body: { type: 'plan', text } }); expect([text, r.status]).toEqual([text, 403]) }
  for (const text of ['Open the settings page', 'The overpayment label is blue', 'Transferable seats list', 'Check the email box layout']) { const e2 = makeEnv(), K2 = 'n'.repeat(40); await e2.call('POST', '/v1/ai-links', { screen: '/', scopes: ['report'], key_hash: await sha256hex(K2), product_key_id: 'pk1' }); expect([text, (await e2.ai('POST', '/v1/ai/notes', { k: K2, body: { type: 'plan', text } })).status]).toEqual([text, 201]); }
});
