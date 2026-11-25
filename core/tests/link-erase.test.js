// 0.4.2 fix 1: privacy rule "personal details are erased within 24 hours". An AI link, its notes and its call log go when the LINK expires,
// whether the link was made with a ticket or without one. Before 0.4.2 only the no-ticket kind was swept: a link made for a ticket kept its
// row (session hash), notes and call log until the ticket itself was erased (up to 90 days on a records product). Time-travel tests: the clock is moved,
// then the same sweep the hourly cron runs is called. Both stores run (the D1 one is the real SQL on the real schema in bun:sqlite).
import { test, expect, setSystemTime, afterEach } from 'bun:test';
import { makeEnv, fixture, STORES, fakeD1, fakeNamespace, SECRET, ASSERT, PNG } from './helpers.js';
import { sweep } from '../src/retention.js';
import { sha256hex } from '../src/crypto.js';
import core from '../src/index.js';

const H = 3600e3, T0 = 1_800_000_000_000, PRODUCT = 'example-product';
const KEY = (c) => 'mpk_' + c.repeat(40);

for (const store of Object.keys(STORES)) {
  const rig = (inst = {}) => { const c = { t: T0 }; const e = makeEnv({ store, now: () => c.t, instance: { ...fixture('instance-example.json'), ...inst } }); e.clock = c; return e; };
  // A link with no ticket: it can only read the screen (read-only scopes).
  async function ticketless(e, c, ttl_s) {
    const k = KEY(c), r = await e.call('POST', '/v1/ai-links', { screen: '/', scopes: ['read_ticket', 'report'], key_hash: await sha256hex(k), product_key_id: 'pk1', ttl_s }, { sess: 'sess-erase-' + c });
    expect(r.status).toBe(201); return { k, id: (await r.json()).id, ticket: null };
  }
  // A link for a ticket: the person's own status token proves the ticket is theirs.
  async function ticketed(e, c, ttl_s) {
    const tk = await (await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { sess: 'sess-erase-' + c })).json(), k = KEY(c);
    const r = await e.call('POST', '/v1/ai-links', { ticket: tk.ticket, screen: '/', scopes: ['read_ticket', 'report'], key_hash: await sha256hex(k), product_key_id: 'pk1', ttl_s }, { token: tk.status_token, sess: 'sess-erase-' + c });
    expect(r.status).toBe(201); return { k, id: (await r.json()).id, ticket: tk.ticket };
  }
  // The AI side through the real routes: one note and one context call, so a notes row and two call-log rows exist.
  async function chat(e, l) {
    expect((await e.ai('POST', '/v1/ai/notes', { k: l.k, body: { type: 'plan', text: 'Read the screen.' } })).status).toBe(201);
    expect((await e.ai('GET', '/v1/ai/context', { k: l.k })).status).toBe(200);
  }
  const rows = async (e, l) => ({ link: await e.store.getLink(l.id), notes: (await e.store.listNotes(l.id)).length, calls: (await e.store.listCalls(l.id)).length });
  const gone = async (e, l) => expect(await rows(e, l)).toEqual({ link: null, notes: 0, calls: 0 });
  const here = async (e, l) => { const r = await rows(e, l); expect(r.link).not.toBeNull(); expect([r.notes, r.calls]).toEqual([1, 2]); }; // one note, and two logged AI calls (the note post and the context read)

  test(`[${store}] link expiry erases a link with no ticket AND a link made for a ticket, with their notes and call log; a live link is not touched; the ticket is not the link`, async () => {
    const e = rig({ retention_class: 'records' }); // records: the ticket lives 90 days, so only the link may go at expiry
    const a = await ticketless(e, 'a', 3600), b = await ticketed(e, 'b', 3600), c = await ticketed(e, 'c', 7200);
    for (const l of [a, b, c]) await chat(e, l);
    e.clock.t = T0 + H - 1; await sweep(e.ctx()); // one millisecond before expiry: nothing is due
    for (const l of [a, b, c]) await here(e, l);
    e.clock.t = T0 + H; await sweep(e.ctx()); // the links of 1 hour are due
    await gone(e, a); await gone(e, b); await here(e, c);
    expect(await e.store.getTicket(PRODUCT, b.ticket, e.clock.t)).not.toBeNull(); // the ticket follows its own retention rule, not the link's
    e.clock.t = T0 + 2 * H; await sweep(e.ctx()); await gone(e, c);
    await sweep(e.ctx()); await gone(e, a); // a second sweep changes nothing and does not fail
    expect(await e.store.getTicket(PRODUCT, c.ticket, e.clock.t)).not.toBeNull();
  });
  test(`[${store}] the longest link (24 hours) is gone at the first sweep after 24 hours, ticket or not: games and records products`, async () => {
    for (const retention_class of ['games', 'records']) {
      const e = rig({ retention_class }), a = await ticketless(e, 'a', 86400), b = await ticketed(e, 'b', 86400);
      for (const l of [a, b]) await chat(e, l);
      e.clock.t = T0 + 24 * H - 1; await sweep(e.ctx()); await here(e, a); await here(e, b);
      e.clock.t = T0 + 24 * H; await sweep(e.ctx()); // games: the ticket is due too (24 hours after receipt)
      await gone(e, a); await gone(e, b);
      expect(JSON.stringify(await e.store.listAudit())).not.toContain(KEY('a')); // no key anywhere
    }
  });
  test(`[${store}] a stopped (revoked) and a finished (done note) ticket link are erased at expiry as well; an AI that comes back after the erase is told the link is not valid`, async () => {
    const e = rig({ retention_class: 'records' }), a = await ticketed(e, 'a', 3600), b = await ticketed(e, 'b', 3600);
    await chat(e, a); await chat(e, b);
    expect((await e.call('DELETE', '/v1/ai-links/' + a.id, undefined, { sess: 'sess-erase-a' })).status).toBe(204); // organizer stops link a
    e.clock.t += 1000; expect((await e.ai('POST', '/v1/ai/notes', { k: b.k, body: { type: 'done', text: 'All good.' } })).status).toBe(201); // link b is finished
    e.clock.t = T0 + H; await sweep(e.ctx()); await gone(e, a); await gone(e, b);
    const r = await e.ai('GET', '/v1/ai/context', { k: b.k }); expect(r.status).toBe(401); expect((await r.json()).error).toBe('bad_link');
  });
  test(`[${store}] a link whose ticket was erased first (Erase now) is still erased at its own expiry`, async () => {
    const e = rig({ retention_class: 'records', }), a = await ticketed(e, 'a', 3600); await chat(e, a);
    await e.store.eraseTicket(PRODUCT, a.ticket, T0 + 10); // notes and calls of the ticket go with it; the link row waits for its expiry
    expect((await e.store.getLink(a.id))).not.toBeNull();
    e.clock.t = T0 + H; await sweep(e.ctx()); await gone(e, a);
  });
  // Review finding (0.4.2): the sweep ran the file jobs first, and one throw stopped everything after it, so a file store that is down kept the links, their notes and
  // the session hash past their time. The database-only jobs now run first and every job is isolated; the first fault is still thrown, so the cron run is marked failed.
  test(`[${store}] a file store that is down cannot keep an expired link, its notes or its calls; one file that cannot be deleted does not stop the others; the fault is still reported`, async () => {
    const e = rig({ retention_class: 'games' });
    const up = async (sess) => (await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png', sess })).json()).screenshot_id;
    const t1 = await (await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: await up('sess-sweep-1') }, { sess: 'sess-sweep-1' })).json();
    const t2 = await (await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: await up('sess-sweep-2') }, { sess: 'sess-sweep-2' })).json();
    const a = await ticketless(e, 'a', 3600), b = await ticketed(e, 'b', 3600); for (const l of [a, b]) await chat(e, l);
    const key1 = (await e.store.shotsOfTicket(PRODUCT, t1.ticket))[0].key, real = e.blobs.delete;
    e.blobs.delete = async (k) => { if (k === key1) throw new Error('r2 down for this file'); return real(k); }; // the bucket refuses one file
    e.clock.t = T0 + 25 * H; // links are long gone by their time, both tickets are due too
    await expect(sweep(e.ctx())).rejects.toThrow('r2 down'); // the run reports the fault ...
    await gone(e, a); await gone(e, b);                       // ... and the links, notes and calls are erased all the same
    expect(await e.store.getTicket(PRODUCT, t2.ticket, 0)).toBeNull(); // the other ticket (and its file) was erased: one bad file did not stop it
    expect((await e.store.shotsOfTicket(PRODUCT, t1.ticket)).length).toBe(1); // the one that failed stays for the next hour
    e.blobs.delete = real; const r = await sweep(e.ctx()); expect(r.tickets).toBe(1); expect(e.blobs.keys()).toEqual([]); // the bucket is back: it goes
  });
}

