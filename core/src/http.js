// S-015: one error shape and one response helper. Error body: {"error": code, "message": text, ...extra}
import { VERSION } from './version.js';
import { ERROR_TEXT } from './strings.js';

export const STATUS = { bad_request: 400, bad_signature: 401, no_assertion: 401, no_team_login: 401, origin: 403, role: 403, not_found: 404, idempotency_conflict: 409, too_large: 413, bad_type: 415, rate: 429, try_later: 503 };
export const ERRORS = Object.fromEntries(Object.keys(STATUS).map((c) => [c, { status: STATUS[c], message: ERROR_TEXT[c] }]));
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-mpc-core-version': VERSION, ...headers } });
export const fail = (code, extra = {}, headers = {}) => {
  const e = ERRORS[code] || ERRORS.try_later;
  return json({ error: ERRORS[code] ? code : 'try_later', message: e.message, ...extra }, e.status, headers);
};
