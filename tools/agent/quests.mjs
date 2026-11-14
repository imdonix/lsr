// Quest Polish Program status.
//   node tools/agent/quests.mjs [--json] [--list]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.mjs';
import { loadConfig } from './config.mjs';

const config = loadConfig(ROOT);
const file = path.join(ROOT, config.questFile || '.agent/quest-polish.md');
if (!fs.existsSync(file)) {
  console.error(`[quests] ${path.relative(ROOT, file)} not found`);
  process.exit(1);
}
const lines = fs.readFileSync(file, 'utf8').split('\n');
const quests = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s*-\s*\[( |x|X|!)\]\s+\*\*(.+?)\*\*/);
  if (!m) continue;
  const content = m[2];
  const idm = content.match(/^([A-Za-z0-9_]+)\s*[—–-]\s*(.+)$/);
  quests.push({
    id: idm ? idm[1] : content,
    title: idm ? idm[2] : content,
    state: m[1].toLowerCase() === 'x' ? 'done' : m[1] === '!' ? 'blocked' : 'open',
    line: i + 1,
  });
}
const done = quests.filter(q => q.state === 'done').length;
const next = quests.find(q => q.state === 'open') || null;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ file: path.relative(ROOT, file), done, total: quests.length, next, quests }, null, 2));
  process.exit(0);
}

console.log(`Quest Polish Program — ${done}/${quests.length} done`);
console.log(`next: ${next ? `${next.id} — ${next.title}` : 'complete'}`);
if (process.argv.includes('--list')) {
  console.log('');
  for (const q of quests) {
    const icon = q.state === 'done' ? '✓' : q.state === 'blocked' ? '!' : '·';
    console.log(`  ${icon} ${q.id.padEnd(12)} ${q.title}`);
  }
}
