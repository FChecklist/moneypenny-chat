// Cloudflare D1 implementation of the store interface in store-memory.js. Binds values only; no string building of SQL from input.
import { IDEM_TTL_MS, decide } from './idem.js';
import { fmtNumber } from './store-memory.js';

const COLS = ['instance', 'number', 'option', 'type', 'topic', 'screen', 'screen_label', 'text', 'screenshot_id', 'role', 'client_class', 'client_w', 'status', 'team_note', 'created', 'updated', 'done_at', 'erase_at', 'token_hash'];
const NUM = '@@NUMBER@@'; // stands in for the ticket number until the batch has allocated it
const PATCHABLE = new Set(['status', 'team_note', 'updated', 'done_at', 'erase_at']);

export function d1Store(db) {
  const peekIdem = async (instance, kh, now) => {
    const r = await db.prepare('SELECT body_hash, response, expires FROM idempotency WHERE instance=? AND key_hash=? AND expires>?').bind(instance, kh, now).first();
    return r ? { bodyHash: r.body_hash, response: r.response } : null;
  };
  const verdict = (hit) => (hit.replay ? { status: 'replay', response: hit.replay } : { status: 'conflict' });
  return {
    peekIdem,
    async createTicket(instance, id, build, now) {
      const first = decide(await peekIdem(instance, id.keyHash, now), id.bodyHash);
      if (first) return verdict(first);
      // The number is allocated inside the same batch, after the idempotency insert. If a same-key request won the race,
      // the idempotency insert fails, the whole batch rolls back and the counter is not touched: no number is burned.
      const { row, response } = build(NUM);
      const r = { ...row, instance }, cols = COLS.filter((k) => k !== 'number'), next = "(SELECT 'T-' || printf('%04d', n) FROM counter WHERE instance=?)";
      let results;
      try {
        results = await db.batch([ // one transaction: idempotency row (primary key), counter, ticket and final response go in together or not at all
          db.prepare('DELETE FROM idempotency WHERE instance=? AND key_hash=? AND expires<=?').bind(instance, id.keyHash, now),
          db.prepare('INSERT INTO idempotency (instance, key_hash, body_hash, response, expires) VALUES (?,?,?,?,?)').bind(instance, id.keyHash, id.bodyHash, JSON.stringify(response), now + IDEM_TTL_MS),
          db.prepare('INSERT INTO counter (instance, n) VALUES (?, 1) ON CONFLICT(instance) DO UPDATE SET n = n + 1').bind(instance),
          db.prepare(`INSERT INTO ticket (instance, number, ${cols.join(',')}) VALUES (?, ${next}, ${cols.map(() => '?').join(',')})`).bind(instance, instance, ...cols.map((k) => r[k] ?? null)),
          db.prepare('UPDATE idempotency SET response = replace(response, ?, ' + next + ') WHERE instance=? AND key_hash=?').bind(NUM, instance, instance, id.keyHash),
          db.prepare('SELECT response FROM idempotency WHERE instance=? AND key_hash=?').bind(instance, id.keyHash),
        ]);
      } catch (e) {
        const again = decide(await peekIdem(instance, id.keyHash, now), id.bodyHash);
        if (again) return verdict(again);
        throw e;
      }
      return { status: 'created', response: JSON.parse(results[results.length - 1].results[0].response) };
    },
    async getTicket(instance, number, now) { return (await db.prepare('SELECT * FROM ticket WHERE instance=? AND number=? AND erase_at>?').bind(instance, number, now).first()) || null; },
    async listTickets({ instance, status, cursor, limit = 50, now }) {
      const w = ['erase_at>?'], a = [now];
      if (instance) { w.push('instance=?'); a.push(instance); }
      if (status) { w.push('status=?'); a.push(status); }
      if (cursor) { w.push('seq<?'); a.push(cursor); }
      const { results } = await db.prepare(`SELECT * FROM ticket WHERE ${w.join(' AND ')} ORDER BY seq DESC LIMIT ?`).bind(...a, limit + 1).all();
      const items = results.slice(0, limit);
      return { items, cursor: results.length > limit ? items[items.length - 1].seq : null };
    },
    async updateTicket(instance, number, patch, now) {
      const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k)); if (!keys.length) return this.getTicket(instance, number, now);
      const r = await db.prepare(`UPDATE ticket SET ${keys.map((k) => k + '=?').join(', ')} WHERE instance=? AND number=? AND erase_at>?`).bind(...keys.map((k) => patch[k]), instance, number, now).run();
      return r.meta.changes ? this.getTicket(instance, number, now) : null;
    },
  };
}
