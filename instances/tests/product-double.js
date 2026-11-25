// Test double of a product server. Follows the adapter contract in contract/README.md. Sessions are bearer tokens, not cookies.
import { mockProduct } from '../../core/tests/mock-product/index.js';
export function productDouble({ now = Date.now } = {}) {
  const keys = mockProduct({ now }), sessions = new Map();
  return {
    keys, sessions,
    login: (token, role, sess) => sessions.set(token, { role, sess }),
    async session(req) { const a = req.headers.get('authorization') || ''; return a.startsWith('Bearer ') ? sessions.get(a.slice(7)) || null : null; },
    mintKey: (x) => keys.mintKey(x),
  };
}
