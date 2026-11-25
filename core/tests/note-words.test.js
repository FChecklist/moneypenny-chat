// 0.4.2 fix 2: the word check for AI notes is precise. Before 0.4.2 every note type was scanned for the plain words (pay, delete, remove, cancel, password ...)
// anywhere in the text. So an AI that hit a payment page and posted the `blocked` note the error message tells it to post
// ("Tell the organizer a person must do it. Post a blocked note.") was refused again when that note said what it could not do: the AI could not report at all.
// Now: plan and step stay strict (the owner's rule: they say what the AI will do or did); done and blocked are reports. A listed word still refuses a report unless
// its sentence shows it is only mentioned (negated, handed to a person, reported from the page, a screen label, a plain noun, how-to words, what a thing does, and in a
// blocked note a state). A claim, a request, intent, sending credits, asking for "your password" and the payment provider's name are refused.
// Both sides are tested here, on lists of wordings. The lists hold what the check is meant to do; what it still gets wrong is written in docs/DECISIONS.md (round 7).
import { test, expect } from 'bun:test';
import { makeEnv, STORES } from './helpers.js';
import { sha256hex } from '../src/crypto.js';
import { checkNoteText } from '../src/noterules.js';

// Reports that must pass in done AND blocked: the word is only mentioned, negated, handed to a person, said by the page, a label, a plain noun or a how-to.
const REPORT_OK = [
  "Blocked: the payment page needs a person to pay. I did not pay anything.",
  "I am blocked. The Delete button is the only way on, and a person must press it.",
  "I cannot delete the game. A person must do it.",
  "I couldn't remove the filter, so the page is blocked.",
  "Blocked by a cancelled booking on the screen.",
  "The Cancel button is greyed out, so I stopped.",
  "Nothing was deleted, removed or paid.",
  "The page asks for a password. I did not type it. A person must sign in.",
  "Stopped here: the next step would charge a card, which only a person may do.",
  "Blocked: refunds and cancellations are handled by the team.",
  "The transfer page is blocked for this role.",
  "Blocked: the Remove link does nothing.",
  "A person must change the password on the account page.",
  "It says free of charge, so no payment is due.",
  "The wipe animation is slow, nothing else is wrong.",
  "Done: the Pay column is sorted by date.",
  "Blocked: the game was already cancelled by the organizer.",
  "Done. I read the screen and wrote down the steps. Nothing was changed.",
  "Blocked: the Credits page is empty for this account.",
  "I did not click Pay.",
  "I could not press the Delete button.",
  "I looked at the Cancel button.",
  "I read the Delete button label.",
  "Done. A person paid the bill.",
  "Done: the bill was paid by the organizer.",
  "I will not delete anything.",
  "The remove option is missing for co-organizers.",
  "Blocked: the login page asks to enter a password.",
  "The login page asks me to enter a password, so I stopped.",
  "I cannot continue because the page asks to enter a password.",
  "Blocked. The page shows a field to type a password.",
  "Now the Cancel button is greyed out.",
  "Then the Delete button appears.",
  "It is just a Cancel button.",
  "Done. I reset the filters on the table.",
  "Done: I changed the date filter to May.",
  "Done. I paid attention to the layout.",
  "Done: nothing was paid, the page only shows a total.",
  "The page has removed the banner after I scrolled.",
  "The charge is 5 credits per player.",
  "The charge shown is 5 credits.",
  "Done. The credits page shows 20 credits.",
  "Done. I will add a note about credits to the summary.",
  "Give an overview: credits are shown at the top.",
  "I read the page. It says to send a message to the team.",
  "Blocked. I tried to open the payment page, but it needs a person.",
  "Blocked: please ask a person to sign in.",
  "Blocked: the form wants a password and I do not have one.",
  "Blocked: the form wants a password; I do not have one. Please sign in first.",
  "Blocked: please sign in and enter the password yourself.",
  "Blocked: sign in first, then I can read the screen.",
  "Blocked. The player list is empty, so there is nothing to remove.",
  "Done. There is nothing to cancel.",
  "Blocked: the Pay page needs a person.",
  "Blocked: I do not have permission to pay.",
  "Blocked: only the organizer can pay.",
  "Done: the page lists who has paid.",
  "Done: the page shows who paid.",
  "Done: the report shows 5 paid and 3 unpaid.",
  "Done. 12 players have paid.",
  "Done: the list shows the cancelled games.",
  "Done: the list of cancelled games is empty.",
  "Done. I found 2 deleted games in the list.",
  "Done: the page lists deleted games.",
  "Blocked: the event has been deleted by the organizer.",
  "Done. The ticket text says: player cannot join. I wrote the steps.",
  "Blocked: the page timed out and the session was reset.",
  "Blocked: the session was reset, so I stopped.",
  "Done. Players can cancel their seat from the list.",
  "Done: a player can cancel on the seat page.",
  "Done: I explained how to cancel a seat.",
  "Done. I explained how to delete a draft.",
  "Done: the steps to delete a draft are on the help page.",
  "Blocked: to reset the password, a person must open the account page.",
  "Done: to change the email, a person opens Settings.",
  "Done: I explained how to change the password on the Settings page.",
  "Done: to change the password, open Settings.",
  "Blocked: to cancel the game a person opens the game menu.",
  "Blocked: the refund policy is not on the page.",
  "Done. The refund policy says refunds take 5 days.",
  "Done: refunds take 5 days.",
  "Done: the page says refunds are not possible.",
  "Done: it explains how to get a refund.",
  "Done: how to ask for a refund is on the help page.",
  "Done. It is not possible to get a refund after the game.",
  "Done: the transfer rules are on the help page.",
  "Done. Transfers are not allowed after the start.",
  "Done: the page explains who can transfer a seat.",
  "Blocked: the seat can be transferred only by the organizer.",
  "Done: seats can be transferred by the organizer.",
  "Done: seats can be transferred by the team.",
  "Done: the credits are shown in the header.",
  "Done: credits are shown next to each name.",
  "Blocked: credits are low.",
  "Blocked: 5 credits are needed.",
  "Done: each game costs 5 credits.",
  "Done. A game costs 5 credits to host.",
  "Done: the host pays 5 credits per game.",
  "Done. The host pays per game, the page says.",
  "Done: players do not pay.",
  "Done: players pay nothing.",
  "Done: players can pay on the day.",
  "Blocked: the host must pay first.",
  "Blocked: the organizer must pay first.",
  "Blocked: the organizer should pay the fee.",
  "Blocked: ask the organizer to pay the fee.",
  "Blocked: a person needs to pay for credits.",
  "Blocked: a person needs to top up credits.",
  "Blocked: out of credits. A person needs to buy credits.",
  "Blocked: the organizer has to buy more credits.",
  "Blocked: I need more credits, which a person must add.",
];
// Reports that pass in a BLOCKED note only: a state is why the AI stopped ("the booking was cancelled"). In a done note the same words read as a claim.
const REPORT_STATE = [
  "Blocked: my access to the game was removed.",
  "Blocked because the payment was cancelled by the bank.",
  "Blocked: the card payment was declined and the order was cancelled.",
  "The page was deleted from the menu.",
  "Done. The game was cancelled earlier, so I read the log.",
  "Blocked: the game has been cancelled.",
  "Blocked: this game was cancelled, so no steps apply.",
  "Blocked: the event was cancelled.",
  "Blocked: the ticket was deleted.",
  "Blocked: the ticket has been erased.",
  "Done. I got the list and it was removed from view.",
  "Blocked: I was removed from the game.",
  "Blocked: my link was cancelled.",
  "Blocked: my link was revoked and cancelled.",
  "Blocked: the key was removed.",
  "Blocked: the key has expired and was removed.",
  "Done: the hint was removed after the first try.",
  "The game is deleted.",
  "Ownership was transferred.",
  "The game was deleted.",
];
// Reports that must be refused in done AND blocked: a claim, a request, intent, sending credits, asking for a password, the provider.
const REPORT_BAD = [
  "I paid the bill.",
  "I deleted the game.",
  "Razorpay was used.",
  "Please pay now.",
  "Delete the game.",
  "Pay 500 credits to continue.",
  "I will delete it.",
  "You should refund the order.",
  "Cancelled the game.",
  "Please type your password here.",
  "Send 500 credits to the account.",
  "Please change the password.",
  "I changed the password.",
  "Then update their email address.",
  "Transfer the credits to a new owner.",
  "I removed the player and then wiped the list.",
  "You can pay later.",
  "Go ahead and delete it.",
  "We purchased more credits.",
  "Charge the card now.",
  "I'll cancel the booking.",
  "Done. Razorpay link sent.",
  "I am deleting the old games.",
  "Share the password with me.",
  "Blocked, so please remove the player.",
  "Click Pay to finish.",
  "Press Delete to continue.",
  "I clicked Pay.",
  "I clicked the Delete button.",
  "I pressed the Pay button and confirmed.",
  "Then I selected Cancel game.",
  "I cannot continue, please pay the invoice.",
  "Cannot continue, please pay the bill.",
  "No worries, please pay now.",
  "No other way, delete the game.",
  "Not sure, but please delete the game.",
  "Nothing else works, so please refund the order.",
  "Stuck, so cancel the booking now.",
  "It did not work, so you should pay.",
  "I couldn't continue, please delete the game.",
  "Without it I am blocked, please cancel the game.",
  "No reply yet, send 500 credits to the account.",
  "Done, deleted the game.",
  "Done - deleted the game.",
  "Done, refunded the order.",
  "Game deleted.",
  "Order refunded.",
  "Player removed.",
  "Account cancelled.",
  "Deleting the game now.",
  "Currently deleting the game.",
  "Paying the bill now.",
  "Cancelling the booking.",
  "Refunding the order.",
  "Time to delete the game.",
  "Next, delete the game.",
  "Then pay the invoice.",
  "Go on and pay.",
  "The next step is to pay the invoice.",
  "The next step is to delete the game.",
  "Step two: delete the game.",
  "It deletes the game.",
  "They refunded the order.",
  "He paid the bill.",
  "She cancelled the game.",
  "Sent 500 credits to the account.",
  "Sending 500 credits now.",
  "Credits were sent to the new owner.",
  "Make a payment of 500 credits.",
  "Complete the payment now.",
  "Confirm the payment.",
  "Approve the payout.",
  "Release the payout to the new account.",
  "Grant 500 credits to the account.",
  "Award 500 credits to the new owner.",
  "Credit the account with 500.",
  "Issue 500 credits.",
  "Allocate 500 credits to the new owner.",
  "Payment made.",
  "Payment of 500 credits completed.",
  "Pay up.",
  "Make the payment.",
  "Top-up the wallet with 500 credits.",
  "Pay with Paytm.",
  "Razor pay link sent.",
  "RAZORPAY was used.",
  "What is your password?",
  "I need your password to continue.",
  "Reply with the password.",
  "Supply the password.",
  "Submit the passcode.",
  "Your password please.",
  "Ask the player for the password.",
  "Log in with your password.",
  "Use the password swordfish to continue.",
  "Set a new password.",
  "Update the account holder email address.",
  "Change the primary contact e-mail.",
  "Change the account holder password.",
  "Change your sign-in password.",
  "Please change your password now.",
  "Change the log in password.",
  "Transfer ownership to me.",
  "Move 500 credits to the new account.",
];
// Plan and step: strict, as before, whole words only.
const STRICT_BAD = ['Refund the order', 'CANCEL the game', 'Please Remove the player', 'wipe all data', 'purge the list', 'destroy the record', 'transfer the credits to a new owner', 'Transferred it', 'Then change the e-mail on the account', 'change email now', 'update their password', 'reset the password',
  'Charge the card', 'buy more', 'Payout is due', 'Razorpay link', 'cancelled', 'refunds', 'The Cancel button is greyed out', 'A person must pay', 'I did not delete anything'];
