// C10: the Worker entry logic shared by every instance. Each instance folder has a tiny worker.js that calls makeWorker.
//   GET /mpc/widget.js   the built bundle. Needs no secret and no product call, so a setup fault never hides it.
//   GET /mpc/config.json public text and colours (same: no setup needed)
//   /mpc/*               everything else goes to createInstance (origin, product session, signing, core)
// env (platform values, never in git): SECRET_<ID>, SECRET_<ID>_ASSERT (see core/src/instance.js secretNames),
// bindings CORE (the core Worker) and PRODUCT (the product server, private). Missing ones: calls answer 503 try_later.
import { createInstance, checkConfig, configReply } from './proxy.js';
import { httpAdapter } from './adapter.js';
import { secretNames } from '../../core/src/instance.js';

const NO_COOKIE_HEAD = { 'x-content-type-options': 'nosniff' };
export function widgetReply(js) { // same origin only: no CORS header is added, no cookie is set
  return new Response(js, { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', ...NO_COOKIE_HEAD } });
}
const down = () => new Response(JSON.stringify({ error: 'try_later', message: 'Please try again in a moment.' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function makeWorker({ config, strings, widgetJs, now }) { // now: an optional clock (tests move time with it); default is the real clock
  checkConfig(config, strings); // a bad record stops the deploy, not the first visitor
  if (typeof widgetJs !== 'string' || !widgetJs.length) throw new Error('widget bundle is empty: run scripts/build-widget.mjs');
  const [signName] = secretNames(config.id).sign, [assertName] = secretNames(config.id).assert;
  let cached = null, cachedKey = '';
  return {
    async fetch(req, env = {}) {
      const { pathname } = new URL(req.url);
      if (req.method === 'GET' && pathname === '/mpc/widget.js') return widgetReply(widgetJs);
      if (req.method === 'GET' && pathname === '/mpc/config.json') return configReply(config, strings);
      if (!pathname.startsWith('/mpc/')) return new Response('Not found.', { status: 404, headers: { 'cache-control': 'no-store' } });
      const sign = env[signName], assert = env[assertName];
      if (typeof sign !== 'string' || typeof assert !== 'string' || !env.CORE || !env.PRODUCT) return down(); // setup is not complete
      if (!cached || cachedKey !== sign + '|' + assert) { // rebuilt if a secret is rotated
        cached = createInstance({ config, strings, secrets: { sign, assert }, product: httpAdapter({ productFetch: (r) => env.PRODUCT.fetch(r) }), core: { fetch: (r) => env.CORE.fetch(r) }, ...(now ? { now } : {}) }); cachedKey = sign + '|' + assert;
      }
      try { return await cached(req); } catch { return down(); }
    },
  };
}
