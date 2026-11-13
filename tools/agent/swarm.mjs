// Parallel swarm runner for the autonomous improvement loop.
//
// Runs N isolated workers in git worktrees (one branch, server and gate run
// each) and then serialises the results through an integration worktree:
// merge one verified branch at a time, re-run the deterministic gates, and keep
// the merge only if the combined tree passes. The user's working tree is never
// switched or touched.
//
// Usage:
//   node tools/agent/swarm.mjs                 # run waves forever
//   node tools/agent/swarm.mjs --once          # one wave
//   node tools/agent/swarm.mjs --workers 4     # override concurrency
//   node tools/agent/swarm.mjs --dry-run       # print the plan, touch nothing
//   node tools/agent/swarm.mjs --no-integrate  # leave verified branches for review
//
// The integration branch is agent/improve, checked out in
// .agent/worktrees/integration. Merge it into main yourself when happy.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  ROOT, detectChrome, git, gitStatus, killActiveChildren, mkdirp, readJson,
  runChild, sleep, stamp, tail, writeJson,
} from './util.mjs';

const SWARM_LOCK = '.agent/swarm.lock';

const DEFAULTS = {
  workers: 3,
  basePort: 8200,
  integrationPort: 8400,
  maxWaves: 0,
  maxHours: 0,
  cooldownSec: 10,
  workerTimeoutMin: 90,
  integrationGateTimeoutMin: 45,
  integrationBranch: 'agent/improve',
  worktreesDir: '.agent/worktrees',
  integrationWorktree: '.agent/worktrees/integration',
  keepWorktrees: false,
  keepMergedBranches: false,
  model: null,
  tasksFile: '.agent/swarm-tasks.json',
  stopFile: '.agent/STOP',
  stateFile: '.agent/swarm-state.json',
  statusFile: '.agent/swarm-status.json',
  runsDir: '.agent/runs',
};

const rel = p => (p && p.startsWith(ROOT + path.sep)) ? p.slice(ROOT.length + 1) : p;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--once': o.once = true; break;
      case '--waves': o.waves = +argv[++i]; break;
      case '--workers': o.workers = +argv[++i]; break;
      case '--model': o.model = argv[++i]; break;
      case '--chromium': o.chromium = argv[++i]; break;
      case '--base-port': o.basePort = +argv[++i]; break;
      case '--integration-port': o.integrationPort = +argv[++i]; break;
      case '--max-hours': o.maxHours = +argv[++i]; break;
      case '--no-integrate': o.noIntegrate = true; break;
      case '--keep-worktrees': o.keepWorktrees = true; break;
      case '--keep-merged-branches': o.keepMergedBranches = true; break;
      case '--dry-run': o.dryRun = true; break;
      case '--verbose': case '-v': o.verbose = true; break;
      default: if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    }
  }
  return o;
}

function usage() {
  return `Parallel agent swarm

Usage: node tools/agent/swarm.mjs [options]

  --once                    One wave
  --waves N                 Stop after N waves
  --workers N               Workers per wave (default from .agent/swarm.config.json)
  --model ID                Model passed to every worker (e.g. opencode-go/deepseek-v4.1-flash)
  --chromium PATH           Chrome/Chromium for headless gates
  --base-port N             First worker port (default 8200)
  --integration-port N      Gate port for the integration worktree (default 8400)
  --max-hours H             Stop after H hours
  --no-integrate            Run workers but do not merge; leave branches for review
  --keep-worktrees          Do not remove worker worktrees afterwards
  --keep-merged-branches    Do not delete worker branches after a clean merge
  --dry-run                 Print the plan and exit without touching git
  -v, --verbose             Pass through worker output when they finish

Workers run one iteration each, in parallel, in separate git worktrees.
Only verified commits are merged, one at a time, into agent/improve, and the
gates are re-run after every merge. The user's checkout stays on its branch.

Stop with Ctrl-C or: touch .agent/STOP
`;
}

function loadConfig() {
  const user = readJson(path.join(ROOT, '.agent/swarm.config.json'), {}) || {};
  const cfg = { ...DEFAULTS, ...user };
  cfg.worktreesDirAbs = path.resolve(ROOT, cfg.worktreesDir);
  cfg.integrationPath = path.resolve(ROOT, cfg.integrationWorktree);
  cfg.tasksPath = path.resolve(ROOT, cfg.tasksFile);
  cfg.statePath = path.resolve(ROOT, cfg.stateFile);
  cfg.statusPath = path.resolve(ROOT, cfg.statusFile);
  cfg.runsPath = path.resolve(ROOT, cfg.runsDir);
  cfg.stopPath = path.resolve(ROOT, cfg.stopFile);
  return cfg;
}

