import { test, expect } from 'bun:test';
import { makeEnv, fixture, STORES } from './helpers.js';
import { TICKET_LIMITS } from '../src/tickets.js';
import { signAssertion } from '../src/assertion.js';
import { ASSERT } from './helpers.js';

for (const store of Object.keys(STORES)) {
  const E = (o = {}) => makeEnv({ store, ...o });
  const post = (e, b, o) => e.call('POST', '/v1/tickets', b, o);
  const err = async (r) => (await r.json());

  test(`[${store}] S-021 one ticket per option; numbers count up; response has token and erase_at`, async () => {
    const e = E(); const out = [];
    for (const f of ['ticket-help.json', 'ticket-suggest.json', 'ticket-stuck.json']) { const r = await post(e, fixture(f), { sess: 's-' + f.replace(/\W/g, '') + '-xx' }); expect(r.status).toBe(201); out.push(await r.json()); }
    expect(out.map((o) => o.ticket)).toEqual(['T-0001', 'T-0002', 'T-0003']);
    expect(out[0].status_token.length).toBeGreaterThanOrEqual(40); expect(Date.parse(out[0].erase_at)).toBeGreaterThan(Date.now());
  });
  test(`[${store}] S-021 screen is cleaned, label comes from the route table, text is scrubbed, ids never stored`, async () => {
    const e = E(); const b = fixture('ticket-stuck.json'); b.text = 'Mail me at user@example.com or 9876543210'; b.screen_label = 'Whatever the browser says';
    const t = await (await post(e, b)).json();
    const row = await e.store.getTicket('example-product', t.ticket, Date.now());
    expect(row.screen).toBe('/console/game/:x/run'); expect(row.screen_label).toBe('Run a game'); expect(row.text).toBe('Mail me at [removed] or [removed]');
    expect(row.role).toBe('co-organizer'); expect(row.client_class).toBe('mobile'); expect(row.client_w).toBe(375); expect(row.token_hash).not.toBe(t.status_token);
    const unknown = fixture('ticket-help.json'); unknown.screen = '/somewhere/else'; const t2 = await (await post(e, unknown)).json();
    expect((await e.store.getTicket('example-product', t2.ticket, Date.now())).screen_label).toBe('This screen');
  });
  const base = (o) => ({ ...fixture('ticket-suggest.json'), ...o });
  const badInputs = [
    ['option', { option: 'nope' }], ['option missing', { option: undefined }], ['type missing on suggest', { type: null }], ['type invalid', { type: 'bug' }], ['type on non-suggest', { option: 'stuck', type: 'feature', topic: 'x' }],
    ['text too short', { text: 'too short' }], ['text too long', { text: 'a'.repeat(601) }], ['text not a string', { text: 5 }], ['topic bad chars', { topic: 'Bad Topic!' }], ['topic on help missing', { option: 'help_more', type: null, topic: null }],
    ['stuck with no topic and no text', { option: 'stuck', type: null, topic: null, text: '' }], ['screen too long', { screen: '/' + 'a'.repeat(250) }], ['screen not a string', { screen: 5 }], ['screen_label too long', { screen_label: 'a'.repeat(61) }],
    ['screenshot_id given', { screenshot_id: 'abc' }], ['role bad', { role: 'player' }], ['client bad ua', { client: { w: 1, h: 1, ua_class: 'tv' } }], ['client bad width', { client: { w: 0, h: 1, ua_class: 'mobile' } }], ['client not object', { client: 'x' }],
  ];
  for (const [name, patch] of badInputs) test(`[${store}] S-021 bad input: ${name} gives 400 bad_request`, async () => {
    const e = E(); const b = { ...base({}), ...patch }; for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
    const r = await post(e, b); expect(r.status).toBe(400); const j = await err(r); expect(j.error).toBe('bad_request'); expect(typeof j.field).toBe('string');
  });
  test(`[${store}] S-021 text of exactly 10 and 600 characters passes; stuck with topic and no text passes`, async () => {
    const e = E();
    expect((await post(e, base({ text: 'a'.repeat(10) }), { sess: 'sess-aaaa' })).status).toBe(201);
    expect((await post(e, base({ text: 'é'.repeat(600) }), { sess: 'sess-bbbb' })).status).toBe(201);
    expect((await post(e, { ...fixture('ticket-stuck.json'), text: '' }, { sess: 'sess-cccc' })).status).toBe(201);
  });
  test(`[${store}] S-021 not a JSON object, missing or bad idempotency key, wrong role proof`, async () => {
    const e = E();
    expect((await e.call('POST', '/v1/tickets', undefined, { rawBody: '{oops' })).status).toBe(400);
    expect((await e.call('POST', '/v1/tickets', undefined, { rawBody: '[1]' })).status).toBe(400);
    const r = await post(e, base({}), { key: 'not-a-uuid' }); expect((await err(r)).field).toBe('idempotency-key');
    expect((await post(e, base({}), { assertion: null })).status).toBe(401);
    let x = await post(e, base({}), { assertion: 'junk.junk' }); expect((await err(x)).error).toBe('no_assertion');
    x = await post(e, base({}), { role: 'player' }); expect(x.status).toBe(403); expect((await err(x)).error).toBe('role');
    x = await post(e, base({}), { product: 'other-product' }); expect((await err(x)).error).toBe('no_assertion');
    x = await post(e, base({ role: 'co-organizer' }), { role: 'organizer' }); expect(x.status).toBe(403); // body role must equal the proven role
  });
  test(`[${store}] S-021 a co-organizer proof needs no role in the body`, async () => {
    const e = E(); const b = base({}); delete b.role; const r = await post(e, b, { role: 'host' }); expect(r.status).toBe(201);
    expect((await e.store.getTicket('example-product', 'T-0001', Date.now())).role).toBe('co-organizer');
  });

  test(`[${store}] S-022 same key and same body: same answer, header, one ticket`, async () => {
    const e = E(), b = base({}), key = crypto.randomUUID();
    const a = await post(e, b, { key }); const c = await post(e, b, { key });
    expect(a.headers.get('idempotent-replay')).toBeNull(); expect(c.headers.get('idempotent-replay')).toBe('true');
    expect(await c.json()).toEqual(await a.json());
    expect((await e.store.listTickets({ now: Date.now() })).items.length).toBe(1);
  });
  test(`[${store}] S-022 same key and different body gives 409; the first ticket stays`, async () => {
    const e = E(), key = crypto.randomUUID(); await post(e, base({}), { key });
    const r = await post(e, base({ text: 'A different idea entirely.' }), { key }); expect(r.status).toBe(409); expect((await err(r)).error).toBe('idempotency_conflict');
    expect((await e.store.listTickets({ now: Date.now() })).items.length).toBe(1);
  });
  test(`[${store}] S-022 parallel taps with one key make exactly one ticket`, async () => {
    const e = E(), key = crypto.randomUUID(), b = base({});
    const rs = await Promise.all(Array.from({ length: 4 }, () => post(e, b, { key })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(await Promise.all(rs.map(async (r) => (await r.json()).ticket))).size).toBe(1);
    expect(rs.filter((r) => !r.headers.get('idempotent-replay')).length).toBe(1);
    expect((await e.store.listTickets({ now: Date.now() })).items.length).toBe(1);
  });
  test(`[${store}] S-022 the key is kept 24 hours, then it is a new ticket; keys are per instance`, async () => {
    let t = Date.now(); const e = E({ now: () => t }), key = crypto.randomUUID();
    const a = await (await post(e, base({}), { key, sess: 'sess-one-1' })).json();
    t += 24 * 3600e3 + 1000; // key expired; the ticket (games: 24 h) is erased too
    const b = await post(e, base({}), { key, sess: 'sess-one-1' }); expect(b.status).toBe(201); expect((await b.json()).ticket).not.toBe(a.ticket);
  });
  test(`[${store}] round 4: key lives 23 h, one hour less than the shortest erase window; replay at 22h59 never meets an erased ticket`, async () => {
    let t = Date.now(); const e = E({ now: () => t }), key = crypto.randomUUID();
    const a = await (await post(e, base({}), { key, sess: 'sess-one-1' })).json();
    t += 23 * 3600e3 - 1000; const b = await post(e, base({}), { key, sess: 'sess-one-1' }); expect(b.headers.get('idempotent-replay')).toBeTruthy(); expect((await b.json()).ticket).toBe(a.ticket);
    expect(await e.store.getTicket('example-product', a.ticket, t)).not.toBeNull();
  });
  test(`[${store}] S-022 a replay does not use up a rate limit slot`, async () => {
    const e = E(), key = crypto.randomUUID(); for (let i = 0; i < 20; i++) expect((await post(e, base({}), { key })).status).toBe(201);
    for (let i = 0; i < TICKET_LIMITS.sessHour - 1; i++) expect((await post(e, base({ text: 'Another idea number ' + i }))).status).toBe(201);
  });

  test(`[${store}] S-023 session limit: exactly 5 of 12 parallel admitted, others 429 with retry-after`, async () => {
    const e = E(); const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => post(e, base({ text: 'Idea number ' + i + ' here' }), { ip: '9.9.9.' + i })));
    const ok = rs.filter((r) => r.status === 201), no = rs.filter((r) => r.status === 429);
    expect(ok.length).toBe(TICKET_LIMITS.sessHour); expect(no.length).toBe(12 - 5);
    expect(Number(no[0].headers.get('retry-after'))).toBeGreaterThan(0); const j = await err(no[0]); expect(j.error).toBe('rate'); expect(j.retry_after).toBe(Number(no[0].headers.get('retry-after')));
    expect((await e.store.listTickets({ now: Date.now() })).items.length).toBe(5);
  });
  test(`[${store}] S-023 address limit: exactly 10 of 16 parallel (different sessions, one address)`, async () => {
    const e = E(); const rs = await Promise.all(Array.from({ length: 16 }, (_, i) => post(e, base({ text: 'Idea number ' + i + ' here' }), { sess: 'session-' + String(i).padStart(4, '0'), ip: '8.8.8.8' })));
    expect(rs.filter((r) => r.status === 201).length).toBe(TICKET_LIMITS.ipHour);
  });
  test(`[${store}] S-023 instance limit comes from the record: exactly 3 of 8`, async () => {
    const e = E({ instance: { ...fixture('instance-example.json'), tickets_per_day: 3 } });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => post(e, base({ text: 'Idea number ' + i + ' here' }), { sess: 'session-' + String(i).padStart(4, '0'), ip: '7.7.7.' + i })));
    expect(rs.filter((r) => r.status === 201).length).toBe(3);
  });
  test(`[${store}] S-023 the window moves on: after an hour the session can send again; a refusal gives its slots back`, async () => {
    let t = Date.now(); const e = E({ now: () => t });
    for (let i = 0; i < 5; i++) await post(e, base({ text: 'Idea number ' + i + ' here' }));
    expect((await post(e, base({ text: 'Idea number 6 here' }))).status).toBe(429);
    t += 3600e3; expect((await post(e, base({ text: 'Idea number 7 here' }))).status).toBe(201);
  });
  test(`[${store}] S-023 daily session limit is 15`, async () => {
    let t = Math.floor(Date.now() / 864e5) * 864e5; const e = E({ now: () => t }); let ok = 0;
    for (let h = 0; h < 4; h++) { for (let i = 0; i < 5; i++) if ((await post(e, base({ text: `Idea ${h} ${i} text here` }), { ip: `6.6.${h}.${i}` })).status === 201) ok++; t += 3600e3; }
    expect(ok).toBe(TICKET_LIMITS.sessDay);
  });

  test(`[${store}] S-024 right token reads status; wrong, missing or other-instance token gives 404`, async () => {
    const e = E(); const t = await (await post(e, base({}))).json();
    let r = await e.call('GET', '/v1/tickets/' + t.ticket, undefined, { token: t.status_token, assertion: null }); expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ticket: t.ticket, status: 'new', team_note: '', updated: expect.any(String) });
    for (const token of ['wrong-token-value', undefined, t.status_token.slice(1)]) { r = await e.call('GET', '/v1/tickets/' + t.ticket, undefined, { token, assertion: null }); expect(r.status).toBe(404); expect((await err(r)).error).toBe('not_found'); }
    expect((await e.call('GET', '/v1/tickets/T-9999', undefined, { token: t.status_token })).status).toBe(404);
    expect((await e.plain('GET', '/v1/tickets/' + t.ticket)).status).toBe(401);
  });
  test(`[${store}] S-024 an erased ticket cannot be read`, async () => {
    let now = Date.now(); const e = E({ now: () => now }); const t = await (await post(e, base({}))).json();
    now += 25 * 3600e3; expect((await e.call('GET', '/v1/tickets/' + t.ticket, undefined, { token: t.status_token })).status).toBe(404);
  });

  test(`[${store}] S-025 games erase_at is receipt + 24 h; records is receipt + 90 days`, async () => {
    const now = Date.now(); let e = E({ now: () => now }), t = await (await post(e, base({}))).json(); expect(Date.parse(t.erase_at)).toBe(now + 24 * 3600e3);
    e = E({ now: () => now, instance: { ...fixture('instance-example.json'), retention_class: 'records' } }); t = await (await post(e, base({}))).json(); expect(Date.parse(t.erase_at)).toBe(now + 90 * 864e5);
  });

  // team side: list, read, close
  test(`[${store}] team routes refuse everyone while no login check exists`, async () => {
    const e = E(); for (const [m, p] of [['GET', '/v1/team/tickets'], ['GET', '/v1/team/tickets/T-0001?product=example-product'], ['PATCH', '/v1/team/tickets/T-0001?product=example-product']]) { const r = await e.plain(m, p, {}); expect(r.status).toBe(401); expect((await err(r)).error).toBe('no_team_login'); }
  });
  test(`[${store}] team list newest first, filters, cursor; detail has text; close sets done and the status shows to the user`, async () => {
    const e = E({ team: true }); const toks = [];
    for (let i = 0; i < 3; i++) toks.push(await (await post(e, base({ text: 'Idea number ' + i + ' here' }), { sess: 'session-' + i.toString().padStart(4, '0') })).json());
    let r = await e.plain('GET', '/v1/team/tickets?product=example-product'); let j = await r.json();
    expect(j.items.map((x) => x.ticket)).toEqual(['T-0003', 'T-0002', 'T-0001']); expect(j.cursor).toBeNull(); expect(j.items[0].text).toBeUndefined();
    r = await e.plain('PATCH', '/v1/team/tickets/T-0002?product=example-product', { status: 'done', team_note: 'Fixed. Call 9876543210 to talk.' }); expect(r.status).toBe(200); expect((await r.json()).status).toBe('done');
    j = await (await e.plain('GET', '/v1/team/tickets?status=done&product=example-product')).json(); expect(j.items.map((x) => x.ticket)).toEqual(['T-0002']);
    j = await (await e.plain('GET', '/v1/team/tickets/T-0002?product=example-product')).json(); expect(j.text).toBe('Idea number 1 here'); expect(j.team_note).toBe('Fixed. Call [removed] to talk.');
    const s = await (await e.call('GET', '/v1/tickets/T-0002', undefined, { token: toks[1].status_token })).json(); expect(s.status).toBe('done'); expect(s.team_note).toContain('Fixed');
  });
  test(`[${store}] team close: records erase_at = done + 30 days (max 90 from receipt); bad input is 400; unknown ticket 404`, async () => {
    const now = Date.now(); const e = E({ team: true, now: () => now, instance: { ...fixture('instance-example.json'), retention_class: 'records' } }); await post(e, base({}));
    await e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', { status: 'done' });
    expect((await e.store.getTicket('example-product', 'T-0001', now)).erase_at).toBe(now + 30 * 864e5);
    for (const b of [{ status: 'new' }, {}, { status: 'seen', team_note: 'a'.repeat(501) }, { status: 'seen', team_note: 5 }]) expect((await e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', b)).status).toBe(400);
    expect((await e.plain('PATCH', '/v1/team/tickets/T-0099?product=example-product', { status: 'done' })).status).toBe(404);
    expect((await e.plain('PATCH', '/v1/team/tickets/T-0001', { status: 'done' })).status).toBe(400);
    expect((await e.plain('GET', '/v1/team/tickets?status=weird')).status).toBe(400); expect((await e.plain('GET', '/v1/team/tickets?cursor=abc')).status).toBe(400);
  });
  test(`[${store}] round 4: re-opening a ticket after done resets done_at and erase_at (both classes)`, async () => {
    for (const cls of ['games', 'records']) {
      let now = Date.now(); const e = E({ team: true, now: () => now, instance: { ...fixture('instance-example.json'), retention_class: cls } }), t0 = now; await post(e, base({}));
      const P = (b) => e.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', b), G = () => e.store.getTicket('example-product', 'T-0001', now);
      const first = (await G()).erase_at; now += 3600e3; await P({ status: 'done' }); expect((await G()).done_at).toBe(now);
      now += 3600e3; expect((await P({ status: 'seen' })).status).toBe(200);
      const r = await G(); expect(r.done_at).toBeNull(); expect(r.erase_at).toBe(first); expect(r.erase_at).toBe(t0 + (cls === 'games' ? 24 * 3600e3 : 90 * 864e5));
      await P({ status: 'done' }); expect((await G()).done_at).toBe(now); // closing again starts from the new close time
    }
  });
  test(`[${store}] team list pages with a cursor`, async () => {
    const e = E({ team: true }); for (let i = 0; i < 3; i++) await post(e, base({ text: 'Idea number ' + i + ' here' }), { sess: 'session-' + i.toString().padStart(4, '0') });
    const all = await e.store.listTickets({ now: Date.now(), limit: 2 }); expect(all.items.length).toBe(2); expect(all.cursor).not.toBeNull();
    const rest = await e.store.listTickets({ now: Date.now(), limit: 2, cursor: all.cursor }); expect(rest.items.map((x) => x.number)).toEqual(['T-0001']); expect(rest.cursor).toBeNull();
  });
  test(`[${store}] audit: screen label is scrubbed before storage`, async () => {
    const inst = fixture('instance-example.json'); inst.routes = { ...inst.routes, '/help': 'Mail ops@example.com' };
    const e = makeEnv({ store, instance: inst }); const t = await (await post(e, { ...fixture('ticket-help.json'), screen: '/help' })).json();
    expect((await e.store.getTicket(inst.id, t.ticket, Date.now())).screen_label).toBe('Mail [removed]');
  });
  test(`[${store}] audit: a missing x-mpc-ip does not put every visitor in one bucket`, async () => {
    const e = E(); const rs = [];
    for (let i = 0; i < 12; i++) rs.push((await post(e, base({ text: 'Idea number ' + i + ' here' }), { sess: 'session-' + String(i).padStart(4, '0'), ip: '' })).status);
    expect(rs.every((s) => s === 201)).toBe(true); // 12 sessions, no address: each has its own bucket (limit is 10 per bucket)
  });
  test(`[${store}] audit: same-key race burns no ticket number`, async () => {
    const e = E(); const b = base({}), key = crypto.randomUUID();
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(e, b, { key })));
    expect(new Set(await Promise.all(rs.map(async (r) => (await r.json()).ticket)))).toEqual(new Set(['T-0001']));
    const next = await (await post(e, base({ text: 'A different idea here' }))).json();
    expect(next.ticket).toBe('T-0002');
  });
}
test('numbers repeat per instance (T-0001 in both) and one instance cannot read the other', async () => {
  const { memoryStore } = await import('../src/store-memory.js'); const s = memoryStore(); const mk = (n) => (num) => ({ row: { number: num, erase_at: 9e15, token_hash: 'h' + n, status: 'new' }, response: { ticket: num } });
  await s.createTicket('a', { keyHash: '1', bodyHash: 'x' }, mk('a'), 1); await s.createTicket('b', { keyHash: '1', bodyHash: 'x' }, mk('b'), 1);
  expect((await s.getTicket('a', 'T-0001', 1)).token_hash).toBe('ha'); expect((await s.getTicket('b', 'T-0001', 1)).token_hash).toBe('hb'); expect(await s.getTicket('c', 'T-0001', 1)).toBeNull();
});
test('a ticket proof signed for one product cannot be used for another product call', async () => {
  const e = makeEnv(); const tok = await signAssertion(ASSERT, { product: 'someone-else', role: 'organizer', sess: 'session-0001', exp: Math.floor(Date.now() / 1000) + 60 });
  expect((await e.call('POST', '/v1/tickets', fixture('ticket-suggest.json'), { assertion: tok })).status).toBe(401);
});

