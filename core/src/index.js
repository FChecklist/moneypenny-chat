// Moneypenny Chat core Worker. Routes: /v1/health, /v1/version, tickets, team tickets. All instance calls are signed (see auth.js).
import { VERSION, API, MIN_INSTANCE } from './version.js';
import { json, fail } from './http.js';
import { MAX, readText, readBytes, parseJsonObject } from './body.js';
import { parseInstances, secretsFromEnv } from './instance.js';
import { verifySignature, nonceStore } from './auth.js';
import { verifyAssertion } from './assertion.js';
import { makeLimiter } from './limits.js';
import { sha256hex } from './crypto.js';
import { d1Store } from './store-d1.js';
import * as T from './tickets.js';
import { uploadShot, readShot } from './shots.js';
import { createLink, revokeLink, approveLink, aiPage, aiContext, aiNote } from './ailink.js';
import { aiError } from './aipage.js';
import { sweep } from './retention.js';
import { notifyTicket, retryMail, serviceMailer } from './mail.js';
import { accessAuth } from './access.js';
import { r2Blobs } from './blobs.js';
import TEAM_HTML from '../team/index.html' with { type: 'text' };
import TEAM_JS from '../team/app.js' with { type: 'text' };

export { Limits } from './limits.js';
const TICKET = /^T-\d{4,}$/;
const out = (r) => (r.error ? fail(r.error, r.extra, r.headers) : r.status === 204 ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...r.headers } }) : json(r.body, r.status, r.headers));

// ctx: {instances: Map, secrets(id, kind) -> [secret], store, limiter, now(), teamAuth(req) -> bool}. Everything is injected so tests need no Cloudflare.
export function createApp(ctx) {
  ctx.now ||= Date.now;
  return async function handle(req) {
    const url = new URL(req.url), path = url.pathname, m = req.method;
    try {
      if (m === 'GET' && path === '/v1/health') return json({ ok: true, core: VERSION, time: ctx.now() });
      if (m === 'GET' && path === '/v1/version') return json({ core: VERSION, api: API, min_instance: MIN_INSTANCE });
      if (path === '/team' || path === '/team/' || path === '/team/app.js') return await teamPage(ctx, req, path);
      if (path.startsWith('/v1/team/')) return await team(ctx, req, url);
      const ai = path.match(/^\/ai\/([A-Za-z0-9_-]+?)(\.json)?$/);
      if (ai && m === 'GET') return await aiPage(ctx, ai[1], url.searchParams.get('k'), ai[2] ? 'json' : 'md');
      if (m === 'GET' && path === '/v1/ai/context') return await aiContext(ctx, req);
      if (m === 'POST' && path === '/v1/ai/notes') return await aiNote(ctx, req, await readText(req, MAX.json));
      if (path.startsWith('/v1/ai/')) return fail('not_found');
      if (m === 'POST' && path === '/v1/screenshots') return await shot(ctx, req, path);
      const lk = path.match(/^\/v1\/ai-links(?:\/([A-Za-z0-9_-]+?)(\/approve)?)?$/);
      if (lk && ((m === 'POST' && (!lk[1] || lk[2])) || (m === 'DELETE' && lk[1] && !lk[2]))) return await signed(ctx, req, path, undefined, lk);
      const sub = path.match(/^\/v1\/tickets(?:\/(T-\d{4,}))?$/);
      if (!sub || !((m === 'POST' && !sub[1]) || (m === 'GET' && sub[1]))) return fail('not_found');
      return await signed(ctx, req, path, sub[1]);
    } catch { return path.startsWith('/v1/ai/') || path.startsWith('/ai/') ? aiError('try_later') : fail('try_later'); } // storage down or any unexpected fault: no detail leaves
  };
}

async function signed(ctx, req, path, number, lk) {
  const id = req.headers.get('x-mpc-instance') || '', inst = ctx.instances.get(id);
  const raw = await readText(req, MAX.json); if (raw === null) return fail('too_large');
  const secrets = inst ? ctx.secrets(id, 'sign') : [];
  const sig = await verifySignature({ headers: req.headers, method: req.method, path, body: raw, secrets, nonces: nonceStore(ctx.limiter), now: ctx.now() });
  if (inst && sig.why === 'busy') return fail('rate'); // nonce table full: too many requests
  if (!inst || !sig.ok) return fail('bad_signature'); // unknown, disabled and wrong all look the same
  if (lk) {
    const a = await verifyAssertion(req.headers.get('x-mpc-assertion'), { secrets: ctx.secrets(id, 'assert'), product: id, roleMap: inst.role_map, now: ctx.now() });
    if (!a.ok) return fail(a.error);
    if (req.method === 'DELETE') return out(await revokeLink(ctx, inst, lk[1], a));
    if (lk[2]) return out(await approveLink(ctx, inst, lk[1], a));
    const p = parseJsonObject(raw); if (!p.ok) return fail('bad_request');
    return out(await createLink(ctx, inst, { b: p.value, a, token: req.headers.get('x-mpc-status-token') }));
  }
  if (req.method === 'GET') return out(await T.readTicket(ctx, inst, number, req.headers.get('x-mpc-status-token')));
  const a = await verifyAssertion(req.headers.get('x-mpc-assertion'), { secrets: ctx.secrets(id, 'assert'), product: id, roleMap: inst.role_map, now: ctx.now() });
  if (!a.ok) return fail(a.error);
  const p = parseJsonObject(raw); if (!p.ok) return fail('bad_request');
  const addr = req.headers.get('x-mpc-ip');
  if (!addr && inst.require_ip === true) return fail('bad_request', { field: 'x-mpc-ip' });
  const r = await T.createTicket(ctx, inst, { raw, b: p.value, a, idemHeader: req.headers.get('idempotency-key'), ip: addr || 'sess:' + (await sha256hex(a.sess)) });
  if (r.status === 201 && !(r.headers && r.headers['idempotent-replay'])) { // C5: tell the team. Never fails the ticket.
    const job = (async () => { const row = await ctx.store.getTicket(inst.id, r.body.ticket, ctx.now()); if (row) await notifyTicket(ctx, inst, row); })().catch(() => {});
    if (ctx.defer) ctx.defer(job); else await job;
  }
  return out(r);
}

