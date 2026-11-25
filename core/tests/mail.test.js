import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { makeEnv, fixture, STORES, TEAM_ADDR, PNG } from './helpers.js';
import { buildMail, fakeMailer, serviceMailer, notifyTicket, retryMail, MAIL_RETRIES, MAIL_QUEUE_MAX } from '../src/mail.js';
import { checkStrings } from '../../contract/strings-rules.mjs';
const inst = fixture('instance-example.json');
const row = { number: 'T-0457', option: 'stuck', topic: 'game-will-not-start', screen_label: 'Create a game', created: 1_800_000_000_000, text: 'SECRET TYPED TEXT', screenshot_id: 'SHOTID', role: 'organizer' };

test('S-034 the fake records mails and fails on demand; the port is just send()', async () => {
  const m = fakeMailer({ failFirst: 1 }); await expect(m.send({ to: 'a' })).rejects.toThrow(); await m.send({ to: 'b' }); expect(m.sent).toEqual([{ to: 'b' }]); expect(m.calls).toBe(2);
});
test('S-035 the body has number, product, option, topic, screen, time and link only; no typed text, no screenshot, no role; text passes the string rules', () => {
  const m = buildMail({ inst, row, teamUrl: 'https://core.test', to: TEAM_ADDR });
  expect(m.subject).toBe('New ticket T-0457'); expect(m.to).toBe(TEAM_ADDR);
  expect(m.text).toBe(['New ticket T-0457', 'Product: ' + inst.name, 'Option: Stuck: tell where', 'Topic: game-will-not-start', 'Screen: Create a game', 'Time: 2027-01-15T08:00:00.000Z', 'List: https://core.test/team', ''].join('\n'));
  expect(m.text).not.toContain('SECRET'); expect(m.text).not.toContain('SHOTID'); expect(m.text).not.toMatch(/organizer/i); expect(checkStrings(m)).toEqual([]);
  expect(buildMail({ inst, row: { ...row, topic: null }, teamUrl: 'x', to: 'y' }).text).toContain('Topic: not set');
});
test('S-036 the real sender posts JSON to the mail service binding; a bad answer is a failure; no address and no service id sit in the repo', async () => {
  const seen = []; const ok = serviceMailer({ fetch: async (u, i) => { seen.push([u, i]); return new Response('', { status: 202 }); } });
  await ok.send({ to: TEAM_ADDR, subject: 's', text: 't' }); expect(seen[0][0]).toBe('https://mail.internal/send'); expect(JSON.parse(seen[0][1].body)).toEqual({ to: TEAM_ADDR, subject: 's', text: 't' });
  await expect(serviceMailer({ fetch: async () => new Response('', { status: 500 }) }).send({})).rejects.toThrow();
  const t = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'); expect(t).toMatch(/wrangler secret put TEAM_EMAIL/); expect(t).not.toMatch(/TEAM_EMAIL\s*=/); expect(t).toMatch(/^# \[\[services\]\]/m); expect(t).not.toMatch(/^\[\[services\]\]/m);
});
for (const store of Object.keys(STORES)) {
  test(`[${store}] a new ticket sends one mail to the team address; a replay sends none; the mail carries no ticket text`, async () => {
    const e = makeEnv({ store }); const key = crypto.randomUUID();
    const b = { ...fixture('ticket-stuck.json'), text: 'Please see my private note about the game' };
    expect((await e.call('POST', '/v1/tickets', b, { key })).status).toBe(201); expect((await e.call('POST', '/v1/tickets', b, { key })).headers.get('idempotent-replay')).toBe('true');
    expect(e.mail.sent.length).toBe(1); expect(e.mail.sent[0].to).toBe(TEAM_ADDR); expect(e.mail.sent[0].text).toContain('T-0001'); expect(e.mail.sent[0].text).not.toContain('private note');
    expect((await e.store.listAudit()).map((a) => a.action)).toContain('mail_sent');
  });
  test(`[${store}] S-037 failure keeps the ticket and retries 3 times, then queues it; the sweep sends it when the service is back`, async () => {
    let t = 1_800_000_000_000; const mail = fakeMailer({ failFirst: 1 + MAIL_RETRIES }); const e = makeEnv({ store, mail, now: () => t });
    const r = await e.call('POST', '/v1/tickets', fixture('ticket-help.json')); expect(r.status).toBe(201);
    expect(mail.calls).toBe(1 + MAIL_RETRIES); expect(MAIL_RETRIES).toBe(3); expect(mail.sent.length).toBe(0);
    expect(await e.store.getTicket('example-product', 'T-0001', t)).not.toBeNull(); expect((await e.store.listAudit()).map((a) => a.action)).toContain('mail_queued');
    expect((await retryMail({ ...e.ctx(), now: () => t })).sent).toBe(0); // not due yet
    t += 3600e3; expect((await retryMail({ ...e.ctx(), now: () => t })).sent).toBe(1); expect(mail.sent.length).toBe(1);
    expect(await e.store.dueMail(t + 99e6, 99)).toEqual([]); expect((await retryMail({ ...e.ctx(), now: () => t + 9e9 })).sent).toBe(0);
  });
  test(`[${store}] S-037 a mail that keeps failing is tried at most ${MAIL_QUEUE_MAX} more times, then given up with an audit row`, async () => {
    let t = 1_800_000_000_000; const mail = fakeMailer({ failFirst: 999 }); const e = makeEnv({ store, mail, now: () => t });
    await e.call('POST', '/v1/tickets', fixture('ticket-help.json'));
    for (let i = 0; i < 8; i++) { t += 3600e3; await retryMail({ ...e.ctx(), now: () => t }); }
    expect(mail.calls).toBe(1 + MAIL_RETRIES + MAIL_QUEUE_MAX); expect((await e.store.listAudit()).map((a) => a.action)).toContain('mail_gave_up');
  });
  test(`[${store}] no mail setup (no address, no sender, no link base) means no mail and no error; a throwing mailer never fails the ticket`, async () => {
    for (const o of [{ teamEmail: '' }, { teamUrl: '' }, { mail: null }]) { const e = makeEnv({ store, ...o }); if (o.mail === null) e.ctx().mail = undefined; expect((await e.call('POST', '/v1/tickets', fixture('ticket-help.json'))).status).toBe(201); }
    const e = makeEnv({ store, mail: { send: async () => { throw new Error('x'); } } }); expect((await e.call('POST', '/v1/tickets', fixture('ticket-help.json'))).status).toBe(201);
    expect((await notifyTicket({ ...e.ctx(), store: { queueMail: async () => { throw new Error('db'); }, audit: async () => { throw new Error('db'); } } }, inst, { ...row })).sent).toBe(false); // even a broken queue does not throw
  });
}