function acquireLock() {
  const file = path.join(ROOT, SWARM_LOCK);
  mkdirp(path.dirname(file));
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
  } catch (e) {
    const existing = readJson(file, {});
    let alive = false;
    if (existing.pid) { try { process.kill(existing.pid, 0); alive = true; } catch (e2) { } }
    if (alive) throw new Error(`another swarm is running (pid ${existing.pid})`);
    fs.unlinkSync(file);
    return acquireLock();
  }
  return {
    file,
    release: () => { try { fs.unlinkSync(file); } catch (e) { } },
  };
}

function setStatus(cfg, patch) {
  try { writeJson(cfg.statusPath, { pid: process.pid, updatedAt: new Date().toISOString(), ...patch }); } catch (e) { }
}

function worktreeList() {
  const out = git(['worktree', 'list', '--porcelain'], { allowFail: true }).out;
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9) }; list.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7);
    else if (cur && line.startsWith('detached')) cur.detached = true;
  }
  return list;
}

function symlinkNodeModules(worktree) {
  const src = path.join(ROOT, 'node_modules');
  const dst = path.join(worktree, 'node_modules');
  if (!fs.existsSync(src)) throw new Error('node_modules is missing in the main checkout; run `npm install` first');
  if (fs.existsSync(dst)) return;
  fs.symlinkSync(src, dst, 'dir');
}

function removeWorktree(cfg, worktree) {
  if (cfg.keepWorktrees) {
    log(`  kept worktree ${rel(worktree)}`);
    return;
  }
  const r = git(['worktree', 'remove', '--force', worktree], { allowFail: true });
  if (!r.ok) log(`  warning: could not remove worktree ${rel(worktree)}: ${tail(r.err || r.out, 2)}`);
}

async function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function assertPortsFree(ports) {
  for (const p of ports) {
    if (!(await portFree(p))) {
      throw new Error(`port ${p} is already in use (probably a leftover test server). Stop it or change basePort/integrationPort.`);
    }
  }
}

function ensureIntegration(cfg, baseCommit) {
  const pathAbs = cfg.integrationPath;
  const branch = cfg.integrationBranch;
  const list = worktreeList();
  const existing = list.find(w => path.resolve(w.path) === pathAbs);
  if (existing) {
    if (existing.branch !== `refs/heads/${branch}`) {
      throw new Error(`${rel(pathAbs)} is checked out on ${existing.branch}, expected ${branch}`);
    }
    const dirty = gitStatus(pathAbs);
    if (dirty) throw new Error(`integration worktree ${rel(pathAbs)} is dirty; clean it before starting the swarm`);
    symlinkNodeModules(pathAbs);
    return { path: pathAbs, branch, head: git(['rev-parse', 'HEAD'], { cwd: pathAbs }).out };
  }
  if (fs.existsSync(pathAbs)) {
    throw new Error(`${rel(pathAbs)} exists but is not a registered git worktree; move it away first`);
  }
  const elsewhere = list.find(w => w.branch === `refs/heads/${branch}`);
  if (elsewhere) {
    throw new Error(`branch ${branch} is already checked out at ${elsewhere.path}; run the swarm from a clean checkout that does not use it`);
  }
  mkdirp(path.dirname(pathAbs));
  const branchExists = git(['rev-parse', '--verify', `refs/heads/${branch}`], { allowFail: true }).ok;
  const r = branchExists
    ? git(['worktree', 'add', pathAbs, branch], { allowFail: true })
    : git(['worktree', 'add', '-b', branch, pathAbs, baseCommit], { allowFail: true });
  if (!r.ok) throw new Error(`could not create integration worktree: ${tail(r.err || r.out, 6)}`);
  symlinkNodeModules(pathAbs);
  log(`integration worktree: ${rel(pathAbs)} (${branch})`);
  return { path: pathAbs, branch, head: git(['rev-parse', 'HEAD'], { cwd: pathAbs }).out };
}

