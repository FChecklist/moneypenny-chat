// S-050: a mock product backend for tests. It follows the adapter contract in contract/README.md ("/mpc/ai-key"):
//   POST /mpc/ai-key  {session, scopes, ttl_s}  ->  {key, key_hash, product_key_id, scopes, exp}
// The product owns and enforces the key: scope, expiry, and the three actions an AI may never do.
import { SCOPES } from '../../src/scopes.js';
import { sha256hex } from '../../src/crypto.js';
const NEVER = ['payment', 'identity', 'delete']; // the product answers 403 forbidden_action for these, whatever the key says
const ACTION_SCOPE = { read_event: 'read_event', edit_event: 'edit_event', create_event: 'create_event', invite: 'invite', report: 'report', read_ticket: 'read_ticket' };
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function mockProduct({ now = Date.now } = {}) {
  const keys = new Map(); let n = 0;
  return {
    keys,
    // The adapter route. Returns {status, body}.
    async mintKey({ session, scopes, ttl_s }) {
      if (typeof session !== 'string' || !session) return { status: 401, body: { error: 'not_signed_in' } };
      if (!Array.isArray(scopes) || !scopes.length || !scopes.every((s) => SCOPES.includes(s))) return { status: 400, body: { error: 'bad_scopes' } };
      if (!Number.isInteger(ttl_s) || ttl_s < 60 || ttl_s > 86400) return { status: 400, body: { error: 'bad_ttl' } };
      const key = 'mpk_' + [...crypto.getRandomValues(new Uint8Array(40))].map((b) => ALNUM[b % ALNUM.length]).join('');
      const id = 'pk' + ++n, exp = now() + ttl_s * 1000; keys.set(await sha256hex(key), { id, session, scopes: [...scopes], exp, revoked: false });
      return { status: 201, body: { key, key_hash: await sha256hex(key), product_key_id: id, scopes: [...scopes], exp } };
    },
    // What the product does with a call made with a key.
    async act(key, action) {
      const k = keys.get(await sha256hex(String(key)));
      if (!k || k.revoked) return { status: 401, error: 'bad_link' };
      if (k.exp <= now()) return { status: 401, error: 'expired' };
      if (NEVER.includes(action)) return { status: 403, error: 'forbidden_action' };
      if (!ACTION_SCOPE[action] || !k.scopes.includes(ACTION_SCOPE[action])) return { status: 403, error: 'out_of_scope' };
      return { status: 200 };
    },
  };
}