// S-027: the body is the file itself. The signature covers the sha256 of the bytes, like any other body.
async function shot(ctx, req, path) {
  const id = req.headers.get('x-mpc-instance') || '', inst = ctx.instances.get(id);
  const bytes = await readBytes(req, MAX.screenshot); if (bytes === null) return fail('too_large');
  const sig = await verifySignature({ headers: req.headers, method: 'POST', path, body: bytes, secrets: inst ? ctx.secrets(id, 'sign') : [], nonces: nonceStore(ctx.limiter), now: ctx.now() });
  if (inst && sig.why === 'busy') return fail('rate');
  if (!inst || !sig.ok) return fail('bad_signature');
  const a = await verifyAssertion(req.headers.get('x-mpc-assertion'), { secrets: ctx.secrets(id, 'assert'), product: id, roleMap: inst.role_map, now: ctx.now() });
  if (!a.ok) return fail(a.error);
  const addr = req.headers.get('x-mpc-ip');
  if (!addr && inst.require_ip === true) return fail('bad_request', { field: 'x-mpc-ip' });
  return out(await uploadShot(ctx, inst, { bytes, contentType: req.headers.get('content-type'), idemHeader: req.headers.get('idempotency-key'), ip: addr || 'sess:' + (await sha256hex(a.sess)) }));
}

// S-040 and S-041: the team page. Same login as the team calls. No external scripts: the page loads one file from the same origin.
const PAGE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' };
async function teamPage(ctx, req, path) {
  if (req.method !== 'GET') return fail('not_found');
  if (!ctx.teamAuth || !(await ctx.teamAuth(req))) return fail('no_team_login');
  if (path === '/team/app.js') return new Response(TEAM_JS, { headers: { ...PAGE_HEADERS, 'content-type': 'text/javascript; charset=utf-8' } });
  return new Response(TEAM_HTML, { headers: { ...PAGE_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
}

async function team(ctx, req, url) {
  if (!ctx.teamAuth || !(await ctx.teamAuth(req))) return fail('no_team_login'); // fails closed until the Access check exists
  const pic = url.pathname.match(/^\/v1\/team\/tickets\/(T-\d{4,})\/screenshot$/);
  if (pic && req.method === 'GET') { // the only way to read a file: team login, no cache, shown inline, never a public link
    const inst = ctx.instances.get(url.searchParams.get('product') || ''); if (!inst || !ctx.blobs) return fail('not_found');
    const f = await readShot(ctx, inst, pic[1]); if (!f) return fail('not_found');
    return new Response(f.bytes, { headers: { 'content-type': f.ctype, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; sandbox" } });
  }
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

let cache = { raw: null, map: null }, access = { key: '', fn: null };
// Everything the Worker needs comes from `env`: DB, LIMITS, SHOTS (bucket), MAIL (service), TEAM_EMAIL (secret), TEAM_URL, ACCESS_TEAM_DOMAIN, ACCESS_AUD.
function build(env, exec) {
  if (cache.raw !== env.INSTANCES) cache = { raw: env.INSTANCES, map: parseInstances(env.INSTANCES) };
  const ak = (env.ACCESS_TEAM_DOMAIN || '') + '|' + (env.ACCESS_AUD || '');
  if (access.key !== ak) access = { key: ak, fn: accessAuth({ domain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }) };
  return { instances: cache.map, secrets: (id, kind) => secretsFromEnv(env, id, kind), store: d1Store(env.DB), limiter: makeLimiter(env.LIMITS), blobs: env.SHOTS ? r2Blobs(env.SHOTS) : undefined,
    mail: env.MAIL ? serviceMailer(env.MAIL) : undefined, teamEmail: env.TEAM_EMAIL, teamUrl: env.TEAM_URL, teamAuth: access.fn, now: Date.now, defer: exec && exec.waitUntil ? (p) => exec.waitUntil(p) : undefined };
}
export default {
  async fetch(req, env, exec) {
    if (!env.DB || !env.LIMITS) return fail('try_later');
    return createApp(build(env, exec))(req);
  },
  // Hourly (cron in wrangler.toml): erase what is due, then try queued team mail again.
  async scheduled(_event, env) {
    if (!env.DB || !env.LIMITS || !env.SHOTS) return;
    const ctx = build(env); ctx.now = Date.now;
    await sweep(ctx); await retryMail(ctx);
  },
};
