// The word check for AI notes (0.4.2). A SECOND layer only: the scope list, checked on every call, and the product backend are the real guard (docs/DECISIONS.md).
// The check must stop plain slips (an AI that plans to pay or delete) without stopping an AI from saying WHY it stopped. Where a note runs decides how strict it is:
//   plan, step    The AI says what it will do or did. Strict, as the owner asked: any listed word, whole word only, any case, refuses the note.
//   done, blocked The AI reports. The error message tells it "a person must do it, post a blocked note", so a report has to be able to name the thing.
//                 A listed word still refuses the note UNLESS its sentence shows it is only mentioned:
//                   negated ("I did not pay"), handed to a person ("a person must pay"), reported from the page ("the page asks me to enter a password"),
//                   a screen label ("the Cancel button"), a plain noun ("the payment page", "free of charge", "refunds are handled by the team"),
//                   a describing word ("cancelled games"), how-to words ("how to cancel a seat"), an explaining "to" ("To delete a draft, open the menu"),
//                   what a thing does ("the next step would charge a card"), and, in a blocked note only, a state ("the booking was cancelled").
//                 The payment provider's name is always refused. So are a claim ("I paid", "Order refunded"), a request ("please pay", "Delete the game",
//                 "Next, pay the invoice"), intent ("I will delete it"), sending credits, and asking for "your password".
// Reports are read one clause at a time (a comma, "but" or a full stop ends a clause; a new "I" or "you" starts a new one). That is a small, readable rule, not
// language understanding: someone can always word a request another way, and a report can say something false. Tests: core/tests/note-words.test.js, both sides.

// ---- plan and step: the strict list (whole words; unchanged from 0.4.1)
const STRICT_WORDS = ['pay', 'pays', 'paid', 'paying', 'payments?', 'payout', 'payouts', 'razor\\w*', 'credits?', 'passwords?', 'passcodes?', 'charge', 'charges', 'charged', 'charging', 'purchase', 'purchases', 'purchased', 'buy', 'buys', 'bought',
  'delete', 'deletes', 'deleted', 'deleting', 'erase', 'erased', 'erases', 'erasing', 'remove', 'removes', 'removed', 'removing', 'wipe', 'wipes', 'wiped', 'wiping', 'purge', 'purges', 'purged', 'purging', 'destroy', 'destroys', 'destroyed', 'destroying',
  'refund', 'refunds', 'refunded', 'refunding', 'reimburse', 'reimburses', 'reimbursed', 'reimbursing', 'cancel', 'cancels', 'canceled', 'cancelled', 'canceling', 'cancelling', 'cancellation',
  'transfer', 'transfers', 'transferred', 'transferring'];
const STRICT = new RegExp(`\\b(?:${STRICT_WORDS.join('|')})\\b|\\b(?:change|changes|changed|changing|update|updates|updated|updating|reset|resets|replace|replaces|replaced|replacing)\\s+(?:the\\s+|their\\s+|a\\s+|an\\s+|his\\s+|her\\s+)?(?:e-?mails?|passwords?)\\b`, 'i');

// ---- done and blocked: word forms of the verbs
const VERBS = { // base: [-s and -ing forms, past forms]
  pay: [['pays', 'paying'], ['paid']], charge: [['charges', 'charging'], ['charged']], purchase: [['purchases', 'purchasing'], ['purchased']], buy: [['buys', 'buying'], ['bought']],
  delete: [['deletes', 'deleting'], ['deleted']], erase: [['erases', 'erasing'], ['erased']], remove: [['removes', 'removing'], ['removed']], wipe: [['wipes', 'wiping'], ['wiped']],
  purge: [['purges', 'purging'], ['purged']], destroy: [['destroys', 'destroying'], ['destroyed']], refund: [['refunds', 'refunding'], ['refunded']], reimburse: [['reimburses', 'reimbursing'], ['reimbursed']],
  cancel: [['cancels', 'canceling', 'cancelling'], ['canceled', 'cancelled']], transfer: [['transfers', 'transferring'], ['transferred']],
};
const CHANGES = { change: [['changes', 'changing'], ['changed']], update: [['updates', 'updating'], ['updated']], reset: [['resets', 'resetting'], ['reset']], replace: [['replaces', 'replacing'], ['replaced']] }; // only when the object is an e-mail or a password
const form = (table) => { const m = new Map(); for (const [b, [other, past]] of Object.entries(table)) { m.set(b, 'base'); for (const o of other) m.set(o, o.endsWith('ing') ? 'ing' : 's'); for (const p of past) if (!m.has(p)) m.set(p, 'past'); } return m; };
const VERB = form(VERBS), CHANGE = form(CHANGES);
const set = (s) => new Set(s.split(' '));
// Words that are nouns too: "the payment page", "free of charge", "refunds are handled by the team". A plural may also start a list: "payments and refunds are ...".
const NOUN = set('payment payments payout payouts credit credits password passwords passcode passcodes cancellation cancellations refund refunds transfer transfers charge charges purchase purchases');
const PLURAL = set('payments payouts credits passwords passcodes cancellations refunds transfers charges purchases');
const MONEY = set('credit credits payment payments payout payouts'), SECRET = set('password passwords passcode passcodes');

