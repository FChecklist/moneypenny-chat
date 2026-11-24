import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { validateInstance, parseInstances, secretNames, secretsFromEnv } from '../src/instance.js';
import schema from '../schema/instance.schema.json' with { type: 'json' };
import { fixture } from './helpers.js';
const good = () => fixture('instance-example.json');
test('S-011 the example record is valid', () => expect(validateInstance(good()).ok).toBe(true));
const bad = [
  ['id', { id: 'A' }], ['id', { id: undefined }], ['name', { name: '' }], ['origins empty', { allowed_origins: [] }], ['origin http', { allowed_origins: ['http://a.test'] }],
  ['origin with path', { allowed_origins: ['https://a.test/x'] }], ['retention', { retention_class: 'forever' }], ['enabled', { enabled: 'yes' }], ['routes label', { routes: { '/a': '' } }],
  ['routes key', { routes: { 'a': 'A' } }], ['routes key digits', { routes: { '/game/123': 'A' } }], ['routes key at', { routes: { '/a@b': 'A' } }], ['role_map', { role_map: { x: 'admin' } }], ['core_min', { core_min: 'one' }], ['tickets_per_day', { tickets_per_day: 0 }], ['require_ip', { require_ip: 'yes' }], ['brand', { brand: { primary: 'red' } }],
];
for (const [name, patch] of bad) test('S-011 invalid: ' + name, () => { const r = validateInstance({ ...good(), ...patch }); expect(r.ok).toBe(false); expect(r.errors.length).toBeGreaterThan(0); });
test('S-011 not an object', () => { for (const v of [null, [], 'x', 5]) expect(validateInstance(v).ok).toBe(false); });
test('S-011 schema file lists the same required fields as the validator', () => {
  for (const k of schema.required) expect(validateInstance({ ...good(), [k]: undefined }).ok, k).toBe(false);
  expect(Object.keys(schema.properties).sort()).toEqual(['ai_calls', 'allowed_origins', 'brand', 'core_max', 'core_min', 'enabled', 'id', 'kb_version', 'name', 'require_ip', 'retention_class', 'role_map', 'routes', 'tickets_per_day']);
});
test('S-011 parseInstances drops invalid and disabled records, bad JSON gives none', () => {
  expect([...parseInstances(JSON.stringify([good(), { id: 'x' }, { ...good(), id: 'off-one', enabled: false }])).keys()]).toEqual(['example-product']);
  expect(parseInstances('{oops').size).toBe(0);
});
test('S-011 secret names come from the id; short or missing secrets are ignored', () => {
  expect(secretNames('town-hall')).toEqual({ sign: ['SECRET_TOWN_HALL', 'SECRET_TOWN_HALL_NEXT'], assert: ['SECRET_TOWN_HALL_ASSERT', 'SECRET_TOWN_HALL_ASSERT_NEXT'] });
  expect(secretsFromEnv({ SECRET_X_Y: 'a'.repeat(20), SECRET_X_Y_NEXT: 'short' }, 'x-y', 'sign')).toEqual(['a'.repeat(20)]);
});
test('S-011 the instance record has no secret field in the example', () => expect(JSON.stringify(good())).not.toMatch(/secret|password|token/i));
test('C6 ai_calls: up to 20 one-line strings; anything else is refused', () => {
  expect(validateInstance({ ...good(), ai_calls: ['GET /events/{event}  read the draft'] }).ok).toBe(true);
  for (const bad of ['x', [5], ['a\nb'], ['a`b'], [''], Array(21).fill('x')]) expect(validateInstance({ ...good(), ai_calls: bad }).ok, JSON.stringify(bad)).toBe(false);
});