function makeWorkerWorktree(cfg, runId, index, baseCommit) {
  const wtPath = path.join(cfg.worktreesDirAbs, `swarm-${runId}-w${index}`);
  const branch = `agent/swarm-${runId}-w${index}`;
  mkdirp(cfg.worktreesDirAbs);
  if (fs.existsSync(wtPath)) throw new Error(`worker worktree path already exists: ${rel(wtPath)}`);
  const r = git(['worktree', 'add', '-b', branch, wtPath, baseCommit], { allowFail: true });
  if (!r.ok) throw new Error(`could not create worker worktree w${index}: ${tail(r.err || r.out, 6)}`);
  symlinkNodeModules(wtPath);
  return { index, path: wtPath, branch };
}

function taskBrief(task, workerIndex, wave) {
  const files = (task.files || []).map(f => `- \`${f}\``).join('\n') || '(choose within the lane)';
  const acceptance = (task.acceptance || []).map(a => `- ${a}`).join('\n') || '- All enabled harness gates pass';
  return `# Swarm lane: ${task.title}

- Lane id: \`${task.id}\`
- Worker: ${workerIndex}
- Wave: ${wave}

## Focus files
${files}

## Brief
${task.brief || 'Find one safe, verifiable improvement in this lane.'}

## Acceptance criteria
${acceptance}

## Swarm rules
- Stay inside this lane unless a cross-lane edit is unavoidable; call out any cross-lane file in your report.
- Do **not** edit \`.agent/backlog.md\`. Put follow-ups in your report; the integrator owns the shared backlog.
- Do **not** touch another worker's branch, worktree, or the integration worktree.
- One focused, verified change. If the lane has no safe work, report \`no-change\` with a concrete reason.
`;
}

function archiveWorker(cfg, runDir, w, last, proc) {
  const dest = path.join(runDir, 'workers', `w${w.index}`);
  mkdirp(dest);
  const srcRuns = path.join(w.path, '.agent/runs');
  try { if (fs.existsSync(srcRuns)) fs.cpSync(srcRuns, path.join(dest, 'runs'), { recursive: true }); } catch (e) { log(`  warning: could not archive w${w.index} runs: ${e.message}`); }
  for (const f of ['state.json', 'status.json']) {
    const src = path.join(w.path, '.agent', f);
    try { if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, f)); } catch (e) { }
  }
  writeJson(path.join(dest, 'result.json'), {
    worker: w.index, task: w.task.id, branch: w.branch, port: w.port,
    outcome: last?.result || 'unknown', commit: last?.commit || null,
    fatal: !!last?.fatal, fatalHint: last?.fatalHint || null,
    exitCode: proc.code, timedOut: proc.timedOut, durationMs: proc.durationMs,
    log: rel(proc.logPath),
  });
}

function gateLogPath(runDir, worker) {
  return path.join(runDir, 'integration', `w${worker.index}.log`);
}

async function integrateWorker(cfg, runDir, integration, w, gateIteration, chromium) {
  const intPath = integration.path;
  const dirty = gitStatus(intPath);
  if (dirty) return { worker: w.index, task: w.task.id, result: 'integration-dirty', detail: 'integration worktree has uncommitted changes' };

  const pre = git(['rev-parse', 'HEAD'], { cwd: intPath }).out;
  const merge = git(['merge', '--no-ff', '--no-edit', w.branch], { cwd: intPath, allowFail: true });
  if (!merge.ok) {
    git(['merge', '--abort'], { cwd: intPath, allowFail: true });
    return { worker: w.index, task: w.task.id, result: 'conflict', detail: tail(merge.err || merge.out, 8) };
  }
  const mergeCommit = git(['rev-parse', '--short', 'HEAD'], { cwd: intPath, allowFail: true }).out;

  const logPath = gateLogPath(runDir, w);
  mkdirp(path.dirname(logPath));
  const gate = await runChild(process.execPath, [
    'tools/agent/gates.mjs', '--iteration', String(gateIteration), '--port', String(cfg.integrationPort),
  ], {
    cwd: intPath,
    env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: chromium },
    timeoutMs: cfg.integrationGateTimeoutMin * 60000,
    logPath,
  });

  if (!gate.ok) {
    const reset = git(['reset', '--hard', pre], { cwd: intPath, allowFail: true });
    if (!reset.ok) return { worker: w.index, task: w.task.id, result: 'gate-failed-reset-failed', detail: `could not reset: ${tail(reset.err || reset.out, 4)}` };
    return {
      worker: w.index, task: w.task.id, result: 'gate-failed', mergeCommit,
      detail: gate.timedOut ? 'integration gate timed out' : `integration gates failed; see ${rel(logPath)}`,
    };
  }

  return {
    worker: w.index, task: w.task.id, result: 'merged', mergeCommit,
    detail: `gates pass; ${rel(logPath)}`,
  };
}

