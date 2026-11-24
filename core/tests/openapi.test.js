import { test, expect } from 'bun:test';
import openapi from '../openapi.json' with { type: 'json' };
import { STATUS } from '../src/http.js';
const F2 = ['/v1/health', '/v1/version', '/v1/help/topics', '/v1/tickets', '/v1/screenshots', '/v1/tickets/{ticket}', '/v1/ai-links', '/v1/ai-links/{id}', '/ai/{id}', '/ai/{id}.json', '/v1/ai/context', '/v1/ai/notes', '/v1/team/tickets', '/v1/team/tickets/{ticket}'];
test('S-010 every path in F2 is present', () => { for (const p of F2) expect(openapi.paths[p], p).toBeDefined(); });
test('S-010 structure: version, operations have responses, every $ref resolves', () => {
  expect(openapi.openapi).toMatch(/^3\.0\./);
  for (const [p, ops] of Object.entries(openapi.paths)) for (const [m, op] of Object.entries(ops)) { expect(['get', 'post', 'patch', 'delete']).toContain(m); expect(Object.keys(op.responses).length, p + m).toBeGreaterThan(0); }
  const refs = JSON.stringify(openapi).match(/#\/[A-Za-z0-9_/]+/g) || [];
  for (const r of refs) { let n = openapi; for (const k of r.slice(2).split('/')) n = n?.[k]; expect(n, r).toBeDefined(); }
});
test('S-010 Error enum equals the error codes in http.js; built routes are not marked planned', () => {
  expect([...openapi.components.schemas.Error.properties.error.enum].sort()).toEqual(Object.keys(STATUS).sort());
  for (const p of ['/v1/tickets', '/v1/tickets/{ticket}']) for (const op of Object.values(openapi.paths[p])) expect(op['x-status']).toBe('built');
});
test('S-010 every declared error status of a built route is a status the core can send', () => {
  const codes = new Set(Object.values(STATUS).map(String));
  for (const p of ['/v1/tickets', '/v1/tickets/{ticket}', '/v1/team/tickets']) for (const op of Object.values(openapi.paths[p])) for (const s of Object.keys(op.responses)) if (+s >= 400) expect(codes.has(s), p + s).toBe(true);
});
