// Deterministic quality gates for the autonomous agent loop.
//
// These gates are the harness's source of truth. They are run with a fresh
// process after the director/fixer agents finish and cannot be edited by the
// verifier. An iteration is only committed when every enabled gate passes.
//
// CLI:
//   node tools/agent/gates.mjs [--quick] [--story] [--world] [--out DIR]
//                               [--port 8123] [--iteration N] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROOT, detectChrome, ensureServer, fmtDuration, gitStatus, killActiveChildren, lastJsonLine,
  mkdirp, readJson, runChild, sleep, stamp, tail, writeJson,
} from './util.mjs';
import { loadConfig, applyOverrides } from './config.mjs';

const IGNORE_DIRS = new Set(['node_modules', '.git', '.agent', 'lib', 'assets']);
const STATIC_EXTS = new Set(['.js', '.mjs']);

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.opencode') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      walk(full, out);
    } else if (STATIC_EXTS.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

function resultStep(name, started, extra = {}) {
  return {
    name,
    ok: false,
    durationMs: Date.now() - started,
    summary: '',
    logPath: '',
    ...extra,
  };
}

async function staticGate(ctx) {
  const started = Date.now();
  const files = [
    path.join(ctx.root, 'server.js'),
    ...walk(path.join(ctx.root, 'src')),
    ...walk(path.join(ctx.root, 'tools')),
  ].filter(f => !f.includes(`${path.sep}.agent${path.sep}`));
  const failures = [];
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { cwd: ctx.root, encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0) failures.push({ file: path.relative(ctx.root, file), error: (r.stderr || r.stdout || '').trim().slice(0, 600) });
  }
  const logPath = path.join(ctx.runDir, 'gates', 'static.log');
  mkdirp(path.dirname(logPath));
  fs.writeFileSync(logPath, JSON.stringify({ files: files.length, failures }, null, 2) + '\n');
  return resultStep('static', started, {
    ok: failures.length === 0,
    summary: failures.length ? `${failures.length}/${files.length} files failed syntax check` : `${files.length} files parsed`,
    logPath,
    data: { files: files.length, failures },
  });
}

async function smokeGate(ctx) {
  const started = Date.now();
  const logPath = path.join(ctx.runDir, 'gates', 'smoke.log');
  const out = path.join(ctx.runDir, 'shots');
  const r = await runChild(process.execPath, ['tools/agent/smoke.mjs'], {
    cwd: ctx.root,
    env: { ...process.env, PORT: String(ctx.port), SMOKE_OUT: out, PUPPETEER_EXECUTABLE_PATH: ctx.chromium },
    timeoutMs: ctx.config.gateTimeoutMin * 60000,
    logPath,
  });
  const data = lastJsonLine(r.output, 'SMOKE_RESULT');
  let ok = r.ok && !!data && data.ok === true;
  let summary;
  if (!data) summary = r.timedOut ? 'smoke timed out' : 'smoke produced no result';
  else if (!data.ok) {
    const bad = Object.entries(data.checks || {}).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.msg}`);
    summary = (bad.length ? bad.join('; ') : data.error || 'smoke failed') + (data.pageErrors?.length ? ` | pageerrors: ${data.pageErrors.slice(0, 3).join(' / ')}` : '');
  } else {
    summary = `boot+sim+drive+render ok (${data.metrics?.driveDistance ?? '?'} m driven, ${data.metrics?.drawCalls ?? '?'} draw calls)`;
  }
  return resultStep('smoke', started, { ok, summary: summary.slice(0, 1200), logPath, data, exitCode: r.code, timedOut: r.timedOut });
}

async function monkeyGate(ctx) {
  const started = Date.now();
  const logPath = path.join(ctx.runDir, 'gates', 'monkey.log');
  const out = path.join(ctx.runDir, 'shots');
  const r = await runChild(process.execPath, [
    'tools/play.js', 'tools/qa_game_monkey.js',
    '--exe', ctx.chromium, '--out', out + path.sep,
    '--url', `http://127.0.0.1:${ctx.port}/index.html`,
  ], {
    cwd: ctx.root,
    env: { ...process.env, MIN: String(ctx.config.monkeyMinutes), INV: '1', PUPPETEER_EXECUTABLE_PATH: ctx.chromium },
    timeoutMs: Math.max(5, ctx.config.monkeyMinutes + 4) * 60000,
    logPath,
  });
  const data = lastJsonLine(r.output);
  const exceptions = data?.ex ?? null;
  const nan = data?.nan || [];
  const stepsError = /\[steps error\]/.test(r.output);
  const ok = r.ok && !!data && exceptions === 0 && nan.length === 0 && !stepsError;
  let summary;
  if (!data) summary = r.timedOut ? 'monkey timed out' : 'monkey produced no result';
  else if (!ok) summary = `${exceptions} exceptions, ${nan.length} NaN entities${stepsError ? ', step error' : ''}${data.errs?.length ? ': ' + data.errs.join(' / ') : ''}`;
  else summary = `${ctx.config.monkeyMinutes} min random input, no exceptions or NaN`;
  return resultStep('monkey', started, {
    ok,
    summary: summary.slice(0, 1200),
    logPath,
    exitCode: r.code,
    timedOut: r.timedOut,
    data: data ? { ex: data.ex, nan: data.nan, counts: { peds: data.peds, vehicles: data.vehs }, errs: data.errs } : null,
  });
}

