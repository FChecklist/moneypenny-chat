# Moneypenny Chat changelog

## 0.1.2 - 25 Nov 2026 - round 2 fixes from two audits
- Idempotency: the status token in the stored answer is now encrypted (AES-GCM, key from the instance secret). The raw token is never stored. Replays decrypt it.
- Signature: `x-mpc-ip` is part of the signed text when the header is sent. A changed address fails with `bad_signature`.
- Docs: known limits noted in DECISIONS; contract README and OpenAPI updated.
- Tests: raw token not found in either store; changed address refused; D1 number order and replay.

## 0.1.1 - 25 Nov 2026 - fixes from two audits of C1 to C3
- Scrub: any run of 8 or more digits is removed, even when glued to letters or signs (a card or phone number glued to letters). Dates and short numbers stay.
- Tickets: screen and screen label are scrubbed too. An instance route may not hold digits or `@`.
- Rate limit: when `x-mpc-ip` is missing, the bucket comes from a hash of the signed session. Visitors no longer share one bucket.
- Ticket numbers: the D1 store allocates the number only when the ticket is created, in the same batch, so a lost race burns no number.
- OpenAPI: team routes are marked closed-until-access. `GET /v1/tickets/{ticket}` lists 413 and 429.
- Deploy: the D1 binding in `wrangler.toml` must be filled in before deploy. See README and DECISIONS.
- Tests: strings checked on every export; secrets scan and history scan tested against a planted fake key.

## 0.1.0 - 24 Nov 2026 - chunks C1 to C3 (steps S-001 to S-025)
Version starts at 0.1.0 by owner instruction. The spec text says 1.0.0 for the core; 1.0.0 is kept for the first live release.
- C1: repo layout, tests run with `bun test`, secrets scan runs first (`bun run test`), history scan script, string rules test, decisions file.
- C2: core Worker with `GET /v1/health`, `GET /v1/version`, signed calls (HMAC, time, nonce), instance config and schema, error shape, body size limits, OpenAPI file.
- C3: tickets API (create, read with status token, team list and close), D1 schema, storage behind an interface (memory store and D1 store), idempotency, rate limits, text scrub, retention dates.
- Not in this version: screenshots, AI links, team notification, erase job, `/team` page, widget, instances. The Cloudflare Access check for team routes is not built; team routes refuse every call until it is.
- The money flag `PAY_VIA_MONEYPENNY` is OFF. No payment code exists.
