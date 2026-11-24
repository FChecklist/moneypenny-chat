// Moneypenny Chat core Worker. Routes: /v1/health, /v1/version, tickets, team tickets. All instance calls are signed (see auth.js).
import { VERSION, API, MIN_INSTANCE } from './version.js';
import { json, fail } from './http.js';
import { MAX, readText, parseJsonObject } from './body.js';
import { parseInstances, secretsFromEnv } from './instance.js';
import { verifySignature, nonceStore } from './auth.js';
import { verifyAssertion } from './assertion.js';
import { makeLimiter } from './limits.js';
import { sha256hex } from './crypto.js';
import { d1Store } from './store-d1.js';
import * as T from './tickets.js';

export { Limits } from './limits.js';
const TICKET = /^T-\d{4,}$/;
const out = (r) => (r.error ? fail(r.error, r.extra, r.headers) : json(r.body, r.status, r.headers));

// ctx: {instances: Map, secrets(id, kind) -> [secret], store, limiter, now(), teamAuth(req) -> bool}. Everything is injected so tests need no Cloudflare.
export function createApp(ctx) {
  ctx.now ||= Date.now;
  return async function handle(req) {
    const url = new URL(req.url), path = url.pathname, m = req.method;
    try {
      if (m === 'GET' && path === '/v1/health') return json({ ok: true, core: VERSION, time: ctx.now() });
      if (m === 'GET' && path === '/v1/version') return json({ core: VERSION, api: API, min_instance: MIN_INSTANCE });
      if (path.startsWith('/v1/team/')) return await team(ctx, req, url);
      const sub = path.match(/^\/v1\/tickets(?:\/(T-\d{4,}))?$/);
      if (!sub || !((m === 'POST' && !sub[1]) || (m === 'GET' && sub[1]))) return fail('not_found');
      return await signed(ctx, req, path, sub[1]);
    } catch { return fail('try_later'); } // storage down or any unexpected fault: no detail leaves
  };
}

async function signed(ctx, req, path, number) {
  const id = req.headers.get('x-mpc-instance') || '', inst = ctx.instances.get(id);
  const raw = await readText(req, MAX.json); if (raw === null) return fail('too_large');
  const secrets = inst ? ctx.secrets(id, 'sign') : [];
  const sig = await verifySignature({ headers: req.headers, method: req.method, path, body: raw, secrets, nonces: nonceStore(ctx.limiter), now: ctx.now() });
  if (!inst || !sig.ok) return fail('bad_signature'); // unknown, disabled and wrong all look the same
  if (req.method === 'GET') return out(await T.readTicket(ctx, inst, number, req.headers.get('x-mpc-status-token')));
  const a = await verifyAssertion(req.headers.get('x-mpc-assertion'), { secrets: ctx.secrets(id, 'assert'), product: id, roleMap: inst.role_map, now: ctx.now() });
  if (!a.ok) return fail(a.error);
  const p = parseJsonObject(raw); if (!p.ok) return fail('bad_request');
  const addr = req.headers.get('x-mpc-ip');
  if (!addr && inst.require_ip === true) return fail('bad_request', { field: 'x-mpc-ip' });
  return out(await T.createTicket(ctx, inst, { raw, b: p.value, a, idemHeader: req.headers.get('idempotency-key'), ip: addr || 'sess:' + (await sha256hex(a.sess)) }));
}

async function team(ctx, req, url) {
  if (!ctx.teamAuth || !(await ctx.teamAuth(req))) return fail('no_team_login'); // fails closed until the Access check exists
  const sub = url.pathname.match(/^\/v1\/team\/tickets(?:\/(T-\d{4,}))?$/); if (!sub) return fail('not_found');
  const product = url.searchParams.get('product') || '', number = sub[1];
  if (!number && req.method === 'GET') return out(await T.listTickets(ctx, { product, status: url.searchParams.get('status'), cursor: url.searchParams.get('cursor') }));
  const inst = ctx.instances.get(product); if (!number || !inst) return fail(number ? 'bad_request' : 'not_found', number ? { field: 'product' } : {});
  if (req.method === 'GET') return out(await T.teamRead(ctx, product, number));
  if (req.method === 'PATCH') {
    const raw = await readText(req, MAX.json); if (raw === null) return fail('too_large');
    const p = parseJsonObject(raw); if (!p.ok) return fail('bad_request');
    return out(await T.teamUpdate(ctx, inst, number, p.value));
  }
  return fail('not_found');
}

let cache = { raw: null, map: null };
export default {
  async fetch(req, env) {
    if (!env.DB || !env.LIMITS) return fail('try_later');
    if (cache.raw !== env.INSTANCES) cache = { raw: env.INSTANCES, map: parseInstances(env.INSTANCES) };
    return createApp({ instances: cache.map, secrets: (id, kind) => secretsFromEnv(env, id, kind), store: d1Store(env.DB), limiter: makeLimiter(env.LIMITS) })(req);
  },
};
