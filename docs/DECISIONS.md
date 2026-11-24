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
Answer: Mask by default with `data-mpc-hide` (step S-062). Owner to decide if townhall-records screenshots are allowed on voter-list screens. Open.

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
