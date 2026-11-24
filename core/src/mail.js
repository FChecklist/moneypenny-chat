// C5: team e-mail on a new ticket. The mail has only: number, product, option, topic, screen, time and a link to the team list. No typed text, no screenshot.
// Port: sender.send({to, subject, text}) -> Promise, throws when the mail could not be sent. The address comes from the TEAM_EMAIL platform secret.
import { OPTIONS } from './strings.js';
import { audit } from './audit.js';
export const MAIL_RETRIES = 3;                 // after the first try: 3 more tries, right away
export const MAIL_QUEUE_MAX = 5;               // then the hourly sweep tries again, up to 5 times
export const MAIL_QUEUE_WAIT_MS = 3600e3;
const LABEL = { help_more: OPTIONS.help, suggest: OPTIONS.suggest, stuck: OPTIONS.stuck };

export function buildMail({ inst, row, teamUrl, to }) {
  const lines = [`New ticket ${row.number}`, `Product: ${inst.name}`, `Option: ${LABEL[row.option]}`, `Topic: ${row.topic ?? 'not set'}`, `Screen: ${row.screen_label}`, `Time: ${new Date(row.created).toISOString()}`, `List: ${teamUrl}/team`];
  return { to, subject: `New ticket ${row.number}`, text: lines.join('\n') + '\n' };
}
// Test double: fails the first `failFirst` calls, records every mail.
export function fakeMailer({ failFirst = 0 } = {}) {
  const m = { sent: [], calls: 0, async send(mail) { m.calls++; if (m.calls <= failFirst) throw new Error('mail down'); m.sent.push(mail); } };
  return m;
}
// Real sender: the platform mail service reached through a service binding (`MAIL`). The service contract is NOT checked against the real service; see DECISIONS.
export const serviceMailer = (binding) => ({
  async send(mail) {
    const r = await binding.fetch('https://mail.internal/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mail) });
    if (!r.ok) throw new Error('mail service ' + r.status);
  },
});
const ready = (ctx) => ctx.mail && ctx.teamEmail && ctx.teamUrl;
async function trySend(ctx, inst, row, tries) {
  for (let i = 0; i < tries; i++) { try { await ctx.mail.send(buildMail({ inst, row, teamUrl: ctx.teamUrl, to: ctx.teamEmail })); return true; } catch {} }
  return false;
}
// Never throws: the ticket is already saved. On failure the ticket is queued for the sweep.
export async function notifyTicket(ctx, inst, row) {
  if (!ready(ctx)) return { sent: false, skipped: true };
  try {
    if (await trySend(ctx, inst, row, 1 + MAIL_RETRIES)) { await audit(ctx, inst.id, row.number, 'mail_sent', 'system'); return { sent: true }; }
    await ctx.store.queueMail(inst.id, row.number, ctx.now() + MAIL_QUEUE_WAIT_MS); await audit(ctx, inst.id, row.number, 'mail_queued', 'system');
  } catch {}
  return { sent: false };
}
// Called by the sweep: one more try for each queued ticket that is due.
export async function retryMail(ctx, now = ctx.now()) {
  if (!ready(ctx)) return { sent: 0 };
  let sent = 0;
  for (const q of await ctx.store.dueMail(now, MAIL_QUEUE_MAX)) {
    const inst = ctx.instances.get(q.instance), row = inst && await ctx.store.getTicket(q.instance, q.number, now);
    if (!row) { await ctx.store.dropMail(q.instance, q.number); continue; }
    if (await trySend(ctx, inst, row, 1)) { await ctx.store.dropMail(q.instance, q.number); await audit(ctx, q.instance, q.number, 'mail_sent', 'system'); sent++; continue; }
    await ctx.store.bumpMail(q.instance, q.number, q.attempts + 1, now + MAIL_QUEUE_WAIT_MS);
    if (q.attempts + 1 >= MAIL_QUEUE_MAX) await audit(ctx, q.instance, q.number, 'mail_gave_up', 'system');
  }
  return { sent };
}
