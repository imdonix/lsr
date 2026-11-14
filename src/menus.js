// Menus: title screen, pause menu, settings, controls, stats, map, shops.
import { G } from './state.js';
import { clamp, fmtMoney, pad2 } from './util.js';
import { MPP, HALF, MAP_N } from './mapdata.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
function panel(id, html, cls = '') { let p = $(id); if (!p) { p = document.createElement('div'); p.id = id; document.body.appendChild(p); } p.className = 'panel ' + cls; p.innerHTML = html; return p; }

export class Menus {
  constructor() {
    this.open = null; this.stack = [];
    this.buildTitle(); this.buildPause();
    window.addEventListener('keydown', e => {
      if (!G.game || !G.game.running) return;
      if (e.code === 'Escape') { e.preventDefault(); if (this.open === 'map' || this.open === 'stats' || this.open === 'controls' || this.open === 'settings' || this.open === 'shop' || this.open === 'replay') this.back(); else if (G.paused && this.open === 'pause') G.game.pause(false); else if (!G.paused && !G.game.inCutscene) G.game.pause(true); }
      else if (e.code === 'KeyM' && !G.game.inCutscene && G.game.state === 'play') { if (this.open === 'map') this.back(); else if (!G.paused) { G.game.pause(true, true); this.show('map'); } else if (this.open === 'pause') this.show('map'); }
      else if (e.code === 'KeyP' && !this.open && !G.game.inCutscene) G.game.pause(true);
      // Secret mission list: "F?" (Shift+/) while playing, or the pause-menu button.
      else if ((e.key === '?' || (e.code === 'Slash' && e.shiftKey)) && !G.game.inCutscene && G.game.state === 'play') {
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        e.preventDefault();
        if (this.open === 'secret') this.back();
        else if (!G.paused) { G.game.pause(true, true); this.show('secret'); }
        else this.show('secret');
      }
    });
  }
  hideAll() { for (const id of ['title', 'pausePanel', 'settingsPanel', 'controlsPanel', 'statsPanel', 'mapPanel', 'shopPanel', 'replayPanel', 'secretPanel']) { const p = $(id); if (p) p.classList.remove('show'); } this.open = null; }
  show(name, arg) {
    const prev = this.open;
    this.hideAll();
    this.open = name;
    if (name === 'pause') $('pausePanel').classList.add('show');
    else if (name === 'title') { $('title').classList.add('show'); this.refreshTitle(); }
    else if (name === 'settings') { this.buildSettings(); $('settingsPanel').classList.add('show'); }
    else if (name === 'controls') { this.buildControls(); $('controlsPanel').classList.add('show'); }
    else if (name === 'stats') { this.buildStats(); $('statsPanel').classList.add('show'); }
    else if (name === 'map') { this.buildMap(); $('mapPanel').classList.add('show'); }
    else if (name === 'shop') { this.buildShop(arg); $('shopPanel').classList.add('show'); }
    else if (name === 'replay') { this.buildReplay(); $('replayPanel').classList.add('show'); }
    else if (name === 'secret') { this.buildSecret(); $('secretPanel').classList.add('show'); }
    if (prev && prev !== name) this.stack.push(prev);
    G.input.unlock();
  }
  back() {
    const prev = this.stack.pop();
    if (this.open === 'shop') { this.hideAll(); this.stack.length = 0; G.game.pause(false); return; }
    if (this.open === 'map' && (!prev || prev === 'pause') && !G.paused) { this.hideAll(); return; }
    if (prev === 'title' || this.stack.length === 0 && G.game.state === 'title') { this.show('title'); this.stack.length = 0; return; }
    if (prev === 'pause' || !prev) { if (G.game.state === 'title') { this.show('title'); this.stack.length = 0; } else { this.stack.length = 0; this.show('pause'); this.stack.length = 0; } return; }
    this.show(prev); this.stack.pop();
  }

