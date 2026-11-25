// Test harness: the REAL Limits class behind a fake Durable Object namespace, memory and D1 (bun:sqlite) stores, a signed-request builder.
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { Limits, makeLimiter } from '../src/limits.js';
import { createApp } from '../src/index.js';
import { memoryStore } from '../src/store-memory.js';
import { d1Store } from '../src/store-d1.js';
import { sign } from '../src/auth.js';
import { signAssertion } from '../src/assertion.js';
import { parseInstances } from '../src/instance.js';
import { memoryBlobs } from '../src/blobs.js';
import { fakeMailer } from '../src/mail.js';

export const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
export const fixture = (n) => JSON.parse(readFileSync(new URL('../../contract/fixtures/' + n, import.meta.url), 'utf8'));
export const TEAM_ADDR = ['team', 'mail.test'].join('@'); // built at run time so no address sits in the repo
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
export const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
export const WEBP = Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat([1, 2, 3, 4], [...'WEBP'].map((c) => c.charCodeAt(0)), [5, 6]));
export const SECRET = 's'.repeat(32), ASSERT = 'a'.repeat(32);

export function fakeNamespace(opts) {
  const store = new Map();
  const storage = { get: async (k) => { await 0; return store.get(k); }, put: async (k, v) => { await 0; store.set(k, v); }, delete: async (k) => void store.delete(k), list: async () => new Map(store), getAlarm: async () => null, setAlarm: async () => {} };
  const l = new Limits({ storage }, opts);
  return { idFromName: (n) => n, get: () => ({ fetch: (u, init) => l.fetch(new Request(u, init)) }) };
}
// Minimal D1 over bun:sqlite: prepare().bind().first()/all()/run() and batch() as one transaction.
export function fakeD1() {
  const db = new Database(':memory:'); db.exec(SCHEMA);
  const prep = (sql) => { let args = []; const o = {
    bind: (...a) => { args = a; return o; },
    first: async () => db.query(sql).get(...args) ?? null,
    all: async () => ({ results: db.query(sql).all(...args) }),
    run: async () => ({ meta: { changes: db.query(sql).run(...args).changes } }),
    _run: () => db.query(sql).all(...args),
  }; return o; };
  return { prepare: prep, batch: async (list) => { db.exec('BEGIN'); try { const out = []; for (const s of list) out.push({ results: s._run() }); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } }, raw: db };
}

// d1 takes an optional fake D1, so a test can hand the same database to the Worker entry (scheduled, fetch) that made the rows.
export const STORES = { memory: () => memoryStore(), d1: (db) => { const d = db || fakeD1(); const s = d1Store(d); s.raw = d.raw; return s; } };

export function makeEnv({ store = 'memory', instance = fixture('instance-example.json'), now = () => Date.now(), team = false, nonceCap, mail = fakeMailer(), teamEmail = TEAM_ADDR, teamUrl = 'https://core.test', teamAuth, others = [], d1 } = {}) {
  const instances = parseInstances([instance, ...others]), limiter = makeLimiter(fakeNamespace({ nonceCap })), st = STORES[store](d1);
  const blobs = memoryBlobs(), secrets = (id, kind) => (kind === 'sign' ? [SECRET] : [ASSERT]);
  const app = createApp({ instances, secrets, store: st, limiter, now, blobs, mail, teamEmail, teamUrl, teamAuth: teamAuth ?? (team ? () => true : undefined) });
  const n = { c: 0 }; const hex = () => (++n.c).toString(16).padStart(32, '0');
  // call(): sends a signed request. opts: ts, nonce, secret, sess, role, product, ip, key, assertion (override), rawBody
  async function call(method, path, body, o = {}) {
    const raw = o.rawBody ?? (body === undefined ? '' : JSON.stringify(body));
    const ts = String(o.ts ?? Math.floor(now() / 1000)), nonce = o.nonce ?? hex(), id = o.instance ?? instance.id;
    const sig = await sign(o.secret ?? SECRET, { method, path, ts, nonce, body: o.signedBody ?? raw, ip: o.signedIp ?? o.ip ?? '1.2.3.4' });
    const h = { 'x-mpc-instance': id, 'x-mpc-ts': ts, 'x-mpc-nonce': nonce, 'x-mpc-sig': sig, 'x-mpc-ip': o.ip ?? '1.2.3.4' };
    if (method === 'POST') h['idempotency-key'] = o.key ?? crypto.randomUUID();
    if (o.token) h['x-mpc-status-token'] = o.token;
    if (o.ctype) h['content-type'] = o.ctype;
    Object.assign(h, o.headers || {});
    if (o.assertion !== null) h['x-mpc-assertion'] = o.assertion ?? await signAssertion(ASSERT, { product: o.product ?? id, role: o.role ?? (body && body.role === 'co-organizer' ? 'host' : 'organizer'), sess: o.sess ?? 'session-0001', exp: Math.floor(now() / 1000) + 600 });
    return app(new Request('https://core.test' + path, { method, headers: h, body: method === 'GET' ? undefined : raw }));
  }
  const plain = (method, path, body) => app(new Request('https://core.test' + path, { method, body: body === undefined ? undefined : JSON.stringify(body) }));
  // ai(): the AI side, no signature: only a bearer key (or a page key in the query)
  const ai = (method, path, { k, body, headers = {} } = {}) => app(new Request('https://core.test' + path, { method, headers: { ...(k ? { authorization: 'Bearer ' + k } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }));
  const ctx = () => ({ instances, secrets, store: st, limiter, now, blobs, mail, teamEmail, teamUrl });
  return { ctx, app, call, plain, ai, store: st, instance, blobs, mail, instances, limiter, d1raw: st.raw };
}
