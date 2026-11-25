// S-008: scan the whole git history (added lines and commit messages) for keys, e-mails and phones. Usage: bun scripts/history-scan.mjs [repo]
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHits } from './patterns.mjs';

export function historyScan(repo) {
  const r = spawnSync('git', ['-C', repo, 'log', '--all', '--format=%x01%H%n%B', '-p', '--no-color'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('git log failed');
  const hits = [];
  for (const chunk of r.stdout.split('\x01').slice(1)) {
    const commit = chunk.slice(0, 40);
    const keep = chunk.split('\n').filter((l) => !l.startsWith('-') && !l.startsWith('+++')); // added lines, context and message (a removed line was added in an earlier commit)
    for (const kind of findHits(keep.join('\n'))) hits.push({ commit, kind });
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = historyScan(resolve(process.argv[2] || '.'));
  for (const h of hits) console.log('FAIL', h.kind, 'in commit', h.commit.slice(0, 10));
  console.log(hits.length ? 'RESULT: FAIL' : 'RESULT: PASS (zero hits)');
  process.exit(hits.length ? 1 : 0);
}
