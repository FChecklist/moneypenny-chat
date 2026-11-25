// C10: the entry of the served bundle. The build bakes in the public instance record (text and colours only, no secrets).
// Loaded by a product page as <script type="module" src="/mpc/widget.js">. It mounts the widget and nothing else.
import { mountWidget } from './widget.js';

export function boot(inst, { doc = document, loc = location, mount = mountWidget } = {}) {
  const routes = (inst.routes && typeof inst.routes === 'object') ? inst.routes : {};
  // The instance server mints the key; the page only receives the finished link. A link for a ticket needs the status token of that ticket, as a header (never in the
  // body or the address): it is the only proof the ticket is the person's own. 0.4.0 and 0.4.1 left it out, so every link for a sent ticket was refused (found in a real browser).
  const post = async (kind, { token, ...extra } = {}) => {
    const r = await fetch('/mpc/ai-link', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...(token ? { 'x-mpc-status-token': token } : {}) }, body: JSON.stringify({ kind, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 201 || typeof j.url !== 'string') throw new Error('no link');
    return j.url;
  };
  return mount({ strings: inst.strings, base: '/mpc', doc, page: () => loc.pathname, screenLabel: Object.hasOwn(routes, loc.pathname) ? routes[loc.pathname] : undefined,
    aiLink: (kind, o = {}) => post(kind, { ...(o.ticket ? { ticket: o.ticket, token: o.token } : {}), screen: loc.pathname }) });
}
/* global __MPC_INSTANCE__ */
if (typeof __MPC_INSTANCE__ !== 'undefined') boot(__MPC_INSTANCE__);
