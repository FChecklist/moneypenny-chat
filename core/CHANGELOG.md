# Moneypenny Chat core changelog

## 0.4.0 - 25 Nov 2026 - C10 to C12: widget bundle, Worker entry, session adapter, screenshot capture
- Widget bundle: `bun scripts/build-widget.mjs [id]` writes one file per instance, `instances/<id>/dist/widget.js` (not in git). `core/widget/boot.js` is the entry; the public instance record (text, colours, route table) is baked in. Served at `GET /mpc/widget.js` (`text/javascript`, `cache-control: public, max-age=300`, no cookie, no CORS header).
- Worker entry per instance: `instances/<id>/worker.js` and `wrangler.toml` (routes for `/mpc/*` on each allowed host, `CORE` service binding, `PRODUCT` binding commented until the owner gives the name, build command, no secrets). Logic in `instances/lib/worker.js`. The widget file and `/mpc/config.json` are served even when secrets or bindings are missing; proxy calls then answer 503 `try_later`.
- Session adapter: `instances/lib/adapter.js` (`httpAdapter`). Role and user id are read from the product server (`GET /mpc/session`); the page cannot set them. A product fault fails closed. Contract in `contract/README.md`. The proxy now gives the product the raw user id for `mintKey` when the adapter has one.
- Capture library `core/widget/shot/`: secret-field masking (password, email, tel, number, token, key, card-like and `data-mpc-hide` fields are blanked and restored; their boxes are also burned black in the pixels), editor (Hide, Blur, Undo, Clear, Use picture, Discard), size cap (1600 px, 1.5 MB), nothing sent from the library.
- Widget requests use `credentials: 'same-origin'` (was `omit`) so the product session cookie reaches `/mpc` on the same host. The widget still reads, sets and stores no cookie.
- Tests: `instances/tests/bundle-worker.test.mjs`, `core/tests/capture.test.mjs`.

## 0.3.1 - 25 Nov 2026 - round 5 fixes
- AI links: a link with no ticket may hold only read-only scopes (`read_ticket`, `read_event`, `report`); a link with a ticket may not exceed its class (help and suggest: read-only; stuck: all listed scopes). Others are refused with `bad_request`, field `scopes`.
- AI notes: the forbidden-action check (pay, delete and so on) now runs for done and blocked notes too.
- Instances: `terms_url` is required in `strings.json`: a https link ending in `/terms`, or `null`. `null` hides the Terms link in the notice. All three are `null` until the owner gives the real page.
- Tests: instance strings go through the owner string rules; the widget test renders every screen and checks no checkbox or radio element or role.

## 0.3.0 - 25 Nov 2026 - C7 to C9: widget and three product instances
- Widget (S-051 to S-059): `core/widget/` (`widget.js`, `model.js`, `api.js`, `widget.css.js`). Shadow root, three buttons on home, options 1 to 3, notice line with a Terms link (no tick box), standard AI line with Copy link, send with idempotency key and retry, Check status. No cookies, no storage. Keyboard and screen reader: dialog role, labelled boxes, focus on the title, Escape closes.
- Screenshot hook: `capture()` option on the widget returns a picture; nothing is sent until Send, then the picture goes first. The capture screens themselves (spec C8: capture library, masking, editor) are not built.
- Instances (`instances/`): `lib/proxy.js` is the instance server logic (origin check, role from the product server, signing, forward to core, AI link). `corporatetambola`, `townhall-records`, `veridian-aios` hold `instance.json` and `strings.json` only. One instance per product, no data shared. Test double of a product server in `instances/tests/`.
- Help answers are empty (`answer: null`) until the owner writes them. The widget says "No answer is written yet."
- Tests: `core/tests/widget.test.mjs`, `instances/tests/instances.test.mjs`.