  // ---------------------------------------------------------------- title
  buildTitle() {
    const p = panel('title', `<h1>LOS SANTOS<br>RISING</h1><div class="sub">BLOOD &amp; CONCRETE</div><div class="menu" id="titleMenu"></div><div class="foot">A browser open-world crime story · WASD move · Mouse look · F enter/exit · Esc pause <span class="ver">build ${VERSION}</span></div>`, '');
    p.style.display = '';
  }
  refreshTitle() {
    const m = $('titleMenu'); m.innerHTML = '';
    const has = G.game.hasSave();
    const add = (t, fn, cls = '') => { const b = document.createElement('div'); b.className = 'btn ' + cls; b.textContent = t; b.onclick = () => { G.audio && G.audio.play('menu_click'); fn(); }; b.onmouseenter = () => G.audio && G.audio.play('menu_move', { volume: 0.4 }); m.appendChild(b); };
    if (has) add('Continue', () => G.game.startGame(true));
    add('New Game', () => { if (has && !confirm('Start a new game? Your saved progress will be overwritten when you next save.')) return; G.game.startGame(false); });
    add('Controls', () => this.show('controls'));
    add('Settings', () => this.show('settings'));
  }

  // ---------------------------------------------------------------- pause
  buildPause() {
    const p = panel('pausePanel', `<h1>PAUSED</h1><div class="menu" id="pauseMenu"></div><div class="pver">build ${VERSION}</div>`);
    const m = $('pauseMenu');
    const add = (t, fn) => { const b = document.createElement('div'); b.className = 'btn'; b.textContent = t; b.onclick = () => { G.audio && G.audio.play('menu_click'); fn(); }; m.appendChild(b); };
    add('Resume', () => G.game.pause(false)); add('Map', () => this.show('map')); add('Stats', () => this.show('stats')); add('Replay a mission', () => this.show('replay')); add('F? Secret missions', () => this.show('secret')); add('Controls', () => this.show('controls')); add('Settings', () => this.show('settings'));
    add('Save Game', () => { if (G.game.canSave()) { G.game.save(); G.hud.toast('Game saved'); } else G.hud.toast('You can only save at a safehouse or between missions'); });
    add('Quit to Title', () => { G.game.quitToTitle(); });
  }

