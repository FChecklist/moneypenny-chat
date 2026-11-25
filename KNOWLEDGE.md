# Knowledge: what was proven and how

## Not run in a real browser (C7 to C12)
Everything for the widget, the bundle and the screenshot library was tested with a small fake DOM and plain pixel arrays in `bun test`. No browser, no Cloudflare and no real product ran.
- **Proven in tests:** screen content, shadow-root structure, the bundle text (built with Bun), the Worker logic as a function, the adapter against a fake product server, masking on fake fields (value blank while the picture is made, restored after, also on error), black pixels under masked boxes and editor boxes, size steps, no storage or cookie calls in the code.
- **Not proven:** that the built file loads and runs in a browser; that product CSS cannot reach the widget (only structure is checked); contrast, 44 px targets and keyboard walk; that a real DOM-to-canvas engine honours the blanked fields; that `canvas.toBlob` strips EXIF; pointer drag on a real canvas; `wrangler deploy` and routes; the real product session answer; Cloudflare Access.
- **Spec C8 proof lines say "browser test".** Those are covered here only at pixel and fake-DOM level. Run them in a browser before ship.

## Run
`bun run test` (secrets scan first). The Worker entry test writes `instances/<id>/dist/widget.js` (ignored by git); `bun scripts/build-widget.mjs` writes it too.
