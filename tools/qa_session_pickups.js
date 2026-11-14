// Regression: transient (non-persistent) pickups must not survive quit-to-title, New Game or Continue.
// Persistent shop plates are seeded once by Places and must stay alive across every session boundary.
// node tools/play.js tools/qa_session_pickups.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  // Runner is exported by the mission module; a bare runner (no script) lets us spawn a tracked mission pickup.
  await c.eval(async () => { window.__MissionRunner = (await import('/src/missions.js')).Runner; });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // ---- A. baseline: only the 10 persistent plates live; remember scene / blip counts
  const a = await c.eval(() => {
    window.__errs = 0; window.addEventListener('error', () => { window.__errs++; });
    const live = G.pickups.list.filter(p => !p.dead);
    return { state: G.game.state, live: live.length, persistent: live.every(p => p.persistent === true), scene: G.scene.children.length, blips: G.blips.list.length };
  });
  ok('baseline: 10 persistent shop plates and nothing else', a.live === 10 && a.persistent, JSON.stringify(a));

  // ---- B. spawn two bare pickups (armor + cash with a collect hook), a blip, a mission pickup and two queue entries
  const b = await c.eval(() => {
    const P = G.pickups, pl = G.player, fx = pl.x + 40, fz = pl.z + 40;
    window.__collected = 0;
    const armor = P.spawn('armor', fx, fz);
    const cash = P.spawn('cash', fx + 2, fz, { amount: 25, onCollect: () => { window.__collected++; } });
    const blip = G.blips.add({ x: armor.x, z: armor.z, color: '#3a7ae0' });
    armor.blip = blip;
    const runner = new window.__MissionRunner(G.missions, G.missions.defs[0]);
    G.missions.active = runner;
    const mission = runner.pickup('health', fx + 4, fz);
    P.respawnQueue.push({ kind: 'armor', x: fx + 6, z: fz, o: { respawning: true }, t: 5 });
    P.respawnQueue.push({ kind: 'armor', x: fx + 8, z: fz, o: { persistent: true }, t: 5 });
    return {
      live: P.list.filter(p => !p.dead).length, queued: P.respawnQueue.length,
      armor: !armor.dead && !armor.persistent, cash: !cash.dead && !cash.persistent,
      mission: mission.mission === true && !mission.dead, blip: G.blips.list.includes(blip),
      scene: G.scene.children.length, blips: G.blips.list.length
    };
  });
  ok('spawned: baseline + 3 transient pickups are live', b.live === a.live + 3 && b.armor && b.cash, JSON.stringify(b));
  ok('spawned: mission pickup is tracked and flagged', b.mission, JSON.stringify({ mission: b.mission }));
  ok('spawned: armor blip attached and in the radar list', b.blip && b.blips === a.blips + 1, JSON.stringify({ blip: b.blip, blips: b.blips, base: a.blips }));
  ok('spawned: one transient and one persistent respawn-queue entry', b.queued === 2, 'queued=' + b.queued);

  // ---- C. quit to title drops transients, mission pickup (via abortAll), dead torsos and transient queue entries
  const q = await c.eval(() => {
    G.game.quitToTitle();
    const live = G.pickups.list.filter(p => !p.dead);
    return {
      state: G.game.state, live: live.length, transient: live.filter(p => !p.persistent).length,
      collected: window.__collected, list: G.pickups.list.length,
      missionLive: live.some(p => p.mission), missionTorso: G.pickups.list.some(p => p.mission && p.dead),
      active: !!G.missions.active, queue: G.pickups.respawnQueue.length,
      queuePersistent: G.pickups.respawnQueue.every(e => e.o && e.o.persistent === true),
      scene: G.scene.children.length, blips: G.blips.list.length
    };
  });
  ok('quit: title state', q.state === 'title', JSON.stringify({ state: q.state }));
  ok('quit: exactly the 10 persistent plates remain and nothing was collected', q.live === 10 && q.transient === 0 && q.collected === 0, JSON.stringify(q));
  ok('quit: no dead pickup torsos are left in the list', q.list === q.live, JSON.stringify({ list: q.list, live: q.live }));
  ok('quit: mission pickup removed and no mission live', !q.missionLive && !q.missionTorso && !q.active, JSON.stringify({ live: q.missionLive, torso: q.missionTorso, active: q.active }));
  ok('quit: respawn queue keeps only the persistent entry', q.queue === 1 && q.queuePersistent, JSON.stringify({ queue: q.queue, persistent: q.queuePersistent }));
  ok('quit: scene and blips back to the baseline', q.scene === a.scene && q.blips === a.blips, JSON.stringify({ scene: q.scene, base: a.scene, blips: q.blips, baseBlips: a.blips }));

  // ---- D. New Game drops a plate spawned while sitting at the title
  const d = await c.eval(() => {
    const P = G.pickups, pl = G.player;
    const spawned = P.spawn('armor', pl.x + 40, pl.z + 40);
    G.game.startGame(false);
    G.missions.abortAll();
    const live = P.list.filter(p => !p.dead);
    return {
      state: G.game.state, spawnedDead: spawned.dead, spawnedListed: P.list.includes(spawned),
      live: live.length, transient: live.filter(p => !p.persistent).length,
      scene: G.scene.children.length, blips: G.blips.list.length
    };
  });
  ok('new game: title-spawned plate removed, 10 persistent stay live', d.spawnedDead && !d.spawnedListed && d.live === 10 && d.transient === 0, JSON.stringify(d));
  ok('new game: scene and blips flat', d.scene === a.scene && d.blips === a.blips, JSON.stringify({ scene: d.scene, base: a.scene, blips: d.blips, baseBlips: a.blips }));

  // ---- E. Continue (save -> title -> spawn at title -> startGame(true))
  const e = await c.eval(() => {
    const P = G.pickups, pl = G.player;
    G.game.quitToTitle();
    const canSave = G.game.canSave();
    G.game.save();
    // control Continue run: establishes the scene/blip baseline for this save (start markers are rebuilt from it)
    G.game.startGame(true); G.missions.abortAll();
    const ctrl = { scene: G.scene.children.length, blips: G.blips.list.length };
    G.game.quitToTitle();
    const spawned = P.spawn('cash', pl.x + 40, pl.z + 40, { amount: 25 });
    G.game.startGame(true);
    const live = P.list.filter(p => !p.dead);
    return {
      canSave, spawnedDead: spawned.dead, spawnedListed: P.list.includes(spawned),
      state: G.game.state, live: live.length, transient: live.filter(p => !p.persistent).length,
      list: P.list.length, scene: G.scene.children.length, blips: G.blips.list.length, ctrl
    };
  });
  ok('continue: save was allowed outside missions', e.canSave, JSON.stringify({ canSave: e.canSave }));
  ok('continue: title-spawned cash removed, 10 persistent stay live', e.spawnedDead && !e.spawnedListed && e.live === 10 && e.transient === 0 && e.list === e.live, JSON.stringify(e));
  ok('continue: scene and blips flat', e.scene === e.ctrl.scene && e.blips === e.ctrl.blips, JSON.stringify({ scene: e.scene, ctrl: e.ctrl.scene, blips: e.blips, ctrlBlips: e.ctrl.blips }));

  // ---- F. persistent plates were never rebuilt or detached
  const f = await c.eval(() => {
    const plates = G.pickups.list.filter(p => p.persistent);
    return { plates: plates.length, alive: plates.every(p => !p.dead), attached: plates.every(p => p.group.parent === G.scene) };
  });
  ok('persistent: 10 plates alive and attached to the scene', f.plates === 10 && f.alive && f.attached, JSON.stringify(f));

  // ---- G. no uncaught page error during the session transitions
  const errs = await c.eval(() => window.__errs ?? 0);
  ok('no page errors', errs === 0, 'errs=' + errs);

  c.log('RESULT checks=' + checks + ' fails=' + fails);
  if (fails) throw new Error(fails + ' QA check(s) failed');
};
