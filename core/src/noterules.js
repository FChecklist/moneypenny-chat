// The word check for AI notes (0.4.2). A SECOND layer only: the scope list, checked on every call, and the product backend are the real guard (docs/DECISIONS.md).
// The check must stop plain slips (an AI that plans to pay or delete) without stopping an AI from saying WHY it stopped. Where a note runs decides how strict it is:
//   plan, step    The AI says what it will do or did. Strict, as the owner asked: any listed word, whole word only, any case, refuses the note.
//   done, blocked The AI reports. The error message tells it "a person must do it, post a blocked note", so the report has to be able to name the thing
//                 ("a person must pay on the payment page", "I did not delete anything", "the Cancel button is greyed out"). A listed word that is only
//                 mentioned passes. Refused: a claim it happened ("I paid", "was deleted"), a request ("please pay", "Delete the game"), intent ("I will delete it"),
//                 asking for a password or credits to be sent, and the payment provider's name.
// Reports are read word by word inside one sentence, looking at the few words before the listed word (and "by <a person>" after a past verb). That is a small,
// readable rule, not language understanding: someone can always word a request another way. Tests: core/tests/note-words.test.js, both sides.

// ---- plan and step: the strict list (whole words; unchanged from 0.4.1)
const STRICT_WORDS = ['pay', 'pays', 'paid', 'paying', 'payments?', 'payout', 'payouts', 'razor\\w*', 'credits?', 'passwords?', 'passcodes?', 'charge', 'charges', 'charged', 'charging', 'purchase', 'purchases', 'purchased', 'buy', 'buys', 'bought',
  'delete', 'deletes', 'deleted', 'deleting', 'erase', 'erased', 'erases', 'erasing', 'remove', 'removes', 'removed', 'removing', 'wipe', 'wipes', 'wiped', 'wiping', 'purge', 'purges', 'purged', 'purging', 'destroy', 'destroys', 'destroyed', 'destroying',
  'refund', 'refunds', 'refunded', 'refunding', 'reimburse', 'reimburses', 'reimbursed', 'reimbursing', 'cancel', 'cancels', 'canceled', 'cancelled', 'canceling', 'cancelling', 'cancellation',
  'transfer', 'transfers', 'transferred', 'transferring'];
const STRICT = new RegExp(`\\b(?:${STRICT_WORDS.join('|')})\\b|\\b(?:change|changes|changed|changing|update|updates|updated|updating|reset|resets|replace|replaces|replaced|replacing)\\s+(?:the\\s+|their\\s+|a\\s+|an\\s+|his\\s+|her\\s+)?(?:e-?mails?|passwords?)\\b`, 'i');

// ---- done and blocked: word forms of the verbs, and the small word sets the reading uses
const VERBS = { // base: [other forms (-s, -ing)], past: [past forms]
  pay: [['pays', 'paying'], ['paid']], charge: [['charges', 'charging'], ['charged']], purchase: [['purchases', 'purchasing'], ['purchased']], buy: [['buys', 'buying'], ['bought']],
  delete: [['deletes', 'deleting'], ['deleted']], erase: [['erases', 'erasing'], ['erased']], remove: [['removes', 'removing'], ['removed']], wipe: [['wipes', 'wiping'], ['wiped']],
  purge: [['purges', 'purging'], ['purged']], destroy: [['destroys', 'destroying'], ['destroyed']], refund: [['refunds', 'refunding'], ['refunded']], reimburse: [['reimburses', 'reimbursing'], ['reimbursed']],
  cancel: [['cancels', 'canceling', 'cancelling'], ['canceled', 'cancelled']], transfer: [['transfers', 'transferring'], ['transferred']],
};
const CHANGES = { change: [['changes', 'changing'], ['changed']], update: [['updates', 'updating'], ['updated']], reset: [['resets', 'resetting'], ['reset']], replace: [['replaces', 'replacing'], ['replaced']] }; // only when the object is an e-mail or a password
const form = (table) => { const m = new Map(); for (const [b, [other, past]] of Object.entries(table)) { m.set(b, 'base'); for (const o of other) m.set(o, 'other'); for (const p of past) if (!m.has(p)) m.set(p, 'past'); } return m; };
const VERB = form(VERBS), CHANGE = form(CHANGES);
const set = (s) => new Set(s.split(' '));
const NEG = set('not never no cannot nothing nobody none without unable neither nor');                       // "I did not pay", "nothing was deleted"
const HAND = set('person people human humans someone somebody organizer organizers co-organizer team owner admin staff support'); // handed to a person: "a person must pay"
const CLAIM = set('i we was were been has have had got already just successfully');                          // with a past verb: "I paid", "was deleted"
const REQUEST = set('please kindly lets let now then just ahead click press tap hit select choose confirm approve accept'); // "please pay", "go ahead and delete", "click Pay"
const SPEAKER = set('i we you');                                                                              // "I will delete", "you should refund"
const SUBJECT = set('i we you they it he she');                                                               // a subject starts a clause: words before it belong to another clause
const CONJ = set('and or nor');
const UI = set('button buttons link links label labels icon menu option options field box column tab page pages screen dialog text word step policy section heading title message error form list items item row panel setting settings animation');
const OBJECT = set('email emails e-mail e-mails password passwords passcode passcodes');                     // what makes change/update/reset/replace a forbidden verb
const MONEY = set('credit credits payment payments payout payouts'), SEND = set('send give top add spend wire deposit');
const SECRET = set('password passwords passcode passcodes'), SHARE = set('send share give tell type enter paste post reveal show provide copy text');

