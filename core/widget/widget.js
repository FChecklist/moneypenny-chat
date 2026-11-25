// S-051: the widget. One script a product page loads. It draws inside a shadow root, uses no cookies and no storage, and
// sends nothing until the person taps Send. Usage: mountWidget({strings, base:'/mpc', capture?, match?, page?, screenLabel?, doc?})
import { view, step, initial, ticketBody } from './model.js';
import { makeApi } from './api.js';
import { CSS } from './widget.css.js';
import { HOME } from '../src/strings.js';

export function mountWidget(cfg) {
  const doc = cfg.doc || document, api = cfg.api || makeApi({ base: cfg.base || '/mpc' });
  const host = doc.createElement('div'); host.setAttribute('data-mpc-hide-zone', ''); // the panel is never in a screenshot
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style'); style.textContent = CSS; root.append(style);
  const fab = doc.createElement('button'); fab.className = 'fab'; fab.textContent = 'Moneypenny'; fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false');
  const panel = doc.createElement('div'); panel.className = 'panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', HOME.title);
  root.append(fab, panel);
  let st = initial(), open = false;
  const live = doc.createElement('div'); live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');

  const setOpen = (v) => { open = v; panel.hidden = !v; fab.setAttribute('aria-expanded', String(v)); if (v) draw(); else fab.focus(); };
  const dyn = () => ({ ...cfg, screenLabel: cfg.screenLabel });
  function draw(keepFocus) {
    const v = view(st, dyn()); panel.replaceChildren();
    const head = doc.createElement('header'), t = doc.createElement('h2'); t.textContent = v.title; t.tabIndex = -1;
    const close = doc.createElement('button'); close.className = 'secondary'; close.textContent = HOME.close; close.onclick = () => setOpen(false);
    head.append(t, close); panel.append(head);
    for (const l of v.lines) { const p = doc.createElement('p'); p.textContent = l; panel.append(p); }
    for (const c of v.controls) panel.append(control(c));
    if (v.error) { const e = doc.createElement('p'); e.className = 'err'; e.setAttribute('role', 'alert'); e.textContent = v.error; panel.append(e); }
    live.textContent = ''; panel.append(live);
    if (!keepFocus) t.focus();
  }
  function control(c) {
    if (c.kind === 'button' || c.kind === 'link') {
      const b = doc.createElement('button'); b.type = 'button'; b.textContent = c.label; if (c.kind === 'link' || c.secondary) b.className = 'secondary'; if (c.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      b.onclick = () => act(c.id); return b;
    }
    if (c.kind === 'text') {
      const w = doc.createElement('div'), id = 'f-' + c.id, l = doc.createElement('label'); l.htmlFor = id; l.textContent = c.label;
      const i = doc.createElement(c.multi ? 'textarea' : 'input'); i.id = id; i.value = c.value; i.maxLength = c.max; if (c.multi) i.rows = 4;
      w.append(l, i);
      if (c.counter) { const n = doc.createElement('p'); n.className = 'counter'; n.id = id + '-n'; n.textContent = c.counter; i.setAttribute('aria-describedby', n.id); w.append(n); i.oninput = () => { st = step(st, { id: c.id, value: i.value }); n.textContent = `${[...st[c.id]].length} of ${c.max}`; sync(); }; }
      else i.oninput = () => { st = step(st, { id: c.id, value: i.value }); };
      return w;
    }
    if (c.kind === 'notice') { const p = doc.createElement('p'); p.className = 'notice'; const [a, b] = c.text.split(c.link.text); p.append(a); const lk = doc.createElement('a'); lk.href = c.link.href; lk.target = '_blank'; lk.rel = 'noopener noreferrer'; lk.textContent = c.link.text; p.append(lk, b); return p; }
    if (c.kind === 'privacy') { const p = doc.createElement('p'); p.className = 'privacy'; p.textContent = c.text; return p; }
    if (c.kind === 'ailine') {
      const w = doc.createElement('div'), p = doc.createElement('p'); p.textContent = c.text; const b = doc.createElement('button'); b.type = 'button'; b.className = 'secondary'; b.textContent = c.copy;
      b.onclick = () => copyLink(c.for); w.append(p, b); return w;
    }
    throw new Error('unknown control');
  }
  // The Send and Next buttons follow the text length without a full redraw (a redraw would drop focus).
  function sync() { const v = view(st, dyn()); const bs = [...panel.querySelectorAll('button')]; for (const c of v.controls) if (c.kind === 'button' && (c.id === 'send' || c.id === 'next')) { const b = bs.find((x) => x.textContent === c.label); if (b) { b.disabled = !!c.disabled; b.setAttribute('aria-disabled', String(!!c.disabled)); } } }
  function say(msg) { live.textContent = msg; }
  async function copyLink(kind) {
    try { const url = await cfg.aiLink(kind, { ticket: st.sent && st.sent.ticket, topic: st.topic }); await (cfg.clipboard || navigator.clipboard).writeText(url); say('Link copied.'); } catch { say('Could not copy. Try again.'); }
  }
  async function act(id) {
    if (id === 'shot') return shot();
    if (id === 'status') { st = { ...st, screen: 'status', status: null }; draw(); const r = await api.status(st.sent.ticket); st = { ...st, status: r.ok ? r.body : null, error: r.ok ? null : 'Status is not available now.' }; return draw(); }
    if (id === 'send') return send();
    st = step(st, { id }); draw();
  }
  async function shot() { // the C4 hook: cfg.capture() returns a Blob (already masked and re-encoded) or null. Nothing is sent here.
    const b = await cfg.capture(); if (!b) return; st = { ...st, shotBlob: b, shot: true, shotId: null }; draw();
  }
  async function send() {
    if (st.sending) return;
    const body = ticketBody(st, cfg, cfg.page ? cfg.page() : '/');
    st = { ...st, sending: true, error: null }; draw(true);
    if (st.shotBlob && !st.shotId) {
      const u = await api.send('/v1/screenshots', null, { raw: st.shotBlob, contentType: st.shotBlob.type, sig: 'shot:' + st.shotBlob.size });
      if (!u.ok) { st = { ...st, sending: false, error: 'The picture was not sent. Try again.' }; return draw(); }
      st = { ...st, shotId: u.body.screenshot_id }; body.screenshot_id = st.shotId;
    }
    const r = await api.send('/v1/tickets', body);
    if (!r.ok) { st = { ...st, sending: false, error: 'Not sent. Try again.' }; return draw(); }
    st = { ...st, sending: false, shotBlob: null, sent: r.body, screen: st.screen === 'suggest.write' ? 'suggest.sent' : 'stuck.sent' }; draw();
  }
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } });
  fab.onclick = () => setOpen(!open);
  (cfg.target || doc.body).append(host);
  return { host, root, open: () => setOpen(true), close: () => setOpen(false), act, state: () => st, panel };
}