async function runWave(wave, ctx) {
  const { cfg, tasks, workers, chromium, model, verbose, runDir, runId } = ctx;
  const waveStarted = Date.now();
  const integrationHead = git(['rev-parse', 'HEAD'], { cwd: ctx.integration.path }).out;
  log(`wave ${wave}: ${workers} workers from ${integrationHead.slice(0, 7)}`);

  await assertPortsFree([
    ...Array.from({ length: workers }, (_, i) => cfg.basePort + i),
    cfg.integrationPort,
  ]);

  const jobs = [];
  const mergedBranches = [];
  let integrations = [];
  for (let i = 0; i < workers; i++) {
    const task = tasks[((wave - 1) * workers + i) % tasks.length];
    const wt = makeWorkerWorktree(cfg, runId, i + 1, integrationHead);
    const taskPath = path.join(runDir, 'tasks', `w${i + 1}.md`);
    mkdirp(path.dirname(taskPath));
    fs.writeFileSync(taskPath, taskBrief(task, i + 1, wave));
    const port = cfg.basePort + i;
    const workerLog = path.join(runDir, 'logs', `w${i + 1}.log`);
    const args = [
      'tools/agent/loop.mjs', '--once', '--exit-on-failure', '--swarm',
      '--branch', wt.branch, '--port', String(port), '--task-file', taskPath,
    ];
    if (model) args.push('--model', model);
    if (chromium) args.push('--chromium', chromium);
    if (verbose) args.push('--verbose');
    jobs.push({ ...wt, task, port, taskPath, logPath: workerLog, args });
    log(`  w${i + 1}: ${task.id} -> ${rel(wt.path)} :${port}`);
  }

  try {
  const procResults = await Promise.all(jobs.map(w => runChild(process.execPath, w.args, {
    cwd: w.path,
    env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: chromium },
    timeoutMs: cfg.workerTimeoutMin * 60000,
    logPath: w.logPath,
  }).then(proc => ({ w, proc }))));

  const summaries = [];
  for (const { w, proc } of procResults) {
    const state = readJson(path.join(w.path, '.agent/state.json'), null);
    const last = state?.history?.[state.history.length - 1] || null;
    const branchExists = git(['rev-parse', '--verify', `refs/heads/${w.branch}`], { allowFail: true }).ok;
    const ok = !!last && last.result === 'committed' && !!last.commit && branchExists;
    const summary = {
      worker: w.index, task: w.task.id, title: w.task.title, branch: w.branch, port: w.port,
      outcome: last?.result || (proc.ok ? 'no-state' : 'failed'), ok,
      commit: last?.commit || null, fatal: !!last?.fatal, fatalHint: last?.fatalHint || null,
      durationMs: proc.durationMs, timedOut: proc.timedOut, exitCode: proc.code,
      log: rel(w.logPath), runDir: last?.runDir || null,
    };
    archiveWorker(cfg, runDir, w, last, proc);
    summaries.push(summary);
    log(`  w${w.index} ${w.task.id}: ${summary.outcome}${summary.commit ? ` ${summary.commit}` : ''} (${Math.round(proc.durationMs / 1000)}s)`);
  }

  integrations = [];
  if (!ctx.noIntegrate) {
    let mergeIteration = (wave - 1) * workers;
    for (const w of jobs.filter(j => summaries.find(s => s.worker === j.index && s.ok))) {
      mergeIteration += 1;
      setStatus(cfg, { phase: 'integrating', wave, worker: w.index, mergeIteration });
      const r = await integrateWorker(cfg, runDir, ctx.integration, w, mergeIteration, chromium);
      integrations.push(r);
      if (r.result === 'merged') mergedBranches.push(w.branch);
      log(`  integrate w${w.index} ${w.task.id}: ${r.result}${r.mergeCommit ? ` ${r.mergeCommit}` : ''}`);
      if (r.result === 'conflict' || r.result === 'gate-failed') {
        log(`    kept branch ${w.branch} for inspection`);
      }
    }
  }

  return {
    wave,
    ts: new Date().toISOString(),
    durationMs: Date.now() - waveStarted,
    integrationHead,
    workers: summaries,
    integrations,
    fatal: summaries.some(s => s.fatal),
  };
  } finally {
    for (const w of jobs) removeWorktree(cfg, w.path);
    // Branches cannot be deleted while checked out, so do it after removing
    // the worktrees. Keep conflict/gate-failed branches and any branch that
    // still has unique commits (for example --no-integrate).
    const keep = new Set(integrations
      .filter(r => r.result === 'conflict' || r.result === 'gate-failed' || r.result === 'gate-failed-reset-failed')
      .map(r => r.worker));
    for (const w of jobs) {
      if (mergedBranches.includes(w.branch) && !cfg.keepMergedBranches) {
        git(['branch', '-D', w.branch], { allowFail: true });
        continue;
      }
      if (keep.has(w.index) || cfg.keepMergedBranches) continue;
      if (mergedBranches.includes(w.branch)) continue;
      const count = git(['rev-list', '--count', `${integrationHead}..${w.branch}`], { allowFail: true }).out;
      if (count === '0') git(['branch', '-D', w.branch], { allowFail: true });
    }
  }
}

