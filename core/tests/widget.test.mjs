// C7 (S-051 to S-059). A small fake DOM is used: no browser ran. See docs/DECISIONS.md.
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { view, step, initial, ticketBody, LIMITS } from '../widget/model.js';
import { makeApi } from '../widget/api.js';
import { mountWidget } from '../widget/widget.js';
import { CSS } from '../widget/widget.css.js';
import { STANDARD_AI_LINE, NOTICE, PRIVACY } from '../src/strings.js';
import { checkStrings } from '../../contract/strings-rules.mjs';

const strings = { terms_url: 'https://p.example/terms', help_topics: [{ id: 'a-topic', label: 'Topic A', answer: 'Do this.' }, { id: 'b-topic', label: 'Topic B', answer: null }], stuck: [{ id: 's1', label: 'Stuck one' }], screens: ['Create a game', 'Run a game'] };
const cfg = (x = {}) => ({ strings, screenLabel: 'Create a game', ...x });
const go = (st, ...ids) => ids.reduce((s, id) => step(s, { id }), st);
const walk = (c = cfg(), st = initial()) => view(st, c);

// ---- fake DOM
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; this.hidden = false; this.value = ''; this._text = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; }
  append(...n) { for (const x of n) this.children.push(typeof x === 'string' ? Object.assign(new El('#text'), { _text: x }) : x); }
  replaceChildren() { this.children = []; }
  set textContent(t) { this._text = t; this.children = []; } get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  attachShadow() { this.shadowRoot = new El('#shadow'); return this.shadowRoot; }
  addEventListener(k, f) { this.listeners[k] = f; } focus() { El.focused = this; }
  get isConnected() { return true; }
  all(tag) { return [this, ...this.children.flatMap((c) => c.all(tag))].filter((e) => !tag || e.tag === tag); }
  querySelectorAll(sel) { return this.all(sel); }
  click() { return this.onclick && this.onclick(); }
}
const fakeDoc = () => ({ body: new El('body'), createElement: (t) => new El(t) });
const mount = (x = {}) => { const doc = fakeDoc(), w = mountWidget({ ...cfg(), doc, ...x }); return { doc, w, texts: () => w.panel.all().map((e) => e.textContent).join('\n'), buttons: () => w.panel.all('button').filter((b) => b.textContent !== 'Close') }; };

