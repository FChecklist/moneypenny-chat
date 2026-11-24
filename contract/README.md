# Contract

What an instance and the core agree on. The core publishes these; every instance pins a version.

- `../core/openapi.json`: the API (paths from section F2 of the spec; routes not built yet are marked `x-status: planned`).
- `../core/schema/instance.schema.json`: the instance record.
- `strings-rules.mjs`: owner string rules and the standard AI line. The core test and each instance test use it.
- `fixtures/`: sample instance record and sample ticket bodies. The core tests post these to the core.

Calls from an instance to the core are signed: headers `x-mpc-instance`, `x-mpc-ts`, `x-mpc-nonce`, `x-mpc-sig`.
Ticket creation also needs `x-mpc-assertion` (role proof from the product) and `idempotency-key` (a UUID).
`x-mpc-ip` is optional: the instance may pass the visitor address so the core can count per address (hashed, rotates daily, never stored). When the header is sent, the address is added to the signed text as a last line (`method \n path \n ts \n nonce \n sha256(body) \n ip`). If it is changed after signing, the call fails with `bad_signature`. When the header is not sent, the signed text has five lines.

## Product adapter: `POST /mpc/ai-key` (S-050)
Called by the instance (never by a browser) for a signed-in organizer. Body `{session, scopes, ttl_s}`. The product answers `201 {key, key_hash, product_key_id, scopes, exp}` where `key` is `mpk_` plus 40 random characters and `key_hash` is the SHA-256 (hex) of `key`.
- Scopes come from the fixed list: `read_ticket`, `read_event`, `edit_event`, `create_event`, `invite`, `report`. The product refuses anything else with `400`.
- `ttl_s` is 60 to 86400. The key is bound to that organizer's own event or account and expires at `exp`.
- The product refuses payments, identity changes and deleting with `403 forbidden_action` for every key, and any call outside the key's scopes with `403 out_of_scope`.
- The instance sends `key_hash`, `scopes`, `ttl_s` and `product_key_id` to the core (`POST /v1/ai-links`) and adds `k` to the returned link itself. The core never sees `k`.
A mock product that follows this contract is in `core/tests/mock-product/`.

## Screenshots, team mail, AI links (0.2.0)
`POST /v1/screenshots`: the body is the file; the signature covers the SHA-256 of the bytes. The standard line "Copy this link and paste in your AI to work." is defined once in `strings-rules.mjs` and in the core `strings.js`; a test compares both to the owner line byte for byte.
