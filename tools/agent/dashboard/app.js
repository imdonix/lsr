let data = null;
let paused = false;
let filter = 'all';
let lastUpdate = 0;

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, n = 90) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function fmtDur(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'm' + String(r).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm';
}
function fmtAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ago';
}
function fmtClock(ms) {
  try { return new Date(ms).toLocaleTimeString(); } catch (e) { return ''; }
}
function tag(text, kind = '') { return '<span class="tag ' + kind + '">' + esc(text) + '</span>'; }

function setLive(kind, text) {
  const el = $('live');
  el.className = 'pill ' + kind;
  el.innerHTML = '<i></i> ' + esc(text);
}

function renderCards(d) {
  const q = d.quests;
  const sw = d.swarm;
  const lp = d.loop;
  const g = d.git;
  const alive = (sw.workers || []).filter(w => w.alive).length;
  const swarmClass = sw.running ? 'good' : 'warn';
  const loopClass = lp.running ? 'good' : '';
  const repoClass = g.dirty ? 'bad' : 'good';
  const questClass = q.percent >= 100 ? 'good' : q.done ? 'good' : '';
  const cards = [
    '<div class="card ' + swarmClass + '">' +
      '<div class="row"><span class="label">Swarm</span>' + (sw.running ? tag('live', 'ok') : tag('idle', '')) + '</div>' +
      '<div class="big">' + (sw.running ? 'Wave ' + (sw.wave || 1) : 'Idle') + '</div>' +
      '<div class="sub">' + (sw.running ? (sw.workers || []).length + ' workers · ' + alive + ' alive · ' + (sw.totals?.merged || 0) + ' merged' : 'no swarm process') + '</div>' +
      '<div class="mini"><span><b>' + (sw.totals?.questsMarked || 0) + '</b> quests marked</span><span><b>' + (sw.totals?.conflicts || 0) + '</b> conflicts</span></div>' +
    '</div>',
    '<div class="card ' + questClass + '">' +
      '<div class="row"><span class="label">Quest program</span>' + tag(q.percent + '%', 'quest') + '</div>' +
      '<div class="big">' + q.done + ' / ' + q.total + '</div>' +
      '<div class="progress"><i style="width:' + q.percent + '%"></i></div>' +
      '<div class="sub">' + (q.next ? 'next: <b class="gold">' + esc(q.next.id) + '</b> ' + esc(q.next.title) : 'complete') + '</div>' +
    '</div>',
    '<div class="card ' + loopClass + '">' +
      '<div class="row"><span class="label">Single loop</span>' + (lp.running ? tag('live', 'ok') : tag('stopped', '')) + '</div>' +
      '<div class="big">' + (lp.running ? 'Iter ' + lp.iteration : 'Stopped') + '</div>' +
      '<div class="sub">' + (lp.totals ? (lp.totals.committed || 0) + ' committed · ' + (lp.totals.failed || 0) + ' failed' : 'no state') + '</div>' +
      '<div class="mini"><span>last: <b>' + (lp.lastResult ? esc(lp.lastResult.result || '?') : '—') + '</b></span><span>' + (lp.phase ? esc(lp.phase) : '') + '</span></div>' +
    '</div>',
    '<div class="card ' + repoClass + '">' +
      '<div class="row"><span class="label">Repository</span>' + (g.dirty ? tag('dirty', 'bad') : tag('clean', 'ok')) + '</div>' +
      '<div class="big">' + esc(g.branch || '?') + '</div>' +
      '<div class="sub">' + (g.integration ? 'integration: ' + esc(g.integration.branch) : 'no integration worktree') + '</div>' +
      '<div class="mini"><span><b>+' + (g.ahead || 0) + '</b> ahead</span><span><b>-' + (g.behind || 0) + '</b> behind</span><span><b>' + (g.worktrees || []).length + '</b> worktrees</span></div>' +
    '</div>',
  ];
  $('cards').innerHTML = cards.join('');
}

function renderWorkers(d) {
  const list = d.swarm.workers || [];
  $('worker-count').textContent = list.length ? list.length + ' worktree' + (list.length === 1 ? '' : 's') : '';
  if (!list.length) {
    $('workers').innerHTML = '<div class="empty">' + (d.swarm.running ? 'Workers are starting or the integrator is running the merge queue.' : 'No active worker worktrees.') + '</div>';
    return;
  }
  $('workers').innerHTML = '<div class="worker-grid">' + list.map(w =>
    '<div class="worker">' +
      '<div class="topline"><span><span class="dot ' + (w.alive ? 'live' : 'dead') + '"></span><b>W' + w.worker + '</b></span>' + tag(w.phase, w.phase === 'director' ? 'info' : '') + '</div>' +
      '<div class="quest">' + (w.quest ? esc(w.quest) : '<span class="muted">preparing…</span>') + '</div>' +
      '<div class="meta">iter ' + (w.iteration || '—') + ' · ' + esc(short(w.branch, 42)) + '</div>' +
      '<div class="meta">' + (w.lastResult ? esc(w.lastResult) + (w.commit ? ' · ' + esc(w.commit) : '') : 'waiting for result') + '</div>' +
      (w.goal ? '<div class="meta" title="' + esc(w.goal) + '">' + esc(short(w.goal, 78)) + '</div>' : '') +
    '</div>'
  ).join('') + '</div>';
}

