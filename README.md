# moneypenny-chat

Moneypenny Chat: Need help, Suggest an option or feature, Stuck: tell where. One modular instance per product.

- `core/`: the shared Worker (tickets API, storage, limits). Version 0.1.0.
- `contract/`: what instances and the core agree on (strings rules, fixtures).
- `docs/DECISIONS.md`: owner decisions.
- `scripts/`: secrets scan and git history scan.

Run the tests: `bun run test` (secrets scan first, then `bun test`). Core only: `bun run test:core`.
Change log: `CHANGELOG.md`. Version file: `VERSION`.

## Deploy note
The D1 database binding in `core/wrangler.toml` is commented out. Fill it in before deploy: remove the `#`, set the real `database_id`, and apply `core/schema.sql`. Without it the worker answers 503 on every ticket call.