  buildSettings() {
    const s = G.settings;
    const row = (label, key, min, max, step) => `<div class="row"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-k="${key}"><span id="v_${key}">${s[key]}</span></div>`;
    const chk = (label, key) => `<div class="row"><label>${label}</label><input type="checkbox" ${s[key] ? 'checked' : ''} data-c="${key}"></div>`;
    const p = panel('settingsPanel', `<div class="box"><h1 style="font-size:40px">SETTINGS</h1>
      ${row('Master volume', 'volume', 0, 1, 0.05)}${row('Music / radio volume', 'music', 0, 1, 0.05)}${row('Effects volume', 'sfx', 0, 1, 0.05)}
      ${row('Mouse sensitivity', 'sens', 0.3, 2.5, 0.05)}${row('Field of view', 'fov', 55, 100, 1)}${row('View distance (chunks)', 'viewDist', 2, 6, 1)}
      <div class="row"><label>Graphics quality</label><select data-q="quality" style="font-size:16px;padding:3px 8px">${['low', 'medium', 'high', 'ultra'].map(q => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}</select></div>
      ${chk('Shadows', 'shadows')}${chk('Invert mouse Y', 'invertY')}${chk('Aim assist (lock-on)', 'lockOn')}
      <div style="margin-top:14px"><div class="btn" id="setBack">Back</div></div></div>`);
    p.querySelectorAll('input[type=range]').forEach(i => i.oninput = () => { const k = i.dataset.k; G.settings[k] = +i.value; $('v_' + k).textContent = i.value; G.game.applySettings(); });
    p.querySelectorAll('input[type=checkbox]').forEach(i => i.onchange = () => { G.settings[i.dataset.c] = i.checked; G.game.applySettings(); });
    p.querySelectorAll('select[data-q]').forEach(i => i.onchange = () => { G.settings.quality = i.value; G.game.applySettings(); this.buildSettings(); $('settingsPanel').classList.add('show'); });
    $('setBack').onclick = () => this.back();
  }
  buildControls() {
    const k = (a) => `<span class="key">${a}</span>`;
    const p = panel('controlsPanel', `<div class="box"><h1 style="font-size:40px">CONTROLS</h1><div style="display:flex;gap:40px;flex-wrap:wrap">
      <div><h2>On foot</h2><table class="tbl">
      <tr><td>${k('W')}${k('A')}${k('S')}${k('D')}</td><td>Move</td></tr><tr><td>${k('Mouse')}</td><td>Look / aim</td></tr><tr><td>${k('Shift')}</td><td>Sprint (stamina)</td></tr>
      <tr><td>${k('Space')}</td><td>Jump</td></tr><tr><td>${k('C')}</td><td>Crouch</td></tr><tr><td>${k('LMB')}</td><td>Fire / punch / swing</td></tr><tr><td>${k('RMB')}</td><td>Aim (hold)</td></tr>
      <tr><td>${k('R')}</td><td>Reload</td></tr><tr><td>${k('Q')}${k('E')} / wheel</td><td>Previous / next weapon (press E near an icon to interact)</td></tr><tr><td>${k('1')}-${k('9')}</td><td>Weapon slot</td></tr><tr><td>${k('E')}</td><td>Interact: talk to weapon dealers, use the save icon</td></tr><tr><td>${k('F')}</td><td>Enter / exit vehicle, jack cars</td></tr></table></div>
      <div><h2>In a vehicle</h2><table class="tbl"><tr><td>${k('W')} / ${k('S')}</td><td>Accelerate / brake &amp; reverse</td></tr><tr><td>${k('A')} ${k('D')}</td><td>Steer</td></tr><tr><td>${k('Space')}</td><td>Handbrake</td></tr>
      <tr><td>${k('H')}</td><td>Horn</td></tr><tr><td>${k('R')} ${k('T')}</td><td>Next / previous radio station</td></tr><tr><td>${k('X')}</td><td>Radio off</td></tr><tr><td>${k('C')}</td><td>Look behind (hold)</td></tr>
      <tr><td>${k('N')}</td><td>Siren / start vigilante, taxi duty</td></tr><tr><td>${k('RMB')} ${k('LMB')}</td><td>Drive-by with pistols / SMG</td></tr><tr><td>${k('F')}</td><td>Exit</td></tr></table></div>
      <div><h2>General</h2><table class="tbl"><tr><td>${k('M')}</td><td>Map (click to set waypoint)</td></tr><tr><td>${k('Esc')}</td><td>Pause</td></tr><tr><td>${k('Enter')}</td><td>Skip cutscene</td></tr><tr><td>${k('F2')} ${k('F3')}</td><td>Hide HUD / show FPS</td></tr><tr><td>${k('F5')}</td><td>Quick save</td></tr><tr><td>type</td><td>Cheats (see pause &gt; hint: CHEATMODE)</td></tr></table>
      <p style="max-width:300px;font-size:14px;color:#aaa">Gamepad: left stick move, right stick look, RT fire, LT aim, A jump/handbrake, X enter/exit.</p></div></div>
      <div style="margin-top:14px"><div class="btn" id="ctrlBack">Back</div></div></div>`);
    $('ctrlBack').onclick = () => this.back();
  }
  buildStats() {
    const s = G.player.stats; const t = Math.floor(s.playTime);
    const M = G.missions; const done = M ? M.completedCount() : 0, tot = M ? M.storyTotal() : 0;
    const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    const p = panel('statsPanel', `<div class="box"><h1 style="font-size:40px">STATS</h1><table class="tbl">
      ${row('Story missions', done + ' / ' + tot)}${row('Play time', Math.floor(t / 3600) + 'h ' + pad2(Math.floor(t / 60) % 60) + 'm')}${row('Money earned', fmtMoney(s.moneyEarned))}
      ${row('People killed', s.kills)}${row('Police officers killed', s.copKills)}${row('Headshots', s.headshots)}${row('Vehicles stolen', s.carsStolen)}${row('Distance travelled', (s.distance / 1000).toFixed(2) + ' km')}
      ${row('Times wasted', s.deaths)}${row('Times busted', s.busted)}${row('Respect', G.player.respect)}${row('Territories owned', G.game.territories ? G.game.territories.size : 0)}${row('Tags sprayed', (G.tags ? G.tags.count() : 0) + ' / ' + (G.tags ? G.tags.total() : 0))}${row('Side quests', (M && M.sideDoneCount ? M.sideDoneCount() : 0) + ' / ' + (M && M.sideTotal ? M.sideTotal() : 0))}${row('Side activities done', G.activities ? G.activities.doneCount() : 0)}
      </table><div style="margin-top:14px"><div class="btn" id="stBack">Back</div></div></div>`);
    $('stBack').onclick = () => this.back();
  }

