// Fully autonomous, never-ending improvement loop for Los Santos Rising.
//
// One iteration = fresh OpenCode director session -> deterministic harness gates
// -> independent verifier -> optional repair rounds -> git commit on an isolated
// branch. The loop refuses to run on a dirty tree, never pushes, and stops on a
// STOP file, a signal, an iteration/hour cap, or repeated failures.
//
// Usage:
//   node tools/agent/loop.mjs                 # run forever
//   node tools/agent/loop.mjs --once          # one iteration
//   node tools/agent/loop.mjs --dry-run       # print the prompt and exit
//   node tools/agent/loop.mjs --gates-only    # run the deterministic gates only
//   node tools/agent/loop.mjs --quick         # gates: static + smoke only
//
// See docs/AGENT_LOOP.md for the full protocol.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROOT, detectChrome, ensureServer, firstJsonObject, fmtDuration, git, gitStatus,
  killActiveChildren, mkdirp, readJson, runChild, sleep, stamp, tail, whichSync, writeJson,
} from './util.mjs';
import { loadConfig, applyOverrides } from './config.mjs';
import { runGates } from './gates.mjs';
import { buildDirectorPrompt, buildVerifierPrompt, buildFixerPrompt } from './prompts.mjs';

const LOCK_FILE = '.agent/loop.lock';
const STATUS_FILE = '.agent/status.json';

function usage() {
  return `Autonomous agent loop for Los Santos Rising

Usage: node tools/agent/loop.mjs [options]

Run control:
  --once                 Run exactly one iteration
  --iterations N         Run at most N iterations
  --max-hours H          Stop after H hours (0 = unlimited)
  --dry-run              Write and print the first prompt; no agents, no git
  --gates-only           Run the deterministic gates on the current tree
  --quick                With --gates-only: static + smoke only
  --story                With --gates-only: force the story gate
  --world                With --gates-only: force the world audit gate

Agent / models:
  --model ID             OpenCode model (provider/model#variant)
  --agent NAME           Primary agent (default: director)
  --timeout-min N        Director time budget per iteration
  --verify-timeout-min N Verifier time budget
  --repair-rounds N      Repair rounds after gate/verify failures (default 2)
  --no-verify            Skip the independent verifier (not recommended)
  --story-every N        Run the story gate every N iterations (0 = never)
  --task TEXT            Extra assigned task/lane text added to the prompt
  --task-file PATH       Read the assigned task/lane brief from a file
  --swarm                Worker mode: do not edit the shared backlog
  --exit-on-failure      Exit 1 if the iteration failed (used by the swarm)
  --no-quest-program     Ignore .agent/quest-polish.md for this run

Git / output:
  --branch NAME          Loop branch (default: agent/improve)
  --no-commit            Keep verified changes in the working tree; do not commit
  --keep-failed          Do not stash failed work (loop will stop if the tree is dirty)
  --port N               Dev-server port (default 8123)
  --chromium PATH        Chrome/Chromium binary for headless gates
  -v, --verbose          Echo child output to the console

Safety:
  Stop after the current iteration:  touch .agent/STOP
  Another running loop is detected via .agent/loop.lock.
`;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--once': o.once = true; break;
      case '--iterations': o.iterations = +argv[++i]; break;
      case '--max-hours': o.maxHours = +argv[++i]; break;
      case '--dry-run': o.dryRun = true; break;
      case '--gates-only': o.gatesOnly = true; break;
      case '--quick': o.quick = true; break;
      case '--story': o.story = true; break;
      case '--world': o.world = true; break;
      case '--model': o.model = argv[++i]; break;
      case '--agent': o.agent = argv[++i]; break;
      case '--timeout-min': o.iterationTimeoutMin = +argv[++i]; break;
      case '--verify-timeout-min': o.verifyTimeoutMin = +argv[++i]; break;
      case '--repair-rounds': o.repairRounds = +argv[++i]; break;
      case '--no-verify': o.verify = false; break;
      case '--story-every': o.storyEvery = +argv[++i]; break;
      case '--task': o.task = argv[++i]; break;
      case '--task-file': o.taskFile = argv[++i]; break;
      case '--swarm': o.swarm = true; break;
      case '--exit-on-failure': o.exitOnFailure = true; break;
      case '--no-quest-program': o.noQuestProgram = true; break;
      case '--branch': o.branch = argv[++i]; break;
      case '--no-commit': o.commit = false; break;
      case '--keep-failed': o.resetOnFailure = false; break;
      case '--port': o.port = +argv[++i]; break;
      case '--chromium': o.chromium = argv[++i]; break;
      case '--out': o.out = argv[++i]; break;
      case '-v': case '--verbose': o.verbose = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    }
  }
  return o;
}

const rel = p => (p && p.startsWith(ROOT + path.sep)) ? p.slice(ROOT.length + 1) : p;

function log(...a) { console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a); }

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function acquireLock() {
  const file = path.join(ROOT, LOCK_FILE);
  mkdirp(path.dirname(file));
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
    return { file, release: () => { try { fs.unlinkSync(file); } catch (e) { } } };
  } catch (e) {
    const existing = readJson(file, {});
    if (pidAlive(existing.pid)) {
      throw new Error(`another agent loop is already running (pid ${existing.pid}). Delete ${LOCK_FILE} only if it is stale.`);
    }
    try { fs.unlinkSync(file); } catch (e2) { }
    return acquireLock();
  }
}

