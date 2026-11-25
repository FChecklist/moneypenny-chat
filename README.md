# moneypenny-chat

Moneypenny Chat: Need help, Suggest an option or feature, Stuck: tell where. One modular instance per product.

- `core/`: the shared Worker (tickets API, storage, limits, AI links), and the widget source in `core/widget/`. The version is in `VERSION`.
- `contract/`: what instances and the core agree on (strings rules, fixtures).
- `docs/DECISIONS.md`: owner decisions.
- `instances/`: one folder per product (record, strings, Worker entry) and the shared proxy and session adapter in `instances/lib/`.
- `tests/browser/`: real-browser tests of the built widget bundle (Playwright Chromium).
- `scripts/`: secrets scan, git history scan, widget build.

Run the tests: `bun run test` (secrets scan first, then the fast unit tests with `bun test`). Core only: `bun run test:core`.
Real-browser tests: `bun run test:browser` (builds the widget, then runs `tests/browser/` in Chromium). Everything: `bun run test:all`.
The browser tests need Playwright and its Chromium, installed outside the repo: `npm i -g playwright && npx playwright install chromium`. No lock file is committed. If Playwright is not found, set `MPC_PLAYWRIGHT` to its folder.
Change log: `CHANGELOG.md`. Version file: `VERSION`.

## Deploy note
The D1 database binding in `core/wrangler.toml` is commented out. Fill it in before deploy: remove the `#`, set the real `database_id`, and apply `core/schema.sql`. Without it the worker answers 503 on every ticket call.