## 0.2.0 - 25 Nov 2026 - C4 to C6: screenshots, team e-mail and login, AI links
- Screenshots (S-026 to S-033): `POST /v1/screenshots` (png, jpeg, webp; first bytes must match; up to 2 MB; 10 per hour per address). Files go to the private bucket `mpc-shots` under `<instance>/<random id>`. One file per ticket. A file no ticket uses is erased after 1 hour. A ticket may carry `screenshot_id`. Team can read the file of one ticket (login only). No public URL.
- Erase (S-030): hourly sweep (cron) erases due files and tickets with their notes, call log and mail queue; `erasure_log` keeps only ticket, instance and time. Team can use Erase now (`PATCH` with `{"erase":true}`).
- Audit: every state change writes a row in the new `audit` table (time, instance, ticket, action, who). No text, no person.
- Privacy (S-031, S-032): with `DNT: 1` or `Sec-GPC: 1` the core writes no AI call-log row. Tests check that no response sets a cookie and no stored row holds an address, user agent or key.
- Team e-mail (S-034 to S-037): one mail per new ticket to the `TEAM_EMAIL` secret address. Only number, product, option, topic, screen, time and a link. Sender port with a fake for tests and a service-binding sender. A failed mail is tried 3 more times, then queued; the hourly sweep tries up to 5 more times.
- Team list (S-038 to S-041): `/team` page (plain HTML, one same-origin script, strict CSP); team routes now check the Cloudflare Access token (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`). See `docs/ACCESS.md`.
- AI links (S-042 to S-050): `POST /v1/ai-links`, `DELETE /v1/ai-links/{id}`, `POST /v1/ai-links/{id}/approve` (added), `GET /ai/{id}` and `/ai/{id}.json`, `GET /v1/ai/context`, `POST /v1/ai/notes`. Fixed scope list. Only the hash of the key is stored. A ticket can only be linked with its own status token (added).
- Fix: a `204` answer now has no body.
- Instance record: new optional `ai_calls` (up to 20 lines shown on the AI page).
- Tests: new files for each step; the standard line test checks the owner line byte for byte.

## 0.1.4 - 25 Nov 2026 - round 4 fixes
- Rate limit: the Durable Object keeps at most 5,000 live nonces. More signed requests are refused with `rate` (429) until old nonces expire (10 minutes).
- Tickets: re-opening a ticket after done clears `done_at` and sets `erase_at` back to the receipt-based time.
- Idempotency: a key now lives 23 hours, one hour less than the shortest ticket erase window, so a replay never points at an erased ticket.
- Docs: I8 has a recommended answer; every question I1 to I13 has an answer line.
- Tests: one new test per fix.

## 0.1.3 - 25 Nov 2026 - round 3 fixes
- Tickets: a topic with 8 or more digits in total is refused (`bad_request`, field `topic`).
- Rate limit: counters taken before the store call are given back when the store throws.
- Instance: new setting `require_ip` (default `false`). When `true`, a call without `x-mpc-ip` is refused with `bad_request`.
- Crypto: the AES key is now the raw 32 bytes of the digest (256 bits).
- Docs: product backends must always send `x-mpc-ip`; secret rotation keeps the old secret for 24 hours.
- Tests: one new test per fix.

## 0.1.2 - 25 Nov 2026 - round 2 fixes from two audits
- Idempotency: the status token in the stored answer is now encrypted (AES-GCM, key from the instance secret). The raw token is never stored. Replays decrypt it.
- Signature: `x-mpc-ip` is part of the signed text when the header is sent. A changed address fails with `bad_signature`.
- Tests: raw token not found in either store; changed address refused; D1 number order and replay.

## 0.1.1 - 25 Nov 2026 - fixes from two audits of C1 to C3
- Scrub: any run of 8 or more digits is removed, even when glued to letters or signs (a card or phone number glued to letters). Dates and short numbers stay.
- Tickets: screen and screen label are scrubbed too. An instance route may not hold digits or `@`.
- Rate limit: when `x-mpc-ip` is missing, the bucket comes from a hash of the signed session. Visitors no longer share one bucket.
- Ticket numbers: the D1 store allocates the number only when the ticket is created, in the same batch, so a lost race burns no number.
- OpenAPI: team routes are marked closed-until-access. `GET /v1/tickets/{ticket}` lists 413 and 429.
- Deploy: the D1 binding in `wrangler.toml` must be filled in before deploy. See README and DECISIONS.
- Tests: strings checked on every export; secrets scan and history scan tested against a planted fake key.

## 0.1.0 - 24 Nov 2026
- First core: health, version, tickets (create, read, team list, team close), signed calls, idempotency, rate limits, scrub, retention dates, OpenAPI file, D1 schema.
- Added beyond the spec table, to be confirmed by the owner: error `no_team_login` (401) for team routes; `GET /v1/team/tickets/{ticket}?product=` for the team detail; `?product=` is required on the team close call because ticket numbers repeat per instance.
- Fields removed: none. Deprecated: none.