let currentStatus = {};
function setStatus(patch) {
  currentStatus = { ...currentStatus, ...patch, pid: process.pid, updatedAt: new Date().toISOString() };
  try { writeJson(path.join(ROOT, STATUS_FILE), currentStatus); } catch (e) { }
}

function loadState(config) {
  const state = readJson(path.join(ROOT, config.stateFile), null) || {
    version: 1,
    startedAt: new Date().toISOString(),
    iteration: 0,
    history: [],
    totals: { committed: 0, failed: 0, noChange: 0 },
  };
  state.history = Array.isArray(state.history) ? state.history : [];
  state.totals = state.totals || { committed: 0, failed: 0, noChange: 0 };
  return state;
}

function saveState(config, state) {
  state.lastUpdatedAt = new Date().toISOString();
  writeJson(path.join(ROOT, config.stateFile), state);
}

function ensureLoopBranch(config) {
  const dirty = gitStatus();
  if (dirty) {
    throw new Error('working tree is not clean. The loop never commits or hides your work by accident.\n'
      + 'Commit or stash your changes, or inspect them with `git status`:\n'
      + dirty.split('\n').slice(0, 12).map(l => '  ' + l).join('\n'));
  }
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (current === config.branch) return current;
  const exists = git(['rev-parse', '--verify', `refs/heads/${config.branch}`], { allowFail: true }).ok;
  if (exists) {
    git(['checkout', config.branch]);
    log(`git: switched to existing branch ${config.branch}`);
  } else {
    const args = config.baseBranch ? ['checkout', '-b', config.branch, config.baseBranch] : ['checkout', '-b', config.branch];
    git(args);
    log(`git: created branch ${config.branch}${config.baseBranch ? ` from ${config.baseBranch}` : ''}`);
  }
  return config.branch;
}

function verifyOpencodeAgents(config) {
  const bin = whichSync('opencode');
  if (!bin) throw new Error('`opencode` is not on PATH. Install/authenticate OpenCode first.');
  const r = spawnSync(bin, ['debug', 'agents'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  const text = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    log('warning: `opencode debug agents` failed; continuing without agent preflight');
    if (text) log(tail(text, 8));
    return;
  }
  const need = [config.agent, config.verifyAgent, config.fixAgent, 'scout', 'designer', 'auditor', 'implementer', 'tester'];
  let ids = [];
  try {
    const parsed = JSON.parse(r.stdout);
    if (Array.isArray(parsed)) ids = parsed.map(a => a && a.id).filter(Boolean);
  } catch (e) { /* fall back to text matching */ }
  const missing = need.filter(n => ids.length ? !ids.includes(n) : !text.includes(n));
  if (missing.length) {
    throw new Error(`missing OpenCode agents: ${missing.join(', ')}.\n`
      + 'Expected .opencode/agents/*.md. Run `opencode debug agents` to inspect.\n'
      + tail(text, 12));
  }
}

function stageAll() { git(['add', '-A']); }

function hasStaged() { return git(['diff', '--cached', '--quiet'], { allowFail: true }).code === 1; }

function diffStats() {
  const numstat = git(['diff', '--cached', '--numstat'], { allowFail: true }).out;
  let additions = 0, deletions = 0, files = 0;
  for (const line of numstat.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    files++;
    if (m[1] !== '-') additions += +m[1];
    if (m[2] !== '-') deletions += +m[2];
  }
  const status = gitStatus();
  return { files, additions, deletions, dirty: !!status, status };
}

function archiveDiff(runDir) {
  mkdirp(runDir);
  const diff = git(['diff', '--cached', '--binary'], { allowFail: true }).out;
  const status = gitStatus();
  const snapshot = diff + '\n';
  fs.writeFileSync(path.join(runDir, 'diff.patch'), snapshot);
  fs.writeFileSync(path.join(runDir, 'status.txt'), status + '\n');
  return snapshot;
}

function firstLine(s, max = 110) {
  const line = String(s || '').split('\n').find(x => x.trim()) || '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/** Recognise infrastructure errors that retrying will not fix. */
function detectFatal(output) {
  const text = String(output || '');
  if (/Insufficient balance|Top up at/i.test(text)) {
    return 'OpenCode reports insufficient balance. Top up, or run with `--model <provider/model>` (try a free model from `opencode models`).';
  }
  if (/not authenticated|unauthorized|invalid api key|missing api key|no api key/i.test(text)) {
    return 'OpenCode is not authenticated for the selected provider. Run `opencode auth login` or pass `--model`.';
  }
  if (/model .*not found|unknown model|model .*does not exist|no such model/i.test(text)) {
    return 'The configured model is unavailable. Run `opencode models` and pass `--model provider/model`.';
  }
  return '';
}

function questChecklist(config) {
  if (!config.questProgram) return null;
  const file = path.resolve(ROOT, config.questFile || '.agent/quest-polish.md');
  if (!fs.existsSync(file)) return { file, done: 0, total: 0, next: null, missing: true };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let done = 0, total = 0, next = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*\[( |x|X|!)\]\s+\*\*(.+?)\*\*/);
    if (!m) continue;
    total++;
    if (m[1].toLowerCase() === 'x') { done++; continue; }
    if (!next && m[1] === ' ') {
      const content = m[2];
      const idm = content.match(/^([A-Za-z0-9_]+)\s*[—–-]\s*(.+)$/);
      next = { id: idm ? idm[1] : content, title: idm ? idm[2] : content, line: content, lineNo: i + 1 };
    }
  }
  return { file, done, total, next, missing: false };
}

