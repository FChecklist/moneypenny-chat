// S-011: instance record (config per product). Holds no secrets: secrets come from platform secrets by name (see secretNames).
export const RETENTION_CLASSES = ['games', 'records'];
const ID = /^[a-z0-9][a-z0-9-]{2,39}$/;
const VER = /^\d+\.\d+$/, VERMAX = /^\d+\.(\d+|x)$/;
const isOrigin = (s) => { try { const u = new URL(s); return u.protocol === 'https:' && u.origin === s; } catch { return false; } };
const ROLE_OUT = ['organizer', 'co-organizer'];

// Returns {ok:true, value} or {ok:false, errors:[text]}.
export function validateInstance(c) {
  const errors = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, errors: ['config must be an object'] };
  if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push('id: 3 to 40 chars, a-z 0-9 and -');
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60) errors.push('name: 1 to 60 chars');
  if (!Array.isArray(c.allowed_origins) || !c.allowed_origins.length || !c.allowed_origins.every(isOrigin)) errors.push('allowed_origins: https origins only, no path');
  if (!RETENTION_CLASSES.includes(c.retention_class)) errors.push('retention_class: games or records');
  if (typeof c.enabled !== 'boolean') errors.push('enabled: true or false');
  if (c.routes !== undefined) {
    const ok = c.routes && typeof c.routes === 'object' && !Array.isArray(c.routes) && Object.entries(c.routes).every(([k, v]) => /^\/[^?#\s]*$/.test(k) && typeof v === 'string' && v.length >= 1 && v.length <= 40);
    if (!ok) errors.push('routes: path to label (1 to 40 chars)');
  }
  if (c.role_map !== undefined) {
    const ok = c.role_map && typeof c.role_map === 'object' && !Array.isArray(c.role_map) && Object.values(c.role_map).every((v) => ROLE_OUT.includes(v));
    if (!ok) errors.push('role_map: values must be organizer or co-organizer');
  }
  for (const k of ['core_min', 'core_max']) if (c[k] !== undefined && !(typeof c[k] === 'string' && (k === 'core_max' ? VERMAX : VER).test(c[k]))) errors.push(`${k}: like 0.1 (core_max may be 0.x)`);
  if (c.kb_version !== undefined && (typeof c.kb_version !== 'string' || c.kb_version.length > 40)) errors.push('kb_version: text up to 40 chars');
  if (c.tickets_per_day !== undefined && !(Number.isInteger(c.tickets_per_day) && c.tickets_per_day >= 1 && c.tickets_per_day <= 10000)) errors.push('tickets_per_day: whole number 1 to 10000');
  if (c.brand !== undefined && !(c.brand && typeof c.brand === 'object' && /^#[0-9a-fA-F]{6}$/.test(c.brand.primary || ''))) errors.push('brand.primary: colour like #1a2b3c');
  return errors.length ? { ok: false, errors } : { ok: true, value: c };
}
// Platform secret names for an instance: signing (two may be active) and the role-assertion secret.
export const secretNames = (id) => { const b = 'SECRET_' + id.toUpperCase().replace(/-/g, '_'); return { sign: [b, b + '_NEXT'], assert: [b + '_ASSERT', b + '_ASSERT_NEXT'] }; };
export const secretsFromEnv = (env, id, kind) => secretNames(id)[kind].map((n) => env[n]).filter((v) => typeof v === 'string' && v.length >= 16);
// Instances come from the INSTANCES variable (JSON array). Invalid records are dropped.
export function parseInstances(raw) {
  let list; try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return new Map(); }
  const m = new Map();
  for (const c of Array.isArray(list) ? list : []) { const v = validateInstance(c); if (v.ok && c.enabled) m.set(c.id, c); }
  return m;
}