test('S-051 the widget draws in a shadow root with its own style; the page gets only one host element and no style', () => {
  const { doc, w } = mount();
  expect(w.root.shadowRoot === undefined).toBe(true); // the root is the shadow root itself
  expect(doc.body.children).toEqual([w.host]);
  expect(w.root.children.some((c) => c.tag === 'style' && c._text === CSS)).toBe(true);
  expect(w.host.children.length).toBe(0); // nothing sits in the light DOM where page CSS could reach
  expect(CSS).toContain(':host{all:initial'); expect(CSS).toContain('--mpc-primary'); expect(CSS).toContain('min-height:44px');
  expect(w.root.all('button')[0].attrs['aria-expanded']).toBe('false');
});
test('S-051 no cookies and no storage: the widget code does not touch them', () => {
  for (const f of readdirSync(new URL('../widget', import.meta.url))) { const t = readFileSync(new URL('../widget/' + f, import.meta.url), 'utf8'); expect(t).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/); }
  expect(readFileSync(new URL('../widget/api.js', import.meta.url), 'utf8')).toContain("credentials: 'omit'");
});
test('S-052 home has exactly 3 buttons in the owner order', () => {
  const v = walk(); expect(v.controls.filter((c) => c.kind === 'button').length).toBe(3);
  expect(v.controls.map((c) => c.label)).toEqual(['Need help', 'Suggest an option or feature', 'Stuck: tell where']); expect(v.lines).toEqual(['What do you need?']);
  const m = mount(); m.w.open(); expect(m.buttons().length).toBe(3);
});
test('S-053 option 1: topic list, answer, Still need help leads to option 3 with the topic filled in', () => {
  let st = go(initial(), 'go:help'); let v = view(st, cfg());
  expect(v.title).toBe('Pick a topic'); expect(v.controls.map((c) => c.label)).toEqual(['Topic A', 'Topic B', 'Something else', 'Back']);
  st = go(st, 'topic:a-topic'); v = view(st, cfg()); expect(v.title).toBe('Topic A'); expect(v.lines).toEqual(['Do this.']);
  expect(v.controls.map((c) => c.label || c.copy)).toEqual(['Got it', 'Still need help', 'Copy link', 'Back']);
  st = go(st, 'still'); expect(st.screen).toBe('stuck.write'); expect(st.topic).toBe('a-topic');
  expect(view(go(initial(), 'go:help', 'topic:b-topic'), cfg()).lines).toEqual(['No answer is written yet.']); // no answer is invented
});
test('S-053 screen 1.3: matcher gives up to 3 buttons; none gives "No match yet." and a path on', () => {
  let st = step(go(initial(), 'go:help', 'else'), { id: 'find', value: 'zzz' });
  expect(view(st, cfg({ match: () => [] })).lines).toEqual(['No match yet.']); expect(view(st, cfg({ match: () => [] })).controls.some((c) => c.id === 'still')).toBe(true);
  const four = [1, 2, 3, 4].map((i) => ({ id: 't' + i, label: 'T' + i }));
  expect(view(st, cfg({ match: () => four })).controls.filter((c) => c.id.startsWith('topic:')).length).toBe(3);
  expect(step(st, { id: 'find', value: 'x'.repeat(500) }).find.length).toBe(LIMITS.findMax);
});
test('S-054 option 2: Send is disabled under 10 characters and on at 10; counter shown; type has no default', () => {
  let st = go(initial(), 'go:suggest'); expect(view(st, cfg()).controls.map((c) => c.label)).toEqual(['Option', 'Feature', 'Wording', 'Back']); expect(st.type).toBeNull();
  st = go(st, 'type:feature'); const send = (s) => view(s, cfg()).controls.find((c) => c.id === 'send');
  expect(send(st).disabled).toBe(true); st = step(st, { id: 'text', value: '123456789' }); expect(send(st).disabled).toBe(true);
  st = step(st, { id: 'text', value: '1234567890' }); expect(send(st).disabled).toBe(false);
  expect(view(st, cfg()).controls.find((c) => c.counter).counter).toBe('10 of 600'); expect(step(st, { id: 'text', value: 'x'.repeat(700) }).text.length).toBe(600);
  expect(view(st, cfg()).lines).toEqual(['One idea per message. Short is fine.']);
});
test('S-055 option 3: page label shown, other screen picked from the list, stuck item picked, summary', () => {
  let st = go(initial(), 'go:stuck'); expect(view(st, cfg()).lines).toEqual(['Screen: Create a game']);
  expect(view(st, { strings, screenLabel: null }).lines).toEqual(['Screen: This screen']);
  expect(view(st, cfg({ strings: { ...strings, screens: [] } })).controls.map((c) => c.label)).not.toContain('Another screen'); // no empty list
  st = go(st, 'where:other', 'screen:1', 'stuck:s1'); expect(view(st, cfg()).title).toBe('Write what happened');
  st = step(go(st, 'back'), { id: 'x' }); st = go(initial(), 'go:stuck', 'where:other', 'screen:1', 'stuck:s1'); st = step(st, { id: 'text', value: 'a'.repeat(300) });
  const v = view(go(st, 'next'), cfg()); expect(v.title).toBe('Check and send'); expect(v.lines).toEqual(['Screen: Run a game', 'Stuck: Stuck one', 'a'.repeat(100)]);
  expect(ticketBody(go(st, 'next'), cfg(), '/console/x')).toEqual({ screen: '/console/x', screen_label: 'Run a game', option: 'stuck', topic: 's1', text: 'a'.repeat(300) });
  expect(view(go(initial(), 'go:stuck', 'where:here'), cfg()).controls.map((c) => c.label)).toEqual(['Stuck one', 'Something else', 'Back']);
  const other = go(initial(), 'go:stuck', 'where:here', 'stuck:other'); expect(view(other, cfg()).controls.find((c) => c.id === 'next').disabled).toBe(true); // something else needs words
  expect(step(other, { id: 'next' }).screen).toBe('stuck.write');
  expect(ticketBody(other, cfg(), '/').topic).toBeNull();
});
test('round 5: every screen renders with no checkbox or radio (element, type or role); null terms_url hides the link', () => {
  const paths = [[], ['go:help'], ['go:help', 'topic:a-topic'], ['go:suggest'], ['go:suggest', 'type:option'], ['go:stuck'], ['go:stuck', 'where:here'], ['go:stuck', 'where:here', 'stuck:s1'], ['go:stuck', 'where:here', 'stuck:s1', 'next']];
  for (const x of [{}, { strings: { ...strings, terms_url: null } }]) for (const p of paths) {
    const m = mount(x); m.w.open(); for (const id of p) m.w.act(id);
    const els = [m.w.panel, ...m.w.panel.all()];
    expect(els.length).toBeGreaterThan(1);
    for (const e of els) { expect(['checkbox', 'radio']).not.toContain(e.type); expect(['checkbox', 'radio']).not.toContain(e.attrs?.type); expect(['checkbox', 'radio']).not.toContain(e.attrs?.role); }
    if (x.strings && p.length >= 2 && m.texts().includes('Sending shares')) { expect(m.w.panel.all('a').length).toBe(0); expect(m.texts()).not.toContain('Read the Terms'); }
  }
  const n = view(go(initial(), 'go:suggest', 'type:option'), cfg({ strings: { ...strings, terms_url: null } })).controls.find((c) => c.kind === 'notice'); expect(n.link).toBeNull();
});
test('S-056 notice line with a Terms link on 2.2 and 3.5; no checkbox anywhere; no tick box words', () => {
  const n = (st) => view(st, cfg()).controls.find((c) => c.kind === 'notice');
  const s2 = go(initial(), 'go:suggest', 'type:option'), s3 = go(initial(), 'go:stuck', 'where:here', 'stuck:s1', 'next');
  for (const s of [s2, s3]) { expect(n(s).text).toBe(NOTICE); expect(n(s).link).toEqual({ text: 'Terms', href: 'https://p.example/terms' }); }
  const m = mount(); m.w.open(); m.w.act('go:suggest'); m.w.act('type:option');
  const a = m.w.panel.all('a'); expect(a.length).toBe(1); expect(a[0].attrs.rel || a[0].rel).toBeTruthy(); expect(a[0].href).toBe('https://p.example/terms'); expect(m.texts()).toContain(NOTICE);
  expect(m.w.panel.all().filter((e) => e.tag === 'input' && e.type === 'checkbox').length).toBe(0);
  for (const f of readdirSync(new URL('../widget', import.meta.url))) expect(readFileSync(new URL('../widget/' + f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')).not.toMatch(/checkbox|type\s*=\s*['"]?radio/i);
  expect(view(s2, cfg()).controls.find((c) => c.kind === 'privacy').text).toBe(PRIVACY);
});
test('S-057 the standard AI line is exact on 1.2, 2.4 and 3.6, each with Copy link; not on home', () => {
  const sent = { ticket: 'T-0001' };
  const screens = [go(initial(), 'go:help', 'topic:a-topic'), { ...initial(), screen: 'suggest.sent', sent }, { ...initial(), screen: 'stuck.sent', sent }];
  for (const s of screens) { const c = view(s, cfg()).controls.find((x) => x.kind === 'ailine'); expect(c.text).toBe(STANDARD_AI_LINE); expect(STANDARD_AI_LINE.length).toBe(44); expect(c.copy).toBe('Copy link'); }
  expect(view(initial(), cfg()).controls.some((c) => c.kind === 'ailine')).toBe(false);
  expect(view(screens[1], cfg()).lines).toEqual(['Idea number T-0001.']); expect(view(screens[2], cfg()).lines).toEqual(['Problem number T-0001.']);
});
test('S-057 Copy link asks the instance for a link and copies it; a failure says so in plain words', async () => {
  const copied = []; let fail = false;
  const m = mount({ aiLink: async (k) => { if (fail) throw new Error('x'); return 'https://p.example/ai/1?k=' + k; }, clipboard: { writeText: async (t) => void copied.push(t) } });
  m.w.open(); m.w.act('go:help'); m.w.act('topic:a-topic');
  await m.buttons().find((b) => b.textContent === 'Copy link').click(); await new Promise((r) => setTimeout(r, 5));
  expect(copied).toEqual(['https://p.example/ai/1?k=help']);
  fail = true; await m.buttons().find((b) => b.textContent === 'Copy link').click(); await new Promise((r) => setTimeout(r, 5)); expect(m.texts()).toContain('Could not copy. Try again.');
});
test('S-058 double tap sends one ticket; a retry reuses the same key; a network fault is retried', async () => {
  const seen = []; let n = 0;
  const fetchFn = async (u, init) => { seen.push(init.headers['idempotency-key']); if (++n === 1) throw new Error('net'); await new Promise((r) => setTimeout(r, 5)); return new Response(JSON.stringify({ ticket: 'T-0001', status_token: 'tok' }), { status: 201 }); };
  const api = makeApi({ fetchFn, sleep: async () => {} });
  const [a, b] = await Promise.all([api.send('/v1/tickets', { x: 1 }), api.send('/v1/tickets', { x: 1 })]);
  expect(a).toBe(b); expect(a.ok).toBe(true); expect(seen.length).toBe(2); expect(new Set(seen).size).toBe(1); // 1 fault + 1 success, one key
  const c = await api.send('/v1/tickets', { x: 2 }); expect(c.ok).toBe(true); expect(seen[2]).not.toBe(seen[0]); // new content, new key
});
test('S-058 the widget send path: one POST on a double tap; errors give a plain line and keep the text', async () => {
  const posts = []; let ok = false;
  const fetchFn = async (u, init) => { posts.push(u); return ok ? new Response(JSON.stringify({ ticket: 'T-0002', status_token: 't' }), { status: 201 }) : new Response(JSON.stringify({ error: 'rate' }), { status: 429 }); };
  const m = mount({ api: makeApi({ fetchFn, sleep: async () => {} }) }); m.w.open();
  for (const id of ['go:suggest', 'type:option']) m.w.act(id); m.w.act('text'); // no-op id for a button: ignored
  m.w.panel.all('textarea')[0].value = 'a long enough idea'; m.w.panel.all('textarea')[0].oninput();
  await m.w.act('send'); expect(m.texts()).toContain('Not sent. Try again.'); expect(m.w.state().text).toBe('a long enough idea');
  ok = true; await Promise.all([m.w.act('send'), m.w.act('send')]); expect(posts.length).toBe(2); // one failed try, one good send; the second tap added nothing
  expect(m.w.state().screen).toBe('suggest.sent'); expect(m.texts()).toContain('Idea number T-0002.');
});
test('S-058 the C4 screenshot hook: nothing is sent before Send; then the picture goes first and its id rides on the ticket', async () => {
  const calls = []; const blob = { type: 'image/jpeg', size: 9 };
  const fetchFn = async (u, init) => { calls.push([u, init.body === blob ? 'blob' : init.body]); return u.endsWith('screenshots') ? new Response(JSON.stringify({ screenshot_id: 'abcdefgh12345678' }), { status: 201 }) : new Response(JSON.stringify({ ticket: 'T-0003', status_token: 't' }), { status: 201 }); };
  const m = mount({ capture: async () => blob, api: makeApi({ fetchFn, sleep: async () => {} }) }); m.w.open();
  m.w.act('go:suggest'); m.w.act('type:option'); await m.w.act('shot'); expect(calls.length).toBe(0); expect(m.texts()).toContain('Change screenshot');
  m.w.panel.all('textarea')[0].value = '0123456789'; m.w.panel.all('textarea')[0].oninput(); await m.w.act('send');
  expect(calls.map((c) => c[0])).toEqual(['/mpc/v1/screenshots', '/mpc/v1/tickets']); expect(JSON.parse(calls[1][1]).screenshot_id).toBe('abcdefgh12345678');
  expect(mountWidgetHasNoShotWithoutHook()).toBe(true);
});
function mountWidgetHasNoShotWithoutHook() { const m = mount(); m.w.open(); m.w.act('go:suggest'); m.w.act('type:option'); return !m.texts().includes('screenshot'); }
test('S-059 status screen reads the ticket with the token kept in memory; a missing token or error says so plainly', async () => {
  const seen = [];
  const fetchFn = async (u, init) => { seen.push([u, init.method, init.headers['x-mpc-status-token']]); return init.method === 'POST' ? new Response(JSON.stringify({ ticket: 'T-0004', status_token: 'tok-9' }), { status: 201 }) : new Response(JSON.stringify({ ticket: 'T-0004', status: 'seen', team_note: 'Looking at it.' }), { status: 200 }); };
  const m = mount({ api: makeApi({ fetchFn, sleep: async () => {} }) }); m.w.open();
  for (const id of ['go:stuck', 'where:here', 'stuck:s1', 'next']) m.w.act(id); await m.w.act('send'); expect(m.texts()).toContain('Problem number T-0004.');
  await m.buttons().find((b) => b.textContent === 'Check status').click(); await new Promise((r) => setTimeout(r, 5));
  expect(seen[1]).toEqual(['/mpc/v1/tickets/T-0004', 'GET', 'tok-9']); expect(m.texts()).toContain('Ticket T-0004: seen.'); expect(m.texts()).toContain('Looking at it.');
  expect(await makeApi({ fetchFn }).status('T-0001')).toEqual({ ok: false, error: 'not_found' });
});
test('keyboard and screen reader: dialog role and name, labelled boxes, focus on the title, Escape closes and returns focus', () => {
  const m = mount(); expect(m.w.panel.attrs.role).toBe('dialog'); expect(m.w.panel.attrs['aria-label']).toBe('Moneypenny Chat');
  m.w.open(); expect(El.focused.tag).toBe('h2'); expect(El.focused.tabIndex).toBe(-1);
  m.w.act('go:suggest'); m.w.act('type:option');
  const ta = m.w.panel.all('textarea')[0], lab = m.w.panel.all('label')[0]; expect(lab.htmlFor).toBe(ta.id); expect(ta.attrs['aria-describedby']).toBeTruthy();
  m.w.panel.listeners.keydown({ key: 'Escape', stopPropagation() {} }); expect(m.w.panel.hidden).toBe(true); expect(El.focused.className).toBe('fab');
  for (const b of m.w.panel.all('button')) expect(b.tag).toBe('button'); // real buttons: Enter and Space work with no extra code
});
test('every screen text passes the owner word rules; unknown screen is refused, not defaulted', () => {
  const all = ['home', 'help.topics', 'help.else', 'suggest.type', 'suggest.write', 'stuck.where', 'stuck.pick', 'stuck.what', 'stuck.write', 'stuck.send', 'status'].map((s) => view({ ...initial(), screen: s }, cfg()));
  all.push(view({ ...initial(), screen: 'help.answer', topic: 'a-topic' }, cfg()), view({ ...initial(), screen: 'suggest.sent', sent: { ticket: 'T-0001' } }, cfg()), view({ ...initial(), screen: 'stuck.sent', sent: { ticket: 'T-0001' } }, cfg()));
  expect(checkStrings(all.map((v) => [v.title, ...v.lines, ...v.controls.map((c) => c.label || c.copy || c.text || '')]))).toEqual([]);
  expect(() => view({ ...initial(), screen: 'nope' }, cfg())).toThrow();
});
