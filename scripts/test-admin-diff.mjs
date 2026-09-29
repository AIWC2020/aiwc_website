/**
 * The version screen's diff (admin/diff.js) must be exact: it is what an
 * editor reads before restoring. For real page histories, rebuild both sides
 * from the edit script and compare change counts with git's own diff.
 */
import { execFileSync } from 'node:child_process';
import { diffLines, summarise } from '../admin/diff.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` → ${detail}` : ''}`);
  if (!ok) failures++;
};

const cases = [
  ['', ''], ['a', 'a'], ['a\nb\nc', 'a\nc'], ['a\nc', 'a\nb\nc'], ['x', 'y'], ['', 'a\nb'], ['a\nb', ''],
];
for (const [a, b] of cases) {
  const ops = diffLines(a, b);
  const left = ops.filter((o) => o.op !== 'add').map((o) => o.text).join('\n');
  const right = ops.filter((o) => o.op !== 'del').map((o) => o.text).join('\n');
  check(`${JSON.stringify(a)} → ${JSON.stringify(b)}`, left === a && right === b);
}

// Real histories: every consecutive pair of versions of a few pages.
for (const file of ['content/pages/news.json', 'content/pages/people.json', 'content/pages/12.json']) {
  const shas = git('log', '--format=%h', '-6', '--', file).trim().split('\n').filter(Boolean);
  for (let i = 0; i + 1 < shas.length; i++) {
    let before, after;
    try {
      before = git('show', `${shas[i + 1]}:${file}`);
      after = git('show', `${shas[i]}:${file}`);
    } catch { continue; } // deleted in one of the two
    const ops = diffLines(before, after);
    const rebuilt = [ops.filter((o) => o.op !== 'add'), ops.filter((o) => o.op !== 'del')].map((l) => l.map((o) => o.text).join('\n'));
    const { added, removed } = summarise(ops);
    const stat = git('diff', '--numstat', '--diff-algorithm=myers', shas[i + 1], shas[i], '--', file).trim().split(/\s+/);
    const exact = rebuilt[0] === before && rebuilt[1] === after;
    // Minimal edit scripts can differ in shape but not in size.
    const sameSize = added + removed === Number(stat[0] || 0) + Number(stat[1] || 0);
    check(`${file} ${shas[i + 1]}→${shas[i]}`, exact && sameSize, `+${added} −${removed} (git +${stat[0] || 0} −${stat[1] || 0})`);
  }
}

if (failures) { console.error(`\n${failures} diff check(s) failed.`); process.exit(1); }
console.log('\nAdmin diff OK.');
