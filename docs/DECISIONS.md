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
