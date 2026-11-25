// S-048: the scope list is fixed. There is no scope for payments, identity or deleting. Anything outside the list is refused.
export const SCOPES = ['read_ticket', 'read_event', 'edit_event', 'create_event', 'invite', 'report'];
export const WRITE_SCOPES = ['edit_event', 'create_event', 'invite']; // a link with one of these needs an approved plan before step notes
export const READ_ONLY_SCOPES = ['read_ticket', 'read_event', 'report']; // no ticket: screen reading only, nothing that changes data
export const CLASS_SCOPES = { help: READ_ONLY_SCOPES, suggest: READ_ONLY_SCOPES, stuck: SCOPES }; // most a link may hold, by ticket class (option)
export function withinScopes(list, allowed) { return list.every((s) => allowed.includes(s)); }
export function checkScopes(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > SCOPES.length) return { ok: false };
  if (!list.every((s) => typeof s === 'string' && SCOPES.includes(s)) || new Set(list).size !== list.length) return { ok: false };
  return { ok: true, value: SCOPES.filter((s) => list.includes(s)) };
}
