# Contract

What an instance and the core agree on. The core publishes these; every instance pins a version.

- `../core/openapi.json`: the API (paths from section F2 of the spec; routes not built yet are marked `x-status: planned`).
- `../core/schema/instance.schema.json`: the instance record.
- `strings-rules.mjs`: owner string rules and the standard AI line. The core test and each instance test use it.
- `fixtures/`: sample instance record and sample ticket bodies. The core tests post these to the core.

Calls from an instance to the core are signed: headers `x-mpc-instance`, `x-mpc-ts`, `x-mpc-nonce`, `x-mpc-sig`.
Ticket creation also needs `x-mpc-assertion` (role proof from the product) and `idempotency-key` (a UUID).
`x-mpc-ip` is optional: the instance may pass the visitor address so the core can count per address (hashed, rotates daily, never stored).