test('audit: d1 store, a request that lost the same-key race burns no number (first peek is forced to miss)', async () => {
  const { fakeD1 } = await import('./helpers.js'); const { d1Store } = await import('../src/store-d1.js');
  const db = fakeD1(); let blind = 0;
  const wrapped = { ...db, prepare: (sql) => { const st = db.prepare(sql); if (!/FROM idempotency WHERE instance=\? AND key_hash=\? AND expires>\?/.test(sql)) return st; const first = st.first; st.first = async () => (blind-- > 0 ? null : first()); return st; } };
  const st = d1Store(wrapped), id = { keyHash: 'k1', bodyHash: 'b1' }, mk = (n) => ({ row: { number: n, option: 'help_more', screen: '/', screen_label: 'x', text: '', role: 'organizer', status: 'new', team_note: '', created: 1, updated: 1, erase_at: 9e12, token_hash: 'h' }, response: { ticket: n } });
  expect((await st.createTicket('p', id, mk, 1)).response).toEqual({ ticket: 'T-0001' });
  blind = 1; const lost = await st.createTicket('p', id, mk, 1);
  expect(lost.status).toBe('replay'); expect(lost.response).toEqual({ ticket: 'T-0001' });
  expect((await st.createTicket('p', { keyHash: 'k2', bodyHash: 'b2' }, mk, 1)).response).toEqual({ ticket: 'T-0002' });
});