const STRICT_OK = ['Open the settings page', 'The overpayment label is blue', 'Transferable seats list', 'Check the email box layout', 'The payload is empty', 'Removable seats are listed', 'Credited seats are blue', 'Read the ticket and the screen', 'Change the date to the 5th.', 'Blocked rows are grey', 'The page is blocked by an overlay'];

test('reports (done, blocked): a listed word that is only mentioned, negated, handed to a person, said by the page or a screen label passes', () => {
  for (const type of ['done', 'blocked']) for (const t of REPORT_OK) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, null]);
});
test('reports: a state ("the booking was cancelled") passes in a blocked note, and reads as a claim in a done note', () => {
  for (const t of REPORT_STATE) { expect(['blocked', t, checkNoteText('blocked', t)]).toEqual(['blocked', t, null]); expect(['done', t, checkNoteText('done', t)]).toEqual(['done', t, 'forbidden_action']); }
});
test('reports (done, blocked): a claim, a request, intent, credits to be sent, asking for a password, or the payment provider is still refused', () => {
  for (const type of ['done', 'blocked']) for (const t of REPORT_BAD) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, 'forbidden_action']);
});
test('reports: a new clause after a comma is judged on its own, so "I cannot ... , please pay" and "No worries, please pay now" are requests; a list shares one "nothing was deleted, removed or paid"', () => {
  for (const type of ['done', 'blocked']) {
    for (const t of ['I cannot continue, please pay the invoice.', 'No worries, please pay now.', 'Not sure, but please delete the game.', 'I did not pay and I deleted it.', 'Stuck, so cancel the booking now.']) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, 'forbidden_action']);
    for (const t of ['Nothing was deleted, removed or paid.', 'I did not pay, delete or cancel anything.', 'A person must pay, and I stopped.']) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, null]);
  }
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
