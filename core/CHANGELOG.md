# Moneypenny Chat core changelog

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
