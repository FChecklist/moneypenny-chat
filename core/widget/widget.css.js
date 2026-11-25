// S-051: styles live inside the shadow root, so page CSS cannot reach them. The theme is set by CSS variables on the host element.
export const CSS = `:host{all:initial;--mpc-primary:#1f4e8c;--mpc-on:#fff;--mpc-bg:#fff;--mpc-text:#1a1a1a;font:16px/1.4 system-ui,sans-serif}
*{box-sizing:border-box}
.fab{position:fixed;right:16px;bottom:16px;min-height:44px;min-width:44px;padding:0 18px;border:0;border-radius:24px;background:var(--mpc-primary);color:var(--mpc-on);font:inherit;cursor:pointer;z-index:2147483000}
.panel{position:fixed;right:16px;bottom:72px;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 96px);overflow:auto;background:var(--mpc-bg);color:var(--mpc-text);border:1px solid #888;border-radius:12px;padding:16px;z-index:2147483000}
.panel[hidden]{display:none}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
h2{font-size:1.1rem;margin:8px 0}
button,.linkbtn{display:block;width:100%;min-height:44px;margin:8px 0;padding:8px 12px;border:2px solid var(--mpc-primary);border-radius:8px;background:var(--mpc-primary);color:var(--mpc-on);font:inherit;cursor:pointer;text-align:center}
button.secondary,.linkbtn{background:transparent;color:var(--mpc-primary)}
button[disabled]{opacity:.5;cursor:not-allowed}
header button{width:auto;margin:0}
label{display:block;margin:8px 0 4px}
input,textarea{width:100%;font:inherit;padding:8px;min-height:44px;border:2px solid #555;border-radius:8px}
:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}
.hint,.counter,.privacy,.notice{font-size:.9rem}
.err{color:#9b1c1c}
a{color:var(--mpc-primary)}
@media (prefers-reduced-motion:no-preference){.panel{transition:opacity .15s}}`;
