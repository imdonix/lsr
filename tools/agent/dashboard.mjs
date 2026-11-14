// Live dashboard for the autonomous loop / swarm.
//
//   npm run agent:dashboard            # http://127.0.0.1:8787
//   node tools/agent/dashboard.mjs --port 8787 --host 127.0.0.1
//
// Reads the runtime files under .agent/ (state, locks, worker worktrees, quest
// checklist, run artifacts) and serves a small auto-refreshing HTML page plus
// /api/overview JSON. Local-only by default; no dependencies.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HERE = path.join(ROOT, 'tools/agent/dashboard');
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const PORT = +opt('port', 8787);
const HOST = opt('host', '127.0.0.1');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function readText(file, max = 80_000) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, max);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, Math.max(0, st.size - len));
    fs.closeSync(fd);
    return buf.toString('utf8').replace(ANSI, '');
  } catch (e) { return ''; }
}

function tail(file, lines = 60) {
  const text = readText(file, 120_000);
  if (!text) return [];
  return text.trimEnd().split('\n').slice(-lines);
}

function exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function git(args, cwd = ROOT, allowFail = true) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2_000_000 });
  if (r.status !== 0 && !allowFail) return '';
  return (r.stdout || '').trim();
}

function listDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
}

function parseQuests(file) {
  if (!file || !exists(file)) return { file: null, done: 0, total: 0, next: null, items: [], percent: 0 };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const items = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*\[( |x|X|!)\]\s+\*\*(.+?)\*\*/);
    if (m) {
      const content = m[2];
      const idm = content.match(/^([A-Za-z0-9_]+)\s*[—–-]\s*(.+)$/);
      current = {
        id: idm ? idm[1] : content,
        title: idm ? idm[2] : content,
        state: m[1].toLowerCase() === 'x' ? 'done' : m[1] === '!' ? 'blocked' : 'open',
        source: '',
      };
      items.push(current);
      continue;
    }
    if (current && !current.source) {
      const sm = lines[i].match(/source:\s*`([^`]+)`/);
      if (sm) current.source = sm[1];
    }
  }
  const done = items.filter(q => q.state === 'done').length;
  const next = items.find(q => q.state === 'open') || null;
  return {
    file: path.relative(ROOT, file),
    done, total: items.length, next,
    items,
    percent: items.length ? Math.round((done / items.length) * 100) : 0,
  };
}

function parseWorktrees() {
  const out = git(['worktree', 'list', '--porcelain']);
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9) }; list.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (cur && line.startsWith('detached')) cur.detached = true;
  }
  return list.map(w => ({ ...w, path: path.relative(ROOT, w.path) || '.' }));
}

function processes() {
  const r = spawnSync('ps', ['-eo', 'pid,ppid,etime,pcpu,pmem,cmd'], { encoding: 'utf8', maxBuffer: 4_000_000 });
  if (r.status !== 0) return [];
  return (r.stdout || '').split('\n').slice(1).filter(Boolean).map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/);
    if (!m) return null;
    const cmd = m[6];
    if (!/tools\/agent\/(loop|swarm)\.mjs|opencode run --agent|node server\.js 8\d\d\d/.test(cmd)) return null;
    return { pid: +m[1], ppid: +m[2], etime: m[3], cpu: +m[4], mem: +m[5], cmd };
  }).filter(Boolean);
}

function latestSwarmRunDir() {
  const dirs = listDir(path.join(ROOT, '.agent/runs'))
    .filter(d => d.isDirectory() && d.name.includes('-swarm'))
    .map(d => ({ name: d.name, mtime: fs.statSync(path.join(ROOT, '.agent/runs', d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs.length ? path.join(ROOT, '.agent/runs', dirs[0].name) : '';
}

function workers(procs, swarmRunDir) {
  const base = path.join(ROOT, '.agent/worktrees');
  const out = [];
  for (const ent of listDir(base)) {
    if (!ent.isDirectory() || !ent.name.startsWith('swarm-')) continue;
    const wt = path.join(base, ent.name);
    const status = readJson(path.join(wt, '.agent/status.json'), {}) || {};
    const state = readJson(path.join(wt, '.agent/state.json'), {}) || {};
    const hist = Array.isArray(state.history) ? state.history : [];
    const last = hist[hist.length - 1] || {};
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], wt) || '';
    const m = ent.name.match(/-w(\d+)$/);
    const worker = m ? +m[1] : out.length + 1;
    const taskFile = swarmRunDir ? path.join(swarmRunDir, 'tasks', `w${worker}.md`) : '';
    const first = exists(taskFile) ? fs.readFileSync(taskFile, 'utf8').split('\n')[0] : '';
    const quest = first.replace(/^#\s*(?:REQUIRED QUEST POLISH|Swarm lane)\s*[:—-]\s*/, '').trim();
    out.push({
      worker,
      worktree: path.relative(ROOT, wt),
      branch,
      quest,
      phase: status.phase || 'unknown',
      iteration: status.iteration || null,
      lastResult: last.result || null,
      goal: last.goal || '',
      commit: last.commit || null,
      durationMs: last.durationMs || 0,
      runDir: last.runDir || '',
      alive: procs.some(p => p.cmd.includes('--branch ' + branch)),
    });
  }
  return out.sort((a, b) => a.worker - b.worker);
}

function recentRuns(limit = 10) {
  const base = path.join(ROOT, '.agent/runs');
  const dirs = listDir(base)
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, mtime: fs.statSync(path.join(base, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return dirs.map(d => {
    const dir = path.join(base, d.name);
    const gates = readJson(path.join(dir, 'gates.json'), null);
    const verify = readJson(path.join(dir, 'verify.json'), null);
    const summary = readText(path.join(dir, 'summary.md'), 4000);
    let type = 'run';
    if (d.name.includes('-swarm')) type = 'swarm';
    else if (d.name.includes('-iter-')) type = 'iteration';
    else if (d.name.includes('gates')) type = 'gates';
    return {
      name: d.name,
      type,
      mtime: d.mtime,
      gates: gates ? { ok: gates.ok, steps: (gates.steps || []).map(s => ({ name: s.name, ok: s.ok, summary: s.summary })) } : null,
      verify: verify ? { verdict: verify.verdict, summary: verify.summary } : null,
      summary: summary.split('\n').slice(0, 16).join('\n'),
    };
  });
}

function overview() {
  const procs = processes();
  const now = Date.now();
  const loopLock = readJson(path.join(ROOT, '.agent/loop.lock'), null);
  const loopStatus = readJson(path.join(ROOT, '.agent/status.json'), null);
  const loopState = readJson(path.join(ROOT, '.agent/state.json'), null);
  const swarmLock = readJson(path.join(ROOT, '.agent/swarm.lock'), null);
  const swarmStatus = readJson(path.join(ROOT, '.agent/swarm-status.json'), null);
  const swarmState = readJson(path.join(ROOT, '.agent/swarm-state.json'), null);
  const swarmRunDir = latestSwarmRunDir();

  const integrationFile = path.join(ROOT, '.agent/worktrees/integration/.agent/quest-polish.md');
  const mainQuestFile = path.join(ROOT, '.agent/quest-polish.md');
  const quests = parseQuests(exists(integrationFile) ? integrationFile : mainQuestFile);

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = !!git(['status', '--porcelain=v1']);
  const commits = git(['log', '--oneline', '-12']).split('\n').filter(Boolean);
  const ab = git(['rev-list', '--left-right', '--count', 'origin/main...HEAD']).split(/\s+/).map(Number);
  const worktrees = parseWorktrees();
  const integration = worktrees.find(w => w.branch === 'agent/improve') || null;

  const swarmRunning = !!(swarmLock && pidAlive(swarmLock.pid));
  const loopRunning = !!(loopLock && pidAlive(loopLock.pid));
  const activityFile = swarmRunning || exists(path.join(ROOT, '.agent/logs/swarm-console.log'))
    ? path.join(ROOT, '.agent/logs/swarm-console.log')
    : path.join(ROOT, '.agent/logs/loop-console.log');
  const activity = tail(activityFile, 70);

  const mem = { total: os.totalmem(), free: os.freemem() };
  const swarmHistory = Array.isArray(swarmState?.waves) ? swarmState.waves : [];
  const workerRows = workers(procs, swarmRunDir);

  return {
    now,
    agent: { root: ROOT, host: os.hostname(), node: process.version },
    system: {
      load: os.loadavg().map(x => +x.toFixed(2)),
      mem: { total: mem.total, free: mem.free, usedPct: Math.round(((mem.total - mem.free) / mem.total) * 100) },
      cpus: os.cpus().length,
      uptime: Math.round(os.uptime()),
    },
    git: {
      branch, dirty, ahead: ab[1] || 0, behind: ab[0] || 0,
      commits, worktrees, integration,
    },
    loop: {
      running: loopRunning,
      lock: loopLock,
      phase: loopStatus?.phase || null,
      iteration: loopState?.iteration || loopStatus?.iteration || 0,
      totals: loopState?.totals || null,
      lastResult: loopState?.history?.[loopState.history.length - 1] || null,
      history: (loopState?.history || []).slice(-10).reverse(),
    },
    swarm: {
      running: swarmRunning,
      lock: swarmLock,
      phase: swarmStatus?.phase || null,
      wave: swarmStatus?.wave || 0,
      integration: swarmStatus?.integration || null,
      totals: swarmState?.totals || null,
      questMode: !!swarmState?.questMode,
      waves: swarmHistory.slice(-6).reverse(),
      workers: workerRows,
      runDir: swarmRunDir ? path.relative(ROOT, swarmRunDir) : null,
    },
    quests,
    runs: recentRuns(),
    processes: procs,
    activity: {
      source: path.relative(ROOT, activityFile),
      lines: activity,
    },
  };
}

function json(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function file(res, name, type) {
  const p = path.join(HERE, name);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/api/overview') {
    try { json(res, 200, overview()); }
    catch (e) { json(res, 500, { error: String(e.stack || e) }); }
    return;
  }
  if (url === '/health') return json(res, 200, { ok: true, now: Date.now() });
  if (url === '/' || url === '/index.html') return file(res, 'index.html', 'text/html; charset=utf-8');
  if (url === '/style.css') return file(res, 'style.css', 'text/css; charset=utf-8');
  if (url === '/app.js') return file(res, 'app.js', 'text/javascript; charset=utf-8');
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`[dashboard] http://${HOST}:${PORT}/`);
  console.log(`[dashboard] repo: ${ROOT}`);
  console.log('[dashboard] Ctrl-C to stop. The loop/swarm keep running.');
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
