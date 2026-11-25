// 0.4.4 (round 9): deny by default. For a done, blocked, plan or step note the text is made plain (NFKC, zero-width characters removed, lower case) and the note is REFUSED
// if it holds ANY listed action word, whatever the negation, "and", comma, hand-off or sentence shape. Only a thing-noun right before a screen label ("payment page") passes.
// Natural reports that hold a listed word are refused too (accepted cost, listed in docs/DECISIONS.md): the AI can reword. Both sides are tested on tables.
import { test, expect } from 'bun:test';
import { makeEnv, STORES } from './helpers.js';
import { sha256hex } from '../src/crypto.js';
import { checkNoteText } from '../src/noterules.js';

const TYPES = ['done', 'blocked', 'plan', 'step'];
const all = (list, want) => { for (const type of TYPES) for (const t of list) expect([type, t, checkNoteText(type, t)]).toEqual([type, t, want]); };

// Refused in every type, whatever else the sentence says.
const REFUSED = [
  // round 8 bypasses: a negation, "and", "no problem" or a hand-off in front of a request
  'Nothing failed and deleted the game', 'Nothing to report and wiped the data', 'No change needed and refunded the order', 'Not a problem and cancelled the booking',
  'No problem delete the game', 'Not sure delete the game', 'The organizer is away and deleted the game', 'I cannot wait to delete the game', 'Someone says delete the game',
  'The page says delete the game', 'The team must send 500 credits', 'Ask the organizer to send 500 credits', 'Delete page', 'About to pay',
  'de\u200Blete the game', '\uFF24elete the game',
  // round 7 bypasses and older samples
  'Nothing failed, deleted the game', 'Cannot wait, delete the game', 'Not done: paid the invoice', 'The booking was cancelled', 'Delete the game yourself',
  'I paid the bill.', 'Razorpay was used.', 'Please pay now.', 'Pay 500 credits to continue.', 'I did not pay anything.', 'A person must pay.', 'Click Pay to finish.',
  'Please type your password here.', 'Change the e-mail on the account', 'Refund the order', 'Transfer the credits to a new owner', 'Order refunded.', 'RAZORPAY link', 'de-lete the game', 'Top-up the wallet',
  'Please pay', 'The Cancel button is greyed out', 'Transferred it', 'pay-per-view was used', 'Stuck, so cancel the booking now.',
  // 0.4.5: seven more verbs a review named (the list stays a closed list: a second layer, see docs/DECISIONS.md round 10)
  'Discard the draft', 'Trash the picture', 'Unsubscribe the person', 'Refill the balance', 'Recharge the wallet', 'Donate now', 'Fund the account',
];
// Passes in every type: a plain report of what was seen or what is waiting.
const PASSES = [
  'The page did not load', 'Waiting for a person to decide', 'The form shows an error', 'Paused: the picture upload failed', 'Payment page did not load', 'The credits page is empty',
  'The screen is blank', 'Paused', 'Waiting for the organizer', 'The link looks old', 'The session ended', 'I read the screen and wrote down what I saw', 'Nothing happened after a minute',
  'The upload bar stays at half', 'Opened the page and looked at the picture', 'The step is not clear', 'A red box shows on the form', 'The page is slow', 'I see two buttons on the screen',
  'Stuck here, the picture upload failed', 'The password page did not load', 'The refund screen is empty', 'The transfer page is blocked', 'The payout form shows an error',
  'The page has a long title', 'It took a long time to open the page', 'A person needs to look at this', 'The organizer has not answered yet', 'The game name is on the first screen',
  'The overpayment label is blue', 'The payload is empty', 'Removable seats are listed', 'The deletedAt column is hidden', 'The cancelable flag is off', 'Overcharged seats are blue',
  'The list has a payment link', 'The picture upload step failed',
  // 0.4.5: ordinary honest reports, longer ones, numbers, two sentences, punctuation (a review found the list too thin)
  'I read the screen. The title says Games and there are 12 players in the list.', 'The page opened in 3 seconds and the board shows 90 numbers.',
  'Waiting: the organizer page is still loading, 2 of 4 panels are visible.', 'The picture looks blurry; the numbers 1 to 90 are in a grid.',
  'No error on the screen, but the button stays grey after 10 seconds.', 'Looked at the help page. It lists 6 topics and none of them matches.',
  'The ticket number is on the first line and the status says open.', 'I opened the second tab and the list had 4 rows: 2 marked, 2 empty.',
  'The board did not change for a minute, so I am pausing here.', 'The screen shows "Game not found" in red.', 'Stopped after step 3 of 5 because the next page is blank.',
  'Step 2 done: the list was visible and I counted 7 names.', 'The help answer is clear and short. Nothing else to report.', 'It is 9:30 and the page still shows the old title.',
  'Reached the end of the page. The footer has a version line.', 'The same error shows on every screen I looked at.', 'Caf\u00E9 menu page did not load',
];
test('refused in done, blocked, plan and step: any listed word, wherever it stands (' + REFUSED.length + ' wordings)', () => { expect(REFUSED.length).toBeGreaterThanOrEqual(30); all(REFUSED, 'forbidden_action'); });
test('passes in done, blocked, plan and step: plain reports and words that only contain a listed word (' + PASSES.length + ' wordings)', () => { expect(PASSES.length).toBeGreaterThanOrEqual(30); expect(REFUSED.length + PASSES.length).toBeGreaterThanOrEqual(60); all(PASSES, null); });
test('the allow-list is only a thing-noun right before a screen label: "payment page" passes, "pay now", "delete the game" and "delete page" do not', () => {
  all(['payment page', 'Credits screen', 'the refund form', 'password link'], null);
  all(['pay now', 'delete the game', 'delete page', 'payment now'], 'forbidden_action');
});
test('endings and spelling tricks: -s -ed -ing, irregular words, hyphens, zero-width and full-width letters', () => {
  all(['deletes', 'deleting', 'refunding', 'cancelling', 'canceled', 'bought', 'sent it', 'giving', 'removed', 'Pa\u200By', '\uFF30ay', 'wi-ped', 'e-mail'], 'forbidden_action');
});
// 0.4.5: look-alike letters. NFKC folds full-width letters but not Cyrillic or Greek ones that look the same, so a note spelled with them used to have no listed word to find.
test('0.4.5 a letter of another script is refused in every type: Cyrillic look-alikes of "pay" and "delete", Greek, Devanagari; an accented Latin letter passes', () => {
  all(['\u0440\u0430\u0443 now', 'p\u0430y now', 'd\u0435lete the game', '\u0440ay the bill', '\u03C1ay now', 'The page says \u0928\u092E\u0938\u094D\u0924\u0947', '\u0440\u0430\u0443'], 'forbidden_action');
  all(['Caf\u00E9 menu page did not load', 'The page says r\u00E9sum\u00E9', 'It costs \u20B9 500 on the screen label'], null);
});
// 0.4.6: accents. "d\u00E9lete" used to split into the words "d" and "lete" and pass; the accents are folded off now, and a Latin letter with no plain form is refused.
test('0.4.6 an accented look-alike of a listed word is read as the word, and a letter with no plain form is refused', () => {
  all(['d\u00E9lete the game', 'p\u00E0yment now', 'r\u00E9fund the order', 'Pa\u0301y now', 'canc\u00E9l it', 'delete th\u0131s', 'pay n\u00F8w'], 'forbidden_action');
  all(['The Caf\u00E9 page did not load', 'No\u00EBl screen is blank'], null);
});
test('an unknown type or a non-string is not decided here (the caller refuses it as bad_note)', () => {
  expect(checkNoteText('wish', 'Pay now')).toBeNull(); expect(checkNoteText('blocked', 5)).toBeNull();
});