// Round 2
test('round2: neither store holds the raw status token; a replay still returns it', async () => {
  for (const store of Object.keys(STORES)) {
    const e = makeEnv({ store }), key = crypto.randomUUID();
    const a = await (await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { key })).json();
    const r = await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { key });
    expect(r.headers.get('idempotent-replay')).toBe('true'); expect((await r.json()).status_token).toBe(a.status_token);
    expect(a.status_token.length).toBeGreaterThan(20);
    const { keyHash } = await import('../src/idem.js'), rec = await e.store.peekIdem(e.instance.id, await keyHash(e.instance.id, key), Date.now()), stored = rec.response;
    expect(stored).not.toContain(a.status_token); expect(stored).toContain('T-0001');
  }
});
test('round2: x-mpc-ip changed after signing fails with bad_signature; unsigned-absent header still works', async () => {
  const e = makeEnv();
  const bad = await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { ip: '9.9.9.9', signedIp: '1.2.3.4' });
  expect(bad.status).toBe(401); expect((await bad.json()).error).toBe('bad_signature');
  expect((await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { ip: '9.9.9.9' })).status).toBe(201);
});
test('round2: d1 createTicket placeholder order gives T-0001 then T-0002, and a replay returns the first', async () => {
  const { fakeD1 } = await import('./helpers.js'); const { d1Store } = await import('../src/store-d1.js');
  const st = d1Store(fakeD1()), mk = (n) => ({ row: { number: n, option: 'help_more', screen: '/', screen_label: 'x', text: '', role: 'organizer', status: 'new', team_note: '', created: 1, updated: 1, erase_at: 9e12, token_hash: 'h' }, response: { ticket: n } });
  expect((await st.createTicket('p', { keyHash: 'k1', bodyHash: 'b' }, mk, 1)).response).toEqual({ ticket: 'T-0001' });
  expect((await st.createTicket('p', { keyHash: 'k2', bodyHash: 'b' }, mk, 1)).response).toEqual({ ticket: 'T-0002' });
  const again = await st.createTicket('p', { keyHash: 'k1', bodyHash: 'b' }, mk, 1);
  expect(again.status).toBe('replay'); expect(again.response).toEqual({ ticket: 'T-0001' });
});