// The entry the platform really calls: the Worker's `scheduled` handler (cron). It reads the real clock, so the clock is moved with setSystemTime.
afterEach(() => setSystemTime());
test('time travel through the Worker cron entry (D1 and the real schema): a ticketless and a ticketed link are erased in the first run after expiry', async () => {
  setSystemTime(new Date(T0));
  const db = fakeD1(), blobs = new Map(), SHOTS = { put: async (k, v) => void blobs.set(k, v), get: async (k) => blobs.get(k) ?? null, delete: async (k) => void blobs.delete(k) };
  const inst = { ...fixture('instance-example.json'), retention_class: 'records' };
  const env = { DB: db, LIMITS: fakeNamespace(), SHOTS, INSTANCES: JSON.stringify([inst]), SECRET_EXAMPLE_PRODUCT: SECRET, SECRET_EXAMPLE_PRODUCT_ASSERT: ASSERT };
  const e = makeEnv({ store: 'd1', d1: db, instance: inst }); // same database: the app made the rows, the cron entry sweeps them
  const mk = async (c, ticket) => { // one link, as the instance Worker would make it
    const tk = ticket ? await (await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { sess: 'sess-cron-' + c })).json() : null, k = KEY(c);
    const r = await e.call('POST', '/v1/ai-links', { ...(tk ? { ticket: tk.ticket } : {}), screen: '/', scopes: ['read_ticket', 'report'], key_hash: await sha256hex(k), product_key_id: 'pk1', ttl_s: 3600 }, { ...(tk ? { token: tk.status_token } : {}), sess: 'sess-cron-' + c });
    expect(r.status).toBe(201); const l = { k, id: (await r.json()).id, ticket: tk && tk.ticket };
    expect((await e.ai('POST', '/v1/ai/notes', { k, body: { type: 'plan', text: 'Read the screen.' } })).status).toBe(201); expect((await e.ai('GET', '/v1/ai/context', { k })).status).toBe(200); return l;
  };
  const a = await mk('a', false), b = await mk('b', true), count = (t) => db.raw.query(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  expect([count('ai_link'), count('ai_note'), count('ai_call_log'), count('ticket')]).toEqual([2, 2, 4, 1]);
  setSystemTime(new Date(T0 + H - 1)); await core.scheduled({}, env); expect([count('ai_link'), count('ai_note'), count('ai_call_log')]).toEqual([2, 2, 4]); // not due yet
  setSystemTime(new Date(T0 + H + 60_000)); await core.scheduled({}, env); // the cron runs a minute after the links expired
  expect([count('ai_link'), count('ai_note'), count('ai_call_log'), count('ticket')]).toEqual([0, 0, 0, 1]); // links, notes and calls: gone. the records ticket: kept.
  expect(db.raw.query('SELECT COUNT(*) AS n FROM ai_link WHERE id IN (?,?)').get(a.id, b.id).n).toBe(0);
});

