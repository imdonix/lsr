// Print the autonomous loop's state at a glance.
//   node tools/agent/status.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, fmtDuration, readJson } from './util.mjs';
import { loadConfig } from './config.mjs';
import { spawnSync } from 'node:child_process';

const config = loadConfig(ROOT);
const state = readJson(path.join(ROOT, config.stateFile), null);
const status = readJson(path.join(ROOT, '.agent/status.json'), null);
const lockPath = path.join(ROOT, '.agent/loop.lock');
const lock = readJson(lockPath, null);
let lockAlive = false;
if (lock?.pid) {
  try { process.kill(lock.pid, 0); lockAlive = true; } catch (e) { lockAlive = false; }
}

let branch = '?', dirty = '';
try {
  branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
} catch (e) { /* not a repo */ }

const runsDir = path.join(ROOT, config.runsDir);
let runs = [];
try { runs = fs.readdirSync(runsDir).filter(n => fs.statSync(path.join(runsDir, n)).isDirectory()).sort(); } catch (e) { }

const latest = runs.length ? runs[runs.length - 1] : null;
const latestSummary = latest ? path.join(runsDir, latest, 'summary.md') : null;
const lastHistory = (state?.history || []).slice(-8).reverse();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    branch, dirty: !!dirty, lock: lock ? { ...lock, alive: lockAlive } : null,
    status, state: state ? {
      iteration: state.iteration, totals: state.totals, lastRunAt: state.lastRunAt,
      history: state.history?.slice(-20),
    } : null,
    runs: runs.slice(-10),
  }, null, 2));
  process.exit(0);
}

console.log('Los Santos Rising — agent loop status');
console.log('====================================');
console.log(`branch:   ${branch}${dirty ? '  (dirty working tree)' : '  (clean)'}`);
if (lock) console.log(`lock:     pid ${lock.pid} ${lockAlive ? '(running)' : '(STALE — safe to delete)'} since ${lock.startedAt || '?'}`);
else console.log('lock:     none');
if (status) console.log(`phase:    ${status.phase || '?'}${status.iteration ? `  iteration ${status.iteration}` : ''}  updated ${status.updatedAt || '?'}`);
if (state) {
  console.log(`totals:   ${state.totals?.committed || 0} committed · ${state.totals?.noChange || 0} no-change · ${state.totals?.failed || 0} failed`);
  console.log(`started:  ${state.startedAt || '?'}   last run: ${state.lastRunAt || '?'}`);
}
if (latestSummary && fs.existsSync(latestSummary)) console.log(`latest:   ${path.relative(ROOT, latestSummary)}`);
console.log('');
if (lastHistory.length) {
  console.log('recent iterations');
  for (const h of lastHistory) {
    const icon = h.result === 'committed' ? '✓' : h.result === 'failed' ? '✗' : '·';
    console.log(`  ${icon} #${h.iteration} ${h.result}  ${h.goal || ''}${h.commit ? `  [${h.commit}]` : ''}  ${fmtDuration(h.durationMs || 0)}`);
    if (h.failReason) console.log(`      reason: ${h.failReason}`);
  }
} else {
  console.log('no iterations recorded yet. Run `npm run agent:once`.');
}
if (latest) {
  const gates = readJson(path.join(runsDir, latest, 'gates.json'), null);
  const verify = readJson(path.join(runsDir, latest, 'verify.json'), null);
  if (gates) {
    console.log('');
    console.log(`gates for ${latest}`);
    for (const s of gates.steps || []) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name.padEnd(12)} ${fmtDuration(s.durationMs || 0).padStart(6)}  ${s.summary}`);
  }
  if (verify) console.log(`  verifier: ${verify.verdict}${verify.summary ? ' — ' + verify.summary : ''}`);
}
