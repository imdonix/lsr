// Headless smoke gate for the autonomous agent loop.
//
// Boots the real game in Chromium, then exercises the core loop: world
// streaming, simulation, on-foot movement, vehicle entry/driving, rendering.
// Prints a machine-readable `SMOKE_RESULT {...}` line and exits non-zero when
// a check fails. This is intentionally independent of any agent's own claims.
//
// Environment:
//   SMOKE_URL   page url (default http://127.0.0.1:$PORT/index.html)
//   PORT        dev-server port (default 8123)
//   SMOKE_OUT   directory for the screenshot
//   PUPPETEER_EXECUTABLE_PATH  chrome/chromium binary
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || '8123';
const URL = process.env.SMOKE_URL || `http://127.0.0.1:${PORT}/index.html`;
const OUT = process.env.SMOKE_OUT || '';
const EXE = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome';
const BOOT_TIMEOUT = +(process.env.SMOKE_BOOT_TIMEOUT || 180000);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function emit(result, code) {
  console.log('SMOKE_RESULT ' + JSON.stringify(result));
  process.exit(code);
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: EXE,
      headless: 'new',
      protocolTimeout: 240000,
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 500)));
    page.on('console', m => {
      const t = m.type();
      if (t === 'error') consoleErrors.push(m.text().slice(0, 500));
    });

    await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.game && window.game.running, { timeout: BOOT_TIMEOUT });

    const result = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = { checks: {}, metrics: {} };
      const ok = (name, msg = '') => { out.checks[name] = { ok: true, msg }; };
      const fail = (name, msg) => { out.checks[name] = { ok: false, msg: String(msg).slice(0, 800) }; };
      const nanList = () => {
        const bad = [];
        for (const p of G.peds.list) if (!Number.isFinite(p.x + p.y + p.z)) bad.push('ped:' + p.role);
        for (const v of G.vehicles.list) if (!Number.isFinite(v.x + v.y + v.z + v.yaw)) bad.push('veh:' + v.type);
        return bad.slice(0, 20);
      };

      try {
        if (!window.game || !window.G) throw new Error('window.game / window.G missing');
        if (!G.map || !G.world || !G.player) throw new Error('core world objects missing');
        ok('api');
      } catch (e) { fail('api', e.message); return out; }

      try {
        game.startGame(false);
        let started = false;
        for (let i = 0; i < 80; i++) { await sleep(100); if (G.missions && G.missions.active) { started = true; break; } }
        await sleep(600);
        // Free roam: stop the autostart tutorial and make the run deterministic.
        if (G.missions) G.missions.abortAll();
        if (G.police) G.police.clear();
        G.player.controlEnabled = true;
        G.player.invincible = true;
        G.player.dead = false;
        G.player.health = G.player.maxHealth;
        game.state = 'play';
        game.timeScale = 1;
        game.inCutscene = false;
        if (G.camera.endCine) G.camera.endCine();
        if (G.hud.hideBig) G.hud.hideBig();
        ok('boot', started ? 'tutorial mission had auto-started' : 'free roam');
      } catch (e) { fail('boot', e.message); return out; }

      try {
        const p = G.player;
        for (let i = 0; i < 200; i++) {
          G.world.update(0.05, p.x, p.z, 40);
          if (G.world.pendingJobs && G.world.pendingJobs() === 0 && G.world.chunks.size > 0) break;
        }
        out.metrics.chunks = G.world.chunks.size;
        out.metrics.roadNodes = G.map.nodes ? G.map.nodes.length : 0;
        out.metrics.roadEdges = G.map.edges ? G.map.edges.length : 0;
        if (G.world.chunks.size > 0 && G.map.nodes.length > 0) ok('world');
        else fail('world', `chunks=${G.world.chunks.size} roadNodes=${G.map.nodes.length}`);
      } catch (e) { fail('world', e.message); }

      try {
        for (let i = 0; i < 300; i++) {
          if (i % 15 === 0) G.world.update(0.03, G.player.x, G.player.z, 8);
          game.sim(1 / 30);
        }
        out.metrics.simSeconds = 10;
        ok('sim');
      } catch (e) { fail('sim', e.message); }

      try {
        const bad = nanList();
        out.metrics.entities = { peds: G.peds.list.length, vehicles: G.vehicles.list.length };
        if (bad.length) fail('finite', bad.join(',')); else ok('finite');
      } catch (e) { fail('finite', e.message); }

      try {
        const p = G.player;
        const edge = (G.map.edges || []).find(e => e.len > 150 && e.cls <= 1) || (G.map.edges || [])[0];
        if (!edge) throw new Error('no road edge');
        const a = edge.pts[0], b = edge.pts[edge.pts.length - 1];
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        game.teleport(a.x, a.z, yaw);
        for (let i = 0; i < 30; i++) G.world.update(0.05, a.x, a.z, 30);
        const v = G.vehicles.spawn('sedan', a.x, a.z, yaw, { owner: 'player' });
        if (!v) throw new Error('vehicle spawn failed');
        p.enterVehicle(v, 0, true);
        v.health = v.maxHealth;
        G.input.down.clear();
        G.input.down.add('KeyW');
        const x0 = v.x, z0 = v.z;
        for (let i = 0; i < 240; i++) {
          if (v.wrecked || v.exploded) { v.repair(); v.health = v.maxHealth; }
          game.sim(1 / 30);
        }
        G.input.down.clear();
        const moved = Math.hypot(v.x - x0, v.z - z0);
        out.metrics.driveDistance = +moved.toFixed(1);
        out.metrics.driveSpeed = +v.speed.toFixed(1);
        if (moved > 5) ok('drive', `${moved.toFixed(1)} m`); else fail('drive', `moved ${moved.toFixed(1)} m`);
        if (p.vehicle) p.exitVehicle(true);
      } catch (e) { fail('drive', e.message); }

      try {
        const bad = nanList();
        if (bad.length) fail('finite-after-drive', bad.join(',')); else ok('finite-after-drive');
      } catch (e) { fail('finite-after-drive', e.message); }

      try {
        game.renderFrame(0.016);
        const info = G.renderer.info.render;
        out.metrics.drawCalls = info.calls;
        out.metrics.triangles = info.triangles;
        if (info.calls > 0 && info.triangles > 0) ok('render'); else fail('render', `calls=${info.calls} tris=${info.triangles}`);
      } catch (e) { fail('render', e.message); }

      out.metrics.gameTime = Math.round(G.time * 10) / 10;
      return out;
    });

    if (OUT) {
      try {
        fs.mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, 'smoke.png') });
      } catch (e) { /* screenshot is best effort */ }
    }

    const failedChecks = Object.entries(result.checks).filter(([, v]) => !v.ok).map(([k]) => k);
    const fatal = pageErrors.length > 0;
    const record = {
      ok: failedChecks.length === 0 && !fatal,
      url: URL,
      checks: result.checks,
      metrics: result.metrics,
      pageErrors,
      consoleErrors: consoleErrors.slice(0, 20),
    };
    emit(record, record.ok ? 0 : 1);
  } catch (e) {
    emit({ ok: false, error: String(e && e.stack || e).slice(0, 2000), pageErrors: [], consoleErrors: [] }, 1);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { } }
  }
})();