  buildReplay() {
    const M = G.missions; const defs = M ? M.defs.filter(d => M.done.has(d.id)) : [];
    const rows = defs.length ? defs.map((d, i) => `<div class="btn" data-m="${d.id}" style="text-align:left;margin-bottom:6px">${d.side ? 'Side quest: ' : String(i + 1).padStart(2, '0') + '. '}${d.title}</div>`).join('') : '<div style="color:#aaa">Complete story missions to replay them here.</div>';
    const p = panel('replayPanel', `<div class="box" style="min-width:420px"><h1 style="font-size:38px">REPLAY A MISSION</h1><div style="font-size:14px;color:#aaa;margin-bottom:10px">Replays pay 40% and do not change your story progress.</div>${rows}<div style="margin-top:14px"><div class="btn" id="rpBack">Back</div></div></div>`);
    p.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const def = M.defs.find(d => d.id === b.dataset.m); G.game.pause(false); M.replay(def); });
    $('rpBack').onclick = () => this.back();
  }

  // ---------------------------------------------------------------- secret mission list
  buildSecret() {
    const M = G.missions;
    const p = panel('secretPanel', `<div class="box" style="width:min(780px,92vw);max-height:86vh;display:flex;flex-direction:column">
      <h1 style="font-size:34px;margin-bottom:2px">SECRET MISSIONS</h1>
      <div style="font-size:13px;color:#aaa;margin-bottom:10px">Start any story mission or side quest at any point. Locked missions are unlocked here. Finished missions replay at 40% pay.</div>
      <input id="secretSearch" placeholder="Filter by id, title or giver…" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:9px 11px;border-radius:8px;border:1px solid #555;background:#141414;color:#eee;font:inherit">
      <div id="secretList" style="overflow:auto;flex:1;min-height:180px;max-height:58vh;padding-right:4px"></div>
      <div style="margin-top:12px;display:flex;gap:8px"><div class="btn" id="secretBack">Back</div><div class="btn" id="secretClose" style="margin-left:auto">Resume game</div></div>
    </div>`);
    const list = $('secretList'), search = $('secretSearch');
    const render = () => {
      if (!M || !M.defs || !M.defs.length) { list.innerHTML = '<div style="color:#aaa">Mission list is still loading…</div>'; return; }
      const q = (search.value || '').toLowerCase().trim();
      const defs = M.defs.filter(d => !q || d.id.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) || String(d.giverName || d.giver || '').toLowerCase().includes(q));
      list.innerHTML = defs.length ? defs.map(d => {
        const done = M.done.has(d.id);
        const kind = d.side ? (d.chapter ? 'C' + d.chapter + ' SIDE' : 'SIDE') : 'STORY';
        const g = d.giverName || d.giver || '';
        return `<div class="btn" data-secret="${d.id}" style="text-align:left;margin-bottom:4px;display:flex;justify-content:space-between;gap:12px;align-items:center">
          <span><b style="color:#f7c948">${d.id}</b> ${d.title}</span>
          <span style="font-size:11px;color:${done ? '#6f6' : '#999'};white-space:nowrap">${kind}${g ? ' · ' + g : ''}${done ? ' · DONE' : ''}</span>
        </div>`;
      }).join('') : '<div style="color:#aaa">No matching missions.</div>';
      list.querySelectorAll('[data-secret]').forEach(b => b.onclick = () => this.startSecret(M.defs.find(d => d.id === b.dataset.secret)));
    };
    search.oninput = render;
    $('secretBack').onclick = () => this.back();
    $('secretClose').onclick = () => G.game.pause(false);
    render();
    setTimeout(() => { if (search) search.focus(); }, 50);
  }

  startSecret(def) {
    const M = G.missions, pl = G.player;
    if (!M || !def) return;
    G.audio && G.audio.play('menu_click');
    if (M.active) M.abortAll();
    G.game.pause(false);
    this.hideAll(); this.stack.length = 0;
    G.police.clear();
    pl.health = pl.maxHealth; pl.dead = false; pl.controlEnabled = true;
    G.game.state = 'play'; G.game.timeScale = 1; G.game.inCutscene = false;
    G.camera.endCine && G.camera.endCine();
    G.hud.setCinematic && G.hud.setCinematic(false);
    G.hud.clearSubs && G.hud.clearSubs();
    if (pl.vehicle) pl.exitVehicle(true);
    M.clearRetry && M.clearRetry();
    const w = def.where ? (() => { try { return def.where(); } catch (e) { return null; } })() : null;
    if (w) G.game.teleport(w.x + 2.5, w.z + 2.5, 0);
    M.clearStarts && M.clearStarts();
    G.input.lock && G.input.lock();
    const replay = M.done.has(def.id);
    M.start(def, { where: w, replay }).catch(e => console.error('secret mission start failed', def.id, e));
    G.hud.notify((replay ? 'Replaying ' : 'Started ') + def.title);
  }

  // ---------------------------------------------------------------- map
  buildMap() {
    const sz = Math.floor(Math.min(innerHeight * 0.82, innerWidth * 0.62, 900));
    const p = panel('mapPanel', `<div class="box" style="display:flex;gap:14px"><div><canvas id="bigmap" width="${sz}" height="${sz}"></canvas><div style="font-size:12px;color:#888;margin-top:4px">Click: set waypoint · Right-click: clear · M / Esc: close</div></div>
      <div id="mapSide" style="min-width:210px;font-size:14px"><h2>LOS SANTOS</h2><div id="mapInfo"></div><div id="mapLegend" style="flex-direction:column;gap:5px"></div></div></div>`);
    this.mapSize = sz; const c = $('bigmap'); this.mapCtx = c.getContext('2d');
    this.mapView = { cx: 0, cz: 0, zoom: 1 };
    const px = G.player.vehicle ? G.player.vehicle.x : G.player.x, pz = G.player.vehicle ? G.player.vehicle.z : G.player.z; this.mapView.cx = 0; this.mapView.cz = 0; this.mapView.zoom = 1.0;
    c.onwheel = (e) => { e.preventDefault(); const z0 = this.mapView.zoom; this.mapView.zoom = clamp(z0 * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 1, 5); if (this.mapView.zoom === 1) { this.mapView.cx = 0; this.mapView.cz = 0; } else if (z0 === 1) { const pl = G.player; this.mapView.cx = pl.vehicle ? pl.vehicle.x : pl.x; this.mapView.cz = pl.vehicle ? pl.vehicle.z : pl.z; } this.drawMap(); };
    c.onmousedown = (e) => {
      const r = c.getBoundingClientRect(); const x = (e.clientX - r.left) * (c.width / r.width), y = (e.clientY - r.top) * (c.height / r.height);
      const w = this.mapToWorld(x, y);
      if (e.button === 0) { G.waypoint = { x: w.x, z: w.z }; G.audio.play('menu_click'); } else if (e.button === 2) G.waypoint = null;
      if (e.button === 1 || e.shiftKey) { this.drag = { x: e.clientX, y: e.clientY, cx: this.mapView.cx, cz: this.mapView.cz }; }
      this.drawMap();
    };
    c.oncontextmenu = e => { e.preventDefault(); };
    window.onmousemove = (e) => { if (this.drag && this.open === 'map') { const v = this.mapView; const span = 2048 / v.zoom; v.cx = this.drag.cx - (e.clientX - this.drag.x) * (span / this.mapSize); v.cz = this.drag.cz - (e.clientY - this.drag.y) * (span / this.mapSize); this.drawMap(); } };
    window.onmouseup = () => { this.drag = null; };
    this.drawMap();
  }
  mapToWorld(x, y) { const v = this.mapView; const span = 2048 / v.zoom; return { x: v.cx + (x / this.mapSize - 0.5) * span, z: v.cz + (y / this.mapSize - 0.5) * span }; }
  worldToMap(wx, wz) { const v = this.mapView; const span = 2048 / v.zoom; return { x: ((wx - v.cx) / span + 0.5) * this.mapSize, y: ((wz - v.cz) / span + 0.5) * this.mapSize }; }
  drawMap() {
    const c = this.mapCtx, S = this.mapSize, v = this.mapView, H = G.hud; if (!c || !H.mapCanvas) return;
    c.fillStyle = '#10161f'; c.fillRect(0, 0, S, S);
    const span = 2048 / v.zoom; const k = H.mapCanvas.width / 2048; // canvas px per metre
    // visible source rect in map canvas px
    const sx = (v.cx - span / 2 + 1024) * k, sy = (v.cz - span / 2 + 1024) * k, sw = span * k;
    c.imageSmoothingEnabled = true; c.drawImage(H.mapCanvas, sx, sy, sw, sw, 0, 0, S, S);
    { const ov = H.getGangOverlay(); const ko = ov.width / 2048; c.globalAlpha = 0.33; c.drawImage(ov, sx * ko / k, sy * ko / k, sw * ko / k, sw * ko / k, 0, 0, S, S); c.globalAlpha = 1; }
    // gang territory tint
    // districts
    c.font = `bold ${Math.max(10, 11 + v.zoom)}px Arial`; c.textAlign = 'center'; c.fillStyle = 'rgba(20,20,20,0.75)';
    for (const d of H.districts) { const p = this.worldToMap(d.x, d.z); if (p.x < 0 || p.y < 0 || p.x > S || p.y > S) continue; c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 3; c.strokeText(d.name.toUpperCase(), p.x, p.y); c.fillText(d.name.toUpperCase(), p.x, p.y); }
    // blips
    const legend = new Map();
    for (const b of G.blips.list) {
      if (b.hidden) continue; const p = this.worldToMap(b.x, b.z); if (p.x < 0 || p.y < 0 || p.x > S || p.y > S) continue;
      c.save(); c.translate(p.x, p.y);
      c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, 9, 0, 6.3); c.fill(); c.fillStyle = b.color || '#fff'; c.beginPath(); c.arc(0, 0, 7, 0, 6.3); c.fill();
      if (b.text) { c.fillStyle = '#000'; c.font = 'bold 11px Arial'; c.textBaseline = 'middle'; c.fillText(b.text, 0, 1); }
      c.restore();
      if (b.label && !legend.has(b.label)) legend.set(b.label, b);
    }
    if (G.waypoint) { const p = this.worldToMap(G.waypoint.x, G.waypoint.z); c.fillStyle = '#ff4fa0'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - 9, p.y - 22); c.lineTo(p.x + 9, p.y - 22); c.closePath(); c.fill(); c.stroke(); }
    // next-mission highlight (pulses even while paused, so use wall time)
    for (const b of G.blips.list) {
      if (b.hidden || !b.nextQuest) continue;
      const p = this.worldToMap(b.x, b.z); if (p.x < -20 || p.y < -20 || p.x > S + 20 || p.y > S + 20) continue;
      const t = performance.now() / 1000, ph = Math.sin(t * 5), pr = 14 + ph * 2.5;
      c.save(); c.translate(p.x, p.y);
      c.globalAlpha = 0.55 + 0.45 * ph; c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, pr, 0, 6.3); c.stroke();
      c.globalAlpha = 1; c.strokeStyle = '#f7c948'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, pr + 4, 0, 6.3); c.stroke();
      c.restore();
    }
    // player
    const pl = G.player; const pp = this.worldToMap(pl.vehicle ? pl.vehicle.x : pl.x, pl.vehicle ? pl.vehicle.z : pl.z); const yaw = pl.vehicle ? pl.vehicle.yaw : pl.yaw;
    c.save(); c.translate(pp.x, pp.y); c.rotate(Math.PI - yaw); c.fillStyle = '#000'; c.beginPath(); c.moveTo(0, -14); c.lineTo(11, 11); c.lineTo(0, 6); c.lineTo(-11, 11); c.closePath(); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -11); c.lineTo(8, 8); c.lineTo(0, 4); c.lineTo(-8, 8); c.closePath(); c.fill(); c.restore();
    // side info
    const info = $('mapInfo'); const d = G.map.districtAt(pl.x, pl.z);
    let nq = '';
    if (G.missions) {
      const act = G.missions.active;
      const mb = !act ? G.blips.list.find(x => x.nextQuest && !x.hidden) : null;
      const def = act || mb ? null : G.missions.nextMain();
      const title = act ? act.title : mb ? mb.label : def ? def.title : '';
      if (title) {
        const dd = act ? null : mb ? Math.hypot(mb.x - pl.x, mb.z - pl.z) : null;
        nq = `<div style="margin-top:6px;color:#f7c948">${act ? 'Current mission' : '★ Next mission'}: <b>${title}</b>${dd != null ? ' — ' + Math.round(dd) + ' m' : ''}</div>`;
      }
    }
    info.innerHTML = `<div style="margin-bottom:8px">You are in <b style="color:#f3c35a">${d ? d.name : 'the bay'}</b></div>${nq}`;
    const lg = $('mapLegend'); lg.innerHTML = '';
    for (const [label, b] of [...legend].sort((a, z) => (z[1].nextQuest ? 1 : 0) - (a[1].nextQuest ? 1 : 0))) {
      const hot = b.nextQuest;
      const d = document.createElement('div');
      d.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${b.color};border:2px solid #000;margin-right:8px;vertical-align:middle"></span>${hot ? `<b style="color:#f7c948">★ MAIN QUEST: ${label}</b>` : label}`;
      lg.appendChild(d);
    }
    const gg = [['#3fb45a', 'Emerald Row'], ['#9a4fd0', 'Violet Kings'], ['#e3c63a', 'Los Soles'], ['#3a7be0', 'Blue Line']].map(([c, n]) => `<div><span style="display:inline-block;width:12px;height:12px;background:${c};margin-right:8px;vertical-align:middle;border:2px solid #000"></span>${n} turf</div>`).join('');
    lg.insertAdjacentHTML('beforeend', '<div style="margin-top:10px;color:#888">Gang colours</div>' + gg);
  }

  // ---------------------------------------------------------------- shop (Ammu-Nation)
  buildShop(kind) {
    const pl = G.player;
    const items = WEAPON_ORDER.filter(id => WEAPONS[id].price && id !== 'spraycan' || id === 'spraycan');
    const rows = items.map(id => { const W = WEAPONS[id]; const have = pl.weapons[id]; return `<div class="nm">${W.name}${have && !W.melee ? ` <span style="color:#999;font-weight:400">(${pl.totalAmmo(id)} rounds)</span>` : have ? ' <span style="color:#999;font-weight:400">(owned)</span>' : ''}</div><div class="pr">${fmtMoney(W.price)}${W.melee ? '' : ' / ' + W.pack + ' rounds'}</div><div class="btn mini" data-w="${id}">${have && W.melee ? 'Owned' : 'Buy'}</div>`; }).join('');
    const p = panel('shopPanel', `<div class="box"><h1 style="font-size:38px">AMMU-NATION</h1><div style="margin-bottom:10px;font-size:18px">Cash: <b style="color:#4fd36b" id="shopCash">${fmtMoney(pl.money)}</b></div>
      <div class="shoplist">${rows}<div class="nm">Body Armor</div><div class="pr">$300</div><div class="btn mini" data-w="armor">Buy</div></div>
      <div style="margin-top:14px"><div class="btn" id="shopBack">Leave</div></div></div>`);
    p.querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
      const id = b.dataset.w;
      if (id === 'armor') { if (pl.money < 300) return G.hud.toast('Not enough cash'); pl.money -= 300; pl.armor = 100; G.audio.play('cash'); }
      else { const W = WEAPONS[id]; if (W.melee && pl.weapons[id]) return; if (pl.money < W.price) return G.hud.toast('Not enough cash'); pl.money -= W.price; pl.give(id, W.melee ? 0 : W.pack, false); G.audio.play('cash'); }
      $('shopCash').textContent = fmtMoney(pl.money); this.buildShop(kind); $('shopPanel').classList.add('show'); this.open = 'shop'; G.hud.weaponChanged();
    });
    $('shopBack').onclick = () => this.back();
  }
}
