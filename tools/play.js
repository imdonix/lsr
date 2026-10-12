// Headless gameplay test driver.  node tools/play.js <steps.js> [--w 1280 --h 720]
// steps.js exports async (ctx) => {...}  with ctx = { page, shot(name), eval(fn,...args), wait(ms), log(...) , key(code,ms), mouse(...) }
const puppeteer = require('puppeteer-core');
const path = require('path');
const args = process.argv.slice(2);
const stepsFile = path.resolve(args[0]);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', '/tmp/claude-1001/-home-tamasmagyar-Work-testgame/2244238a-7010-4c23-9327-bbc7bc4690bf/scratchpad/');
const EXE = opt('exe', process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: +opt('w', 1280), height: +opt('h', 720) });
  const errs = [];
  page.on('console', m => { const t = m.type(); const txt = m.text(); if (t === 'error' || t === 'warning' || txt.startsWith('[T]')) console.log('[' + t + ']', txt.slice(0, 600)); });
  page.on('pageerror', e => { console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 5).join(' | ')); });
  await page.goto(opt('url', 'http://localhost:8080/index.html'), { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.game && window.game.running, { timeout: 180000 });
  const ctx = {
    page,
    wait: ms => new Promise(r => setTimeout(r, ms)),
    eval: (fn, ...a) => page.evaluate(fn, ...a),
    log: (...a) => console.log('[T]', ...a),
    shot: async (name) => { await page.screenshot({ path: OUT + name + '.png' }); console.log('[shot]', OUT + name + '.png'); },
    key: async (code, ms = 100) => { await page.keyboard.down(code); await new Promise(r => setTimeout(r, ms)); await page.keyboard.up(code); },
    simulate: async (seconds) => { await page.evaluate(async (s) => { const t0 = performance.now(); while (performance.now() - t0 < s * 1000) await new Promise(r => setTimeout(r, 50)); }, seconds); },
    // advance simulated time faster than real-time: runs n sim steps directly
    step: async (seconds, dt = 1 / 30) => { await page.evaluate((s, dt) => { const g = window.game; const n = Math.round(s / dt); for (let i = 0; i < n; i++) { g.sim(dt); } }, seconds, dt); },
  };
  try { await require(stepsFile)(ctx); } catch (e) { console.log('[steps error]', e.message, e.stack.split('\n').slice(0, 4).join(' | ')); }
  await browser.close();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
