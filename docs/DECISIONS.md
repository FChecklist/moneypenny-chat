# Decisions (S-001)

Source: section I of the design spec (`ledger/design/MONEYPENNY-CHAT-SPEC.md`).
The owner has not answered these in writing in this run. Each answer line below is the spec's recommended answer and is marked **Recommended, owner to confirm**. Change the line when the owner decides.

Also fixed by the owner (from the task): version starts at 0.1.0; tests run with bun; money flag stays OFF; no secrets in the repo; payments only through Moneypenny credits (payee name in user text comes from the payee record, never hard-coded).

## I1. Where does each instance live?
Answer: One public repo per instance and one for the core. Run the history scan (`scripts/history-scan.mjs`) before any repo goes public. Recommended, owner to confirm.

## I2. The chat code is private today. How to move it?
Answer: Copy only code, tests and docs. Leave `LOG.md`, `eval/results/` and private plan links behind. Use a custom host name per instance, not the account-named Worker URL. Recommended, owner to confirm. Done in this repo: clean copy only (the Durable Object limits class).

## I3. Retention for townhall-records and veridian-aios
Answer: Screenshots 7 days after done, text 30 days after done, hard maximums 30 and 90 days. Games stay at 24 hours. Recommended, owner to confirm. Built in `core/src/retention.js` as proposed values.

## I4. Product code is not in this repo; injection points are unverified
Answer: Each product owner session checks its entry file and session check before coding (steps S-087 to S-090). Not started.

## I5. Layer 2 AI proxy
Answer: Keep it OFF in v2. The core has no AI proxy code. Recommended, owner to confirm.

## I6. Old journey recording (`/v1/j`, `/v1/c`, OK / No thanks)
Answer: Left out of v2. The old Worker keeps running for the tambola site until S-099. Recommended, owner to confirm. Not copied here.

## I7. Team address and team login
Answer: Address only as platform secret `TEAM_EMAIL`. Cloudflare Access for `/team`. Recommended, owner to confirm. The Access check is not built; team routes refuse every call until it is.

## I8. Screenshot of personal data
Answer: Mask by default with `data-mpc-hide` (step S-062). Until the owner decides, no screenshot is taken on voter-list screens of townhall-records (the simplest safe option). Recommended, owner to confirm. Not built yet, because the widget and the product pages are not in this repo.

## I9. The AI link is a bearer link
Answer: Short life (2 hours), revoke button, scopes in the product backend. Recommended, owner to confirm. Not built yet.

## I10. Role check may be missing on static pages
Answer: Route table plus a signed link token as fallback; mark those pages weaker in the changelog. Not built yet.

## I11. Screen names need a route table per product
Answer: Product owners supply `mpc-routes.json`; fallback is "This screen". The instance record has a `routes` field; the fallback is built.

## I12. Payments: AI may not pay
Answer: Enforced in the product backend; the core refuses any scope named payment, identity or delete (step S-048). Not built yet. The core has no payment code. Payments go only through Moneypenny credits.

## I13. Instance and core secrets
Answer: Platform secrets only. The secrets scan is first in the test chain (`bun run test`). Done.

## Steps in C1 that do not apply to this repo
- S-002 (old embed test with `C:/ct` paths), S-007 (old knowledge base answers) and S-005 (old report route): they belong to the old private chat folder and to instances. Nothing copied, so nothing to fix here.
- S-004: `core/wrangler.toml` is written from the spec. `wrangler deploy --dry-run` was not run (no Cloudflare tooling or account here).

## Deploy: the D1 binding must be filled in
The `DB` binding in `core/wrangler.toml` is commented out and holds no database id. Fill it in before deploy and apply `core/schema.sql`. Without it the worker answers 503 (`try_later`).

## Ticket numbers on a same-key race
The D1 store allocates the number inside the same batch, after the idempotency insert. A lost race rolls the batch back, so no number is burned. The memory store behaves the same.

