// Ticket storage interface (all methods async). Two implementations: this one (tests) and store-d1.js.
//   peekIdem(instance, keyHash, now) -> {bodyHash, response} | null
//   createTicket(instance, idem:{keyHash, bodyHash}, build(number) -> {row, response}, now)
//        -> {status:'created', response} | {status:'replay', response} | {status:'conflict'}   (atomic per key)
//   getTicket(instance, number, now) -> row | null   (null when erased: erase_at passed)
//   listTickets({instance?, status?, cursor?, limit, now}) -> {items:[row], cursor|null}   (newest first)
//   updateTicket(instance, number, patch, now) -> row | null
import { IDEM_TTL_MS, decide } from './idem.js';
export const fmtNumber = (n) => 'T-' + String(n).padStart(4, '0');

export function memoryStore() {
  const tickets = [], idem = new Map(), counter = new Map(); let seq = 0;
  const live = (r, now) => r.erase_at > now;
  const peekIdem = async (instance, kh, now) => { const r = idem.get(instance + '|' + kh); return r && r.expires > now ? r : null; };
  return {
    peekIdem,
    async createTicket(instance, id, build, now) {
      const hit = decide(await peekIdem(instance, id.keyHash, now), id.bodyHash);
      if (hit) return hit.replay ? { status: 'replay', response: hit.replay } : { status: 'conflict' };
      const n = (counter.get(instance) || 0) + 1; counter.set(instance, n); // no await between check and write: atomic
      const { row, response } = build(fmtNumber(n));
      tickets.push({ ...row, seq: ++seq, instance });
      idem.set(instance + '|' + id.keyHash, { bodyHash: id.bodyHash, response: JSON.stringify(response), expires: now + IDEM_TTL_MS });
      return { status: 'created', response };
    },
    async getTicket(instance, number, now) { const r = tickets.find((t) => t.instance === instance && t.number === number); return r && live(r, now) ? { ...r } : null; },
    async listTickets({ instance, status, cursor, limit = 50, now }) {
      const all = tickets.filter((t) => live(t, now) && (!instance || t.instance === instance) && (!status || t.status === status) && (!cursor || t.seq < cursor)).sort((a, b) => b.seq - a.seq);
      const items = all.slice(0, limit).map((t) => ({ ...t }));
      return { items, cursor: all.length > limit ? items[items.length - 1].seq : null };
    },
    async updateTicket(instance, number, patch, now) {
      const r = tickets.find((t) => t.instance === instance && t.number === number); if (!r || !live(r, now)) return null;
      Object.assign(r, patch); return { ...r };
    },
  };
}