const SOFT = set('now then just');                                                                                    // "now pay", but also "Now the Cancel button is greyed out"
const NEG = set('not never no cannot nothing nobody none without unable neither nor');                                // "I did not pay", "nothing was deleted"
const NEG_AFTER = set('nothing nobody none never');                                                                   // "players pay nothing"
const HAND = set('person people human humans someone somebody organizer organizers co-organizer co-organizers host hosts team owner admin staff support yourself'); // handed to a person: "a person must pay"
const SAY = set('asks asked asking says said saying requires required requiring prompts prompted prompting wants wanted shows showed showing displays displayed lists listed explains explained describes described mentions mentioned states stated warns warned offers offered how'); // what the page says: "the page asks me to enter a password"; "how to ..."
const STRONG = set('please kindly lets let ahead click clicked clicking press pressed pressing tap tapped tapping hit select selected selecting choose chose chosen choosing confirm confirmed confirming approve approved approving accept accepted accepting'); // "please pay", "click Pay", "I clicked the Delete button"
const SPEAKER = set('i we you');                                                                                      // "I will delete", "you should refund"
const SUBJECT = set('i we you they it he she');                                                                       // a subject starts a clause: words before it belong to an earlier clause
const CONJ = set('and or nor');
const BREAK = set('but however although though yet while whereas');
const LEAD = set('currently now still already just then next first finally also so here there again');               // words that may stand before the first word of a clause
const ADV = set('already now also then just still');
const AUX = set('was were is are be been being');                                                                     // "the booking was cancelled", "my link was revoked and cancelled"
const MODAL = set('would will may might could can');                                                                  // what a thing does: "the next step would charge a card"
const DET = set('the a an this that these those any some no each every both all of for with by in on at from about per free my our his her its their another other more less few many several such');
const TOPIC = set('about regarding concerning');                                                                      // "a note about credits"
const PRON = set('the a an this that these those it them him her all any some my our his their its one two three four five six seven eight nine ten');  // after a past verb these make it a verb with an object: "cancelled the game"
const FUNC = set('by from to in on at with for of and or but so as is are was were be been has have had it them him her');        // not a noun: a past verb followed by one of these is not "cancelled <noun>"
const COP = set('is are was were be been needs need requires required cannot can may must should will would could might has have had does do did');
const STATE_NEXT = set('is are was were needs need requires required must can may will would should could cannot has have had due pending failed declined missing overdue low high empty zero');
const UI = set('button buttons link links label labels icon menu option options field box column tab page pages screen dialog text word step heading title message error form panel setting settings animation attention heed policy section');
const COMPOUND = set('rule rules info information help fee fees limit limits terms history log status amount balance total report receipt invoice summary details flow steps process method methods type types code number date time count mode');  // "the transfer rules", "the refund policy": only after a noun
const OBJECT = set('email emails e-mail e-mails password passwords passcode passcodes');                              // what makes change/update/reset/replace a forbidden verb
const ASK = set('complete completed completing make made making process processed processing submit submitted submitting authorize authorise confirm approve release released releasing settle send sent sending give gave given giving add added adding top top-up topup spend spent spending wire wired wiring deposit deposited depositing move moved moving grant granted granting award awarded awarding issue issued issuing allocate allocated allocating assign assigned assigning enter type paste share reveal provide supply tell use finish initiate start proceed apply redeem set email text reply ask');
const ASK_PAST = set('sent given added spent moved granted awarded issued released deposited wired topped completed processed made');  // "credits were sent to the new owner"