## Stored idempotency answer
The idempotency row keeps the first answer for 23 hours (`expires`), one hour less than the shortest ticket erase window (games: 24 hours), so a replay never points at an erased ticket. The status token inside it is stored only encrypted (AES-GCM, key derived from the instance signing secret) and is decrypted on a replay. The raw token is never stored; the ticket row keeps only its sha256. If the secret is changed so that no active secret fits, a replay fails with `try_later` (fail closed). Old rows are ignored after `expires`; an erase job that deletes them is not built yet.

## Visitor address is signed
`x-mpc-ip` is part of the signed text when it is sent, so it cannot be changed after signing.

## Accepted known limits (v0.1.3)
- One global Durable Object serialises the counters for all instances; shard it by instance later.
- Digit runs split by letters (for example `1234abcd5678`) are not scrubbed.
- Team listing across instances needs a per-product rule when Cloudflare Access is built.
- `topic` is stored unscrubbed on purpose: it is limited to `[a-z0-9-]{1,40}` and a topic with 8 or more digits in total is refused (`bad_request`, field `topic`), so it cannot hold a card or phone number.

## Missing visitor address
If `x-mpc-ip` is missing, the rate-limit bucket is a hash of the signed session id. One bucket is never shared by all visitors.

## Product backends must always send x-mpc-ip
Every product backend must send `x-mpc-ip` (the visitor address) on every signed call. The product backend picks the session id, so a bucket built from it can be changed by that backend. To refuse a call without the header, set `require_ip: true` in the instance record (default `false`). The call then fails with `bad_request`, field `x-mpc-ip`.

## Secret rotation
Encryption of the stored status token always uses the first (primary) secret. Opening tries every active secret. During a rotation the old secret stays configured for 24 hours, longer than the 23 hours an idempotency row lives, so a replay sealed with the old secret still opens. After 24 hours remove the old secret.

## Encryption key
The AES-GCM key is the raw 32 bytes of the HMAC-SHA-256 digest (256 bits). Nothing is deployed yet, so no migration is needed.

## Counters on a store failure
If the store throws while a ticket is created, the limit counters taken for that call are given back before the error goes on.

## Nonce cap
The Durable Object keeps at most 5,000 live nonces (`NONCE_CAP` in `core/src/limits.js`). When full, a valid signed request is refused with `rate` (429) until old nonces expire (10 minutes). Only valid signatures can fill it.

## Re-opening a ticket
Setting a done ticket back to `seen` clears `done_at` and sets `erase_at` to the receipt-based time (games: 24 hours, records: 90 days).

## Reviewed and not defects (round 4)
- Split-digit scrub limit: accepted (see known limits above).
- Team routes fail closed until the Access check exists.
- A sealed status token cannot contain the placeholder text.
- Batch order in the D1 store is covered by the fake D1 tests.

