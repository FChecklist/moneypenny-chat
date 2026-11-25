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

## Product session adapter (0.4.0)
Interface the instance Worker uses (reference: `instances/lib/adapter.js`, `httpAdapter`):
- `adapter.session(req) -> { role, user_id, sess } | null`. `null` means not signed in. The role and user id come from the product server, never from the page. The instance asks `GET /mpc/session` on the product (service binding, private) and forwards only the `cookie` and `authorization` headers of the browser request. Product answers `200 {role, user_id}` (`role`: lower case letters, digits and `-`, up to 32; `user_id`: printable, no spaces, up to 128). `401`, `403`, `204`: not signed in. Any other status, bad JSON or a network fault throws, and the instance answers 503 `try_later` (never a default role). A wrong shape gives `null`.
- The instance then maps the role with `role_map` and refuses roles it does not know.
- `adapter.mintKey({ session, scopes, ttl_s }) -> { status, body }`: calls `POST /mpc/ai-key` (above). `session` is the raw `user_id`. The answer is refused (502) when the key is not `mpk_` plus 40 characters, `key_hash` is not the sha256 of the key, or `scopes` are wider than asked.
- A product that cannot give a role for a page (static pages) must answer `401`. Do not trust a role in the page, a query or a body.

## Instance proxy routes the widget uses (0.4.2)
Browser to instance Worker, same host, path `/mpc/*`. All need an allowed `Origin`, except a same-origin GET, which a browser sends with no Origin: it is accepted on `Sec-Fetch-Site: same-origin` (or a Referer of the same origin) on an allowed host.
- `POST /mpc/v1/tickets` and `POST /mpc/v1/screenshots`: the body goes to the core; the role comes from the product session, never from the page. `Idempotency-Key` must be a UUID.
- `GET /mpc/v1/tickets/{ticket}` with header `x-mpc-status-token`: Check status.
- `POST /mpc/ai-link` `{kind, ticket?, screen?}`: when `ticket` is named, header `x-mpc-status-token` (the token returned when the ticket was made) is required; without it, or with a wrong one, the answer is 403 `not_yours` and no key is made. The token is passed to the core on the ticket read and the link call only, never to the product.
- A screenshot can be attached only to a ticket made by the session that uploaded it.

