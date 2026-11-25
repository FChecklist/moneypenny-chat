// C11: reference session adapter. The contract is in contract/README.md ("Product session adapter").
//   adapter.session(req)  -> { role, sess, user_id } | null     null = not signed in (or the product did not say yes)
//   adapter.mintKey({session, scopes, ttl_s}) -> { status, body }
// The role and the user id come from the PRODUCT SERVER, asked here, server to server. Nothing the page sends (body, query, any
// header except the product's own cookie or authorization header) can set a role. A product fault throws: the instance fails closed.
import { sha256hex } from '../../core/src/crypto.js';
import { SCOPES } from '../../core/src/scopes.js';

const FORWARD = ['cookie', 'authorization']; // the only things of the browser request the product server sees
const USER_ID = /^[\x21-\x7e]{1,128}$/;       // printable, no spaces, up to 128
const ROLE = /^[a-z][a-z0-9-]{0,31}$/;
const KEY = /^mpk_[A-Za-z0-9]{40}$/, HASH = /^[0-9a-f]{64}$/;

// productFetch: (Request) -> Response. In a Worker this is a service binding (private, no public route).
// base: the product URL prefix as the binding sees it (default https://product.internal).
export function httpAdapter({ productFetch, base = 'https://product.internal' }) {
  if (typeof productFetch !== 'function') throw new Error('adapter: productFetch is needed');
  return {
    async session(req) {
      const h = new Headers(); for (const k of FORWARD) if (req.headers.get(k)) h.set(k, req.headers.get(k));
      if (![...h.keys()].length) return null; // no cookie and no authorization: nothing to ask
      const r = await productFetch(new Request(base + '/mpc/session', { method: 'GET', headers: h }));
      if (r.status === 401 || r.status === 403 || r.status === 204) return null; // product says: not signed in
      if (r.status !== 200) throw new Error('product session: status ' + r.status); // product fault is not "signed out": the caller fails closed
      let j; try { j = await r.json(); } catch { throw new Error('product session: bad body'); }
      if (!j || typeof j !== 'object' || typeof j.role !== 'string' || !ROLE.test(j.role) || typeof j.user_id !== 'string' || !USER_ID.test(j.user_id)) return null; // unknown shape: refused, no default role
      // sess is a one way id of the user: stable (so limits follow the person), and the raw user id never reaches the core
      return { role: j.role, user_id: j.user_id, sess: (await sha256hex('mpc-sess|' + j.user_id)).slice(0, 32) };
    },
    // Not called with a browser request: the instance calls it after session() said yes. The product re-checks everything.
    async mintKey({ session, scopes, ttl_s }) {
      if (typeof session !== 'string' || !session || !Array.isArray(scopes) || !scopes.length || !scopes.every((s) => SCOPES.includes(s))) return { status: 400, body: { error: 'bad_request' } };
      const r = await productFetch(new Request(base + '/mpc/ai-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, scopes, ttl_s }) }));
      if (r.status !== 201) return { status: r.status, body: {} };
      const b = await r.json().catch(() => null);
      if (!b || !KEY.test(b.key || '') || !HASH.test(b.key_hash || '') || b.key_hash !== (await sha256hex(b.key)) || !Array.isArray(b.scopes) || !b.scopes.every((s) => scopes.includes(s)) || typeof b.product_key_id !== 'string' || !b.product_key_id) return { status: 502, body: {} }; // a wrong answer is refused; wider scopes than asked are refused
      return { status: 201, body: { key: b.key, key_hash: b.key_hash, product_key_id: b.product_key_id, scopes: b.scopes, exp: b.exp } };
    },
  };
}