function renderRecent(d) {
  const parts = [];
  const hist = d.loop.history || [];
  if (hist.length) {
    parts.push('<h3 class="small muted" style="margin:2px 0 8px">Loop iterations</h3>');
    parts.push('<table class="recent"><thead><tr><th class="num">#</th><th>Result</th><th>Goal</th><th>Commit</th><th class="num">Time</th></tr></thead><tbody>');
    for (const h of hist.slice(0, 8)) {
      const kind = h.result === 'committed' || h.result === 'verified' ? 'ok' : h.result === 'failed' ? 'bad' : '';
      parts.push('<tr><td class="num">' + h.iteration + '</td><td>' + tag(h.result || '?', kind) + '</td><td class="goal"><span class="ellipsis" title="' + esc(h.goal || '') + '">' + esc(short(h.goal || '', 76)) + '</span></td><td class="mono small">' + esc(h.commit || '—') + '</td><td class="num muted">' + fmtDur(h.durationMs) + '</td></tr>');
    }
    parts.push('</tbody></table>');
  }
  const waves = d.swarm.waves || [];
  if (waves.length) {
    parts.push('<h3 class="small muted" style="margin:14px 0 8px">Swarm waves</h3>');
    for (const w of waves) {
      const ok = (w.integrations || []).filter(r => r.result === 'merged').length;
      const bad = (w.integrations || []).filter(r => r.result !== 'merged').length;
      const lines = [];
      for (const x of w.workers || []) lines.push('w' + x.worker + ' ' + (x.quest || x.task || '') + ': ' + x.outcome + (x.commit ? ' ' + x.commit : ''));
      for (const x of w.integrations || []) lines.push('merge ' + (x.quest || x.task || '') + ': ' + x.result + (x.mergeCommit ? ' ' + x.mergeCommit : '') + (x.questMarked ? ' · quest marked' : ''));
      parts.push('<details class="run"><summary><span class="rname">Wave ' + w.wave + '</span><span class="muted small">' + fmtDur(w.durationMs) + '</span>' + (w.complete ? tag('complete', 'ok') : '') + '<span class="spacer" style="flex:1"></span>' + tag(ok + ' merged', ok ? 'ok' : '') + (bad ? tag(bad + ' failed', 'bad') : '') + '</summary><pre>' + esc(lines.join('\n') || 'no details') + '</pre></details>');
    }
  }
  $('recent').innerHTML = parts.length ? parts.join('') : '<div class="empty">No completed work yet.</div>';
}

