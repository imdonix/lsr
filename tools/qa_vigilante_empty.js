// Regression: vigilante duty must not pay out / level up when spawnCriminals() finds no targets (transient
// pickRoadSpot failure). It must stay in 'spawn', keep the level, hide the counter and retry quietly.
// node tools/play.js tools/qa_vigilante_empty.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // All setup + measurement in one synchronous eval: the live loop cannot advance / alter state between reads.
  const r = await c.eval(() => {
    const pl = G.player, A = G.activities;
    const removeAll = () => { for (const p of G.peds.list.slice()) if (p !== pl) G.peds.remove(p); for (const v of G.vehicles.list.slice()) G.vehicles.remove(v); };
    const sim = (n) => { for (let i = 0; i < n; i++) game.sim(1 / 30); };
    const counter = () => ({ shown: G.hud.e.counter.style.display !== 'none', text: G.hud.e.counter.textContent });
    const orig = G.population.pickRoadSpot;
    try {
      if (A.vig || A.mode) A.endDuty('');
      removeAll();
      const st = QA.findStraight(220) || G.map.nearestRoad(pl.x, pl.z, 400);
      const x = st ? st.x : pl.x, z = st ? st.z : pl.z, yaw = st ? st.yaw || 0 : 0;
      game.teleport(x, z, yaw);
      const v = G.vehicles.spawn('police', x, z, yaw, { owner: 'player' });
      v.y = G.world.groundY(x, z) + v.def.wheelRadius; v.applyTransform();
      pl.enterVehicle(v, 0, true);
      A.startVigilante(v);
      const money0 = pl.money, level0 = A.vig.level, hp0 = pl.health, armor0 = pl.armor;

      // ---- A: pickRoadSpot always fails -> no targets, no payout, stay in spawn
      G.population.pickRoadSpot = () => null;
      sim(60);
      const mid = { money: pl.money, level: A.vig.level, state: A.vig.state, targets: A.vig.targets.length, done: A.doneSet.has('vigilante'), obj: G.hud.objText, counter: counter(), hp: pl.health, armor: pl.armor };
      sim(600);
      const late = { money: pl.money, level: A.vig.level, state: A.vig.state, targets: A.vig.targets.length, done: A.doneSet.has('vigilante'), obj: G.hud.objText, counter: counter(), hp: pl.health, armor: pl.armor };

      // ---- B: transient failure recovers -> hunt with real targets
      G.population.pickRoadSpot = orig;
      let steps = 0; while (A.vig.state !== 'hunt' && steps < 300) { sim(1); steps++; }
      const hunt = { state: A.vig.state, targets: A.vig.targets.length, steps };

      // ---- C: clearing real targets pays exactly once (400 + level*250)
      for (const car of A.vig.targets) for (const p of car.occupants()) p.die({ source: pl });
      A.updateVigilante(1 / 30);
      const after = { money: pl.money, level: A.vig.level, counter: counter() };
      for (let i = 0; i < 6; i++) A.updateVigilante(1 / 30);
      const afterMore = { money: pl.money, level: A.vig.level };

      // ---- D: safety net — forced 'hunt' with no targets must not pay, and a direct empty spawn resets to 'spawn'
      A.vig.state = 'hunt'; A.vig.targets = []; A.vig.t = 0;
      const d0 = { money: pl.money, level: A.vig.level };
      A.updateVigilante(1 / 30);
      const forced = { money: pl.money, level: A.vig.level, counter: counter() };
      G.population.pickRoadSpot = () => null;
      A.spawnCriminals();
      const direct = { state: A.vig.state, wait: A.vig.wait, targets: A.vig.targets.length, money: pl.money };

      return { money0, level0, hp0, armor0, mid, late, hunt, after, afterMore, d0, forced, direct };
    } finally {
      G.population.pickRoadSpot = orig;
      A.endDuty('');
      removeAll();
    }
  });

  // A: empty spawn must never pay, level up, complete the activity or show a "take out 0" objective
  ok('A empty spawn: money unchanged', r.mid.money === r.money0 && r.late.money === r.money0, JSON.stringify({ money0: r.money0, mid: r.mid.money, late: r.late.money }));
  ok('A empty spawn: level stayed 1', r.mid.level === r.level0 && r.late.level === r.level0, JSON.stringify({ level0: r.level0, mid: r.mid.level, late: r.late.level }));
  ok('A empty spawn: duty stays in spawn state', r.mid.state === 'spawn' && r.late.state === 'spawn', JSON.stringify({ mid: r.mid.state, late: r.late.state }));
  ok('A empty spawn: no targets', r.mid.targets === 0 && r.late.targets === 0, JSON.stringify({ mid: r.mid.targets, late: r.late.targets }));
  ok('A empty spawn: doneSet has no vigilante', !r.mid.done && !r.late.done, JSON.stringify({ mid: r.mid.done, late: r.late.done }));
  ok('A empty spawn: objective is not "take out 0"', !/<b>0<\/b>/.test(r.mid.obj) && !/<b>0<\/b>/.test(r.late.obj), JSON.stringify({ mid: r.mid.obj, late: r.late.obj }));
  ok('A empty spawn: counter hidden', !r.mid.counter.shown && !r.late.counter.shown, JSON.stringify({ mid: r.mid.counter, late: r.late.counter }));
  ok('A empty spawn: health/armor unchanged', r.mid.hp === r.hp0 && r.mid.armor === r.armor0 && r.late.hp === r.hp0 && r.late.armor === r.armor0, JSON.stringify({ hp0: r.hp0, armor0: r.armor0, mid: [r.mid.hp, r.mid.armor], late: [r.late.hp, r.late.armor] }));

  // B: recovery
  ok('B retry after failure: reaches hunt', r.hunt.state === 'hunt', JSON.stringify(r.hunt));
  ok('B retry after failure: targets spawned', r.hunt.targets > 0, JSON.stringify(r.hunt));

  // C: real clear pays exactly once
  const reward = 400 + r.level0 * 250;
  ok('C clear: money += 400 + level*250 exactly once', r.after.money === r.money0 + reward, JSON.stringify({ money0: r.money0, after: r.after.money, reward }));
  ok('C clear: level advanced by 1', r.after.level === r.level0 + 1, JSON.stringify({ level0: r.level0, after: r.after.level }));
  ok('C clear: counter shows 0 remaining', r.after.counter.shown && r.after.counter.text === 'Criminals remaining: 0', JSON.stringify(r.after.counter));
  ok('C clear: repeated updates do not pay again', r.afterMore.money === r.after.money && r.afterMore.level === r.after.level, JSON.stringify({ after: r.after, afterMore: r.afterMore }));

  // D: the done guard and spawn-state reset are safety nets even if state is forced
  ok('D forced hunt with no targets: no payout', r.forced.money === r.d0.money && r.forced.level === r.d0.level, JSON.stringify({ d0: r.d0, forced: r.forced }));
  ok('D forced hunt with no targets: counter shows 0', r.forced.counter.shown && r.forced.counter.text === 'Criminals remaining: 0', JSON.stringify(r.forced.counter));
  ok('D direct empty spawn: resets to spawn without paying', r.direct.state === 'spawn' && r.direct.wait === 0 && r.direct.targets === 0 && r.direct.money === r.d0.money, JSON.stringify(r.direct));

  c.log('RESULT ' + JSON.stringify({ checks, fails }));
};