function mergeTotals(state, wave) {
  state.totals.waves += 1;
  state.totals.workers += wave.workers.length;
  for (const s of wave.workers) {
    if (s.ok) state.totals.verified += 1; else if (s.outcome === 'no-change') state.totals.noChange += 1; else state.totals.failed += 1;
  }
  for (const r of wave.integrations) {
    if (r.result === 'merged') state.totals.merged += 1;
    else if (r.result === 'conflict') state.totals.conflicts += 1;
    else if (r.result === 'gate-failed') state.totals.gateFailed += 1;
    else state.totals.failed += 1;
  }
  state.waves.push(wave);
  state.waves = state.waves.slice(-100);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }
  const cfg = loadConfig();
  if (args.workers) cfg.workers = args.workers;
  if (args.model) cfg.model = args.model;
  if (args.basePort) cfg.basePort = args.basePort;
  if (args.integrationPort) cfg.integrationPort = args.integrationPort;
  if (args.maxHours != null) cfg.maxHours = args.maxHours;
  if (args.keepWorktrees) cfg.keepWorktrees = true;
  if (args.keepMergedBranches) cfg.keepMergedBranches = true;

  const chromium = detectChrome({ chromium: args.chromium });
  if (!chromium) { console.error('[swarm] no Chrome/Chromium found; set --chromium or config.chromium'); return 1; }

  const tasks = (readJson(cfg.tasksPath, {}) || {}).tasks;
  if (!Array.isArray(tasks) || !tasks.length) {
    console.error(`[swarm] no tasks in ${rel(cfg.tasksPath)}`);
    return 1;
  }
  const cpuCap = Math.max(1, Math.floor(os.cpus().length / 2));
  const memCap = Math.max(1, Math.floor(os.totalmem() / 3e9));
  const cap = Math.min(8, tasks.length, cpuCap, memCap);
  let workers = Math.min(cfg.workers, cap);
  if (workers < cfg.workers) log(`worker count ${cfg.workers} capped to ${workers} (tasks/CPU/RAM safety limit)`);
  if (workers < 1) { console.error('[swarm] no worker slot available'); return 1; }

  if (cfg.basePort + workers > cfg.integrationPort && cfg.integrationPort >= cfg.basePort) {
    console.error(`[swarm] worker ports ${cfg.basePort}..${cfg.basePort + workers - 1} overlap integrationPort ${cfg.integrationPort}`);
    return 1;
  }

  const baseCommit = git(['rev-parse', 'HEAD']).out;
  if (args.dryRun) {
    log(`plan: ${workers} workers, model=${cfg.model || 'default'}, chrome=${chromium}`);
    log(`base ${baseCommit.slice(0, 7)} -> integration worktree ${rel(cfg.integrationPath)} (${cfg.integrationBranch})`);
    for (let i = 0; i < workers; i++) {
      const t = tasks[i % tasks.length];
      log(`  w${i + 1}: port ${cfg.basePort + i} lane ${t.id} (${t.title})`);
    }
    log(`  integration gate port ${cfg.integrationPort}; tasks ${rel(cfg.tasksPath)}`);
    log('dry run: no git worktrees or agents were created.');
    return 0;
  }

  const dirty = gitStatus(ROOT);
  if (dirty) {
    console.error('[swarm] the main checkout is dirty. Commit or stash your work first:\n' + dirty.split('\n').slice(0, 12).map(l => '  ' + l).join('\n'));
    return 1;
  }

  const lock = acquireLock();
  let stopping = false;
  const cleanup = () => { try { lock.release(); } catch (e) { } };
  const onSignal = async (sig) => {
    if (stopping) return;
    stopping = true;
    log(`received ${sig}; killing workers`);
    try { killActiveChildren('SIGTERM'); } catch (e) { }
    await sleep(1500);
    try { killActiveChildren('SIGKILL'); } catch (e) { }
    cleanup();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  try {
    const integration = ensureIntegration(cfg, baseCommit);
    const runId = String(Date.now());
    const runDir = path.join(cfg.runsPath, `${stamp()}-swarm`);
    mkdirp(runDir);
    mkdirp(path.join(runDir, 'logs'));
    mkdirp(path.join(runDir, 'tasks'));
    mkdirp(path.join(runDir, 'integration'));

    let state = readJson(cfg.statePath, null);
    if (!state) state = { version: 1, startedAt: new Date().toISOString(), waves: [] };
    state.workers = workers;
    state.waves = Array.isArray(state.waves) ? state.waves : [];
    state.totals = {
      waves: 0, workers: 0, verified: 0, merged: 0, conflicts: 0, gateFailed: 0, failed: 0, noChange: 0,
      ...(state.totals || {}),
    };
    state.model = cfg.model || 'default';
    state.lastRunAt = new Date().toISOString();

    const maxWaves = args.once ? 1 : (args.waves || cfg.maxWaves || 0);
    const maxHours = cfg.maxHours || 0;
    const startMs = Date.now();
    let fatalStop = false;

    log('============================================================');
    log(`agent swarm: ${workers} workers, model=${cfg.model || 'default'}, chrome=${chromium}`);
    log(`integration: ${rel(integration.path)} on ${integration.branch}`);
    log(`ports: workers ${cfg.basePort}..${cfg.basePort + workers - 1}, integrate ${cfg.integrationPort}`);
    log(`waves=${maxWaves || 'unlimited'} maxHours=${maxHours || 'unlimited'}`);
    log('stop with Ctrl-C or `touch .agent/STOP`');
    log('============================================================');
    setStatus(cfg, { phase: 'idle', workers, integration: rel(integration.path), branch: integration.branch });

    let wave = 0;
    while (!stopping) {
      if (fs.existsSync(cfg.stopPath)) { log(`stop file found (${cfg.stopFile}); finishing`); break; }
      if (maxWaves && wave >= maxWaves) { log(`reached wave cap (${maxWaves})`); break; }
      if (maxHours && (Date.now() - startMs) >= maxHours * 3600000) { log(`reached time cap (${maxHours}h)`); break; }
      wave++;
      setStatus(cfg, { phase: 'workers', wave, workers, integration: rel(integration.path) });
      let result;
      try {
        result = await runWave(wave, {
          cfg, tasks, workers, chromium, model: cfg.model, verbose: !!args.verbose,
          runDir, runId, integration, noIntegrate: !!args.noIntegrate,
        });
      } catch (e) {
        log(`wave ${wave}: SWARM ERROR — ${e.message}`);
        state.totals.failed += 1;
        state.waves.push({ wave, ts: new Date().toISOString(), error: e.message });
        writeJson(cfg.statePath, state);
        setStatus(cfg, { phase: 'error', wave, error: e.message });
        break;
      }
      mergeTotals(state, result);
      state.lastRunAt = new Date().toISOString();
      writeJson(cfg.statePath, state);
      setStatus(cfg, { phase: 'idle', wave, lastWave: result });
      if (result.fatal) {
        fatalStop = true;
        const f = result.workers.find(s => s.fatal);
        log(`FATAL worker error: ${f?.fatalHint || 'agent unavailable'}`);
        break;
      }
      if (wave < maxWaves || !maxWaves) {
        const pause = result.integrations.some(r => r.result !== 'merged') ? Math.max(cfg.cooldownSec, 30) : cfg.cooldownSec;
        if (pause > 0) await sleep(pause * 1000);
      }
    }

    log('agent swarm finished');
    log(`integration worktree: ${rel(integration.path)} (${integration.branch})`);
    setStatus(cfg, { phase: fatalStop ? 'fatal' : 'finished', integration: rel(integration.path), branch: integration.branch });
    return fatalStop ? 1 : 0;
  } finally {
    cleanup();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then(code => process.exit(code || 0)).catch(e => {
    console.error('[swarm] FATAL', e.stack || e);
    process.exit(1);
  });
}
