// S-025: erase_at per retention class (D5). Games: 24 hours after receipt (owner rule). Records: proposed in D5, owner to confirm (decision I3):
// text 30 days after done, never later than 90 days after receipt. A ticket still open at 90 days is erased.
const H = 3600e3, D = 24 * H;
export const RULES = { games: { afterReceipt: 24 * H }, records: { maxAfterReceipt: 90 * D, textAfterDone: 30 * D, shotAfterDone: 7 * D, shotMaxAfterReceipt: 30 * D } };
export const eraseAtCreate = (cls, created) => created + (cls === 'games' ? RULES.games.afterReceipt : RULES.records.maxAfterReceipt);
export function eraseAtDone(cls, created, done) {
  if (cls === 'games') return created + RULES.games.afterReceipt; // never later than 24 hours
  return Math.min(done + RULES.records.textAfterDone, created + RULES.records.maxAfterReceipt);
}
