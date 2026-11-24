// Fake samples on purpose (this file is exempt from the secrets scan).
import { test, expect } from 'bun:test';
import { scrub } from '../src/scrub.js';
const R = '[removed]';
const table = [
  ['mail me at user@example.com please', `mail me at ${R} please`], ['USER.NAME+tag@sub.example.co.in', R], ['a@b.co and c@d.org', `${R} and ${R}`],
  ["o'brien@example.com", R], ['write to x_y@example.com.', `write to ${R}.`],
  ['call 9876543210 now', `call ${R} now`], ['call +91 98765 43210 now', `call ${R} now`], ['phone: 098765-43210', `phone: ${R}`], ['(022) 2345 6789', R], ['+1 (415) 555-0132', R], ['98765.43210', R],
  ['card 4111 1111 1111 1111 ok', `card ${R} ok`], ['4111-1111-1111-1111', R], ['4111111111111111', R], ['amex 3782 822463 10005', `amex ${R}`], ['card 5555555555554444.', `card ${R}.`], ['1234567812345678', R],
  ['Players 25 and prizes 3', 'Players 25 and prizes 3'], ['Ticket T-0457 failed', 'Ticket T-0457 failed'], ['price 1,00,000 rupees', 'price 1,00,000 rupees'], ['on 2026-11-24 it broke', 'on 2026-11-24 it broke'],
  ['room 1234567', 'room 1234567'], ['version 1.2.3', 'version 1.2.3'], ['', ''], ['no data here', 'no data here'], ['two: 9876543210 and 8123456789', `two: ${R} and ${R}`],
  ['id12345678901', 'id12345678901'], ['line one\n9876543210\nline three', `line one\n${R}\nline three`], ['at 10:30, 11:45', 'at 10:30, 11:45'], ['5 of 600', '5 of 600'],
];
test('S-020 table of ' + table.length + ' samples', () => { expect(table.length).toBeGreaterThanOrEqual(30); for (const [i, o] of table) expect(scrub(i), i).toBe(o); });
test('S-020 non-string input does not throw', () => { expect(scrub(null)).toBe('null'); expect(scrub(12)).toBe('12'); });
