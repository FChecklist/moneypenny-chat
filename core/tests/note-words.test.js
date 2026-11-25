// 0.4.2 fix 2: the word check for AI notes is precise. Before 0.4.2 every note type was scanned for the plain words (pay, delete, remove, cancel, password ...)
// anywhere in the text. So an AI that hit a payment page and posted the `blocked` note the error message tells it to post
// ("Tell the organizer a person must do it. Post a blocked note.") was refused again when that note said what it could not do: the AI could not report at all.
// Now: plan and step stay strict (the owner's rule: they say what the AI will do or did); done and blocked are reports, where a forbidden word may be MENTIONED,
// and only a claim ("I paid"), a request ("please pay"), intent ("I will delete it"), sharing a password, sending credits, or the payment provider's name is refused.
// Both sides are tested here: ordinary reports pass, and real abuse is still refused.
import { test, expect } from 'bun:test';
import { makeEnv, STORES } from './helpers.js';
import { sha256hex } from '../src/crypto.js';
import { checkNoteText } from '../src/noterules.js';

// Reports that must pass: the word is only mentioned, negated, handed to a person, or is the label of something on the screen.
const REPORT_OK = [
  'Blocked: the payment page needs a person to pay. I did not pay anything.',
  'I am blocked. The Delete button is the only way on, and a person must press it.',
  'I cannot delete the game. A person must do it.',
  "I couldn't remove the filter, so the page is blocked.",
  'Blocked by a cancelled booking on the screen.',
  'The Cancel button is greyed out, so I stopped.',
  'Nothing was deleted, removed or paid.',
  'The page asks for a password. I did not type it. A person must sign in.',
  'Stopped here: the next step would charge a card, which only a person may do.',
  'Blocked: refunds and cancellations are handled by the team.',
  'The transfer page is blocked for this role.',
  'Blocked: the Remove link does nothing.',
  'A person must change the password on the account page.',
  'It says free of charge, so no payment is due.',
  'The wipe animation is slow, nothing else is wrong.',
  'Done: the Pay column is sorted by date.',
  'Blocked: the game was already cancelled by the organizer.',
  'Done. I read the screen and wrote down the steps. Nothing was changed.',
  'Blocked: the Credits page is empty for this account.', 'I did not click Pay.', 'I could not press the Delete button.',
  'The remove option is missing for co-organizers.',
];
// Reports that must be refused: a claim, a request, intent, a password or credits to be sent, or the provider.
const REPORT_BAD = [
  'I paid the bill.', 'I deleted the game.', 'Razorpay was used.', 'Please pay now.', 'Delete the game.', 'Pay 500 credits to continue.', 'I will delete it.',
  'You should refund the order.', 'The game was deleted.', 'Cancelled the game.', 'Please type your password here.', 'Send 500 credits to the account.', 'Please change the password.',
  'I changed the password.', 'Then update their email address.', 'Transfer the credits to a new owner.', 'I removed the player and then wiped the list.', 'You can pay later.',
  'Go ahead and delete it.', 'We purchased more credits.', 'Charge the card now.', "I'll cancel the booking.", 'Done. Razorpay link sent.', 'I am deleting the old games.',
  'Share the password with me.', 'Blocked, so please remove the player.', 'Click Pay to finish.', 'Press Delete to continue.', 'I clicked Pay.',
];
// Plan and step: strict, as before, whole words only.
const STRICT_BAD = ['Refund the order', 'CANCEL the game', 'Please Remove the player', 'wipe all data', 'purge the list', 'destroy the record', 'transfer the credits to a new owner', 'Transferred it', 'Then change the e-mail on the account', 'change email now', 'update their password', 'reset the password',
  'Charge the card', 'buy more', 'Payout is due', 'Razorpay link', 'cancelled', 'refunds', 'The Cancel button is greyed out', 'A person must pay', 'I did not delete anything'];
