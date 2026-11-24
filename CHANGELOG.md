# Moneypenny Chat changelog

## 0.1.0 - 24 Nov 2026 - chunks C1 to C3 (steps S-001 to S-025)
Version starts at 0.1.0 by owner instruction. The spec text says 1.0.0 for the core; 1.0.0 is kept for the first live release.
- C1: repo layout, tests run with `bun test`, secrets scan runs first (`bun run test`), history scan script, string rules test, decisions file.
- C2: core Worker with `GET /v1/health`, `GET /v1/version`, signed calls (HMAC, time, nonce), instance config and schema, error shape, body size limits, OpenAPI file.
- C3: tickets API (create, read with status token, team list and close), D1 schema, storage behind an interface (memory store and D1 store), idempotency, rate limits, text scrub, retention dates.
- Not in this version: screenshots, AI links, team notification, erase job, `/team` page, widget, instances. The Cloudflare Access check for team routes is not built; team routes refuse every call until it is.
- The money flag `PAY_VIA_MONEYPENNY` is OFF. No payment code exists.
