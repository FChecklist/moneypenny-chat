// Fake samples on purpose (exempt from the scan).
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { historyScan } from '../scripts/history-scan.mjs';
const git = (d, ...a) => { const r = spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
test('S-008 clean history: zero hits (platform noreply addresses are allowed)', () => {
  const d = mkdtempSync(join(tmpdir(), 'hist-'));
  try { git(d, 'init', '-q'); writeFileSync(join(d, 'a.txt'), 'hello'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'one\n\nCo-Authored-By: X <noreply@anthropic.com>'); expect(historyScan(d)).toEqual([]); } finally { rmSync(d, { recursive: true }); }
});
test('S-008 a key added and then removed is still found in history; so is an e-mail in a message', () => {
  const d = mkdtempSync(join(tmpdir(), 'hist-'));
  try {
    git(d, 'init', '-q'); writeFileSync(join(d, 'a.txt'), 'key ' + 'sk-ant-' + 'abcdefghij'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'add');
    writeFileSync(join(d, 'a.txt'), 'gone'); git(d, 'commit', '-qam', 'ask someone@example.org');
    const kinds = historyScan(d).map((h) => h.kind).sort(); expect(kinds).toEqual(['anthropic key', 'e-mail address']);
  } finally { rmSync(d, { recursive: true }); }
});
