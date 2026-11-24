// Moneypenny Chat: atomic counters (Cloudflare Durable Object). One instance serialises every read-modify-write, so a cap can never be passed
// by parallel requests (KV cannot promise this). Keys expire; an alarm sweeps expired keys once a day. No personal data: keys carry only hashes.
export const NONCE_CAP = 5000; // live nonces per Durable Object instance; more are refused (rate) until old ones expire
export class Limits {
  constructor(state, opts = {}) { this.nonceCap = opts.nonceCap ?? NONCE_CAP; this.s = state.storage; this.q = Promise.resolve(); this.state = state; }
  async fetch(req) {
    const b = await req.json();
    const run = this.q.then(() => this.op(b)); this.q = run.catch(() => {}); // strict queue: operations never interleave, even across awaits
    return new Response(JSON.stringify(await run), { headers: { 'content-type': 'application/json' } });
  }
  async op({ op, key, delta = 0, cap = Infinity, ttl = 0, nonce = false }) {
    const now = Date.now(), r = await this.s.get(key), live = r && r.exp > now;
    let v = live ? r.v : 0; const exp = live ? r.exp : now + Math.max(1, ttl) * 1000;
    if (op === 'get') return { v };
    if (op === 'take') { if (nonce && !live && (await this.liveNonces()) >= this.nonceCap) return { ok: false, full: true, v };
      if (v + delta > cap) return { ok: false, v }; v += delta; await this.s.put(key, { v, exp }); await this.arm(); return { ok: true, v }; }
    if (op === 'add') { v = Math.max(0, v + delta); await this.s.put(key, { v, exp }); await this.arm(); return { ok: true, v }; }
    return { error: 'op' };
  }
  async liveNonces() { const now = Date.now(); let n = 0; for (const [k, r] of await this.s.list({ prefix: 'n:' })) if (k.startsWith('n:') && r && r.exp > now) n++; return n; }
  async arm() { try { if (this.state.storage.getAlarm && !(await this.s.getAlarm())) await this.s.setAlarm(Date.now() + 864e5); } catch {} }
  async alarm() { const now = Date.now(); for (const [k, r] of await this.s.list()) if (!r || r.exp <= now) await this.s.delete(k); }
}

// Added in Moneypenny Chat core 0.1.0 (the class above is unchanged). Caller side: one Durable Object serialises every counter.
export const makeLimiter = (ns) => async (key, body) => {
  const r = await ns.get(ns.idFromName('g')).fetch('https://limits/', { method: 'POST', body: JSON.stringify({ key, ...body }) });
  return r.json();
};
