// 0.4.2 fix 4: a screenshot is claimed by instance AND session. Before 0.4.2 `claimShot` looked only at the instance and the file id, so any
// signed-in person of the same product who knew a file id could attach someone else's picture to their own ticket. File ids are random
// (128 bits), so this is defence in depth: the id is a hint, the session that uploaded the file is the owner.
import { test, expect } from 'bun:test';
import { makeEnv, fixture, STORES, PNG } from './helpers.js';
import * as S from '../src/shots.js';

const A = { sess: 'sess-shot-aaaa' }, B = { sess: 'sess-shot-bbbb' };
const other = () => ({ ...fixture('instance-example.json'), id: 'other-product', allowed_origins: ['https://other.example.test'] });

for (const store of Object.keys(STORES)) {
  const E = (o = {}) => makeEnv({ store, ...o });
  const up = async (e, who) => (await (await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png', ...who })).json()).screenshot_id;
  const send = (e, shot, who, o = {}) => e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: shot }, { ...who, ...o });

  test(`[${store}] one session cannot claim the picture another session uploaded; the owner still can`, async () => {
    const e = E(), id = await up(e, A);
    let r = await send(e, id, B); expect(r.status).toBe(400); expect((await r.json()).field).toBe('screenshot_id'); // B names A's file: refused like an unknown id
    expect(await e.store.getTicket('example-product', 'T-0001', Date.now())).toBeNull(); // no ticket was made
    expect((await e.store.getShot('example-product', id, Date.now())).ticket).toBeNull(); // the file is still unattached and nobody's ticket holds it
    for (let i = 0; i < 5; i++) expect((await send(e, id, B, { sess: 'sess-shot-bbbb' })).status).toBe(400); // the refused tries gave their counters back: B is not locked out of the ticket limit
    expect((await send(e, null, B)).status).toBe(201); // B can still send a ticket with no picture
    r = await send(e, id, A); expect(r.status).toBe(201); // A, who uploaded it, can attach it
    expect((await e.store.shotsOfTicket('example-product', (await r.json()).ticket)).length).toBe(1);
  });
  test(`[${store}] the same session id in another product cannot claim the file either (instance and session both count)`, async () => {
    const e = E({ others: [other()] }), id = await up(e, A);
    const r = await e.call('POST', '/v1/tickets', { ...fixture('ticket-suggest.json'), screenshot_id: id }, { ...A, instance: 'other-product', product: 'other-product' });
    expect(r.status).toBe(400); expect((await r.json()).field).toBe('screenshot_id');
    expect((await send(e, id, A)).status).toBe(201);
  });
  test(`[${store}] store level: claimShot needs the session hash of the uploader; a wrong, empty or missing hash never claims; a file without an owner (old row) can never be claimed`, async () => {
    const e = E(), inst = e.instances.get('example-product'), id = await up(e, A), now = Date.now();
    const hA = await S.shotSess(inst, A.sess), hB = await S.shotSess(inst, B.sess);
    expect(hA).toMatch(/^[0-9a-f]{64}$/); expect(hA).not.toBe(hB); expect(hA).not.toContain(A.sess);
    expect(await e.store.claimShot('example-product', id, hB, now)).toBe(false);
    for (const bad of ['', null, undefined, 5]) expect(await e.store.claimShot('example-product', id, bad, now), String(bad)).toBe(false);
    expect(await e.store.claimShot('other-product', id, hA, now)).toBe(false); // other instance
    expect(await e.store.claimShot('example-product', id, hA, now + 3600e3)).toBe(false); // expired (unattached files live 1 hour)
    expect(await e.store.claimShot('example-product', id, hA, now)).toBe(true); expect(await e.store.claimShot('example-product', id, hA, now)).toBe(false); // once
    await e.store.releaseShot('example-product', id); expect(await e.store.claimShot('example-product', id, hA, now)).toBe(true); // a refused ticket gives it back
    await e.store.putShot({ id: 'legacy-row-without-owner-1', instance: 'example-product', key: 'example-product/legacy', bytes: 1, ctype: 'image/png', ticket: null, created: now, erase_at: now + 3600e3 });
    expect(await e.store.claimShot('example-product', 'legacy-row-without-owner-1', hA, now)).toBe(false); // fails closed
  });
  test(`[${store}] the stored owner is a hash, never the session id; the row is erased with the picture`, async () => {
    const e = E(), id = await up(e, A), row = await e.store.getShot('example-product', id, Date.now());
    expect(JSON.stringify(row)).not.toContain(A.sess); expect(row.sess_hash).toMatch(/^[0-9a-f]{64}$/);
    const t = await (await send(e, id, A)).json(); expect(t.ticket).toBe('T-0001');
    await e.store.eraseTicket('example-product', 'T-0001', Date.now()); expect(await e.store.getShot('example-product', id, 0)).toBeNull();
  });
  test(`[${store}] an upload needs a session: a call that has no role proof is refused before anything is stored`, async () => {
    const e = E(), r = await e.call('POST', '/v1/screenshots', undefined, { rawBody: PNG, signedBody: PNG, ctype: 'image/png', assertion: null });
    expect(r.status).toBe(401); expect(e.blobs.keys()).toEqual([]);
    const inst = e.instances.get('example-product');
    expect(await S.uploadShot(e.ctx(), inst, { bytes: PNG, contentType: 'image/png', idemHeader: crypto.randomUUID(), ip: '1.2.3.4' })).toEqual({ error: 'no_assertion' }); // the code path itself fails closed too
    expect(e.blobs.keys()).toEqual([]);
  });
}