// Lower case, contractions opened up ("couldn't" -> "could not", "I'll" -> "i"), then one list of words per sentence. A comma stays as a word so a list can be told from a new clause.
const sentences = (text) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\b(i|we|you|they)'(?:ll|ve|d|m|re)\b/g, '$1').replace(/n't\b/g, ' not').replace(/'s\b/g, '')
  .split(/[.!?;:\n\r]+/).map((s) => s.match(/[a-z0-9]+(?:-[a-z0-9]+)*|,/g) || []);
const kind = (w, i) => { const t = w[i]; if (VERB.has(t)) return VERB.get(t); if (CHANGE.has(t) && w.slice(i + 1, i + 6).some((x) => OBJECT.has(x))) return CHANGE.get(t); return null; };
const listed = (w, i) => !!kind(w, i) || NOUN.has(w[i]);
// The words that govern word i: back to the start of its clause (a comma, "but" and the like end a clause), and no further back than the nearest subject, which starts a clause too.
// A run of listed words joined by "or", "and" or commas shares what governs the first ("nothing was deleted, removed or paid").
function around(w, i) {
  let j = i - 1;
  for (;;) { if (j >= 0 && (CONJ.has(w[j]) || listed(w, j))) j--; else if (j > 0 && w[j] === ',' && (CONJ.has(w[j - 1]) || listed(w, j - 1))) j--; else break; }
  const out = []; for (; j >= 0; j--) { const t = w[j]; if (t === ',' || BREAK.has(t)) break; out.unshift(t); if (SUBJECT.has(t)) break; } return out;
}
const clauseStart = (w, i) => { let j = i - 1; while (j >= 0 && LEAD.has(w[j])) j--; return j < 0 || w[j] === ',' || BREAK.has(w[j]); };
const numeric = (t) => /^\d+$/.test(t || '');
// "was", "were", "is", "are", "been" before a past word, even through "and", an adverb or another past word: a passive, so a state.
function passive(w, i) { let j = i - 1; while (j >= 0 && (CONJ.has(w[j]) || ADV.has(w[j]) || /ed$/.test(w[j]) || listed(w, j))) j--; return j >= 0 && AUX.has(w[j]); }

// Is the listed word at w[i] refused? type: 'done' or 'blocked'.
function refusedAt(w, i, type) {
  const t = w[i];
  if (t.startsWith('razor')) return true;                                                                         // the payment provider is never named in a note
  const k = kind(w, i); if (!k && !NOUN.has(t)) return false;
  const before = around(w, i), next = w[i + 1], prev = w[i - 1], after = w.slice(i + 1, i + 5), start = clauseStart(w, i);
  if (before.some((x) => NEG.has(x) || HAND.has(x) || SAY.has(x))) return false;                                  // negated, handed to a person, or what the page says
  if (after.slice(0, 2).some((x) => NEG_AFTER.has(x)) || (after.includes('by') && after.some((x) => HAND.has(x))) || after.includes('yourself')) return false; // "pay nothing", "cancelled by the organizer", "enter the password yourself"
  const strong = before.some((x) => STRONG.has(x));
  if ((UI.has(next) || (NOUN.has(t) && COMPOUND.has(next)) || (numeric(next) && UI.has(w[i + 2]))) && !strong) return false; // "the Cancel button", "the refund policy", "pay attention": a label or an idiom
  if (TOPIC.has(prev) || TOPIC.has(w[i - 2])) return false;                                                       // "a note about credits"
  const asked = before.slice(-5).some((x) => ASK.has(x) || STRONG.has(x));
  if (k === 'past') {
    const noun = next && !PRON.has(next) && !FUNC.has(next) && next !== ',' && !BREAK.has(next) && !numeric(next);
    if ((DET.has(prev) || numeric(prev) || start) && noun) return false;                                           // "a cancelled booking", "Cancelled games are hidden"
    if (type === 'blocked' && passive(w, i)) return false;                                                        // "the booking was cancelled": why it is blocked
    if ((prev === 'have' || prev === 'has' || prev === 'had') && !before.some((x) => SPEAKER.has(x) && x !== 'you')) return false; // "12 players have paid": about others
    return true;                                                                                                   // "I paid", "was deleted" in a done note, "Done, deleted the game", "Order refunded"
  }
  if (SECRET.has(t) && before.includes('your')) return true;                                                      // "What is your password?": the AI never asks for one
  if (NOUN.has(t)) {                                                                                              // a plain noun mention
    const verbal = prev === 'to' || MODAL.has(prev) || SPEAKER.has(prev) || SOFT.has(prev) || prev === 'should' || prev === 'must';  // "to refund", "will refund", "I refund", "now refund": used as a verb
    if (MONEY.has(t) && after.slice(0, 3).some((x) => ASK_PAST.has(x))) return true;                              // "Credits were sent to the new owner"
    if (!asked && prev !== undefined && !verbal && !(k === 'base' && start)) return false;                        // "the payment page", "the card payment", "free of charge", "payments and refunds"
    if (!asked && start && PLURAL.has(t) && !PRON.has(next)) return false;                                         // "Credits are low", "Refunds take 5 days", "Refunds and cancellations are handled by the team"
    if (!asked && start && STATE_NEXT.has(next)) return false;                                                     // "Payment required"
  }
  if (k === 'ing' && start && COP.has(next)) return false;                                                         // "Deleting is not allowed"
  if (before.slice(-2).join(' ') === 'how to' || (prev === 'to' && /^(?:how|step|steps|way|ways|instructions|guide)$/.test(w[i - 2] || ''))) return false; // "how to cancel a seat", "steps to delete a draft"
  if (prev === 'to' && clauseStart(w, i - 1) && (k === 'base' || k === 'ing')) return false;                      // "To delete a draft, open the menu": a reason, not an order
  if (MODAL.has(prev) && !before.some((x) => SPEAKER.has(x))) return false;                                       // "the next step would charge a card", "players can cancel"
  return true;                                                                                                    // a request ("please pay"), intent ("I will delete"), a claim, "Deleting the game now"
}
function refusedReport(text, type) {
  for (const w of sentences(text)) for (let i = 0; i < w.length; i++) if (refusedAt(w, i, type)) return true;
  return false;
}

// Returns null when the text passes, or 'forbidden_action'. Types other than the four are not decided here (the caller refuses them as bad_note).
export function checkNoteText(type, text) {
  if (typeof text !== 'string') return null;
  if (type === 'plan' || type === 'step') return STRICT.test(text) ? 'forbidden_action' : null;
  if (type === 'done' || type === 'blocked') return refusedReport(text, type) ? 'forbidden_action' : null;
  return null;
}