function questTask(quest, checklist, extra = '') {
  return `# REQUIRED QUEST POLISH — ${quest.line}

This iteration is assigned by the Quest Polish Program (${checklist.done}/${checklist.total} done).
Read \`${rel(checklist.file)}\`, the quest's source and \`docs/SPEC.md\`. Work on **${quest.id}**
only; do not polish another quest this iteration.

1. Audit ${quest.id} against all eight criteria in the Quest Polish Standard.
2. Run \`node tools/bot.js --only ${quest.id}\` (add \`--cuts 1\` if it has cutscenes) and record the objective transitions/page errors.
3. Implement the smallest player-visible polish that fixes the weakest real issue. Keep the diff focused.
4. Re-run the focused check; add a screenshot for visual/cutscene work.
5. Mark the \`${quest.id}\` checklist entry \`[x]\` with a one-line note. The harness will auto-mark it after verified work if you forget, but you should keep the note accurate.
6. In the report, set \`"quest": "${quest.id}"\` and list the criteria you audited, the issue fixed, and the verification evidence.

${extra ? 'Additional context from the operator:\n' + extra + '\n' : ''}`;
}

function markQuestDone(config, quest, note) {
  if (!config.questProgram || !quest) return false;
  const file = path.resolve(ROOT, config.questFile || '.agent/quest-polish.md');
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let changed = false, done = 0, total = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*-\s*)\[( |x|X|!)\](\s+\*\*)([^*]+?)(\*\*.*)$/);
    if (!m) continue;
    total++;
    if (m[2].toLowerCase() === 'x') { done++; continue; }
    if (!m[4].trim().startsWith(quest.id)) continue;
    const suffix = note ? ` — ${note}` : '';
    lines[i] = `${m[1]}[x]${m[3]}${m[4]}${m[5]}${suffix}`;
    done++;
    changed = true;
  }
  if (changed) {
    let text = lines.join('\n');
    text = text.replace(/^Progress:\s*\d+\s*\/\s*\d+$/m, `Progress: ${done} / ${total}`);
    fs.writeFileSync(file, text);
  }
  return changed;
}

function normalizeReport(raw, fallbackGoal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const status = raw.status === 'no-change' ? 'no-change' : 'changed';
  return {
    ...raw,
    status,
    goal: typeof raw.goal === 'string' && raw.goal.trim() ? raw.goal.trim() : fallbackGoal,
    why: typeof raw.why === 'string' ? raw.why : '',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    acceptance: Array.isArray(raw.acceptance) ? raw.acceptance.map(String) : [],
    files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    tests: Array.isArray(raw.tests) ? raw.tests : [],
    risks: Array.isArray(raw.risks) ? raw.risks.map(String) : [],
    followups: Array.isArray(raw.followups) ? raw.followups.map(String) : [],
  };
}

async function runOpencode({ config, runDir, agent, promptPath, logName, timeoutMs, verbose }) {
  // Absolute path: OpenCode resolves --file against its project location, which
  // can be the main checkout even when the loop runs in a swarm worktree.
  const args = ['run', '--agent', agent, '--auto', '--archived', '--file', promptPath];
  if (config.model) args.push('--model', config.model);
  args.push('Follow the attached instructions exactly. Work in the current directory. Do not ask questions.');
  const logPath = path.join(runDir, 'logs', logName + '.log');
  log(`  opencode run --agent ${agent} (timeout ${Math.round(timeoutMs / 60000)} min)`);
  const r = await runChild('opencode', args, {
    cwd: ROOT,
    env: process.env,
    timeoutMs,
    logPath,
  });
  if (verbose && r.output) process.stdout.write(r.output);
  if (r.timedOut) log(`  ${agent}: TIMED OUT`);
  else if (!r.ok) log(`  ${agent}: exited ${r.code}`);
  return r;
}

