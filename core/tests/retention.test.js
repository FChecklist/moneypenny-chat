import { test, expect } from 'bun:test';
import { eraseAtCreate, eraseAtDone } from '../src/retention.js';
const H = 3600e3, D = 24 * H, T = 1_800_000_000_000;
test('S-025 games: 24 hours after receipt, also after done', () => {
  expect(eraseAtCreate('games', T)).toBe(T + 24 * H); expect(eraseAtDone('games', T, T + 5 * H)).toBe(T + 24 * H);
});
test('S-025 records: 90 days at receipt; done gives done + 30 days, never past 90 days', () => {
  expect(eraseAtCreate('records', T)).toBe(T + 90 * D);
  expect(eraseAtDone('records', T, T + 2 * D)).toBe(T + 32 * D);
  expect(eraseAtDone('records', T, T + 80 * D)).toBe(T + 90 * D);
});
