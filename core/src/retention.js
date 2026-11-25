// S-025: erase_at per retention class (D5). Games: 24 hours after receipt (owner rule). Records: proposed in D5, owner to confirm (decision I3):
// text 30 days after done, never later than 90 days after receipt. A ticket still open at 90 days is erased.
const H = 3600e3, D = 24 * H;
export const RULES = { games: { afterReceipt: 24 * H }, records: { maxAfterReceipt: 90 * D, textAfterDone: 30 * D, shotAfterDone: 7 * D, shotMaxAfterReceipt: 30 * D } };
export const eraseAtCreate = (cls, created) => created + (cls === 'games' ? RULES.games.afterReceipt : RULES.records.maxAfterReceipt);
export function eraseAtDone(cls, created, done) {
  if (cls === 'games') return created + RULES.games.afterReceipt; // never later than 24 hours
  return Math.min(done + RULES.records.textAfterDone, created + RULES.records.maxAfterReceipt);
}
// S-029 and D5: screenshot erase time. Unattached files go after 1 hour (shots.js). Games: with the ticket, 24 hours. Records: 7 days after done, never later than 30 days after receipt.
export const shotEraseAt = (cls, created, done) => (cls === 'games' ? created + RULES.games.afterReceipt : Math.min(done == null ? Infinity : done + RULES.records.shotAfterDone, created + RULES.records.shotMaxAfterReceipt));

// S-030: erase one ticket: the files first (a failure leaves everything in place for the next sweep), then the rows, notes and mail queue; the erasure log row stays.
export async function eraseTicketNow(ctx, instance, number, who) {
  const now = ctx.now();
  for (const s of await ctx.store.shotsOfTicket(instance, number)) await ctx.blobs.delete(s.key);
  const ok = await ctx.store.eraseTicket(instance, number, now);
  if (ok) await ctx.store.audit({ at: now, instance, ticket: number, action: 'ticket_erased', who });
  return ok;
}
// The sweep: runs hourly (cron in wrangler.toml). Erases due files and tickets, expired AI links and old idempotency rows.
// 0.4.2: the database-only jobs (links, idempotency rows) run FIRST and every job is isolated, so a file store that is down (R2) cannot keep a link, its notes or its
// session hash past their time, and one file that cannot be deleted does not stop the others. The first fault is thrown at the end, so the cron run is marked failed.
export async function sweep(ctx, now = ctx.now()) {
  const out = { shots: 0, tickets: 0 }; let fault = null;
  const run = async (job) => { try { await job(); } catch (e) { fault ||= e; } };
  await run(() => ctx.store.eraseExpiredLinks(now)); // every AI link, with a ticket or without, goes with its notes and calls when the link expires (a link lives 24 hours at most)
  await run(() => ctx.store.expireIdem(now));
  let shots = []; await run(async () => { shots = await ctx.store.dueShots(now); });
  for (const s of shots) await run(async () => { await ctx.blobs.delete(s.key); await ctx.store.dropShots([s.id]); await ctx.store.audit({ at: now, instance: s.instance, ticket: s.ticket && s.ticket !== 'claim' ? s.ticket : null, action: 'screenshot_erased', who: 'system' }); out.shots++; });
  let tickets = []; await run(async () => { tickets = await ctx.store.dueTickets(now); });
  for (const t of tickets) await run(async () => { if (await eraseTicketNow({ ...ctx, now: () => now }, t.instance, t.number, 'system')) out.tickets++; });
  if (fault) throw fault;
  return out;
}
