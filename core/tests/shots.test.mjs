import { test, expect } from 'bun:test';
import { makeEnv, fixture, STORES, PNG, JPG, WEBP } from './helpers.js';
import { sniff, shotKey, UNATTACHED_MS } from '../src/shots.js';
import { memoryBlobs, r2Blobs } from '../src/blobs.js';
import { sweep } from '../src/retention.js';
import { MAX } from '../src/body.js';

test('S-026 blob port: put and get (memory) and the R2 adapter calls the bucket the same way', async () => {
  const b = memoryBlobs(); await b.put('a/b', PNG, 'image/png'); expect((await b.get('a/b')).ctype).toBe('image/png'); expect([...(await b.get('a/b')).bytes]).toEqual([...PNG]);
  await b.delete('a/b'); expect(await b.get('a/b')).toBeNull(); await b.delete('a/b'); // deleting twice is fine
  const calls = [], store = new Map(); const bucket = { put: async (k, v, o) => { calls.push(o); store.set(k, [v, o]); }, get: async (k) => store.has(k) ? { arrayBuffer: async () => store.get(k)[0].buffer, httpMetadata: store.get(k)[1].httpMetadata } : null, delete: async (k) => void store.delete(k) };
  const r = r2Blobs(bucket); await r.put('k', PNG, 'image/png'); expect(calls[0]).toEqual({ httpMetadata: { contentType: 'image/png' } }); expect((await r.get('k')).ctype).toBe('image/png'); await r.delete('k'); expect(await r.get('k')).toBeNull();
});
test('S-026 key is instance/random id; two uploads of one file get two different keys; no file name', async () => {
  expect(shotKey('inst-a', 'abc')).toBe('inst-a/abc');
  const e = makeEnv(); const a = await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png' })).json();
  const b = await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png' })).json();
  expect(a.screenshot_id).not.toBe(b.screenshot_id); expect(a.screenshot_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(e.blobs.keys().sort()).toEqual([shotKey('example-product', a.screenshot_id), shotKey('example-product', b.screenshot_id)].sort());
});
test('S-027 magic bytes are read from the file, not the header', () => { expect(sniff(PNG)).toBe('image/png'); expect(sniff(JPG)).toBe('image/jpeg'); expect(sniff(WEBP)).toBe('image/webp'); expect(sniff(Uint8Array.from([0x4d, 0x5a, 0x90, 0]))).toBeNull(); expect(sniff(new Uint8Array(0))).toBeNull(); });
for (const store of Object.keys(STORES)) {
  const up = (e, bytes, ctype, o = {}) => e.call('POST', '/v1/screenshots', undefined, { rawBody: bytes, signedBody: bytes, ctype, ...o });
  const E = (o = {}) => makeEnv({ store, ...o });
  test(`[${store}] S-027 png, jpeg and webp are accepted`, async () => {
    const e = E();
    for (const [b, t] of [[PNG, 'image/png'], [JPG, 'image/jpeg'], [WEBP, 'image/webp']]) { const r = await up(e, b, t); expect(r.status, t).toBe(201); const j = await r.json(); expect(j.bytes).toBe(b.length); expect(Date.parse(j.expires)).toBeGreaterThan(Date.now()); }
  });
  test(`[${store}] S-027 an exe renamed to png is refused (415 bad_type); wrong header for real bytes too; nothing is stored`, async () => {
    const e = E(), exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]);
    let r = await up(e, exe, 'image/png'); expect(r.status).toBe(415); expect((await r.json()).error).toBe('bad_type');
    expect((await up(e, PNG, 'image/jpeg')).status).toBe(415); expect((await up(e, PNG, 'application/pdf')).status).toBe(415); expect((await up(e, PNG, undefined)).status).toBe(415);
    expect((await up(e, new Uint8Array(0), 'image/png')).status).toBe(415);
    expect(e.blobs.keys()).toEqual([]);
  });
  test(`[${store}] S-028 exactly 2 MB is accepted; one byte more is refused 413 too_large`, async () => {
    const e = E(), at = new Uint8Array(MAX.screenshot); at.set(PNG); const over = new Uint8Array(MAX.screenshot + 1); over.set(PNG);
    expect((await up(e, at, 'image/png')).status).toBe(201);
    const r = await up(e, over, 'image/png'); expect(r.status).toBe(413); expect((await r.json()).error).toBe('too_large');
  });
  test(`[${store}] upload needs signature, role proof and a UUID key; same key and file replays; same key other file conflicts`, async () => {
    const e = E();
    expect((await up(e, PNG, 'image/png', { secret: 'x'.repeat(32) })).status).toBe(401);
    expect((await up(e, PNG, 'image/png', { assertion: null })).status).toBe(401);
    expect((await up(e, PNG, 'image/png', { key: 'nope' })).status).toBe(400);
    const key = crypto.randomUUID(), a = await up(e, PNG, 'image/png', { key }), b = await up(e, PNG, 'image/png', { key });
    expect(b.headers.get('idempotent-replay')).toBe('true'); expect((await b.json()).screenshot_id).toBe((await a.json()).screenshot_id); expect(e.blobs.keys().length).toBe(1);
    expect((await up(e, JPG, 'image/jpeg', { key })).status).toBe(409);
  });
  test(`[${store}] F4: 10 uploads per hour per address, the 11th is 429 with retry-after`, async () => {
    const e = E(); for (let i = 0; i < 10; i++) expect((await up(e, PNG, 'image/png', { sess: 'sess-' + i + '-xxxx' })).status).toBe(201);
    const r = await up(e, PNG, 'image/png', { sess: 'sess-zzzz-xxxx' }); expect(r.status).toBe(429); expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  const send = async (e, shot, o = {}) => e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: shot }, o);
  test(`[${store}] S-028 one screenshot per ticket: a second ticket cannot use an attached file; unknown id; other instance`, async () => {
    const e = E(); const { screenshot_id: id } = await (await up(e, PNG, 'image/png')).json();
    let r = await send(e, id, { sess: 'sess-aaaa-1' }); expect(r.status).toBe(201); const t = await r.json();
    expect((await e.store.getTicket('example-product', t.ticket, Date.now())).screenshot_id).toBe(id);
    r = await send(e, id, { sess: 'sess-aaaa-2' }); expect(r.status).toBe(400); expect((await r.json()).field).toBe('screenshot_id');
    expect((await send(e, 'A'.repeat(22), { sess: 'sess-aaaa-3' })).status).toBe(400);
    expect((await send(e, 'bad id', { sess: 'sess-aaaa-4' })).status).toBe(400);
  });
  test(`[${store}] S-028 a refused ticket gives the file back; a replay keeps it attached to the first ticket`, async () => {
    const e = E(); const { screenshot_id: id } = await (await up(e, PNG, 'image/png')).json();
    expect((await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), text: 'short', screenshot_id: id })).status).toBe(400);
    const key = crypto.randomUUID(); expect((await send(e, id, { key, sess: 'sess-bbbb-1' })).status).toBe(201);
    expect((await send(e, id, { key, sess: 'sess-bbbb-1' })).headers.get('idempotent-replay')).toBe('true');
    expect((await e.store.shotsOfTicket('example-product', 'T-0001')).length).toBe(1);
  });
  test(`[${store}] S-029 an unattached file is erased after 1 hour (fake clock); an attached one is kept for the ticket`, async () => {
    let t = 1_800_000_000_000; const e = E({ now: () => t });
    const a = (await (await up(e, PNG, 'image/png')).json()).screenshot_id, b = (await (await up(e, JPG, 'image/jpeg', { sess: 'sess-cccc-9' })).json()).screenshot_id;
    expect((await send(e, b, { sess: 'sess-cccc-1' })).status).toBe(201);
    t += UNATTACHED_MS - 1; expect((await sweep({ store: e.store, blobs: e.blobs, now: () => t })).shots).toBe(0);
    t += 1; const r = await sweep({ store: e.store, blobs: e.blobs, now: () => t }); expect(r.shots).toBe(1);
    expect(e.blobs.keys()).toEqual([shotKey('example-product', b)]); expect(await e.store.getShot('example-product', a, t)).toBeNull();
    expect((await send(e, a, { sess: 'sess-cccc-2' })).status).toBe(400); // too late to attach
  });
  test(`[${store}] S-029 attached file: erase time by class (games: with ticket; records: 30 days, 7 days after done)`, async () => {
    const T = 1_800_000_000_000, D = 864e5; let t = T;
    const g = E({ now: () => t }); const gid = (await (await up(g, PNG, 'image/png')).json()).screenshot_id; await send(g, gid);
    expect((await g.store.shotsOfTicket('example-product', 'T-0001'))[0].erase_at).toBe(T + 24 * 3600e3);
    const rec = { ...fixture('instance-example.json'), retention_class: 'records' };
    const r = E({ now: () => t, instance: rec, team: true }); const rid = (await (await up(r, PNG, 'image/png')).json()).screenshot_id; await send(r, rid);
    expect((await r.store.shotsOfTicket('example-product', 'T-0001'))[0].erase_at).toBe(T + 30 * D);
    t = T + 2 * D; await r.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', { status: 'done' });
    expect((await r.store.shotsOfTicket('example-product', 'T-0001'))[0].erase_at).toBe(T + 9 * D);
    await r.plain('PATCH', '/v1/team/tickets/T-0001?product=example-product', { status: 'seen' }); // re-opened: back to 30 days
    expect((await r.store.shotsOfTicket('example-product', 'T-0001'))[0].erase_at).toBe(T + 30 * D);
  });
  test(`[${store}] S-033 the bucket has no public URL: file URLs and every route that could name a key answer 404; team route needs login`, async () => {
    const e = E({ team: false }); const id = (await (await up(e, PNG, 'image/png')).json()).screenshot_id; const key = shotKey('example-product', id);
    for (const p of ['/' + key, '/shots/' + key, '/v1/screenshots/' + id, '/v1/shots/' + id, '/mpc-shots/' + key, '/file/' + id]) { const r = await e.plain('GET', p); expect(r.status, p).toBe(404); expect(await r.text()).not.toContain('PNG'); }
    expect((await e.plain('GET', '/v1/team/tickets/T-0001/screenshot?product=example-product')).status).toBe(401);
  });
  test(`[${store}] the team can read the file of one ticket, with safe headers; wrong product or ticket without a file is 404`, async () => {
    const e = E({ team: true }); const id = (await (await up(e, PNG, 'image/png')).json()).screenshot_id; await send(e, id); await send(e, null, { sess: 'sess-dddd-2' });
    const r = await e.plain('GET', '/v1/team/tickets/T-0001/screenshot?product=example-product'); expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png'); expect(r.headers.get('cache-control')).toBe('no-store'); expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([...PNG]);
    expect((await e.plain('GET', '/v1/team/tickets/T-0002/screenshot?product=example-product')).status).toBe(404);
    expect((await e.plain('GET', '/v1/team/tickets/T-0001/screenshot?product=nope')).status).toBe(404);
  });
}