const STRICT_OK = ['Open the settings page', 'The overpayment label is blue', 'Transferable seats list', 'Check the email box layout', 'The payload is empty', 'Removable seats are listed', 'Credited seats are blue', 'Read the ticket and the screen', 'Change the date to the 5th.', 'Blocked rows are grey', 'The page is blocked by an overlay'];

test('reports (done, blocked): a forbidden word that is only mentioned, negated, handed to a person or a screen label passes', () => {
  for (const type of ['done', 'blocked']) for (const t of REPORT_OK) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, null]);
});
test('reports (done, blocked): a claim, a request, intent, a password or credits to be sent, or the payment provider is still refused', () => {
  for (const type of ['done', 'blocked']) for (const t of REPORT_BAD) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, 'forbidden_action']);
});
test('plan and step stay strict (whole words, any case): every real-abuse sample is refused, ordinary words that only contain a listed word pass', () => {
  for (const type of ['plan', 'step']) {
    for (const t of STRICT_BAD) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, 'forbidden_action']);
    for (const t of STRICT_OK) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, null]);
  }
});
test('whole word only: a listed word inside a longer word never counts, in any type', () => {
  for (const type of ['plan', 'step', 'done', 'blocked']) for (const t of ['Please open the payload view.', 'I read the repayments label.', 'Transferable and removable seats.', 'The deletedAt column is hidden.', 'The cancelable flag is off.', 'Overcharged seats look red.'])
    expect([type, t, checkNoteText(type, t)]).toEqual([type, t, null]);
});
test('an unknown type or a non-string is not decided here (the caller refuses it as bad_note)', () => {
  expect(checkNoteText('wish', 'Pay now')).toBeNull(); expect(checkNoteText('blocked', 5)).toBeNull();
});

for (const store of Object.keys(STORES)) {
  const T0 = 1_800_000_000_000, K = 'mpk_' + 'k'.repeat(40);
  async function rig() { const c = { t: T0 }, e = makeEnv({ store, now: () => c.t }); e.clock = c; await e.call('POST', '/v1/ai-links', { screen: '/', scopes: ['read_ticket', 'report'], key_hash: await sha256hex(K), product_key_id: 'pk1' }); return e; }
  const note = async (e, type, text) => { e.clock.t += 1000; const r = await e.ai('POST', '/v1/ai/notes', { k: K, body: { type, text } }); return { status: r.status, body: await r.json() }; };

  test(`[${store}] the loop the error message creates: the AI is refused for a plan to pay, posts the blocked note it was told to post, and that note is accepted`, async () => {
    const e = await rig();
    const bad = await note(e, 'plan', 'Pay the bill with a card'); expect(bad.status).toBe(403); expect(bad.body.error).toBe('forbidden_action');
    expect(bad.body.next).toBe('Tell the organizer a person must do it. Post a blocked note.'); // the next step the AI is given
    const ok = await note(e, 'blocked', 'A person must pay the bill. I did not pay or delete anything.'); expect(ok.status).toBe(201); // before 0.4.2: 403 again, and the AI could not report at all
    expect((await e.store.listNotes((await e.store.getLinkByHash(await sha256hex(K))).id)).map((n) => n.type)).toEqual(['blocked']);
  });
  test(`[${store}] through the API: ordinary blocked and done reports are accepted; claims, requests and the provider are refused; plan and step are strict`, async () => {
    for (const type of ['blocked', 'done']) {
      const e = await rig(); const ok = await note(e, type, 'The Cancel button is greyed out and the payment page needs a person.'); expect([type, ok.status]).toEqual([type, 201]);
    }
    for (const [type, text] of [['blocked', 'I paid the bill.'], ['done', 'Please delete the game.'], ['blocked', 'Razorpay was used.'], ['plan', 'The Cancel button is greyed out'], ['step', 'Open the payment page'], ['plan', 'Pay now']]) {
      const e = await rig(); const r = await note(e, type, text); expect([type, text, r.status, r.body.error]).toEqual([type, text, 403, 'forbidden_action']);
    }
  });
}
