// S-031: DNT and GPC. A request with `DNT: 1` or `Sec-GPC: 1` still works, but the core writes no side record for it.
// Side records are the AI call log rows. Rate-limit counters (hashed address, rotates daily) and audit rows are not side records: they are needed to run the service and hold no person.
// The instance must forward both headers on the calls it makes for a visitor.
export const isPrivate = (headers) => headers.get('dnt') === '1' || headers.get('sec-gpc') === '1';
export async function sideRecord(headers, write) { if (isPrivate(headers)) return false; await write(); return true; }
