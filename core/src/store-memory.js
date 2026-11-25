// Storage interface (all methods async). Two implementations: this one (tests) and store-d1.js. Ticket part (C3):
//   peekIdem(instance, keyHash, now) -> {bodyHash, response} | null;  putIdem(instance, keyHash, bodyHash, response, now)
//   createTicket(instance, idem:{keyHash, bodyHash}, build(number) -> {row, response}, now) -> {status:'created'|'replay', response} | {status:'conflict'}
//   getTicket(instance, number, now) -> row | null (null once erase_at has passed);  listTickets({instance?, status?, cursor?, limit, now});  updateTicket(instance, number, patch, now)
// C4 screenshots: putShot (row has sess_hash, the uploader), getShot, claimShot(instance, id, sessHash, now), attachShot, releaseShot, setShotErase, shotsOfTicket, dueShots, dropShots
// C4 erase and audit: dueTickets, eraseTicket, expireIdem, erasureLog, audit, listAudit
// C5 mail queue: queueMail, dueMail, bumpMail, dropMail
// C6 AI links: createLink, getLink, getLinkByHash, updateLink, addNote, listNotes, addCall, listCalls
import { IDEM_TTL_MS, decide } from './idem.js';
export const fmtNumber = (n) => 'T-' + String(n).padStart(4, '0');

export function memoryStore() {
  const tickets = [], idem = new Map(), counter = new Map(); let seq = 0;
  let shots = [], audits = [], erasure = [], mailq = [], links = [], notes = [], calls = [];
  const live = (r, now) => r.erase_at > now;
  const peekIdem = async (instance, kh, now) => { const r = idem.get(instance + '|' + kh); return r && r.expires > now ? r : null; };
  const shot = (instance, id) => shots.find((s) => s.instance === instance && s.id === id);
  return {
    peekIdem,
    async putIdem(instance, kh, bodyHash, response, now) { if (!(await peekIdem(instance, kh, now))) idem.set(instance + '|' + kh, { bodyHash, response: JSON.stringify(response), expires: now + IDEM_TTL_MS }); },
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
    // C4
    async putShot(row) { shots.push({ ...row }); },
    async getShot(instance, id, now) { const s = shot(instance, id); return s && s.erase_at > now ? { ...s } : null; },
    // Keyed by instance AND session: sessHash must equal the hash stored when the file was uploaded (a file with no owner can never be claimed).
    async claimShot(instance, id, sessHash, now) { const s = shot(instance, id); if (!s || typeof sessHash !== 'string' || !sessHash || s.sess_hash !== sessHash || s.ticket !== null || s.erase_at <= now) return false; s.ticket = 'claim'; return true; },
    async attachShot(instance, id, number, eraseAt) { const s = shot(instance, id); if (s) { s.ticket = number; s.erase_at = eraseAt; s.sess_hash = null; } }, // the owner hash was only needed to claim: it is dropped once the file is on a ticket
    async releaseShot(instance, id) { const s = shot(instance, id); if (s && s.ticket === 'claim') s.ticket = null; },
    async setShotErase(instance, number, eraseAt) { for (const s of shots) if (s.instance === instance && s.ticket === number) s.erase_at = eraseAt; },
    async shotsOfTicket(instance, number) { return shots.filter((s) => s.instance === instance && s.ticket === number).map((s) => ({ ...s })); },
    async dueShots(now) { return shots.filter((s) => s.erase_at <= now).map((s) => ({ ...s })); },
    async dropShots(ids) { shots = shots.filter((s) => !ids.includes(s.id)); },
    async dueTickets(now) { return tickets.filter((t) => t.erase_at <= now).map((t) => ({ instance: t.instance, number: t.number })); },
    async eraseTicket(instance, number, now) {
      const i = tickets.findIndex((t) => t.instance === instance && t.number === number); if (i < 0) return false;
      const ids = links.filter((l) => l.instance === instance && l.ticket === number).map((l) => l.id);
      tickets.splice(i, 1); shots = shots.filter((s) => !(s.instance === instance && s.ticket === number));
      notes = notes.filter((n) => !ids.includes(n.link_id)); calls = calls.filter((c) => !ids.includes(c.link_id));
      mailq = mailq.filter((m) => !(m.instance === instance && m.number === number));
      erasure.push({ ticket: number, instance, erased_at: now }); return true;
    },
    // Every link whose time is up goes, with its notes and call log: a link made for a ticket as well as one made without (privacy rule: 24 hours at most).
    async eraseExpiredLinks(now) {
      const ids = links.filter((l) => l.expires <= now).map((l) => l.id);
      links = links.filter((l) => !ids.includes(l.id)); notes = notes.filter((n) => !ids.includes(n.link_id)); calls = calls.filter((c) => !ids.includes(c.link_id)); return ids.length;
    },
    async expireIdem(now) { for (const [k, v] of idem) if (v.expires <= now) idem.delete(k); },
    async erasureLog() { return erasure.map((e) => ({ ...e })); },
    async audit(row) { audits.push({ ...row }); },
    async listAudit() { return audits.map((a) => ({ ...a })); },
    // C5
    async queueMail(instance, number, nextAt) { if (!mailq.some((m) => m.instance === instance && m.number === number)) mailq.push({ instance, number, attempts: 0, next_at: nextAt }); },
    async dueMail(now, maxAttempts) { return mailq.filter((m) => m.next_at <= now && m.attempts < maxAttempts).map((m) => ({ ...m })); },
    async bumpMail(instance, number, attempts, nextAt) { const m = mailq.find((x) => x.instance === instance && x.number === number); if (m) { m.attempts = attempts; m.next_at = nextAt; } },
    async dropMail(instance, number) { mailq = mailq.filter((m) => !(m.instance === instance && m.number === number)); },
    // C6
    async createLink(row) { links.push({ ...row, revoked: 0, approved: 0, closed: 0 }); },
    async getLink(id) { const l = links.find((x) => x.id === id); return l ? { ...l } : null; },
    async getLinkByHash(h) { const l = links.find((x) => x.key_hash === h); return l ? { ...l } : null; },
    async updateLink(id, patch) { const l = links.find((x) => x.id === id); if (l) Object.assign(l, patch); },
    async addNote(linkId, type, text, at) { const n = notes.filter((x) => x.link_id === linkId).length + 1; notes.push({ link_id: linkId, n, type, text, at }); return n; },
    async listNotes(linkId) { return notes.filter((x) => x.link_id === linkId).map((x) => ({ ...x })); },
    async addCall(row) { calls.push({ ...row }); },
    async listCalls(linkId) { return calls.filter((c) => c.link_id === linkId).map((c) => ({ ...c })); },
  };
}
