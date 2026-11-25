// S-003: scan every text file of the working tree. Runs first in `bun run test`. Usage: bun scripts/secrets-scan.mjs [root]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHits } from './patterns.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler']);
// Test files that hold fake samples on purpose (made-up data to test the scrub, not real data).
export const EXEMPT = new Set(['core/tests/scrub.test.js', 'core/tests/tickets.test.js', 'tests/secrets.test.js', 'tests/history.test.js']);
const TEXT = /\.(js|mjs|json|css|html|toml|sql|md|txt|yml|yaml)$|^VERSION$/;

export function scan(root, exempt = EXEMPT) {
  const found = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      if (SKIP_DIRS.has(n)) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const rel = relative(root, p).split('\\').join('/');
      if (!TEXT.test(n) || exempt.has(rel)) continue;
      for (const name of findHits(readFileSync(p, 'utf8'))) found.push({ file: rel, kind: name });
    }
  })(root);
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || join(fileURLToPath(import.meta.url), '../..'));
  const hits = scan(root);
  for (const h of hits) console.log('FAIL', h.kind, 'in', h.file);
  console.log(hits.length ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(hits.length ? 1 : 0);
}