async function storyGate(ctx) {
  const started = Date.now();
  const logPath = path.join(ctx.runDir, 'gates', 'story.log');
  const out = path.join(ctx.runDir, 'shots');
  const r = await runChild(process.execPath, [
    'tools/bot.js',
    '--from', ctx.config.storyFrom,
    '--to', ctx.config.storyTo,
    '--out', out + path.sep,
    '--maxloops', '5000',
  ], {
    cwd: ctx.root,
    env: {
      ...process.env,
      GAME_URL: `http://127.0.0.1:${ctx.port}/index.html`,
      PUPPETEER_EXECUTABLE_PATH: ctx.chromium,
    },
    timeoutMs: ctx.config.storyTimeoutMin * 60000,
    logPath,
  });
  const res = lastJsonLine(r.output, 'RESULT');
  const pageErrors = (r.output.match(/\[pageerror\]/g) || []).length;
  const ok = r.ok && !!res && Array.isArray(res.failed) && res.failed.length === 0 && pageErrors === 0;
  let summary;
  if (!res) summary = r.timedOut ? 'story bot timed out' : 'story bot produced no RESULT';
  else summary = `${res.passed?.length || 0} passed, ${res.failed?.length || 0} failed${pageErrors ? `, ${pageErrors} page errors` : ''}${res.failed?.length ? ': ' + res.failed.join(',') : ''}`;
  return resultStep('story', started, {
    ok,
    summary: summary.slice(0, 1200),
    logPath,
    exitCode: r.code,
    timedOut: r.timedOut,
    data: res ? { passed: res.passed, failed: res.failed, pageErrors } : { pageErrors },
  });
}

async function worldAuditGate(ctx) {
  const started = Date.now();
  const logPath = path.join(ctx.runDir, 'gates', 'world-audit.log');
  const out = path.join(ctx.runDir, 'shots');
  const r = await runChild(process.execPath, [
    'tools/play.js', 'tools/qa_world_audit.js',
    '--exe', ctx.chromium, '--out', out + path.sep,
    '--url', `http://127.0.0.1:${ctx.port}/index.html`,
  ], {
    cwd: ctx.root,
    env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: ctx.chromium },
    timeoutMs: ctx.config.gateTimeoutMin * 60000,
    logPath,
  });
  const data = lastJsonLine(r.output);
  const valid = data && Number.isFinite(data.props);
  const onRoad = data?.bldOnRoad?.length || 0;
  const floating = data?.floatBig?.length || 0;
  const underwater = Object.keys(data?.propUnderwater || {}).length;
  const ok = r.ok && valid && onRoad <= ctx.config.worldMaxBuildingsOnRoad && floating <= ctx.config.worldMaxFloating && underwater === 0;
  const summary = !valid ? (r.timedOut ? 'world audit timed out' : 'world audit produced no result')
    : `${data.buildings} buildings, ${data.props} props; ${onRoad} on roads, ${floating} floating, ${underwater} underwater prop kinds`;
  return resultStep('world-audit', started, { ok, summary, logPath, data: valid ? data : null, exitCode: r.code, timedOut: r.timedOut });
}

/**
 * Run the enabled gates.
 * @param {object} ctx
 * @param {string} ctx.root
 * @param {object} ctx.config
 * @param {string} ctx.runDir
 * @param {number} ctx.port
 * @param {string} ctx.chromium
 * @param {number} [ctx.iteration]
 * @param {boolean} [ctx.quick]
 * @param {boolean} [ctx.forceStory]
 * @param {boolean} [ctx.forceWorld]
 * @param {(line:string)=>void} [ctx.log]
 */
