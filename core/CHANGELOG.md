# Moneypenny Chat core changelog

## 0.1.0 - 24 Nov 2026
- First core: health, version, tickets (create, read, team list, team close), signed calls, idempotency, rate limits, scrub, retention dates, OpenAPI file, D1 schema.
- Added beyond the spec table, to be confirmed by the owner: error `no_team_login` (401) for team routes; `GET /v1/team/tickets/{ticket}?product=` for the team detail; `?product=` is required on the team close call because ticket numbers repeat per instance.
- Fields removed: none. Deprecated: none.
