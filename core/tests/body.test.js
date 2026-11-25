import { test, expect } from 'bun:test';
import { MAX, readBytes, readText, parseJsonObject } from '../src/body.js';
const stream = (n, chunk = 1000) => new ReadableStream({ start(c) { let left = n; while (left > 0) { const k = Math.min(chunk, left); c.enqueue(new Uint8Array(k).fill(97)); left -= k; } c.close(); } });
const req = (body, headers = {}) => new Request('https://x.test/', { method: 'POST', body, headers, duplex: 'half' });
test('S-016 limits are the contract values', () => { expect(MAX.json).toBe(8192); expect(MAX.screenshot).toBe(2 * 1024 * 1024); });
test('S-016 exact limit is accepted, one byte over is refused (stream, no content-length)', async () => {
  expect((await readBytes(req(stream(MAX.json)), MAX.json)).length).toBe(MAX.json);
  expect(await readBytes(req(stream(MAX.json + 1)), MAX.json)).toBeNull();
});
test('S-016 declared length over the limit is refused before reading', async () => {
  let pulled = false; const s = new ReadableStream({ pull(c) { pulled = true; c.close(); } }, { highWaterMark: 0 });
  expect(await readBytes({ headers: new Headers({ 'content-length': String(MAX.json + 1) }), body: s }, MAX.json)).toBeNull(); expect(pulled).toBe(false);
});
test('S-016 string body at and over the limit; empty body', async () => {
  expect((await readText(req('a'.repeat(MAX.json)), MAX.json)).length).toBe(MAX.json);
  expect(await readText(req('a'.repeat(MAX.json + 1)), MAX.json)).toBeNull();
  expect(await readText(new Request('https://x.test/'), MAX.json)).toBe('');
});
test('S-016 bad JSON, array and scalar are refused; an object passes', () => {
  expect(parseJsonObject('{oops').ok).toBe(false); expect(parseJsonObject('[1]').ok).toBe(false); expect(parseJsonObject('5').ok).toBe(false); expect(parseJsonObject('null').ok).toBe(false);
  expect(parseJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
});
