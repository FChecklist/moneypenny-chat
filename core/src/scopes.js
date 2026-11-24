// S-048: the scope list is fixed. There is no scope for payments, identity or deleting. Anything outside the list is refused.
export const SCOPES = ['read_ticket', 'read_event', 'edit_event', 'create_event', 'invite', 'report'];
export const WRITE_SCOPES = ['edit_event', 'create_event', 'invite']; // a link with one of these needs an approved plan before step notes
export function checkScopes(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > SCOPES.length) return { ok: false };
  if (!list.every((s) => typeof s === 'string' && SCOPES.includes(s)) || new Set(list).size !== list.length) return { ok: false };
  return { ok: true, value: SCOPES.filter((s) => list.includes(s)) };
}
