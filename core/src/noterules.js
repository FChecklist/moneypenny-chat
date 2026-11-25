// The word check for AI notes (0.4.4). A SECOND layer only: the scope list, checked on every call, and the product backend are the real guard (docs/DECISIONS.md).
// Deny by default, one rule: for a done, blocked, plan or step note, the text is lower-cased (after NFKC and with zero-width characters removed) and the note is REFUSED
// if it holds ANY listed action word, whole word, with simple endings (-s -es -ed -d -ing, a few irregular ones). Negation, "and", commas, hand-offs and sentence shape are
// not looked at: that reading was bypassed in rounds 7 and 8. The only way through is the small allow-list below. The AI is told how to reword: say what it saw or what is waiting.
// Natural reports are sometimes refused too ("A person must pay" is refused). That cost is accepted and listed in docs/DECISIONS.md. Tests: core/tests/note-words.test.js.

const stems = (s) => s.split(' ');
const VERBS = stems('pay charge purchase buy delete erase remove wipe purge destroy refund reimburse cancel transfer discard trash unsubscribe refill recharge donate fund');   // the money and removal verbs (0.4.5: the last seven added after a review named them)
const NOUNS = stems('payment payout credit password passcode cancellation');                                              // their nouns (the payment provider is matched as razor*)
const STRONG = stems('please kindly let ahead click press tap hit select choose confirm approve accept');                 // push words
const ASK = stems('complete make process submit authorize authorise release settle send give add top topup spend wire deposit move grant award issue allocate assign enter type paste share reveal provide supply tell use finish initiate start proceed apply redeem set email text reply ask');
const IRREGULAR = stems('paid bought sent gave given made spent chose chosen tapped tapping topped topping submitted submitting transferred transferring cancelled cancelling canceled canceling lets');
const forms = (b) => [b, b + 's', b + 'es', b + 'ed', b + 'd', b + 'ing', b.replace(/e$/, '') + 'ing', b.replace(/y$/, 'i') + 'ed'];
const LISTED = new Set([...VERBS, ...NOUNS, ...STRONG, ...ASK].flatMap(forms).concat(IRREGULAR));
// A word that is a noun for a thing on the screen is let through when the very next word is a screen label: "payment page did not load". A verb is never let through ("pay now", "delete page").
const THING_NOUNS = new Set(stems('payment payments payout payouts credit credits password passwords passcode passcodes cancellation cancellations refund refunds transfer transfers charge charges purchase purchases'));
const LABELS = new Set(stems('page pages screen screens form forms session sessions link links step steps upload uploads picture pictures'));

// 0.4.6: one plain form of a note, used for every check AND for what is stored: NFKC, zero-width and soft-hyphen characters removed (written as escapes, so the source can be read).
export const plainNote = (text) => text.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '');
// For the word check the plain form is also lower-cased and accents are folded off (NFD, then the marks removed), so "d\u00E9lete" is read as "delete".
const clean = (text) => plainNote(text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const wordsOf = (s) => s.match(/[a-z0-9]+/g) || [];

// Returns null when the text passes, or 'forbidden_action'. Types other than the four are not decided here (the caller refuses them as bad_note).
export function checkNoteText(type, text) {
  if (typeof text !== 'string') return null;
  if (type !== 'plan' && type !== 'step' && type !== 'done' && type !== 'blocked') return null;
  const t = clean(text);
  // 0.4.5/0.4.6: a note is plain English. After the accents are folded off, any letter that is not a to z (Cyrillic, Greek, Devanagari, or a Latin letter that has no plain form such as a dotless i)
  // is refused: some of them look exactly like a Latin letter and NFKC does not fold them, so a note spelled with them would have no listed word to find. The cost: a note that quotes a page
  // label in another script is refused too; the AI can say what it saw in plain words. Digits, punctuation, the rupee sign and emoji are not letters and pass.
  if (/[^\P{L}a-z]/u.test(t)) return 'forbidden_action';
  // The text is read twice: with a hyphen as a space ("top-up" -> top, up) and with it removed ("e-mail" -> email, "de-lete" -> delete).
  for (const w of [wordsOf(t), wordsOf(t.replace(/-/g, ''))]) for (let i = 0; i < w.length; i++) {
    if (w[i].startsWith('razor')) return 'forbidden_action';
    if (!LISTED.has(w[i])) continue;
    if (THING_NOUNS.has(w[i]) && LABELS.has(w[i + 1])) continue;
    return 'forbidden_action';
  }
  return null;
}