## C4 to C6 notes (version 0.2.0)
Built in this run: screenshots (S-026 to S-033), team e-mail and list (S-034 to S-041), AI links (S-042 to S-050). Not confirmed by the owner. Accepted limits and choices:
- **No per-ticket alarm.** The spec asks for a per-ticket Durable Object alarm and a nightly sweep. Built: reads already hide a ticket and its file once `erase_at` has passed, and an hourly sweep (cron `17 * * * *`) deletes the data. So data can stay in storage up to about one hour after `erase_at` but cannot be read. The per-ticket alarm is not built.
- **Sweep and bucket.** The sweep deletes the file first, then the rows. If the bucket is down, the ticket stays and the next sweep tries again.
- **Parallel uploads with one key** may store two files. The extra one is erased after 1 hour.
- **Team mail service contract is unverified.** The sender posts `{to, subject, text}` as JSON to `https://mail.internal/send` through a service binding named `MAIL`. The real platform mail service was not checked. The binding is commented out in `wrangler.toml`. A staging send must be checked by the owner. The address is only the `TEAM_EMAIL` secret.
- **Mail retry.** First try plus 3 immediate retries. Then queued. The hourly sweep tries again, up to 5 times, then writes `mail_gave_up`. No mail is sent when the address, the sender or `TEAM_URL` is not set; the ticket is never blocked by mail.
- **Access login** is tested with a locally made key pair only. Not tried on a real Cloudflare Access application. The routes answer 401 until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set. See `docs/ACCESS.md`. The team page was not opened in a browser and no accessibility tool was run; only static checks on the HTML were made.
- **Team code stays in `tickets.js`.** The spec names `core/src/team.js`; the team list and update logic was built in C3 and was not moved.
- **AI link host.** The link uses the first entry of `allowed_origins` of the instance. If the chat page origin and the AI page origin differ, a separate setting is needed.
- **Added to the spec:** `POST /v1/ai-links/{id}/approve` (without it `approved:true` could never happen); a named ticket needs its status token when a link is made (ticket numbers are in order and must not be enough to read another organizer's ticket); `GET /v1/team/tickets/{ticket}/screenshot`; `ai_calls` in the instance record.
- **AI note rules are a first filter, not the lock.** Notes with words about paying, credits, passwords or deleting (plan and step notes) get `forbidden_action`; links to other sites and long token-like strings get `bad_note`. A person can word a request in another way. The real block is in the product backend (spec E3).
- **Note limits.** 20 notes per link in total and 1 per second. The 21st note gets `slow_down` with `retry_after` set to the seconds left on the link, because E6 has no other code for it. A note of type `done` or `blocked` closes the link; later calls get `expired`.
- **Step and done notes need an approved plan** only when the link has a write scope (`edit_event`, `create_event`, `invite`). Links with read scopes only may continue without approval.
- **Sign-out revoke** (spec E2) belongs to the instance and is not built here. The organizer can already stop a link with `DELETE`.
- **Product calls on the AI page** come from the optional `ai_calls` list in the instance record. They are not checked against any real product API. The page names no payee. Payments are only by a person, through Moneypenny credits; a payee name must come from the payee record when a payment screen is built.
- **DNT and GPC.** The instance must forward both headers. Rate-limit counters (hashed address, rotated daily) and audit rows are not side records.
- **`wrangler` text imports.** `team/*.html`, `team/app.js` and `templates/ai-page.md` are imported as text with `with { type: 'text' }` and a `[[rules]]` entry. Tests run in bun. The bundling by wrangler was not run here.

## C7 to C9 notes (version 0.3.0)
Not confirmed by the owner. Choices and accepted limits:
- **Order.** The task asked for widget, corporatetambola wiring, then the two other instances. The spec's own C8 (screenshot capture screens, S-060 to S-067) was not built; only the `capture()` hook exists. The spec's C9 and C10 were built as instance files plus one shared `instances/lib/proxy.js`, not as a template repo or separate repos.
- **No browser ran.** Widget tests use a small fake DOM and the pure screen model. "Product CSS cannot reach it" is shown only by structure (shadow root, style inside it, nothing in the light DOM). Contrast, 44 px and keyboard walk were not checked in a real browser. The widget file is an ES module; bundling and serving it at `/mpc/widget.js` is not built.
- **Terms link.** The Terms page URL of each product is not known. Round 5: `terms_url` is now `null` in all three instances, and `null` hides the Terms link (a link to the home page is not a Terms page). **Owner must give each product its Terms URL** (a https path ending in `/terms`).
- **Origins.** Taken from the ledger: corporatetambola `home.` and `console.`, townhall-records `townhall-records.com`, veridian-aios `veridian-aios.com` and `app.`. Owner to confirm.
- **Route table is empty** for all three. Owners supply the screen names (I-answer on routes). Until then the label is "This screen" and "Another screen" is hidden.
- **Topic lists.** corporatetambola follows the old starter entries; townhall-records and veridian-aios lists are PROPOSED in the spec and not confirmed (S-077, S-081 wait for the owner). Help answers are `null`: no answer text, price or policy is made up.
- **Role map.** corporatetambola maps `host` to `co-organizer`. townhall-records does the same as a guess. veridian-aios maps only `organizer`. Product role names are unchecked.
- **Proxy.** Roles come from the product server session, never from the page. The page role in a ticket body is replaced. Sessions are bearer tokens in the test double; the real products' session check is not written (adapter `session()` is an interface only). No Worker entry or `wrangler.toml` for instances; nothing was deployed.
- **AI link scopes** from the widget are read only (`read_event`, plus `read_ticket` for a problem). An AI may do everything but pay; wider scopes need the organizer to approve on the AI page later. Payments are not part of this build; the money flag stays off.
- **Retries.** The widget retries 2 times on network faults and 502, 503, 504 with the same key. A 429 is not retried.
- **Status token** lives in memory only; after a page reload "Check status" has nothing to read.

## Round 5 notes (version 0.3.1)
- **Link scopes.** No ticket: read-only scopes only. With a ticket: help and suggest are read-only, stuck may hold every listed scope (the organizer still has to approve the plan before write steps).
- **Accepted, not defects.** Ticket text is visible to the key holder for 24 hours by design. The screenshot blob stored twice is erased after 1 hour and accepted.

## C10 to C12 notes (version 0.4.0)
Not confirmed by the owner. Built: widget bundle and Worker entry (C10), session adapter (C11), screenshot capture, masking and editor (C12). Choices and accepted limits:
- **Tested without Cloudflare and without a browser.** `wrangler deploy --dry-run`, a real bundle load in a browser, and a real product session were not run. See `KNOWLEDGE.md`.
- **Widget cookies.** The widget sends requests with `credentials: 'same-origin'` so the product's own session cookie reaches `/mpc` on the same host. The widget and the instance Worker never set or read a cookie (the Worker reads only the `cookie` and `authorization` headers to pass them to the product, server to server).
- **Adapter wire format** (an interface of this repo, not checked against any real product): `GET /mpc/session` answers `200 {role, user_id}`; `401`, `403` or `204` mean not signed in; any other status is a product fault and the instance answers 503. `sess` for the core is a one-way id (first 32 hex of sha256 of `mpc-sess|<user_id>`); the raw user id goes only to the product for `mintKey`.
- **PRODUCT binding** is commented in each `wrangler.toml` until the owner gives the product Worker name. Routes use a `zone_name` taken from the host name; owner to confirm.
- **Widget file cache** is 300 seconds. After a deploy a page can show the old widget for up to 5 minutes.
- **No picture engine.** The DOM-to-pixels engine (spec S-060) is not vendored (no network in the build run). `makeCapture` takes `render(doc)` and `toBlob(image, type, quality)` as parts; the widget boot does not set `capture`, so the screenshot button stays hidden until the owner approves an engine and wiring. EXIF removal relies on re-encoding from pixels (`canvas.toBlob`); the encoder was not run.
- **Masking limits.** Text outside fields is hidden only when the product marks it `data-mpc-hide`. A secret in a field with a plain name and a plain type (for example a text box holding a short code) is not found. The editor is drag only; a keyboard way to place boxes is not built. Blur is coarse blocks; Hide is the safe choice.
- **Voter-list screens (I8).** `takePicture` takes a `blocked()` check, but no instance sets it yet: the owner has not decided, and the route table is empty.
- **Capture assumes the picture starts at the top left of the visible page** (field boxes are in viewport pixels, scaled by picture width over `innerWidth`).

## Round 6 notes (version 0.4.1)
- **AI note word list is a second layer.** Scope limits, checked on every call, are the real guard; the word list on free text only catches plain slips and can be got round with other words.
- **Team login has no product.** The team login is one Access login for the whole team, so the product comes from the query and is checked against the instance list. Every read, update, erase and picture call is keyed by instance and number, so a ticket of one instance cannot be reached through another (tests with two instances). A per-product team login is not built.
- **Proxy AI link ticket check.** The proxy reads the named ticket at the core with the caller's status token before it asks the product for a key. The ticket does not store a session, so the token is the proof of ownership.

## Round 7 notes (version 0.4.2)
Not confirmed by the owner. The head of PR 1 already said 0.4.1 (round 6), so this is 0.4.2. Choices, evidence and open questions:
- **Link erase (privacy rule: 24 hours).** Every AI link, made with a ticket or without, goes with its notes and call log when the link expires; a link lives 24 hours at most (`ttlMax`), and the hourly sweep runs it, so data can sit in storage up to about one hour longer but cannot be read (an expired link answers `expired`). Erasing a ticket still removes the notes and calls of its links at once and leaves the link row until its own expiry (so an AI is told `ticket_gone`, not `bad_link`). Before 0.4.2 a link made for a ticket kept its row, notes and calls until its ticket was erased (up to 90 days on a records product). The sweep now runs the database-only jobs first (links, idempotency rows) and isolates every job, so a file store that is down cannot keep a link or its session hash past its time; the first fault is still thrown so the cron run shows as failed.
- **Status token: the proxy passes it.** Evidence: the core answers 404 without it for a ticket read and for a link made for a ticket; a ticket row keeps no session, only the hash of the token (`schema.sql`), and ticket numbers run in order, so neither the session nor the number can prove ownership. Safe choice: no token or a wrong one is a refusal (403 `not_yours`), never a link made without the ticket. It goes to the core only on the ticket read and the AI link (the check and the link call), never on create or screenshots, never to the product server, never in a body, an address or an answer. The widget kept it in memory but never sent it on the link call; fixed. Because it lives in memory only, a link for a ticket can be made only from the page that sent the ticket (after a reload the person gets a link without the ticket).
- **Origin rule for a GET.** A browser adds no `Origin` header to a same-origin GET, so Check status was refused. A GET with no Origin is accepted when the browser says `Sec-Fetch-Site: same-origin` (a page script cannot set it), or, where that header is missing, when the `Referer` is the same origin, and the host the request went to is an allowed origin. The Referer must be https (a `blob:` address carries the origin inside it and is refused). A POST still needs an allowed Origin; a wrong Origin is refused whatever else is sent; a client with none of these (curl) is refused as before.
- **AI note word check.** Precise by type, see `core/src/noterules.js`. Plan and step stay strict (the owner's rule from C4 to C6; the list is unchanged). Done and blocked are reports: a listed word refuses the note unless its clause shows it is only mentioned (negated, handed to a person, said by the page, a screen label, a plain noun, a describing word, how-to words, what a thing does, and, in a blocked note only, a state such as "the booking was cancelled"). The payment provider's name, a claim ("I paid", "Order refunded"), a request ("please pay", "Next, delete the game"), intent ("I will delete it"), credits sent somewhere and "your password" are refused. An independent review ran 90 abusive and 111 harmless wordings: the first version let 76 of the 90 abusive ones through (in a done or blocked note) and refused 41 of the 111 harmless ones; this version lets 17 through, refuses 10 harmless ones in a blocked note and 27 in a done note (a passive state counts as a claim there, by design). The tests now hold about 110 passing and 100 refused reports. **Still wrong, on purpose or not fixed:** it is a second layer, the scope list and the product backend are the lock. *Refused but harmless:* "I need to remove the filter first", "I removed the cookie banner", "please remove the overlay", "you can pay on the payment page", "3 players paid", "you can remove a player with the Remove button", "you need to buy more credits". *Passes but not wanted:* words outside the owner's list (settle, wire, other payment names than Razorpay, modify or edit or set an e-mail, hand over, assign, give ownership); something a person did ("Organizer deleted the game"); a state in a blocked note ("the game is deleted"); a password written out ("The password is ...", only a long token is caught by the older token check). Widening the word list is an owner decision.
- **Screenshots are owned by a session.** The upload stores sha256 of `instance|shot|session`; only that session can attach the file to a ticket. An old row with no owner can never be claimed (it is erased after 1 hour anyway). The hash is dropped once the file is attached to a ticket (it is only needed to claim). A database made from the 0.4.1 schema needs `ALTER TABLE shot ADD COLUMN sess_hash TEXT` once; nothing is deployed, so none does.
- **Real-browser tests** (`tests/browser/`). What is real and what is replaced is in `KNOWLEDGE.md`. The picture engine is not shipped, so masking is tested on the real library with the browser's own screenshot as the engine. The tests that read source files with a regex (cookie words, comment stripping) were replaced by tests that use the widget while every cookie and storage door throws, and by the real-browser checks.
- **Open questions for the owner.**
  1. **Scopes of widget links.** `AI_KINDS` in `instances/lib/proxy.js` gives help and suggest `read_event`, and stuck `read_event` and `read_ticket`. The core needs `report` for a note and `read_ticket` for the context call, so an AI on a widget link cannot post a plan or a blocked note, and a help link cannot read the context. `report` is a read-only scope in `scopes.js`. Nothing was changed: it is a product choice. The C7 to C9 notes say wider scopes need the organizer to approve on the AI page later, but the approve call only sets `approved`; it does not widen scopes.
  2. **AI page address.** The link uses the first allowed origin (`https://<product host>/ai/<id>?k=`), but each instance route covers `/mpc/*` only and the core has no route, so nothing serves that address. Needs a route from the product host to the core, or a separate setting.
  3. **Check status** works once per sent screen: after Done the widget forgets the ticket (the token is kept but no button leads back).
  4. **History scan.** `bun scripts/history-scan.mjs .` was red before this PR: two old commits hold fake sample e-mail and phone numbers in test files that the tree scan exempts. Decide before any repo goes public (I1).
  5. **Terms pages** are still `null` for all three products.
  6. **Link life and the 24-hour rule.** `ttlMax` is 86400 s and the cron is hourly, so a link made for the longest life is erased up to about one hour after it ends (about 25 hours after it was made). Tickets have the same hour of lag, which was accepted in C4 to C6. The proxy makes 1-hour links, so only a direct caller of the core can reach it. Capping `ttlMax` at 23 hours would close it, but it changes the contract (`ttl_s` 60 to 86400): owner decision.

## Round 8 notes (version 0.4.3)
Not confirmed by the owner. Two independent read-only reviews of head 488af572 found open problems (one passed test quality; one failed the note word check; one failed the erase cron guard). This round fixes only those and the cheap small findings, then reviews run again on the new head. Test run: 428 tests in 37 files (0.4.2 had 414 in 35), `bun run test` green.
**Fixed**
- **Erase cron needs only `DB` and `LIMITS`.** Before, a missing picture bucket (`SHOTS`) made `scheduled` return at once, so expired links, notes, call logs, idempotency rows and tickets were never erased (privacy rule: 24 hours) and nothing was logged. Now a missing `DB` or `LIMITS` is a `console.warn` and a missing `SHOTS` is a `console.warn` plus a run that skips only the picture steps. Test: `core/tests/scheduled.test.js`.
- **A ticket with a picture waits while `SHOTS` is missing.** The ticket row is the only record of the file, so erasing the row first would leave the file in the bucket for good. Such a ticket is kept (and a warning counts it) until the bucket is bound; every other due ticket is erased. Choice made here, not asked for in words: the alternative (erase the row anyway) trades a late ticket for a file nobody can find.
- **A sweep fault no longer skips the mail retry.** Both run; the first fault is thrown once both have finished, so the cron run still shows as failed.
- **`boot.js` uses the `uuid()` helper of `api.js`** (now exported) instead of a bare `crypto.randomUUID()`, so Copy link works where that is missing.
- **`capture.test.mjs` puts the global `navigator` back as it found it.** It used to delete it for every later test in the same run.
- **A default-run guard on the widget source** (`core/tests/widget-static.test.js`): no `document.cookie`, `localStorage`, `sessionStorage` or `fetch(` to a third-party address. It is a plain text scan with comments removed. The real-browser tests stay the real check; they are still not part of `bun run test`.
- **Note word check, stricter where it let words through** (`core/src/noterules.js`; the rules are at the top of that file). A negation counts only within 3 words of the listed word. A hand-off word ("a person", "the team") or a "the page says" word still counts anywhere in its clause but never when the clause holds a push word: a strong word (please, click, select), an ask word that is not the hand-off's own verb, or "I", "we" or "you" with a past verb. "So", "then" and "because" start a new thought. "Yourself" is no longer a hand-off. In a blocked note a state ("was cancelled", "was deleted", "removed", "transferred") passes only when it is about a page, screen, form, session, link, step, upload or picture; the subject is read as the last words before "was", checked part by part when joined by "and" or "or", and refused when it holds "of", "to", "on" and the like.
- **Sample lines moved.** 17 lines of the state list ("the game was cancelled", "the ticket was deleted", "my access to the game was removed" and so on) and 1 line of the accepted list ("please sign in and enter the password yourself") moved to the refused list in `core/tests/note-words.test.js`, each with a reason. All other accepted lines are unchanged and still pass in done and blocked notes; 12 new accepted lines guard against refusing honest reports.
**Where this round differs from the request, or could not do it as worded**
- **Three of the five named sentences were already refused** at 488af572: "Nothing failed, deleted the game", "Cannot wait, delete the game" and "Not done: paid the invoice" each have a comma or a colon, and a clause is read on its own after one. They are pinned by tests now, but those three tests also pass on the old code. The real holes were the same words without a comma ("Cannot wait so delete the game"), "the booking was cancelled" in a blocked note, and "Delete the game yourself"; those tests fail on the old code.
- **Ask words and hand-offs.** The request said a hand-off or "the page says" must never clear a clause with an ask word. Nine accepted lines say the opposite in their own words ("the page asks me to enter a password", "ask the organizer to pay the fee", "a person needs to top up credits"). So an ask word clears the hand-off only when it is the hand-off's own verb (after "to", "must", "should", "can", "will" and the like) or the request is addressed to the person ("ask the organizer to pay"). Strong words and "I" with a past verb always defeat it, as asked.
- **A negation reaches "have to".** "I do not have permission to pay" has its "not" four words before "pay"; one narrow rule lets "not have ... to" through, because the line is a plain report.
- **"Done" notes were not changed for states.** A done note never accepted a state of its own ("the booking was cancelled"); only the blocked note did. The done note still passes "the bill was paid by the organizer" (a named person did it).
**Still accepted or still wrong, on purpose or not fixed** (the word check is a second layer; the scope list and the product backend are the lock)
- *Passes but not wanted:* "I cannot wait to delete the game" (the "cannot" is within 3 words, but the sentence says the opposite); something a person did ("Organizer deleted the game", "The organizer said the game was cancelled"); "A person is here and delete the game" (a hand-off word with an order and no push word); what the page says ("The page says the booking was cancelled"); a false report ("I did not delete anything" when it did); a password written out ("The password is swordfish"); words outside the owner's list ("Settle the invoice"); a state of a page, screen, form, session, link, step, upload or picture, even when the AI caused it.
- *Refused but harmless (new this round):* "The page says click Delete to continue", "Blocked: please sign in and enter the password yourself", "Blocked: the game was cancelled" and every other state of a game, event, ticket, booking, order or key; and, as before, "I removed the cookie banner", "please remove the overlay", "3 players paid". The AI is told to post a blocked note that a person must do it, and may say that in plain words.
- **The static widget scan is text only.** It cannot see a call built from pieces. The browser tests (`bun run test:browser`) are the real check.
- **Open questions from round 7 are unchanged** (widget link scopes, AI page address, Check status once per screen, history scan, Terms pages, link life).

