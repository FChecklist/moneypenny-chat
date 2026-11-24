// S-019: path allowlist per instance (replaces the shared SEG list). Known segments stay; ids and names become ":x". No query, no fragment.
export const segmentsFromRoutes = (routes = {}) => new Set(Object.keys(routes).flatMap((p) => p.split('/')).filter(Boolean).map((s) => s.toLowerCase()));
export function cleanPath(p, allowed = new Set()) {
  return String(p || '/').split('?')[0].split('#')[0].split('/').map((x) => (x === '' || allowed.has(x.toLowerCase()) ? x.toLowerCase() : ':x')).join('/').slice(0, 120) || '/';
}
// Friendly name from the route table; the table keys are cleaned the same way.
export function screenLabel(cleaned, routes = {}, allowed) {
  for (const [k, v] of Object.entries(routes)) if (cleanPath(k, allowed) === cleaned) return v;
  return null;
}
