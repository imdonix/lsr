// Shared helpers for the autonomous agent loop (no external dependencies).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const activeChildren = new Set();

/** Kill every child process group spawned through runChild(). Used on Ctrl-C. */
export function killActiveChildren(signal = 'SIGTERM') {
  for (const child of activeChildren) {
    try { process.kill(-child.pid, signal); } catch (e) { try { child.kill(signal); } catch (e2) { } }
  }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m${String(r).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

export function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

export function writeJson(file, value) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export function tail(text, lines = 40) {
  return String(text || '').trimEnd().split('\n').slice(-lines).join('\n');
}

export function whichSync(bin) {
  const r = spawnSync('sh', ['-c', `command -v ${JSON.stringify(bin)}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

export function detectChrome(config = {}) {
  const candidates = [
    config.chromium,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    whichSync('google-chrome'),
    whichSync('google-chrome-stable'),
    whichSync('chromium'),
    whichSync('chromium-browser'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch (e) { /* next */ }
  }
  return '';
}

/**
 * Run a child process with a hard timeout, capturing output while also
 * streaming it to a log file. Kills the whole process group on timeout.
 */
export function runChild(cmd, args, opts = {}) {
  const {
    cwd = ROOT,
    env = process.env,
    timeoutMs = 0,
    logPath = '',
    maxCapture = 6_000_000,
  } = opts;
  return new Promise(resolve => {
    const started = Date.now();
    let out = '';
    let timedOut = false;
    let logStream = null;
    if (logPath) {
      mkdirp(path.dirname(logPath));
      logStream = fs.createWriteStream(logPath, { flags: 'a' });
      logStream.write(`\n\n===== ${new Date().toISOString()} :: ${cmd} ${args.join(' ')} =====\n`);
    }
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      activeChildren.add(child);
    } catch (e) {
      if (logStream) logStream.end(String(e.stack || e));
      return resolve({ ok: false, code: null, signal: null, timedOut: false, output: String(e), durationMs: 0, logPath });
    }
    const add = s => {
      out += s;
      if (out.length > maxCapture) out = out.slice(-Math.floor(maxCapture / 2));
    };
    child.stdout.on('data', d => { const s = d.toString(); add(s); if (logStream) logStream.write(s); });
    child.stderr.on('data', d => { const s = d.toString(); add(s); if (logStream) logStream.write(s); });
    child.on('error', e => add('\n[spawn error] ' + String(e) + '\n'));
    let hardKill = null;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      add(`\n[agent-loop] timeout after ${timeoutMs} ms; killing process group ${child.pid}\n`);
      try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { try { child.kill('SIGTERM'); } catch (e2) { } }
      hardKill = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) { } }
      }, 8000);
      if (hardKill.unref) hardKill.unref();
    }, timeoutMs) : null;
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
      if (timer) clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      const durationMs = Date.now() - started;
      if (logStream) {
        logStream.write(`\n===== exit ${code}${signal ? ' signal ' + signal : ''} in ${durationMs} ms =====\n`);
        logStream.end();
      }
      resolve({ ok: code === 0 && !timedOut, code, signal, timedOut, output: out, durationMs, logPath });
    });
  });
}

async function probeServer(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/index.html`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const text = await res.text();
    return /Los Santos Rising|LOS SANTOS RISING|src\/main\.js/i.test(text);
  } catch (e) { return false; }
}

/**
 * Make sure the game's static server is up. Starts one if needed and returns
 * a stop() that only kills a server this process started.
 */
export async function ensureServer({ port = 8123, root = ROOT, logPath = '' } = {}) {
  if (await probeServer(port)) return { started: false, port, stop: async () => { } };
  if (logPath) mkdirp(path.dirname(logPath));
  const fd = logPath ? fs.openSync(logPath, 'a') : 'ignore';
  const child = spawn(process.execPath, ['server.js', String(port)], {
    cwd: root,
    detached: true,
    stdio: ['ignore', fd === 'ignore' ? 'ignore' : fd, fd === 'ignore' ? 'ignore' : fd],
  });
  child.unref();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await sleep(250);
    if (await probeServer(port)) {
      return {
        started: true,
        port,
        pid: child.pid,
        stop: async () => {
          try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { try { child.kill('SIGTERM'); } catch (e2) { } }
          await sleep(300);
          try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
        },
      };
    }
    if (child.exitCode !== null) break;
  }
  throw new Error(`static server on port ${port} did not come up` + (logPath ? ` (see ${logPath})` : ''));
}

export function git(args, { cwd = ROOT, allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
}

export function gitStatus(cwd = ROOT) {
  return git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd, allowFail: true }).out;
}

/** Extract the last line beginning with `prefix` and parse its JSON payload. */
export function lastJsonLine(output, prefix) {
  const lines = String(output || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (prefix && !line.startsWith(prefix)) continue;
    const raw = prefix ? line.slice(prefix.length).trim() : line;
    try { return JSON.parse(raw); } catch (e) { /* keep looking */ }
  }
  return null;
}

/** Extract the first fenced/JSON object from arbitrary text (best effort). */
export function firstJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}