function writeIterationSummary(runDir, ctx) {
  const { iteration, quest, report, gates, verify, outcome, commit, diff, durations } = ctx;
  const lines = [];
  lines.push(`# Iteration ${iteration} — ${outcome}`);
  lines.push('');
  lines.push(`- When: ${new Date().toISOString()}`);
  lines.push(`- Goal: ${report?.goal || '(none)'}`);
  if (quest) lines.push(`- Quest: **${quest.id} — ${quest.title}**`);
  lines.push(`- Commit: ${commit || '(none)'}`);
  lines.push(`- Diff: ${diff?.files || 0} files, +${diff?.additions || 0} / -${diff?.deletions || 0}`);
  lines.push('');
  if (report) {
    if (report.why) lines.push(`## Why\n${report.why}\n`);
    if (report.summary) lines.push(`## Summary\n${report.summary}\n`);
    if (report.acceptance?.length) lines.push(`## Acceptance\n${report.acceptance.map(a => '- ' + a).join('\n')}\n`);
    if (report.files?.length) lines.push(`## Files\n${report.files.map(f => '- `' + f + '`').join('\n')}\n`);
    if (report.risks?.length) lines.push(`## Risks\n${report.risks.map(x => '- ' + x).join('\n')}\n`);
    if (report.followups?.length) lines.push(`## Follow-ups\n${report.followups.map(x => '- ' + x).join('\n')}\n`);
    if (report.missingReport) lines.push('> Note: the director did not write report.json; this report was inferred by the harness.\n');
  }
  if (gates?.steps?.length) {
    lines.push('## Gates');
    for (const s of gates.steps) lines.push(`- **${s.name}**: ${s.ok ? 'PASS' : 'FAIL'} — ${s.summary} (${fmtDuration(s.durationMs)})`);
    lines.push('');
  }
  if (verify) {
    lines.push('## Independent verification');
    lines.push(`- Verdict: **${verify.verdict || '?'}**${verify.confidence != null ? ` (confidence ${verify.confidence})` : ''}`);
    if (verify.summary) lines.push(`- ${verify.summary}`);
    for (const f of verify.findings || []) lines.push(`- [${f.severity || 'major'}] ${f.file || '?'}${f.line ? ':' + f.line : ''}: ${f.issue || ''}`);
    lines.push('');
  }
  if (durations) {
    lines.push('## Timing');
    for (const [k, v] of Object.entries(durations)) lines.push(`- ${k}: ${fmtDuration(v)}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(runDir, 'summary.md'), lines.join('\n') + '\n');
}

async function runIteration(iteration, ctx) {
  const { config, port, chromium, state, quest } = ctx;
  const started = Date.now();
  const runDir = path.join(ROOT, config.runsDir, `${stamp()}-iter-${String(iteration).padStart(4, '0')}`);
  mkdirp(path.join(runDir, 'logs'));
  mkdirp(path.join(runDir, 'gates'));
  mkdirp(path.join(runDir, 'shots'));
  setStatus({ phase: 'starting', iteration, runDir: rel(runDir), startedAt: new Date().toISOString() });
  log(`iteration ${iteration}: ${rel(runDir)}`);

  const reportPath = path.join(runDir, 'report.json');
  const promptPath = path.join(runDir, 'prompt.md');
  const prompt = buildDirectorPrompt({
    iteration, root: ROOT, branch: config.branch, runDir, reportPath, config, state,
    task: ctx.task || '', swarm: !!ctx.swarm,
  });
  fs.writeFileSync(promptPath, prompt);

  const durations = {};
  let director;
  const directorStarted = Date.now();
  setStatus({ phase: 'director' });
  director = await runOpencode({
    config, runDir, agent: config.agent, promptPath, logName: 'director',
    timeoutMs: config.iterationTimeoutMin * 60000, verbose: ctx.verbose,
  });
  durations.director = Date.now() - directorStarted;

  let fatal = false;
  let fatalHint = '';
  const directorFatal = detectFatal(director.output);
  if (directorFatal) {
    fatal = true;
    fatalHint = directorFatal;
    fs.writeFileSync(path.join(runDir, 'director-error.txt'), tail(director.output, 80) + '\n');
  }

  // The harness owns staging. This makes untracked files visible in the diff
  // and lets us detect no-op iterations reliably.
  stageAll();
  const diff = diffStats();
  archiveDiff(runDir);

  const rawReport = readJson(reportPath, null);
  let report = normalizeReport(rawReport, diff.files ? `Autonomous changes in ${diff.status.split('\n').slice(0, 2).map(l => l.slice(3)).join(', ')}` : 'no changes');
  if (!report && diff.files) {
    report = {
      status: 'changed',
      goal: `Autonomous changes in ${diff.status.split('\n').slice(0, 2).map(l => l.slice(3)).join(', ')}`,
      why: 'The director did not write report.json; inferred from the staged diff.',
      summary: 'Report missing.',
      acceptance: ['All enabled harness gates pass', 'No unrelated or destructive changes'],
      files: [],
      tests: [],
      risks: [],
      followups: [],
      missingReport: true,
    };
    writeJson(path.join(runDir, 'report.inferred.json'), report);
  }
  if (report && report.status === 'no-change' && diff.files) {
    report.reportMismatch = true;
    report.why = (report.why ? report.why + ' ' : '') + `(Harness note: the agent reported no-change but staged ${diff.files} files.)`;
  }
  if (!report) report = { status: 'no-change', goal: 'no changes', summary: '', acceptance: [], files: [], tests: [], risks: [], followups: [] };
  if (quest) {
    if (report.quest && report.quest !== quest.id) report.questMismatch = true;
    report.quest = quest.id;
  }

  if (fatal) {
    durations.total = Date.now() - started;
    writeIterationSummary(runDir, { iteration, report, gates: null, verify: null, outcome: 'failed', commit: null, diff, durations });
    log(`iteration ${iteration}: FAILED — ${fatalHint}`);
    return {
      outcome: 'failed', failReason: 'director-unavailable', fatal: true, fatalHint,
      report, gates: null, verify: null, commit: null, diff, runDir, durations, finalOk: false,
    };
  }

  if (!diff.files) {
    durations.total = Date.now() - started;
    if (!director.ok) {
      fs.writeFileSync(path.join(runDir, 'director-error.txt'), tail(director.output, 80) + '\n');
      writeIterationSummary(runDir, { iteration, report, gates: null, verify: null, outcome: 'failed', commit: null, diff, durations });
      log(`iteration ${iteration}: FAILED — director exited ${director.code}${director.timedOut ? ' (timeout)' : ''} with no changes`);
      return {
        outcome: 'failed', failReason: 'director-error', fatal: false, fatalHint: '',
        report, gates: null, verify: null, commit: null, diff, runDir, durations, finalOk: false,
      };
    }
    const outcome = 'no-change';
    writeIterationSummary(runDir, { iteration, report, gates: null, verify: null, outcome, commit: null, diff, durations });
    log(`iteration ${iteration}: no changes (${fmtDuration(durations.total)})`);
    return { outcome, report, gates: null, verify: null, commit: null, diff, runDir, durations, directorOk: director.ok };
  }

  if (!director.ok) log(`  warning: director exited ${director.code}${director.timedOut ? ' (timeout)' : ''}; evaluating the changes it left behind`);
  log(`iteration ${iteration}: diff ${diff.files} files, +${diff.additions}/-${diff.deletions}`);

  let gates = null;
  let verify = null;
  let repairRound = 0;
  let finalOk = false;
  let failReason = '';
  let verifiedDiff = '';

  const gateArgs = { root: ROOT, config, runDir, port, chromium, iteration, log };

  // Implement -> test -> verify, with repair rounds. Gates are re-run after
  // every repair; verification only runs once the deterministic gates are green.
  for (;;) {
    setStatus({ phase: 'gates', iteration, repairRound });
    const gateStarted = Date.now();
    gates = await runGates(gateArgs);
    durations['gates-' + repairRound] = Date.now() - gateStarted;

    if (!gates.ok) {
      if (repairRound >= config.repairRounds) { finalOk = false; failReason = 'gates'; break; }
      repairRound++;
      setStatus({ phase: 'repair', iteration, repairRound, reason: 'gates' });
      const promptPath2 = path.join(runDir, `repair-${repairRound}.md`);
      const fixReportPath = path.join(runDir, `repair-${repairRound}.json`);
      stageAll();
      archiveDiff(runDir);
      fs.writeFileSync(promptPath2, buildFixerPrompt({
        iteration, root: ROOT, runDir, report, gates, verify, round: repairRound,
        fixReportPath, diffPath: path.join(runDir, 'diff.patch'),
      }));
      const startedFix = Date.now();
      const fix = await runOpencode({
        config, runDir, agent: config.fixAgent, promptPath: promptPath2,
        logName: `repair-${repairRound}`, timeoutMs: config.iterationTimeoutMin * 60000, verbose: ctx.verbose,
      });
      durations['repair-' + repairRound] = Date.now() - startedFix;
      stageAll();
      archiveDiff(runDir);
      const fixFatal = detectFatal(fix.output);
      if (fixFatal) {
        fatal = true; fatalHint = fixFatal; finalOk = false; failReason = 'fixer-unavailable';
        log(`  repair ${repairRound}: ${fixFatal}`);
        break;
      }
      if (fix.timedOut) log(`  repair ${repairRound}: timed out; re-running gates anyway`);
      continue;
    }

    if (!config.verify) { finalOk = true; break; }

    // Freeze what the verifier is reviewing. Any subsequent source edit by the
    // verifier is detected by comparing this to the final staged diff.
    stageAll();
    verifiedDiff = archiveDiff(runDir);

    const verifyPath = path.join(runDir, 'verify.json');
    const verifyPromptPath = path.join(runDir, 'verify-prompt.md');
    fs.writeFileSync(verifyPromptPath, buildVerifierPrompt({
      iteration, root: ROOT, runDir, report, gates,
      acceptance: report.acceptance, verifyPath, diffPath: path.join(runDir, 'diff.patch'),
    }));
    setStatus({ phase: 'verify', iteration, repairRound });
    const verifyStarted = Date.now();
    const vr = await runOpencode({
      config, runDir, agent: config.verifyAgent, promptPath: verifyPromptPath,
      logName: 'verify-' + repairRound, timeoutMs: config.verifyTimeoutMin * 60000, verbose: ctx.verbose,
    });
    durations['verify-' + repairRound] = Date.now() - verifyStarted;

    const verifierFatal = detectFatal(vr.output);
    let v = readJson(verifyPath, null);
    if (!v) {
      const parsed = firstJsonObject(vr.output);
      if (parsed && parsed.verdict) { v = parsed; writeJson(verifyPath, parsed); }
    }
    if (verifierFatal) {
      v = { verdict: 'ERROR', fatal: true, summary: verifierFatal };
      writeJson(verifyPath, v);
    } else if (!v) {
      v = { verdict: 'ERROR', summary: vr.timedOut ? 'verifier timed out and wrote no verdict' : 'verifier wrote no verdict file' };
      writeJson(verifyPath, v);
    } else if (!['PASS', 'FAIL'].includes(v.verdict)) {
      v = { ...v, verdict: 'ERROR', summary: `invalid verifier verdict: ${JSON.stringify(v.verdict)}` };
      writeJson(verifyPath, v);
    }
    verify = v;
    if (verifierFatal) { fatal = true; fatalHint = verifierFatal; }

    if (verify.verdict === 'PASS') {
      const finalDiff = git(['diff', '--cached', '--binary'], { allowFail: true }).out + '\n';
      if (finalDiff !== verifiedDiff) {
        finalOk = false; failReason = 'verifier-modified-worktree';
        log('  verifier modified the staged diff — refusing to commit');
        break;
      }
      finalOk = true;
      break;
    }

    if (verify.verdict === 'ERROR') {
      if (config.requireVerification) {
        finalOk = false;
        failReason = verify.fatal ? 'verifier-unavailable' : 'verification-unavailable';
        break;
      }
      log('  warning: verifier unavailable; gates passed, continuing without independent verification');
      finalOk = true;
      break;
    }

    // Verdict FAIL.
    if (repairRound >= config.repairRounds) { finalOk = false; failReason = 'verify'; break; }
    repairRound++;
    setStatus({ phase: 'repair', iteration, repairRound, reason: 'verify' });
    const promptPath2 = path.join(runDir, `repair-${repairRound}.md`);
    const fixReportPath = path.join(runDir, `repair-${repairRound}.json`);
    fs.writeFileSync(promptPath2, buildFixerPrompt({
      iteration, root: ROOT, runDir, report, gates, verify, round: repairRound,
      fixReportPath, diffPath: path.join(runDir, 'diff.patch'),
    }));
    const startedFix = Date.now();
    const fix = await runOpencode({
      config, runDir, agent: config.fixAgent, promptPath: promptPath2,
      logName: `repair-${repairRound}`, timeoutMs: config.iterationTimeoutMin * 60000, verbose: ctx.verbose,
    });
    durations['repair-' + repairRound] = Date.now() - startedFix;
    stageAll();
    archiveDiff(runDir);
    const fixFatal = detectFatal(fix.output);
    if (fixFatal) {
      fatal = true; fatalHint = fixFatal; finalOk = false; failReason = 'fixer-unavailable';
      log(`  repair ${repairRound}: ${fixFatal}`);
      break;
    }
    if (fix.timedOut) log(`  repair ${repairRound}: timed out; re-running gates anyway`);
  }

  let commit = null;
  if (finalOk && quest) {
    const marked = markQuestDone(config, quest, `iter ${iteration}: ${firstLine(report.goal, 80)}`);
    if (marked) log(`  marked quest ${quest.id} done in ${config.questFile}`);
    report.quest = quest.id;
    report.questMarked = true;
    stageAll();
  }
  if (finalOk) {
    if (config.commit) {
      stageAll();
      const finalStats = diffStats();
      const gateNames = (gates?.steps || []).map(s => `${s.name}:${s.ok ? 'pass' : 'fail'}`).join(', ');
      const message = `agent(iter ${iteration}): ${firstLine(report.goal)}\n\n`
        + `${firstLine(report.summary || report.why || 'Autonomous improvement.', 700)}\n\n`
        + `Gates: ${gateNames}\n`
        + `Verifier: ${verify ? `${verify.verdict}${verify.confidence != null ? ` (confidence ${verify.confidence})` : ''}` : 'skipped'}\n`
        + `Run: ${rel(runDir)}`;
      const c = git(['commit', '-m', message], { allowFail: true });
      if (!c.ok) {
        finalOk = false;
        failReason = 'commit-failed';
        log('  commit failed: ' + firstLine(c.err || c.out, 300));
      } else {
        commit = git(['rev-parse', '--short', 'HEAD'], { allowFail: true }).out;
        log(`iteration ${iteration}: COMMITTED ${commit} — ${firstLine(report.goal)}`);
      }
    } else {
      log(`iteration ${iteration}: verified (commit disabled)`);
    }
  }

  durations.total = Date.now() - started;
  const outcome = finalOk ? (commit ? 'committed' : 'verified') : 'failed';
  writeIterationSummary(runDir, { iteration, quest, report, gates, verify, outcome, commit, diff, durations });
  if (!finalOk) log(`iteration ${iteration}: FAILED (${failReason}) after ${fmtDuration(durations.total)}`);

  return { outcome, failReason, fatal, fatalHint, quest, report, gates, verify, commit, diff, runDir, durations, finalOk };
}

async function gatesOnly(args, config, chromium) {
  const port = args.port || config.port;
  const runDir = args.out ? path.resolve(args.out) : path.join(ROOT, config.runsDir, `${stamp()}-gates`);
  mkdirp(runDir);
  log(`gates only: ${rel(runDir)}`);
  const server = await ensureServer({ port, root: ROOT, logPath: path.join(ROOT, config.serverLog) });
  try {
    const record = await runGates({
      root: ROOT, config, runDir, port, chromium,
      iteration: 1, quick: !!args.quick, forceStory: !!args.story, forceWorld: !!args.world,
      log: line => log(line),
    });
    log(`GATES_RESULT ${JSON.stringify({
      ok: record.ok, runDir: rel(runDir), durationMs: record.durationMs,
      steps: record.steps.map(s => ({ name: s.name, ok: s.ok, summary: s.summary, durationMs: s.durationMs })),
      metrics: record.metrics,
    })}`);
    return record.ok ? 0 : 1;
  } finally {
    await server.stop();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }

  const overrides = {
    ...(args.model ? { model: args.model } : {}),
    ...(args.agent ? { agent: args.agent } : {}),
    ...(args.branch ? { branch: args.branch } : {}),
    ...(args.port ? { port: args.port } : {}),
    ...(args.chromium ? { chromium: args.chromium } : {}),
    ...(args.iterationTimeoutMin ? { iterationTimeoutMin: args.iterationTimeoutMin } : {}),
    ...(args.verifyTimeoutMin ? { verifyTimeoutMin: args.verifyTimeoutMin } : {}),
    ...(args.repairRounds != null ? { repairRounds: args.repairRounds } : {}),
    ...(args.verify === false ? { verify: false } : {}),
    ...(args.commit === false ? { commit: false } : {}),
    ...(args.resetOnFailure === false ? { resetOnFailure: false } : {}),
    ...(args.storyEvery != null ? { storyEvery: args.storyEvery } : {}),
    ...(args.maxHours != null ? { maxHours: args.maxHours } : {}),
  };
  const config = applyOverrides(loadConfig(ROOT), overrides);
  if (args.noQuestProgram) config.questProgram = false;
  const port = config.port;
  const chromium = detectChrome(config);
  let task = args.task || '';
  if (args.taskFile) {
    try { task = fs.readFileSync(path.resolve(args.taskFile), 'utf8').trim(); }
    catch (e) { console.error(`[agent-loop] cannot read --task-file ${args.taskFile}: ${e.message}`); return 1; }
  }
  if (!chromium) log('warning: no Chrome/Chromium found; smoke/monkey/story gates will fail. Set config.chromium.');

  if (args.gatesOnly) return await gatesOnly(args, config, chromium);

  if (args.dryRun) {
    const runDir = path.join(ROOT, config.runsDir, `${stamp()}-dry-run`);
    mkdirp(runDir);
    const state = loadState(config);
    const iteration = Math.max(1, (state.iteration || 0) + 1);
    let dryTask = task;
    const checklist = questChecklist(config);
    if (checklist?.next) dryTask = questTask(checklist.next, checklist, task);
    else if (checklist && !checklist.next) dryTask = `The Quest Polish Program is complete (${checklist.done}/${checklist.total}).\n\n${task}`;
    const prompt = buildDirectorPrompt({
      iteration, root: ROOT, branch: config.branch, runDir,
      reportPath: path.join(runDir, 'report.json'), config, state,
      task: dryTask, swarm: !!args.swarm,
    });
    const promptPath = path.join(runDir, 'prompt.md');
    fs.writeFileSync(promptPath, prompt);
    log(`dry run: wrote ${rel(promptPath)}`);
    console.log('\n' + prompt + '\n');
    log(`gates: ${Object.entries(config.gates).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
    log('no agents or git commands were run.');
    return 0;
  }

  const lock = acquireLock();
  let server = null;
  let stopping = false;
  let fatalStop = false;
  let originalBranch = '';
  const cleanup = async () => {
    try { if (server) await server.stop(); } catch (e) { }
    try { lock.release(); } catch (e) { }
  };
  const onSignal = async (sig) => {
    if (stopping) return;
    stopping = true;
    log(`received ${sig}; stopping after cleaning up`);
    setStatus({ phase: 'stopping', signal: sig });
    try { killActiveChildren('SIGTERM'); } catch (e) { }
    await sleep(1500);
    try { killActiveChildren('SIGKILL'); } catch (e) { }
    try { await cleanup(); } catch (e) { }
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  try {
    const state = loadState(config);
    verifyOpencodeAgents(config);
    originalBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }).out;
    const branch = ensureLoopBranch(config);
    server = await ensureServer({ port, root: ROOT, logPath: path.join(ROOT, config.serverLog) });
    const startMs = Date.now();
    const maxIterations = args.once ? 1 : (args.iterations || config.maxIterations || 0);
    const maxHours = args.maxHours != null ? args.maxHours : config.maxHours;
    let consecutiveFailures = 0;
    let consecutiveNoChange = 0;
    let sawFailure = false;

    log('============================================================');
    log(`agent loop: branch=${branch} agent=${config.agent} model=${config.model || 'default'}`);
    log(`server=http://127.0.0.1:${port} chrome=${chromium || 'MISSING'} verify=${config.verify} commit=${config.commit}`);
    log(`iterations=${maxIterations || 'unlimited'} maxHours=${maxHours || 'unlimited'} storyEvery=${config.storyEvery}`);
    if (config.questProgram) {
      const q = questChecklist(config);
      if (q?.missing) log(`warning: quest program is on but ${config.questFile} is missing`);
      else log(`quest program: ${q.done}/${q.total} done${q.next ? `; next ${q.next.id} — ${q.next.title}` : '; complete'}`);
    }
    log('stop with Ctrl-C or `touch .agent/STOP`');
    log('============================================================');

    setStatus({ phase: 'idle', branch, iteration: state.iteration, startedAt: new Date().toISOString() });

    while (!stopping) {
      if (fs.existsSync(path.join(ROOT, config.stopFile))) {
        log(`stop file found (${config.stopFile}); finishing`);
        break;
      }
      if (maxIterations && state.iteration >= maxIterations) {
        log(`reached iteration cap (${maxIterations})`);
        break;
      }
      if (maxHours && (Date.now() - startMs) >= maxHours * 3600000) {
        log(`reached time cap (${maxHours}h)`);
        break;
      }

      const iteration = (state.iteration || 0) + 1;
      state.iteration = iteration;
      saveState(config, state);

      const checklist = questChecklist(config);
      const assignedQuest = checklist?.next || null;
      let iterationTask = task;
      if (checklist && assignedQuest) {
        iterationTask = questTask(assignedQuest, checklist, task);
        log(`iteration ${iteration}: quest ${assignedQuest.id} — ${assignedQuest.title} (${checklist.done}/${checklist.total})`);
      } else if (checklist && !checklist.next) {
        iterationTask = `The Quest Polish Program is complete (${checklist.done}/${checklist.total}).\n\n${task}`;
      }

      let result;
      try {
        result = await runIteration(iteration, {
          config, port, chromium, state, verbose: !!args.verbose,
          task: iterationTask, quest: assignedQuest, swarm: !!args.swarm,
        });
      } catch (e) {
        log(`iteration ${iteration}: HARNESS ERROR — ${e.message}`);
        const runDir = path.join(ROOT, config.runsDir, `${stamp()}-iter-${String(iteration).padStart(4, '0')}-error`);
        mkdirp(runDir);
        fs.writeFileSync(path.join(runDir, 'harness-error.txt'), String(e.stack || e) + '\n');
        result = { outcome: 'failed', failReason: 'harness-error', quest: assignedQuest, report: null, gates: null, verify: null, commit: null, diff: { files: 0 }, runDir, durations: {}, finalOk: false };
      }

      const now = new Date().toISOString();
      state.history.push({
        iteration,
        ts: now,
        result: result.outcome,
        quest: result.quest?.id || null,
        goal: result.report?.goal || '',
        commit: result.commit || null,
        gatesOk: result.gates?.ok ?? null,
        verify: result.verify?.verdict || null,
        durationMs: result.durations?.total || 0,
        runDir: rel(result.runDir),
        failReason: result.failReason || null,
        fatal: !!result.fatal,
        fatalHint: result.fatalHint || null,
      });
      state.history = state.history.slice(-300);
      if (result.outcome === 'committed' || result.outcome === 'verified') {
        state.totals.committed++;
        consecutiveFailures = 0;
        consecutiveNoChange = 0;
      } else if (result.outcome === 'no-change') {
        state.totals.noChange++;
        consecutiveNoChange++;
      } else {
        state.totals.failed++;
        consecutiveFailures++;
        sawFailure = true;
      }
      state.lastRunAt = now;
      state.lastResult = { iteration, outcome: result.outcome, goal: result.report?.goal || '', runDir: rel(result.runDir) };
      saveState(config, state);
      setStatus({ phase: 'idle', iteration, lastResult: result.outcome, lastRunDir: rel(result.runDir) });

      // Failed iterations must not poison the next one. Archive the diff first
      // (done by runIteration), then stash it for later inspection.
      if (result.outcome === 'failed' && result.finalOk === false) {
        const st = gitStatus();
        if (st) {
          if (config.resetOnFailure) {
            const s = git(['stash', 'push', '-u', '-m', `agent-loop iter ${iteration} failed (${result.failReason})`], { allowFail: true });
            if (!s.ok) {
              log('could not stash failed work; stopping so the tree does not stay dirty');
              break;
            }
            log(`stashed failed work: agent-loop iter ${iteration} failed (${result.failReason})`);
            log('recover with: git stash list && git stash show -p <stash>');
          } else {
            log('failed work left in the tree (--keep-failed); stopping to avoid mixing iterations');
            break;
          }
        }
      }

      if (result.fatal) {
        fatalStop = true;
        log(`FATAL: ${result.fatalHint || result.failReason}`);
        break;
      }
      if (consecutiveFailures >= (config.maxConsecutiveFailures || Infinity)) {
        log(`stopping after ${consecutiveFailures} consecutive failed iterations`);
        break;
      }
      if (consecutiveNoChange >= (config.maxConsecutiveNoChange || Infinity)) {
        log(`stopping after ${consecutiveNoChange} consecutive no-change iterations; add ideas to ${config.backlogFile}`);
        break;
      }

      const pause = result.outcome === 'failed'
        ? Math.max(config.cooldownSec, config.failureBackoffSec)
        : config.cooldownSec;
      if (pause > 0) await sleep(pause * 1000);
    }

    if (fatalStop && originalBranch && originalBranch !== config.branch) {
      const ahead = git(['rev-list', '--count', `${originalBranch}..${config.branch}`], { allowFail: true }).out;
      if (ahead === '0' && !gitStatus()) {
        const co = git(['checkout', originalBranch], { allowFail: true });
        if (co.ok) log(`no commits were made; restored branch ${originalBranch}`);
      }
    }
    log(fatalStop ? 'agent loop stopped on a fatal error' : 'agent loop finished');
    setStatus({ phase: fatalStop ? 'fatal' : 'finished' });
    if (fatalStop) return 1;
    if (args.exitOnFailure && sawFailure) return 1;
    return 0;
  } finally {
    await cleanup();
  }
}

main().then(code => process.exit(code || 0)).catch(e => {
  console.error('[agent-loop] FATAL', e.stack || e);
  process.exit(1);
});