export async function runGates(ctx) {
  const log = ctx.log || (() => { });
  const started = Date.now();
  const steps = [];
  const gateDir = path.join(ctx.runDir, 'gates');
  mkdirp(gateDir);

  const run = async (name, fn) => {
    if (!ctx.chromium && ['smoke', 'monkey', 'story', 'world-audit'].includes(name)) {
      steps.push(resultStep(name, Date.now(), { ok: false, summary: 'no Chromium/Chrome executable found (set config.chromium or PUPPETEER_EXECUTABLE_PATH)' }));
      log(`  ${name}: FAIL (no chrome)`);
      return;
    }
    log(`  ${name}: running...`);
    const step = await fn();
    steps.push(step);
    log(`  ${name}: ${step.ok ? 'PASS' : 'FAIL'} — ${step.summary} (${fmtDuration(step.durationMs)})`);
  };

  if (ctx.config.gates.static) await run('static', () => staticGate({ ...ctx, runDir: ctx.runDir }));
  if (ctx.config.gates.smoke) await run('smoke', () => smokeGate(ctx));
  if (!ctx.quick && ctx.config.gates.monkey) await run('monkey', () => monkeyGate(ctx));
  const wantStory = ctx.forceStory || (!ctx.quick && ctx.config.gates.story && ctx.config.storyEvery > 0
    && ((Math.max(1, ctx.iteration || 1) - 1) % ctx.config.storyEvery === 0));
  if (wantStory) await run('story', () => storyGate(ctx));
  if (ctx.forceWorld || (!ctx.quick && ctx.config.gates.worldAudit)) await run('world-audit', () => worldAuditGate(ctx));

  const metrics = {};
  for (const s of steps) {
    if (s.name === 'smoke' && s.data?.metrics) Object.assign(metrics, s.data.metrics);
    if (s.name === 'monkey' && s.data) metrics.monkey = { exceptions: s.data.ex, counts: s.data.counts };
    if (s.name === 'story' && s.data) metrics.story = { passed: s.data.passed?.length || 0, failed: s.data.failed?.length || 0 };
  }
  const record = {
    ok: steps.length > 0 && steps.every(s => s.ok),
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    quick: !!ctx.quick,
    iteration: ctx.iteration || null,
    steps,
    metrics,
  };
  writeJson(path.join(ctx.runDir, 'gates.json'), record);
  return record;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { quick: false, story: false, world: false, json: false, out: '', port: null, iteration: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') out.quick = true;
    else if (a === '--story') out.story = true;
    else if (a === '--world') out.world = true;
    else if (a === '--json') out.json = true;
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--port') out.port = +argv[++i];
    else if (a === '--iteration') out.iteration = +argv[++i];
    else if (a === '--no-story') out.story = false;
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const config = loadConfig(ROOT);
    const port = args.port || config.port;
    const chromium = detectChrome(config);
    const runDir = args.out ? path.resolve(args.out) : path.join(ROOT, config.runsDir, `${stamp()}-gates`);
    mkdirp(runDir);
    const log = line => console.log(line);
    log(`[gates] ${runDir}`);
    if (gitStatus(ROOT)) log('[gates] note: working tree is dirty; gates are read-only and will not commit');
    let server;
    const onSignal = async (sig) => {
      killActiveChildren('SIGTERM');
      if (server) { try { await server.stop(); } catch (e) { } }
      process.exit(sig === 'SIGINT' ? 130 : 143);
    };
    process.on('SIGINT', () => onSignal('SIGINT'));
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    try {
      server = await ensureServer({ port, root: ROOT, logPath: path.join(ROOT, config.serverLog) });
      const record = await runGates({
        root: ROOT, config, runDir, port, chromium,
        iteration: args.iteration, quick: args.quick,
        forceStory: args.story, forceWorld: args.world, log,
      });
      console.log('GATES_RESULT ' + JSON.stringify({
        ok: record.ok,
        runDir,
        durationMs: record.durationMs,
        steps: record.steps.map(s => ({ name: s.name, ok: s.ok, summary: s.summary, durationMs: s.durationMs })),
        metrics: record.metrics,
      }));
      await server.stop();
      process.exit(record.ok ? 0 : 1);
    } catch (e) {
      console.error('GATES HARNESS ERROR', e.stack || e);
      if (server) await server.stop();
      process.exit(2);
    }
  })();
}
