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

    // C4 screenshots, erase, audit
    async putIdem(instance, kh, bodyHash, response, now) { await db.prepare('INSERT OR IGNORE INTO idempotency (instance, key_hash, body_hash, response, expires) VALUES (?,?,?,?,?)').bind(instance, kh, bodyHash, JSON.stringify(response), now + IDEM_TTL_MS).run(); },
    async putShot(r) { await db.prepare('INSERT INTO shot (id, instance, key, bytes, ctype, ticket, created, erase_at) VALUES (?,?,?,?,?,?,?,?)').bind(r.id, r.instance, r.key, r.bytes, r.ctype, r.ticket, r.created, r.erase_at).run(); },
    async getShot(instance, id, now) { return (await db.prepare('SELECT * FROM shot WHERE instance=? AND id=? AND erase_at>?').bind(instance, id, now).first()) || null; },
    async claimShot(instance, id, now) { return (await db.prepare("UPDATE shot SET ticket='claim' WHERE instance=? AND id=? AND ticket IS NULL AND erase_at>?").bind(instance, id, now).run()).meta.changes > 0; },
    async attachShot(instance, id, number, eraseAt) { await db.prepare('UPDATE shot SET ticket=?, erase_at=? WHERE instance=? AND id=?').bind(number, eraseAt, instance, id).run(); },
    async releaseShot(instance, id) { await db.prepare("UPDATE shot SET ticket=NULL WHERE instance=? AND id=? AND ticket='claim'").bind(instance, id).run(); },
    async setShotErase(instance, number, eraseAt) { await db.prepare('UPDATE shot SET erase_at=? WHERE instance=? AND ticket=?').bind(eraseAt, instance, number).run(); },
    async shotsOfTicket(instance, number) { return (await db.prepare('SELECT * FROM shot WHERE instance=? AND ticket=?').bind(instance, number).all()).results; },
    async dueShots(now) { return (await db.prepare('SELECT * FROM shot WHERE erase_at<=?').bind(now).all()).results; },
    async dropShots(ids) { for (const id of ids) await db.prepare('DELETE FROM shot WHERE id=?').bind(id).run(); },
    // Every link whose time is up goes, with its notes and call log: a link made for a ticket as well as one made without (privacy rule: 24 hours at most).
    // One transaction: notes and calls first (they are found through the link row), then the link rows.
    async eraseExpiredLinks(now) {
      const due = '(SELECT id FROM ai_link WHERE expires<=?)';
      const r = await db.batch([db.prepare(`DELETE FROM ai_note WHERE link_id IN ${due}`).bind(now), db.prepare(`DELETE FROM ai_call_log WHERE link_id IN ${due}`).bind(now), db.prepare('DELETE FROM ai_link WHERE expires<=?').bind(now)]);
      return r[r.length - 1]?.meta?.changes ?? 0; // links erased (D1 reports it; the test double does not)
    },
    async dueTickets(now) { return (await db.prepare('SELECT instance, number FROM ticket WHERE erase_at<=?').bind(now).all()).results; },
    async eraseTicket(instance, number, now) {
      if (!(await db.prepare('SELECT 1 AS x FROM ticket WHERE instance=? AND number=?').bind(instance, number).first())) return false;
      const own = '(SELECT id FROM ai_link WHERE instance=? AND ticket=?)';
      const r = await db.batch([ // one transaction: the log row is written from the ticket row before it is deleted
        db.prepare(`DELETE FROM ai_note WHERE link_id IN ${own}`).bind(instance, number),
        db.prepare(`DELETE FROM ai_call_log WHERE link_id IN ${own}`).bind(instance, number),
        db.prepare('DELETE FROM shot WHERE instance=? AND ticket=?').bind(instance, number),
        db.prepare('DELETE FROM mail_queue WHERE instance=? AND number=?').bind(instance, number),
        db.prepare('INSERT INTO erasure_log (ticket, instance, erased_at) SELECT number, instance, ? FROM ticket WHERE instance=? AND number=?').bind(now, instance, number),
        db.prepare('DELETE FROM ticket WHERE instance=? AND number=?').bind(instance, number),
      ]);
      return r.length > 0;
    },
    async expireIdem(now) { await db.prepare('DELETE FROM idempotency WHERE expires<=?').bind(now).run(); },
    async erasureLog() { return (await db.prepare('SELECT ticket, instance, erased_at FROM erasure_log').all()).results; },
    async audit(r) { await db.prepare('INSERT INTO audit (at, instance, ticket, action, who) VALUES (?,?,?,?,?)').bind(r.at, r.instance, r.ticket ?? null, r.action, r.who).run(); },
    async listAudit() { return (await db.prepare('SELECT at, instance, ticket, action, who FROM audit ORDER BY seq').all()).results; },
    // C5 mail queue
    async queueMail(instance, number, nextAt) { await db.prepare('INSERT OR IGNORE INTO mail_queue (instance, number, attempts, next_at) VALUES (?,?,0,?)').bind(instance, number, nextAt).run(); },
    async dueMail(now, max) { return (await db.prepare('SELECT * FROM mail_queue WHERE next_at<=? AND attempts<?').bind(now, max).all()).results; },
    async bumpMail(instance, number, attempts, nextAt) { await db.prepare('UPDATE mail_queue SET attempts=?, next_at=? WHERE instance=? AND number=?').bind(attempts, nextAt, instance, number).run(); },
    async dropMail(instance, number) { await db.prepare('DELETE FROM mail_queue WHERE instance=? AND number=?').bind(instance, number).run(); },
    // C6 AI links
    async createLink(r) { await db.prepare('INSERT INTO ai_link (id, instance, ticket, screen, scopes, key_hash, product_key_id, sess_hash, created, expires) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(r.id, r.instance, r.ticket, r.screen, r.scopes, r.key_hash, r.product_key_id, r.sess_hash, r.created, r.expires).run(); },
    async getLink(id) { return (await db.prepare('SELECT * FROM ai_link WHERE id=?').bind(id).first()) || null; },
    async getLinkByHash(h) { return (await db.prepare('SELECT * FROM ai_link WHERE key_hash=?').bind(h).first()) || null; },
    async updateLink(id, patch) { const keys = Object.keys(patch); for (const k of keys) if (!['revoked', 'approved', 'closed'].includes(k)) throw new Error('field'); if (keys.length) await db.prepare(`UPDATE ai_link SET ${keys.map((k) => k + '=?').join(', ')} WHERE id=?`).bind(...keys.map((k) => patch[k]), id).run(); },
    async addNote(linkId, type, text, at) {
      await db.prepare('INSERT INTO ai_note (link_id, n, type, text, at) SELECT ?, COALESCE(MAX(n),0)+1, ?, ?, ? FROM ai_note WHERE link_id=?').bind(linkId, type, text, at, linkId).run();
      return (await db.prepare('SELECT MAX(n) AS n FROM ai_note WHERE link_id=?').bind(linkId).first()).n;
    },
    async listNotes(linkId) { return (await db.prepare('SELECT * FROM ai_note WHERE link_id=? ORDER BY n').bind(linkId).all()).results; },
    async addCall(r) { await db.prepare('INSERT INTO ai_call_log (link_id, at, method, path_class, code) VALUES (?,?,?,?,?)').bind(r.link_id, r.at, r.method, r.path_class, r.code).run(); },
    async listCalls(linkId) { return (await db.prepare('SELECT * FROM ai_call_log WHERE link_id=? ORDER BY at').bind(linkId).all()).results; },
  };
}
