// 0.4.3 (review of 0.4.2): the browser tests (`bun run test:browser`) check that the widget uses no cookie, no storage and no third-party address, but they are not part of
// the default `bun run test`. This is the cheap guard that IS: it reads the widget source (core/widget, every .js file, the screenshot library too) and fails if it finds
// document.cookie, localStorage, sessionStorage, or a fetch( to anything but a path on the page's own site. Comments are ignored, so a comment may still say "no cookies".
// It is a plain text scan, not a proof: the browser tests stay the real check (see docs/DECISIONS.md, round 8).
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../widget/', import.meta.url);
const files = (d = DIR, prefix = '') => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(new URL(e.name + '/', d), prefix + e.name + '/') : e.name.endsWith('.js') ? [prefix + e.name] : []));
// Code only: block comments and line comments removed (a "//" right after ":" is a web address inside a string, so it stays).
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// Returns a list of problems found in one file's source text.
export function scan(src) {
  const c = code(src), out = [];
  if (/\bdocument\s*\.\s*cookie\b/.test(c)) out.push('document.cookie');
  if (/\blocalStorage\b/.test(c)) out.push('localStorage');
  if (/\bsessionStorage\b/.test(c)) out.push('sessionStorage');
  for (const m of c.matchAll(/\bfetch\s*\(\s*([^)]*)/g)) { // the first argument: a path on this site is fine; a variable or the spread of arguments is fine (the address was set elsewhere, and any literal address there is caught below)
    const a = m[1].trim();
    if (/^['"`]/.test(a) && !/^['"`]\/(?!\/)/.test(a)) out.push('fetch to ' + a.slice(0, 40)); // a quoted address that does not start with a single "/"
  }
  if (/['"`]\s*(?:https?:)?\/\/[a-z0-9]/i.test(c)) out.push('a written-out web address'); // no third-party address is written into the widget; the Terms link comes from the instance record
  return out;
}

test('the scan itself works: it flags each forbidden thing and lets a same-site fetch and comments through', () => {
  expect(scan("const x = document.cookie;")).toEqual(['document.cookie']);
  expect(scan("document . cookie = 'a=b'")).toEqual(['document.cookie']);
  expect(scan("localStorage.setItem('a', 1)")).toEqual(['localStorage']);
  expect(scan("window.sessionStorage.getItem('a')")).toEqual(['sessionStorage']);
  expect(scan("fetch('https://tracker.example/hit')").length).toBeGreaterThan(0);
  expect(scan("fetch('//tracker.example/hit')").length).toBeGreaterThan(0);
  expect(scan('fetch(`https://tracker.example/${id}`)').length).toBeGreaterThan(0);
  expect(scan("fetch('relative/path')").length).toBeGreaterThan(0); // not a path on this site's root
  expect(scan("await fetch('/mpc/ai-link', { method: 'POST' })")).toEqual([]);
  expect(scan('const f = (...a) => fetch(...a);')).toEqual([]);
  expect(scan("// no cookies, no localStorage, no fetch('https://x.example')\n/* document.cookie */ const ok = 1;")).toEqual([]);
});

test('0.4.3 the widget source has no document.cookie, no localStorage, no sessionStorage, and no fetch to a third-party address', () => {
  const list = files(); expect(list.length).toBeGreaterThanOrEqual(10); // the scan really read the widget (api, boot, model, widget, css, and the screenshot library)
  expect(list).toContain('api.js'); expect(list).toContain('boot.js'); expect(list).toContain('shot/capture.js');
  const found = {}; for (const f of list) { const p = scan(readFileSync(new URL(f, DIR), 'utf8')); if (p.length) found[f] = p; }
  expect(found).toEqual({});
});
