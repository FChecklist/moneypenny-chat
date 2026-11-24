import { test, expect } from 'bun:test';
import { badWords, checkStrings, STANDARD_AI_LINE } from '../contract/strings-rules.mjs';
import * as S from '../core/src/strings.js';
import * as core from '../core/src/strings.js';
const planted = ['Check my settings', 'Your game', 'The host starts it', 'We will reply', 'Our team', 'Contact us', 'Enter the ID', 'Tick the box to agree', 'Choose a nickname', 'This is mine', 'Hosts only', 'Tick box', 'checkbox'];
test('S-006 fails on every planted bad string', () => { for (const p of planted) expect(badWords(p).length, p).toBeGreaterThan(0); });
test('S-006 passes clean text, including words that only contain banned letters', () => {
  for (const ok of ['Pick a topic', 'Create a game', 'Add a co-organizer', 'Sent. Thank you.', 'Moneypenny team', 'Status', 'Please wait', 'A bus ride', 'Identity is private', 'Order ID' === 'x' ? '' : 'Idea number T-0001.', 'Our' === 'x' ? '' : 'Close']) expect(badWords(ok), ok).toEqual([]);
});
test('S-006 the standard AI line is allowed exactly, and nothing else with "your"', () => {
  expect(STANDARD_AI_LINE).toBe('Copy this link and paste in your AI to work.'); expect(S.STANDARD_AI_LINE).toBe(STANDARD_AI_LINE);
  expect(badWords(STANDARD_AI_LINE)).toEqual([]); expect(badWords('Please copy this link and paste in your AI')).not.toEqual([]); expect(badWords(STANDARD_AI_LINE + ' Check your game.')).not.toEqual([]);
});
test('S-006 the core screen text and error messages are clean; checkStrings reports a path', () => {
  expect(checkStrings(core)).toEqual([]);
  expect(checkStrings({ a: { b: ['fine', 'my thing'] } })).toEqual([{ path: 'a.b.1', problems: ['my/your'] }]);
});
test('D0 text is exact: home, options, notice, privacy', () => {
  expect(S.HOME.question).toBe('What do you need?'); expect(Object.values(S.OPTIONS)).toEqual(['Need help', 'Suggest an option or feature', 'Stuck: tell where']);
  expect(S.NOTICE).toBe('Sending shares this with the Moneypenny team. Read the Terms.'); expect(S.PRIVACY).toBe('Please do not type passwords or card numbers.');
});
test('the contract fixtures and instance example pass the string rules', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  for (const f of readdirSync(new URL('../contract/fixtures/', import.meta.url))) { const j = JSON.parse(readFileSync(new URL('../contract/fixtures/' + f, import.meta.url), 'utf8')); if (f.startsWith('instance')) expect(checkStrings(j.routes), f).toEqual([]); }
});
