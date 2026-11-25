// C10: builds one file per instance: instances/<id>/dist/widget.js (one ES module, no other file needed).
// Usage: bun scripts/build-widget.mjs [id ...] [--out <dir>]   (no id: every instance)
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { checkConfig } from '../instances/lib/proxy.js';
const root = new URL('../', import.meta.url);
const rd = (id, f) => JSON.parse(readFileSync(new URL(`instances/${id}/${f}`, root), 'utf8'));
export const instanceIds = () => readdirSync(new URL('instances/', root), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'lib' && d.name !== 'tests').map((d) => d.name);

// Builds the bundle text from an instance record and its strings (the same two files a folder holds). Refuses a bad record or strings file, same check the Worker makes.
// The real-browser tests use this with a changed record (for example a Terms link) without writing a file.
export async function buildBundle(config, strings) {
  checkConfig(config, strings);
  const inst = { id: config.id, name: config.name, brand: config.brand || null, routes: config.routes || {}, strings };
  const r = await Bun.build({ entrypoints: [new URL('core/widget/boot.js', root).pathname], target: 'browser', format: 'esm', minify: true, define: { __MPC_INSTANCE__: JSON.stringify(inst) } });
  if (!r.success || r.outputs.length !== 1) throw new Error('build failed: ' + r.logs.join(' '));
  return await r.outputs[0].text();
}
// Returns the bundle text of one instance folder. Refuses a bad instance record or strings file (same check the Worker makes).
export async function buildWidget(id) {
  if (!instanceIds().includes(id)) throw new Error('unknown instance: ' + id);
  return buildBundle(rd(id, 'instance.json'), rd(id, 'strings.json'));
}
if (import.meta.main) {
  const a = process.argv.slice(2), oi = a.indexOf('--out'), out = oi >= 0 ? a.splice(oi, 2)[1] : null, ids = a.length ? a : instanceIds();
  for (const id of ids) {
    const dir = out ? new URL(id + '/', 'file://' + (out.endsWith('/') ? out : out + '/')) : new URL(`instances/${id}/dist/`, root);
    mkdirSync(dir, { recursive: true }); writeFileSync(new URL('widget.js', dir), await buildWidget(id)); console.log('built', id);
  }
}
