import { test, expect } from 'bun:test';
import { cleanPath, segmentsFromRoutes, screenLabel } from '../src/path.js';
const routes = { '/console/create': 'Create a game', '/console/game/:x/run': 'Run a game' }, A = segmentsFromRoutes(routes);
test('S-019 known segments stay; ids and names become :x', () => {
  expect(cleanPath('/console/create', A)).toBe('/console/create');
  expect(cleanPath('/console/priya.sharma/create', A)).toBe('/console/:x/create');
  expect(cleanPath('/console/game/12345/run', A)).toBe('/console/game/:x/run');
  expect(cleanPath('/CONSOLE/Create', A)).toBe('/console/create');
});
test('S-019 query and fragment are dropped; other instance words are not allowed', () => {
  expect(cleanPath('/console/create?email=a@b.c#top', A)).toBe('/console/create');
  expect(cleanPath('/pricing', A)).toBe('/:x'); expect(cleanPath('/pricing', segmentsFromRoutes({ '/pricing': 'Price' }))).toBe('/pricing');
});
test('S-019 empty, odd and long input', () => {
  expect(cleanPath('', A)).toBe('/'); expect(cleanPath(undefined, A)).toBe('/'); expect(cleanPath('/', A)).toBe('/');
  expect(cleanPath('/console/' + 'a'.repeat(300), A).length).toBeLessThanOrEqual(120);
});
test('S-019 label from the route table; unknown gives null', () => {
  expect(screenLabel('/console/game/:x/run', routes, A)).toBe('Run a game'); expect(screenLabel('/console/other', routes, A)).toBeNull();
});