function renderQuests(d) {
  const q = d.quests;
  $('questpct').textContent = q.percent + '%';
  const next = q.next ? '<span class="muted">next</span> <b class="gold">' + esc(q.next.id) + '</b> <span class="muted">' + esc(q.next.title) + '</span>' : '<span class="green">program complete</span>';
  $('questmeta').innerHTML = '<div style="flex:1"><div class="muted small">' + q.done + ' done · ' + (q.total - q.done) + ' open</div><div class="progress"><i style="width:' + q.percent + '%"></i></div><div class="small">' + next + '</div></div>';
  for (const b of document.querySelectorAll('#filters .chip')) b.classList.toggle('active', b.dataset.filter === filter);
  const items = (q.items || []).filter(x => filter === 'all' ? true : filter === 'done' ? x.state === 'done' : x.state !== 'done');
  $('quests').innerHTML = items.length ? items.map(x =>
    '<div class="quest ' + (x.state === 'done' ? 'done' : x.state === 'blocked' ? 'blocked' : '') + '">' +
      '<span class="mark">' + (x.state === 'done' ? '✓' : x.state === 'blocked' ? '!' : '·') + '</span>' +
      '<span><span class="id">' + esc(x.id) + '</span> <span class="title" title="' + esc(x.title) + '">' + esc(x.title) + '</span></span>' +
      '<span class="src">' + esc((x.source || '').replace(/^src\//, '')) + '</span>' +
    '</div>'
  ).join('') : '<div class="empty">Nothing in this filter.</div>';
}

function renderProcesses(d) {
  const ps = d.processes || [];
  $('proccount').textContent = ps.length + ' running';
  if (!ps.length) { $('processes').innerHTML = '<div class="empty">No loop, worker or opencode processes.</div>'; return; }
  $('processes').innerHTML = '<table><thead><tr><th class="num">PID</th><th class="num">Time</th><th class="num">CPU</th><th class="num">MEM</th><th>Command</th></tr></thead><tbody>' +
    ps.map(p => '<tr><td class="num mono">' + p.pid + '</td><td class="num">' + esc(p.etime) + '</td><td class="num">' + p.cpu.toFixed(1) + '%</td><td class="num">' + p.mem.toFixed(1) + '%</td><td class="mono small"><span class="ellipsis" title="' + esc(p.cmd) + '">' + esc(short(p.cmd, 70)) + '</span></td></tr>').join('') +
    '</tbody></table>';
}

function renderRuns(d) {
  const runs = d.runs || [];
  if (!runs.length) { $('runs').innerHTML = '<div class="empty">No run artifacts yet.</div>'; return; }
  $('runs').innerHTML = runs.map(r => {
    const g = r.gates ? (r.gates.ok ? tag('gates pass', 'ok') : tag('gates fail', 'bad')) : tag('no gates', '');
    const v = r.verify ? (r.verify.verdict === 'PASS' ? tag('verify PASS', 'ok') : tag('verify ' + r.verify.verdict, 'bad')) : '';
    const steps = r.gates ? (r.gates.steps || []).map(s => (s.ok ? '✓ ' : '✗ ') + s.name + ': ' + s.summary).join('\n') : '';
    const body = [r.summary, steps, r.verify ? 'verifier: ' + r.verify.verdict + (r.verify.summary ? ' — ' + r.verify.summary : '') : ''].filter(Boolean).join('\n\n');
    return '<details class="run"><summary><span class="rname">' + esc(short(r.name, 38)) + '</span><span class="muted small">' + fmtAgo(r.mtime) + '</span><span style="flex:1"></span>' + tag(r.type, 'info') + g + v + '</summary><pre>' + esc(body || 'no summary') + '</pre></details>';
  }).join('');
}

function renderActivity(d) {
  const a = d.activity || { lines: [] };
  $('logsource').textContent = a.source || '';
  const pre = $('activity');
  pre.textContent = (a.lines && a.lines.length) ? a.lines.join('\n') : 'waiting for activity…';
  pre.scrollTop = pre.scrollHeight;
}

function render(d) {
  data = d;
  $('footerhost').textContent = d.agent.host + ' · ' + d.agent.root;
  $('updated').textContent = 'updated ' + fmtClock(d.now);
  if (d.swarm.running) {
    const alive = (d.swarm.workers || []).filter(w => w.alive).length;
    setLive('pill-live', 'SWARM LIVE');
    $('subtitle').textContent = 'wave ' + (d.swarm.wave || 1) + ' · ' + (d.swarm.workers || []).length + ' workers · ' + alive + ' alive · ' + d.quests.done + '/' + d.quests.total + ' quests';
  } else if (d.loop.running) {
    setLive('pill-live', 'LOOP LIVE');
    $('subtitle').textContent = 'iteration ' + d.loop.iteration + ' · ' + (d.loop.phase || 'working') + ' · ' + d.quests.done + '/' + d.quests.total + ' quests';
  } else {
    setLive('pill-idle', 'IDLE');
    $('subtitle').textContent = 'no loop or swarm running · ' + d.quests.done + '/' + d.quests.total + ' quests';
  }
  renderCards(d);
  renderWorkers(d);
  renderRecent(d);
  renderQuests(d);
  renderProcesses(d);
  renderRuns(d);
  renderActivity(d);
}

async function refresh() {
  if (paused) return;
  try {
    const r = await fetch('/api/overview', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    lastUpdate = Date.now();
    render(d);
  } catch (e) {
    setLive('pill-bad', 'DISCONNECTED');
    $('subtitle').textContent = 'dashboard cannot reach the API: ' + e.message;
  }
}

$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  if (!paused) refresh();
});

for (const b of document.querySelectorAll('#filters .chip')) {
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    if (data) renderQuests(data);
  });
}

refresh();
setInterval(refresh, 3000);
setInterval(() => {
  if (!paused && lastUpdate) {
    const s = Math.max(0, 3 - Math.floor((Date.now() - lastUpdate) / 1000));
    $('updated').textContent = 'updated ' + fmtClock(lastUpdate) + ' · next in ' + s + 's';
  }
}, 1000);
