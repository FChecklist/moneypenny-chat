// S-022 helpers: the key is a UUID made by the widget; the core keeps key hash + body hash + response for 24 hours.
import { sha256hex } from './crypto.js';
export const IDEM_TTL_MS = 24 * 3600e3;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const parseKey = (v) => (UUID.test(v || '') ? v.toLowerCase() : null);
export const keyHash = (instance, key) => sha256hex(instance + '|' + key);
export const bodyHash = (text) => sha256hex(text);
// Decide from a stored record: replay (same body), conflict (different body) or null.
export const decide = (rec, bHash) => (!rec ? null : rec.bodyHash === bHash ? { replay: JSON.parse(rec.response) } : { conflict: true });