// 0.4.4: the same cron entry with NO picture bucket (SHOTS not bound): links, notes and call logs are still erased; a ticket that holds a picture is held.
test('Worker cron entry with no SHOTS binding: links, notes and call logs are erased; a ticket that holds a picture is held, one without is erased', async () => {
  setSystemTime(new Date(T0));
  const db = fakeD1(), inst = fixture('instance-example.json');
  const env = { DB: db, LIMITS: fakeNamespace(), INSTANCES: JSON.stringify([inst]), SECRET_EXAMPLE_PRODUCT: SECRET, SECRET_EXAMPLE_PRODUCT_ASSERT: ASSERT }; // no SHOTS
  const e = makeEnv({ store: 'd1', d1: db, instance: inst, now: () => Date.now() }), count = (t) => db.raw.query(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const k = KEY('n'), lr = await e.call('POST', '/v1/ai-links', { screen: '/', scopes: ['read_ticket', 'report'], key_hash: await sha256hex(k), product_key_id: 'pk1', ttl_s: 3600 }, { sess: 'sess-nos-l' });
  expect(lr.status).toBe(201); expect((await e.ai('POST', '/v1/ai/notes', { k, body: { type: 'plan', text: 'Read the screen.' } })).status).toBe(201); expect((await e.ai('GET', '/v1/ai/context', { k })).status).toBe(200);
  const plain = await (await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { sess: 'sess-nos-1' })).json();
  const shot = (await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png', sess: 'sess-nos-2' })).json()).screenshot_id;
  const pic = await (await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: shot }, { sess: 'sess-nos-2' })).json();
  expect([count('ai_link'), count('ai_note'), count('ai_call_log'), count('ticket')]).toEqual([1, 1, 2, 2]);
  setSystemTime(new Date(T0 + 25 * H));
  await core.scheduled({}, env);
  expect([count('ai_link'), count('ai_note'), count('ai_call_log')]).toEqual([0, 0, 0]);
  expect(await e.store.getTicket(PRODUCT, plain.ticket, 0)).toBeNull();
  expect(await e.store.getTicket(PRODUCT, pic.ticket, 0)).not.toBeNull(); expect(count('shot')).toBe(1);
});
