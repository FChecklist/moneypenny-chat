import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/version.js';
import openapi from '../openapi.json' with { type: 'json' };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
test('S-009 versions agree: core, root, VERSION file, OpenAPI, both changelogs', () => {
  expect(VERSION).toBe('0.4.0');
  expect(JSON.parse(read('../package.json')).version).toBe(VERSION);
  expect(JSON.parse(read('../../package.json')).version).toBe(VERSION);
  expect(read('../../VERSION').trim()).toBe(VERSION);
  expect(openapi.info.version).toBe(VERSION);
  expect(read('../CHANGELOG.md')).toContain('## ' + VERSION);
  expect(read('../../CHANGELOG.md')).toContain('## ' + VERSION);
});
