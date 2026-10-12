// Automated story playthrough bot: drives the mission scripts with cheats (teleports, kills) to find script errors.
// node tools/bot.js [--from m01] [--to m14] [--only m05|s1] [--cuts 1]   (--cuts: screenshot every cutscene shot into the scratchpad as cut_<mission>_<n>_s<shot>_<a|b>.png)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', '/tmp/claude-1001/-home-tamasmagyar-Work-testgame/2244238a-7010-4c23-9327-bbc7bc4690bf/scratchpad/');
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) { }
(async () => {
  const browser = await puppeteer.launch({ protocolTimeout: 1800000, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
  page.on('console', m => { const t = m.type(), x = m.text(); if (t === 'error' || t === 'warning' || x.startsWith('[B]')) console.log('[' + t + ']', x.slice(0, 500)); });
  page.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.running, { timeout: 180000 });
  const CUTS = +opt('cuts', 0);
  if (CUTS) await page.exposeFunction('nodeShot', async (name) => { await page.screenshot({ path: OUT + name + '.png' }); });
  const MAXL_ARG = +opt('maxloops', 4000); const from = opt('from', 'm01'), to = opt('to', 'm14'), only = opt('only', null);
  await page.evaluate(() => { window.__start = performance.now(); });
  const result = await page.evaluate(async (from, to, only, MAXL, CUTS) => {
    const log = (...a) => console.log('[B]', ...a);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    game.startGame(false);
    await sleep(3600);
    if (CUTS) {
      const { Runner } = await import('/src/missions.js'); const orig = Runner.prototype.cutscene; window.__cutN = 0;
      Runner.prototype.cutscene = async function (shots, lines = [], o = {}) {
        const n = ++window.__cutN, id = this.def.id; const pr = orig.call(this, shots, lines, o);
        const t0 = performance.now(); while (!G.camera.cine && performance.now() - t0 < 4000) await sleep(20);
        const c = G.camera.cine; const total = shots.reduce((a, s) => a + s.dur, 0); const ltot = lines.reduce((a, l) => a + (l[2] ?? Math.max(2.4, l[1].length * 0.055)) + 0.15, 0);
        log('CUT', id, '#' + n, 'shots', shots.map(s => s.dur).join('+'), '=', total.toFixed(1), 's | dialogue', ltot.toFixed(1), 's', ltot > total + 0.5 ? '  <-- DIALOGUE LONGER THAN SHOTS' : '', ltot < total - 3 ? '  (shots outlast dialogue by ' + (total - ltot).toFixed(1) + 's)' : '');
        if (c) { window.__hold = true; let acc = 0; for (let i = 0; i < shots.length; i++) { for (const fr of [0.2, 0.8]) { c.t = acc + shots[i].dur * fr; G.paused = true; await sleep(800); await window.nodeShot(`cut_${id}_${n}_s${i}_${fr < 0.5 ? 'a' : 'b'}`); } acc += shots[i].dur; } c.t = 0; G.paused = false; window.__hold = false; }
        return pr;
      };
    }
    G.player.invincible = true;
    const M = G.missions; const pl = G.player;
    // prepare: mark prerequisites as done
    const ids = M.defs.map(d => d.id);
    const startIdx = ids.indexOf(only || from);
    for (let i = 0; i < startIdx; i++) { M.done.add(ids[i]); const d = M.defs[i]; if (d.afterDone) try { d.afterDone(M); } catch (e) { } }
    M.abortAll();
    const passed = []; const failed = [];
    let lastId = null;
    const endIdx = only ? startIdx : ids.indexOf(to);
    const t0 = performance.now();
    for (let idx = startIdx; idx <= endIdx; idx++) {
      const def = M.defs[idx]; if (!def) break;
      log('--- starting', def.id, def.title);
      G.police.clear(); pl.health = pl.maxHealth; pl.dead = false; game.state = 'play'; game.timeScale = 1; pl.controlEnabled = true;
      if (!def.autostart && def.where) { const w = def.where(); if (w) { game.teleport(w.x + 4, w.z + 4, 0); } }
      // start
      M.refreshStarts(); await sleep(50);
      const p = M.start(def);
      let n = 0, lastObj = '', stuck = 0, ended = false;
      p.then(() => { ended = true; });
      const tm = performance.now();
      while (!ended && performance.now() - tm < 240000) {
        if (window.__hold) { await sleep(50); continue; }
        for (let k = 0; k < 12; k++) game.sim(1 / 20);
        n++; if (!pl.dead) pl.health = Math.max(pl.health, 70);
        const r = M.active; if (!r) { await sleep(10); continue; }
        if (n % 4 === 0) {
          const obj = document.getElementById('objective').textContent; if (obj !== lastObj) { lastObj = obj; log(def.id, 'obj:', obj.slice(0, 90)); }
          if (!game.inCutscene) {
            // press E when a mission interactable (breaker box, drill, ...) is targeted
            if (G.interactions && G.interactions.target && G.interactions.target.mission) G.input.pressed.add('KeyE');
            // kill enemies
            for (const q of G.peds.list) if (!q.dead && !q.isPlayer && q.mission && (q.hostile || q.role === 'enemy' || q.name === 'Courier' || q.name === 'Duke Price') && q.role !== 'ally') { q.damage(1e5, { source: pl }); }
            for (const v of G.vehicles.list) if (v.name === 'Armored truck' && !v.wrecked && v.health > v.maxHealth * 0.4) v.health = v.maxHealth * 0.3;
            // destroy hostile vehicles
            for (const v of G.vehicles.list) if (v.mission && !v.wrecked && v !== pl.vehicle && v.blipObj && v.blipObj.color === '#ff3030') v.blowUp(pl);
            if (/^Get out|^Leave/i.test(r.objText) && pl.vehicle) pl.exitVehicle(false);
            if (/^Chase/i.test(r.objText)) { const lm = G.vehicles.list.find(v => v.ai && /limo/i.test(v.name)); if (lm && pl.vehicle && Math.hypot(pl.vehicle.x - lm.x, pl.vehicle.z - lm.z) < 30) { const hh = G.landmarks.home.door; pl.vehicle.x = hh.x; pl.vehicle.z = hh.z; pl.vehicle.vx = pl.vehicle.vz = 0; } }
            if (G.police.stars > 0 && !(r.def.id === 'm04' && G.police.stars === 2 && false)) G.police.clear();
            // tail bot
            const cel = document.getElementById('counter'); const ctr = cel.style.display === 'none' ? '' : cel.textContent;
            if (ctr.startsWith('Distance')) { const mc = G.vehicles.list.find(v => v.name === "Marcus's coupe"); if (mc && pl.vehicle) { const v = pl.vehicle; const back = 34; v.x = mc.x - Math.sin(mc.yaw) * back; v.z = mc.z - Math.cos(mc.yaw) * back; v.yaw = mc.yaw; v.vx = mc.vx; v.vz = mc.vz; } else if (mc && !pl.vehicle) { const v = G.vehicles.list.find(q => q.mission && q !== mc && !q.wrecked); if (v) pl.enterVehicle(v, 0, true); } }
            else if (ctr.startsWith('Tailing')) { const tg = G.vehicles.list.find(v => v.mission && v.ai && v !== pl.vehicle && !v.wrecked && v.blipObj && v.blipObj.color === '#ff5090'); if (tg && pl.vehicle) { const v = pl.vehicle; const back = 30; v.x = tg.x - Math.sin(tg.yaw) * back; v.z = tg.z - Math.cos(tg.yaw) * back; v.yaw = tg.yaw; v.vx = tg.vx; v.vz = tg.vz; } else if (tg && !pl.vehicle) { const v = G.vehicles.list.find(q => q.mission && q !== tg && !q.wrecked); if (v) pl.enterVehicle(v, 0, true); } }
            else {
              let targeted = false;
              // pickups
              for (const pk of r.pickups) { if (!pk.dead && (pk.kind === 'cash' || pk.kind === 'tag' || pk.onCollect)) { if (pl.vehicle) pl.exitVehicle(true); game.teleport(pk.x, pk.z, pl.yaw); targeted = true; break; } }
              if (!targeted) {
                const mk = r.markers.find(m => !m.dead);
                if (mk && mk.entity && mk.entity.def && !mk.entity.wrecked && pl.vehicle !== mk.entity && !mk.vehicleOnly) { if (pl.vehicle) pl.exitVehicle(true); pl.enterVehicle(mk.entity, 0, true); targeted = true; }
                else if (mk) {
                  if (mk.vehicleOnly || (mk.mode === 'vehicle')) {
                    if (!pl.vehicle) { const v = G.vehicles.list.find(q => (q.mission || q.owner === 'player') && !q.wrecked && !q.driver && q.type !== 'policeheli') || null; if (v) pl.enterVehicle(v, 0, true); else { const nv = G.vehicles.spawn('sedan', mk.x, mk.z, 0, { owner: 'player' }); pl.enterVehicle(nv, 0, true); } }
                    const v = pl.vehicle; if (v) { v.x = mk.x; v.z = mk.z; v.vx = v.vz = 0; v.vy = 0; v.airborne = false; v.y = G.world.groundY(v.x, v.z) + v.def.wheelRadius; v.groundY = v.y; }
                    if (mk.needVehicle && pl.vehicle !== mk.needVehicle && !mk.needVehicle.wrecked) { pl.exitVehicle(true); pl.enterVehicle(mk.needVehicle, 0, true); mk.needVehicle.x = mk.x; mk.needVehicle.z = mk.z; }
                  } else { if (pl.vehicle && mk.footOnly) pl.exitVehicle(true); if (pl.vehicle) { const vv = pl.vehicle; vv.x = mk.x; vv.z = mk.z; vv.vx = vv.vz = 0; vv.vy = 0; vv.airborne = false; vv.y = G.world.groundY(vv.x, vv.z) + vv.def.wheelRadius; vv.groundY = vv.y; } else game.teleport(mk.x, mk.z, pl.yaw); }
                  targeted = true;
                }
              }
              if (!targeted) {
                // enter-vehicle waiters
                const bv = r.blips.find(b => b.entity && b.entity.def && !b.entity.wrecked && b.color !== '#ff3030');
                if (bv && pl.vehicle !== bv.entity && !bv.entity.driver) { if (pl.vehicle) pl.exitVehicle(true); pl.enterVehicle(bv.entity, 0, true); }
                else if (!pl.vehicle) { const v = G.vehicles.list.find(q => q.mission && !q.wrecked && !q.driver && !q.ai); if (v && r.objText && /car|van|bike|limo|truck|wheel|vehicle|Get in|Take/i.test(r.objText)) pl.enterVehicle(v, 0, true); }
              }
            }
          }
        }
        if (n % 200 === 0 && r) log(def.id, 'dbg: waiters', r.waiters.length, 'markers', r.markers.length, 'pickups', r.pickups.length, 'peds', r.peds.filter(p=>!p.dead).length, 'player', Math.round(pl.x), Math.round(pl.z), pl.vehicle ? pl.vehicle.name : 'foot', 'obj', lastObj.slice(0,40), (() => { const m = G.vehicles.list.find(v => v.name === "Marcus's coupe" || v.name === "Calloway's limo"); if (!m) return ''; const a = m.ai; return JSON.stringify({ mp: [Math.round(m.x), Math.round(m.z)], spd: +m.speed.toFixed(1), hp: Math.round(m.health), blk: a && a.blocked, ls: a && a.lightStop, rv: a && a.reverseT, sc: a && a.stuckCount, mode: a && a.mode, thr: m.input.throttle, hb: m.input.handbrake, e: a && a.agent && a.agent.edge.id, s: a && a.agent && Math.round(a.agent.s) }); })());
        if (n > MAXL) { log('TIMEOUT loops in', def.id); break; }
        await sleep(1);
      }
      if (M.done.has(def.id)) { passed.push(def.id); log('PASSED', def.id, 'in', Math.round(performance.now() - tm) + 'ms'); }
      else { failed.push(def.id); log('NOT PASSED', def.id, 'obj:', lastObj, '| mp:', document.getElementById('mp').textContent); try { M.abortAll(); } catch (e) { } }
      await sleep(200);
      if (M.active) { M.abortAll(); }
      // clear leftover entities
      for (const q of G.peds.list.slice()) if (!q.isPlayer && q.mission) { q.mission = false; }
    }
    return { passed, failed };
  }, from, to, only, MAXL_ARG, CUTS);
  console.log('RESULT', JSON.stringify(result));
  await page.screenshot({ path: OUT + 'bot_end.png' });
  await browser.close();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
