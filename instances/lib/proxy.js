// C8: the instance Worker logic, same for every product. It stands between the page and the core:
//   page -> /mpc/* (this file) -> core /v1/*
// It checks the origin, asks the PRODUCT server who the person is (never the browser), signs the role proof and the request
// with secrets that only live on the server side, and forwards. No cookies are read or set. No secret is in the repo.
import { sign } from '../../core/src/auth.js';
import { signAssertion } from '../../core/src/assertion.js';
import { validateInstance } from '../../core/src/instance.js';
import { checkStrings } from '../../contract/strings-rules.mjs';

const HEX = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const reply = (status, body, h = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const err = (status, error, message) => reply(status, { error, message });
// Which core route each page route reaches. Anything else is 404. Table, not a pattern: nothing leaks through a typo.
const ROUTES = [['POST', /^\/mpc\/v1\/tickets$/, () => '/v1/tickets'], ['GET', /^\/mpc\/v1\/tickets\/(T-\d{4,})$/, (m) => '/v1/tickets/' + m[1]], ['POST', /^\/mpc\/v1\/screenshots$/, () => '/v1/screenshots']];
export const AI_KINDS = { help: ['read_event'], suggest: ['read_event'], stuck: ['read_event', 'read_ticket'] }; // read only scopes; the organizer can approve more on the AI page later
const AI_TTL_S = 3600;

// Refuses a bad config at start, not at the first call.
export function checkConfig(config, strings) {
  const v = validateInstance(config); if (!v.ok) throw new Error('instance: ' + v.errors.join('; '));
  if (!strings || !/^https:\/\//.test(strings.terms_url || '')) throw new Error('strings: terms_url must be an https link');
  const bad = checkStrings(strings); if (bad.length) throw new Error('strings: ' + JSON.stringify(bad));
  for (const k of ['help_topics', 'stuck', 'screens']) if (!Array.isArray(strings[k])) throw new Error('strings: ' + k + ' must be a list');
}

// opts: {config, strings, secrets:{sign, assert}, product:{session(req)->{role,sess}|null, mintKey({session,scopes,ttl_s})->{status,body}}, core:{fetch(Request)}, now}
export function createInstance({ config, strings, secrets, product, core, now = Date.now }) {
  checkConfig(config, strings);
  if (!secrets || typeof secrets.sign !== 'string' || secrets.sign.length < 16 || typeof secrets.assert !== 'string' || secrets.assert.length < 16) throw new Error('secrets: sign and assert are needed (16 characters or more)');
  const origins = new Set(config.allowed_origins);
  const roles = new Set([...Object.keys(config.role_map || {}), 'organizer', 'co-organizer']);

  async function toCore(method, path, req, bodyBytes, who, extra = {}) {
    const ts = String(Math.floor(now() / 1000)), nonce = HEX(16), ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-mpc-ip') || '';
    const body = bodyBytes ?? new Uint8Array(0);
    const h = { 'x-mpc-instance': config.id, 'x-mpc-ts': ts, 'x-mpc-nonce': nonce, 'x-mpc-sig': await sign(secrets.sign, { method, path, ts, nonce, body, ip }),
      'x-mpc-assertion': await signAssertion(secrets.assert, { product: config.id, role: who.role, sess: who.sess, exp: Math.floor(now() / 1000) + 600 }), ...extra };
    if (ip) h['x-mpc-ip'] = ip;
    for (const k of ['idempotency-key', 'content-type', 'x-mpc-status-token', 'dnt', 'sec-gpc']) if (req.headers.get(k)) h[k] = req.headers.get(k); // DNT and GPC must reach the core
    return core.fetch(new Request('https://core.internal' + path, { method, headers: h, body: method === 'GET' ? undefined : body }));
  }
  const person = async (req) => { // who is asking: from the product server, never from the page
    const s = await product.session(req);
    if (!s || typeof s.sess !== 'string' || !roles.has(s.role)) return null;
    return s;
  };

  return async function handle(req) {
    const url = new URL(req.url), path = url.pathname, m = req.method;
    try {
      if (m === 'GET' && path === '/mpc/config.json') { // public: text and colours only
        return reply(200, { id: config.id, name: config.name, brand: config.brand || null, kb_version: config.kb_version || null, strings });
      }
      const rt = ROUTES.find(([rm, re]) => rm === m && re.test(path)), ai = m === 'POST' && path === '/mpc/ai-link';
      if (!rt && !ai) return err(404, 'not_found', 'Not found.');
      const o = req.headers.get('origin'); if (!o || !origins.has(o)) return err(403, 'origin', 'This origin is not allowed.'); // other origin, or none: refused before anything else
      const who = await person(req); if (!who) return err(403, 'role', 'Only an organizer or a co-organizer can do this.');
      if (rt) {
        const bytes = m === 'GET' ? null : new Uint8Array(await req.arrayBuffer());
        if (bytes && bytes.length > 2.5 * 1024 * 1024) return err(413, 'too_large', 'The request is too large.');
        const corePath = rt[2](path.match(rt[1]));
        let out = bytes;
        if (corePath === '/v1/tickets') { // the role comes from the product server; the page cannot claim one
          let b; try { b = JSON.parse(new TextDecoder().decode(bytes)); } catch { return err(400, 'bad_request', 'Something in the request is wrong. Check the fields.'); }
          if (!b || typeof b !== 'object' || Array.isArray(b)) return err(400, 'bad_request', 'Something in the request is wrong. Check the fields.');
          out = new TextEncoder().encode(JSON.stringify({ ...b, role: config.role_map?.[who.role] || who.role }));
        }
        const r = await toCore(m, corePath, req, out, who);
        return new Response(r.status === 204 ? null : await r.arrayBuffer(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store', ...(r.headers.get('retry-after') ? { 'retry-after': r.headers.get('retry-after') } : {}) } });
      }
      // POST /mpc/ai-link {kind, ticket?, screen?}: the product mints the key; the core keeps only its hash; this server adds k.
      let b; try { b = JSON.parse(await req.text()); } catch { b = null; }
      if (!b || !Object.hasOwn(AI_KINDS, b.kind)) return err(400, 'bad_request', 'Something in the request is wrong. Check the fields.'); // unknown kind: refused, no default scopes
      const k = await product.mintKey({ session: who.sess, scopes: AI_KINDS[b.kind], ttl_s: AI_TTL_S });
      if (k.status !== 201) return err(503, 'try_later', 'Please try again in a moment.');
      const body = new TextEncoder().encode(JSON.stringify({ scopes: k.body.scopes, ttl_s: AI_TTL_S, key_hash: k.body.key_hash, product_key_id: k.body.product_key_id, ...(typeof b.ticket === 'string' ? { ticket: b.ticket } : {}), ...(typeof b.screen === 'string' ? { screen: b.screen } : {}) }));
      const r = await toCore('POST', '/v1/ai-links', req, body, who, { 'content-type': 'application/json', 'idempotency-key': req.headers.get('idempotency-key') || HEX(16) });
      const j = await r.json().catch(() => ({}));
      if (r.status !== 201) return reply(r.status, { error: j.error || 'try_later', message: j.message });
      return reply(201, { url: j.link + k.body.key }); // the key reaches only this person's page, never the core
    } catch { return err(503, 'try_later', 'Please try again in a moment.'); }
  };
}