// Lower case, contractions opened up ("couldn't" -> "could not", "I'll" -> "i"), then one list of words per sentence.
const sentences = (text) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\b(i|we|you|they)'(?:ll|ve|d|m|re)\b/g, '$1').replace(/n't\b/g, ' not').replace(/'s\b/g, '')
  .split(/[.!?;:\n\r]+/).map((s) => s.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []);
const kind = (w, i) => { const t = w[i]; if (VERB.has(t)) return VERB.get(t); if (CHANGE.has(t) && w.slice(i + 1, i + 4).some((x) => OBJECT.has(x))) return CHANGE.get(t); return null; };
// The words that govern word i: up to 4 words before it in the sentence. A run of verbs joined by "or"/"and" shares what governs the first ("nothing was deleted, removed or paid").
// It stops after a subject (words before "I" or "it" belong to an earlier clause: "I did not pay and I deleted it" is a claim).
function around(w, i) {
  let j = i - 1; while (j >= 0 && (CONJ.has(w[j]) || kind(w, j))) j--;
  const out = []; for (; j >= 0 && out.length < 4; j--) { out.unshift(w[j]); if (SUBJECT.has(w[j])) break; } return out;
}
const none = (before) => !before.some((x) => NEG.has(x) || HAND.has(x));
function refusedVerb(w, i, k) {
  const before = around(w, i); if (!none(before)) return false;                                                 // negated, or handed to a person
  const after = w.slice(i + 1, i + 5); if (after.includes('by') && after.some((x) => HAND.has(x))) return false; // "cancelled by the organizer"
  const next = w[i + 1];
  if (k === 'past') return i === 0 ? !UI.has(next) : before.some((x) => CLAIM.has(x));                          // "I paid", "was deleted"; a bare "cancelled booking" is only a word
  if (before.slice(-3).some((x) => REQUEST.has(x))) return true;                                                 // "please pay", "then delete it"
  if (UI.has(next)) return false;                                                                                // "the Cancel button": a label, not an action
  return (k === 'base' && i === 0) || before.slice(-3).some((x) => SPEAKER.has(x));                              // "Delete the game.", "I will delete it", "you should refund"
}
function refusedReport(text) {
  for (const w of sentences(text)) for (let i = 0; i < w.length; i++) {
    const t = w[i], k = kind(w, i);
    if (t.startsWith('razor')) return true;                                                                      // the payment provider is never named in a note
    if (k) { if (refusedVerb(w, i, k)) return true; continue; }
    const need = MONEY.has(t) ? SEND : SECRET.has(t) ? SHARE : null;                                             // "send 500 credits", "type your password"
    if (need) { const before = around(w, i); if (none(before) && before.some((x) => need.has(x))) return true; }
  }
  return false;
}

// Returns null when the text passes, or 'forbidden_action'. Types other than the four are not decided here (the caller refuses them as bad_note).
export function checkNoteText(type, text) {
  if (typeof text !== 'string') return null;
  if (type === 'plan' || type === 'step') return STRICT.test(text) ? 'forbidden_action' : null;
  if (type === 'done' || type === 'blocked') return refusedReport(text) ? 'forbidden_action' : null;
  return null;
}