// ---- the sentences the reviews named
// Round 9 bypasses: each of these passed the 0.4.3 clause reading ("and", "no problem", a hand-off or a far negation in front). These fail on the old code.
test('0.4.4 round 8 bypasses ("and", "no problem", "the organizer is away and ...") are refused', () => {
  all(['Nothing failed and deleted the game', 'Nothing to report and wiped the data', 'No change needed and refunded the order', 'Not a problem and cancelled the booking',
    'No problem delete the game', 'Not sure delete the game', 'The organizer is away and deleted the game', 'I cannot wait to delete the game', 'The page says delete the game', 'Ask the organizer to send 500 credits'], 'forbidden_action');
});
// COVERAGE ONLY: these five were already refused by the 0.4.3 code and still are; they stay so the round 7 findings cannot come back.
test('coverage only (also passed on 0.4.3): the round 7 sentences are still refused', () => {
  all(['Nothing failed, deleted the game', 'Cannot wait, delete the game', 'Not done: paid the invoice', 'the booking was cancelled', 'Delete the game yourself'], 'forbidden_action');
});

for (const store of Object.keys(STORES)) {
  const T0 = 1_800_000_000_000, K = 'mpk_' + 'k'.repeat(40);
  async function rig() { const c = { t: T0 }, e = makeEnv({ store, now: () => c.t }); e.clock = c; await e.call('POST', '/v1/ai-links', { screen: '/', scopes: ['read_ticket', 'report'], key_hash: await sha256hex(K), product_key_id: 'pk1' }); return e; }
  const note = async (e, type, text) => { e.clock.t += 1000; const r = await e.ai('POST', '/v1/ai/notes', { k: K, body: { type, text } }); return { status: r.status, body: await r.json() }; };

  test(`[${store}] the loop the error message creates: the AI is refused, is told how to reword, posts a plain blocked note, and that note is accepted`, async () => {
    const e = await rig();
    const bad = await note(e, 'plan', 'Pay the bill with a card'); expect(bad.status).toBe(403); expect(bad.body.error).toBe('forbidden_action');
    expect(bad.body.next).toContain('paused'); expect(bad.body.next).toContain('waiting for a person to decide'); expect(bad.body.next).toContain('the page did not load'); // how to reword
    const same = await note(e, 'blocked', 'A person must pay the bill. I did not pay anything.'); expect(same.status).toBe(403); // naming the action again is refused, even negated
    const ok = await note(e, 'blocked', 'Paused: waiting for a person to decide.'); expect(ok.status).toBe(201);
    expect((await e.store.listNotes((await e.store.getLinkByHash(await sha256hex(K))).id)).map((n) => n.type)).toEqual(['blocked']);
  });
  test(`[${store}] through the API: plain reports are accepted in all four types; any listed word is refused`, async () => {
    // 0.4.5: every type goes through the same call with several honest wordings (a review found one wording and 8 refusals too thin) and every type is refused on several listed words
    const HONEST = ['The payment page did not load.', 'I read the screen. The title says Games and there are 12 players in the list.', 'Stopped after step 3 of 5 because the next page is blank.', 'Waiting for a person to decide.'];
    for (const type of ['blocked', 'done', 'plan', 'step']) for (const text of HONEST) { const e = await rig(); const ok = await note(e, type, text); expect([type, text, ok.status]).toEqual([type, text, 201]); }
    // 0.4.6: the note is made plain BEFORE the link and secret checks and is stored in that form
    for (const text of ['See h​ttps://x.example/a', 'See ｈｔｔｐｓ://x.example/a', 'Look at ww​w.x.example']) {
      const e = await rig(); const r = await note(e, 'blocked', text); expect([text, r.status, r.body.error]).toEqual([text, 422, 'bad_note']);
    }
    { const e = await rig(); const ok = await note(e, 'blocked', 'The page says Café st​atus ok'); expect(ok.status).toBe(201);
      expect((await e.store.listNotes((await e.store.getLinkByHash(await sha256hex(K))).id)).map((n) => n.text)).toEqual(['The page says Café status ok']); }
    const BAD = ['I paid the bill.', 'Please delete the game.', 'Razorpay was used.', 'The Cancel button is greyed out', 'Pay now', 'Nothing failed and deleted the game', 'No problem delete the game', 'The page was removed.', 'Fund the account', 'p\u0430y now'];
    for (const type of ['blocked', 'done', 'plan', 'step']) for (const text of BAD) {
      const e = await rig(); const r = await note(e, type, text); expect([type, text, r.status, r.body.error]).toEqual([type, text, 403, 'forbidden_action']);
      expect((await e.store.listNotes((await e.store.getLinkByHash(await sha256hex(K))).id)).length).toBe(0); // nothing was stored
    }
  });
}