// Round 3
test('round3: topic with 8 or more digits in total is refused; 7 digits pass', async () => {
  const e = makeEnv(), mk = (topic) => ({ ...fixture('ticket-help.json'), topic });
  for (const t of ['a1b2c3d4e5f6g7h8', '1'.repeat(40), 'x-1234-5678']) { const r = await e.call('POST', '/v1/tickets', mk(t)); expect(r.status).toBe(400); const j = await r.json(); expect(j.error).toBe('bad_request'); expect(j.field).toBe('topic'); }
  expect((await e.call('POST', '/v1/tickets', mk('abc-1234567'))).status).toBe(201);
});
test('round3: a store that throws gives the counters back', async () => {
  const e = makeEnv(); const real = e.store.createTicket; let boom = true;
  e.store.createTicket = async (...a) => { if (boom) throw new Error('store down'); return real.apply(e.store, a); };
  for (let i = 0; i < 8; i++) { const r = await e.call('POST', '/v1/tickets', fixture('ticket-help.json')).catch(() => null); expect(r === null || r.status !== 429).toBe(true); }
  boom = false; // the session limit is 5 an hour: without give-back the next call would be 429
  expect((await e.call('POST', '/v1/tickets', fixture('ticket-help.json'))).status).toBe(201);
});
test('round3: require_ip refuses a missing x-mpc-ip; default and false accept it', async () => {
  const on = makeEnv({ instance: { ...fixture('instance-example.json'), require_ip: true } });
  const r = await on.call('POST', '/v1/tickets', fixture('ticket-help.json'), { ip: '' }); expect(r.status).toBe(400); expect((await r.json()).field).toBe('x-mpc-ip');
  expect((await on.call('POST', '/v1/tickets', fixture('ticket-help.json'))).status).toBe(201);
  expect((await makeEnv().call('POST', '/v1/tickets', fixture('ticket-help.json'), { ip: '' })).status).toBe(201);
});
test('round3: AES key is the raw 32 digest bytes (round trip, and not the old hex-slice key)', async () => {
  const { encryptText, decryptText, hmacHex } = await import('../src/crypto.js'); const S = 'k'.repeat(32), enc = new TextEncoder();
  expect(await decryptText([S], await encryptText(S, 'hello'))).toBe('hello');
  const old = await crypto.subtle.importKey('raw', enc.encode(await hmacHex(S, 'mpc-idem-v1')).slice(0, 32), 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, old, enc.encode('x')));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  expect(await decryptText([S], btoa(String.fromCharCode(...all)))).toBeNull();
});
test('round3: a replay sealed with the old secret opens while both secrets are configured', async () => {
  const { encryptText, decryptText } = await import('../src/crypto.js'); const OLD = 'o'.repeat(32), NEW = 'n'.repeat(32);
  const sealed = await encryptText(OLD, 'tok-123');
  expect(await decryptText([NEW, OLD], sealed)).toBe('tok-123');
  expect(await decryptText([NEW], sealed)).toBeNull();
});
