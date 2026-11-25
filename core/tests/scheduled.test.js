// 0.4.3 (review of 0.4.2): the Worker cron entry `scheduled`.
// Finding 1: the guard `!env.DB || !env.LIMITS || !env.SHOTS` skipped the WHOLE sweep when only the picture bucket was not bound, so links, notes, call logs,
//            idempotency rows and tickets stayed past their time (a privacy rule), with no sign in the log. Now only DB and LIMITS are needed to start; without
//            SHOTS only the picture steps are skipped; a missing required binding is a warning, not a silent return.
// Finding 2: `await sweep(); await retryMail();` - a sweep fault is thrown after the sweep has finished its work, and that skipped the mail retry.
// The clock is moved with setSystemTime because the entry reads the real clock. D1 is the real SQL on the real schema (bun:sqlite).
import { test, expect, setSystemTime, afterEach, spyOn } from 'bun:test';
import { makeEnv, fixture, fakeD1, fakeNamespace, SECRET, ASSERT, PNG, TEAM_ADDR } from './helpers.js';
import { sha256hex } from '../src/crypto.js';
import core from '../src/index.js';

const H = 3600e3, T0 = 1_800_000_000_000, KEY = (c) => 'mpk_' + c.repeat(40);
afterEach(() => setSystemTime());

// A fake R2 bucket over the memory file store of the test app, so a file put by the app can be deleted by the Worker entry.
const bucketOf = (blobs) => ({ put: (k, v, o) => blobs.put(k, v, o && o.httpMetadata && o.httpMetadata.contentType), get: async () => null, delete: (k) => blobs.delete(k) });
function rig(extraEnv = {}) {
  const db = fakeD1(), inst = fixture('instance-example.json'), e = makeEnv({ store: 'd1', d1: db, instance: inst, now: () => Date.now() });
  const env = { DB: db, LIMITS: fakeNamespace(), INSTANCES: JSON.stringify([inst]), SECRET_EXAMPLE_PRODUCT: SECRET, SECRET_EXAMPLE_PRODUCT_ASSERT: ASSERT, ...extraEnv };
  const count = (t) => db.raw.query(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  return { e, env, db, count };
}
async function link(e, c, ttl_s = 3600) { // a link with no ticket, one note and one logged call (so a notes row and two call rows exist)
  const k = KEY(c), r = await e.call('POST', '/v1/ai-links', { screen: '/', scopes: ['read_ticket', 'report'], key_hash: await sha256hex(k), product_key_id: 'pk1', ttl_s }, { sess: 'sess-sched-' + c });
  expect(r.status).toBe(201);
  expect((await e.ai('POST', '/v1/ai/notes', { k, body: { type: 'plan', text: 'Read the screen.' } })).status).toBe(201); expect((await e.ai('GET', '/v1/ai/context', { k })).status).toBe(200);
}
const upload = async (e, sess) => (await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png', sess })).json()).screenshot_id;

test('finding 1: no SHOTS binding - expired links, notes, call logs, idempotency rows and tickets are still erased; a ticket with a picture waits; a warning says why', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    setSystemTime(new Date(T0));
    const { e, env, count } = rig();
    await link(e, 'a');
    const plain = await (await e.call('POST', '/v1/tickets', fixture('ticket-help.json'), { sess: 'sess-sched-t1' })).json();
    const shotId = await upload(e, 'sess-sched-t2'), pic = await (await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: shotId }, { sess: 'sess-sched-t2' })).json();
    expect([count('ai_link'), count('ai_note'), count('ai_call_log'), count('ticket'), count('shot')]).toEqual([1, 1, 2, 2, 1]);
    expect(count('idempotency')).toBeGreaterThan(0); expect(e.blobs.keys().length).toBe(1);
    setSystemTime(new Date(T0 + 25 * H)); // the link (1 hour), the idempotency rows (23 hours) and both games tickets (24 hours) are due
    await core.scheduled({}, env); // no SHOTS in env
    expect([count('ai_link'), count('ai_note'), count('ai_call_log'), count('idempotency')]).toEqual([0, 0, 0, 0]);
    expect(await e.store.getTicket('example-product', plain.ticket, 0)).toBeNull(); // the ticket with no picture is erased
    expect(await e.store.getTicket('example-product', pic.ticket, 0)).not.toBeNull(); // the one with a picture waits: its row is the only record of the file
    expect(count('shot')).toBe(1); expect(e.blobs.keys().length).toBe(1); // the picture steps were skipped, nothing was lost track of
    const said = warn.mock.calls.map((c) => c.join(' ')).join('\n'); expect(said).toContain('SHOTS'); expect(said).toContain('1 ticket');
    setSystemTime(new Date(T0 + 26 * H)); env.SHOTS = bucketOf(e.blobs); // the bucket is bound again: the next run finishes the job
    await core.scheduled({}, env);
    expect([count('ticket'), count('shot')]).toEqual([0, 0]); expect(e.blobs.keys()).toEqual([]);
  } finally { warn.mockRestore(); }
});

test('finding 1: a missing DB or LIMITS binding is a clear warning, not a silent return, and nothing throws', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { env } = rig();
    await core.scheduled({}, { ...env, DB: undefined }); await core.scheduled({}, { ...env, LIMITS: undefined }); await core.scheduled({}, {});
    const said = warn.mock.calls.map((c) => String(c[0]));
    expect(said.length).toBe(3); expect(said[0]).toMatch(/\bDB\b/); expect(said[1]).toMatch(/\bLIMITS\b/); expect(said[2]).toMatch(/DB and LIMITS/);
    for (const s of said) expect(s).toMatch(/skipped/);
  } finally { warn.mockRestore(); }
});

test('finding 1: with every binding set there is no warning', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    setSystemTime(new Date(T0)); const { e, env } = rig(); env.SHOTS = bucketOf(e.blobs); await core.scheduled({}, env); expect(warn).not.toHaveBeenCalled();
  } finally { warn.mockRestore(); }
});

test('finding 2: a sweep fault (the picture bucket is down) does not stop the mail retry; the fault is still thrown after both have run', async () => {
  setSystemTime(new Date(T0));
  const sent = [], MAIL = { fetch: async (_url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; } };
  const { env, count } = rig({ MAIL, TEAM_EMAIL: TEAM_ADDR, TEAM_URL: 'https://core.test' });
  // The app's own mail is down when the ticket is made, so the ticket goes on the mail queue; the unattached picture is due after 1 hour.
  const e2 = makeEnv({ store: 'd1', d1: env.DB, instance: fixture('instance-example.json'), now: () => Date.now(), mail: { send: async () => { throw new Error('mail down'); } } });
  await e2.call('POST', '/v1/tickets', fixture('ticket-help.json'), { sess: 'sess-sched-m1' }); await upload(e2, 'sess-sched-m2');
  expect(count('mail_queue')).toBe(1); expect(count('shot')).toBe(1);
  env.SHOTS = { put: async () => {}, get: async () => null, delete: async () => { throw new Error('r2 down'); } };
  setSystemTime(new Date(T0 + H + 60_000)); // the queued mail is due (1 hour) and so is the picture
  await expect(core.scheduled({}, env)).rejects.toThrow('r2 down'); // still reported, so the cron run is marked failed ...
  expect(sent.length).toBe(1); expect(sent[0].subject).toMatch(/^New ticket T-\d+/); // ... but the mail was tried
  expect(count('mail_queue')).toBe(0);
});
