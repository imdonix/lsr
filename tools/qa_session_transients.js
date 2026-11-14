// Regression: transient session state must not survive quit-to-title, New Game or Continue.
//   covers world events, combat projectiles/fires, taxi duty markers/blips/peds/hints,
//   gang heat, lastPlayerVehicle, HUD duty objective, and the persistent shop plates.
// node tools/play.js tools/qa_session_transients.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // All three boundaries run in one eval so no live frame can advance/alter state between setup and check.
  const r = await c.eval(async () => {
    const { Ped } = await import('/src/peds.js');
    window.__errs = 0; window.addEventListener('error', () => { window.__errs++; });
    const sim = (n) => { for (let i = 0; i < n; i++) game.sim(1 / 30); };
    const objText = () => (document.getElementById('objective')?.textContent || '').trim();
    const livePickups = () => G.pickups.list.filter(p => !p.dead).length;

    const resetWorld = () => {
      G.missions.abortAll();
      if (G.player.vehicle) G.player.exitVehicle(true);
      G.police.clear(); G.police.noWanted = false;
      G.player.controlEnabled = true; G.player.invincible = true; G.player.dead = false;
      game.state = 'play'; game.inCutscene = false;
      G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0;
      QA.clear();
      const st = QA.findStraight(220) || G.map.nearestRoad(G.player.x, G.player.z, 400);
      game.teleport(st ? st.x : G.player.x, st ? st.z : G.player.z, st ? (st.yaw || 0) : 0);
    };

    // Create one of each transient, all in the same synchronous slice, and snapshot what must disappear.
    const makeTransients = () => {
      resetWorld();
      const pl = G.player;
      const sceneBaseline = G.scene.children.length;
      const blipsBaseline = G.blips.list.length;

      // --- real taxi duty: driver ped + player at the wheel, then start the activity
      const taxi = G.vehicles.spawn('taxi', pl.x + 6, pl.z, pl.yaw || 0, { owner: 'traffic' });
      const drv = new Ped({ x: taxi.x, z: taxi.z, role: 'civ' }); G.peds.add(drv); drv.noDespawn = true;
      drv.enterVehicle(taxi, 0, true);
      pl.enterVehicle(taxi, 0, true);
      G.activities.startTaxi(taxi);
      // newFare() may fail on the first pickRoadSpot(); its 2 s retry needs a few sim steps.
      let steps = 0;
      while (steps < 90 && (!G.activities.taxi || !G.activities.taxi.blip || !G.activities.taxi.markers.length)) { sim(1); steps++; }
      const T = G.activities.taxi;
      const taxiMarkers = T ? T.markers.slice() : [];
      const taxiBlip = T ? T.blip : null;

      // --- in-flight ordnance + fire (created last so no sim can resolve them before the boundary)
      G.combat.launch(pl, 'grenade', pl.x, pl.y + 1.2, pl.z, 0, 0, 1);
      G.combat.startFire(pl.x + 4, pl.z + 4, 4, 30);
      const proj = G.combat.projectiles[G.combat.projectiles.length - 1];
      const projMesh = proj ? proj.mesh : null;

      // --- a real world event (accident preferred, fall back through the other kinds)
      let E = G.worldEvents.start('accident', true);
      let eventKind = E ? 'accident' : null;
      if (!E) for (const k of ['carfire', 'pullover', 'mugging', 'driveby']) { E = G.worldEvents.start(k, true); if (E) { eventKind = k; break; } }
      const eventBlip = E ? E.blip : null;

      // --- state that must be zeroed / dropped at the boundary
      G.gangHeat[1] = 180; G.gangHeat[2] = 120; G.gangHeat[3] = 5; G.gangHeat[4] = 0;
      G.lastPlayerVehicle = taxi;
      G.activities._taxiHint = true; G.activities._vigHint = true;

      // --- stale mission-retry offer + a live spray-can loop handle
      G.missions.lastFailed = G.missions.defs[0] || { id: 'qa_fail' };
      G.missions.lastFailedReplay = false;
      G.hud.missionFailed('QA failure');
      const spray = { alive: true, stopped: 0, stop() { this.alive = false; this.stopped++; } };
      G.player._sprayLoop = spray;

      return {
        // live refs are internal only: the object returned from page.evaluate must stay JSON-serialisable
        refs: { sceneBaseline, blipsBaseline, taxi, markerList: taxiMarkers, taxiBlip, projMesh, eventBlip, spray },
        mode: G.activities.mode, objective: objText(),
        projCount: G.combat.projectiles.length, fireCount: G.combat.fires.length,
        projAttached: !!projMesh && projMesh.parent === G.scene,
        eventKind, eventStarted: !!E, eventActive: G.worldEvents.active === E,
        eventInList: !!(E && G.blips.list.includes(eventBlip)),
        taxiMarkers: taxiMarkers.length,
        taxiMarkersInList: taxiMarkers.filter(m => G.markers.list.includes(m)).length,
        taxiBlipInList: !!taxiBlip && G.blips.list.includes(taxiBlip),
        gangHeat: { ...G.gangHeat }, lastVehSame: G.lastPlayerVehicle === taxi,
        hints: [G.activities._taxiHint, G.activities._vigHint],
        retry: { lastFailed: !!G.missions.lastFailed, canRetry: G.missions.canRetry(), opacity: G.hud.e.mp.style.opacity },
        spray: { present: G.player._sprayLoop === spray, alive: spray.alive, stopped: spray.stopped },
        pickupCount: livePickups(), missionsActive: !!G.missions.active, steps
      };
    };
    const plainSetup = (s) => { const o = {}; for (const k in s) if (k !== 'refs') o[k] = s[k]; return o; };

    // Snapshot immediately after a boundary. markers.remove() marks dead and detaches the group but the
    // list entries are pruned on the next update; run that update so we assert the list the next frame sees.
    const measure = (s) => {
      const R = s.refs;
      G.markers.update(0);
      return {
        state: G.game.state,
        worldActive: !!G.worldEvents.active,
        eventBlipInList: R.eventBlip ? G.blips.list.includes(R.eventBlip) : false,
        projCount: G.combat.projectiles.length, fireCount: G.combat.fires.length,
        projAttached: !!R.projMesh && R.projMesh.parent === G.scene,
        scene: G.scene.children.length, sceneBaseline: R.sceneBaseline,
        mode: G.activities.mode,
        taxiMarkersStillListed: R.markerList.filter(m => G.markers.list.includes(m)).length,
        taxiBlipStillListed: !!R.taxiBlip && G.blips.list.includes(R.taxiBlip),
        hints: [G.activities._taxiHint, G.activities._vigHint],
        gangHeat: { ...G.gangHeat },
        lastPlayerVehicle: G.lastPlayerVehicle ? (G.lastPlayerVehicle.type || 'vehicle') : null,
        lastFailed: !!G.missions.lastFailed, canRetry: G.missions.canRetry(), failOpacity: G.hud.e.mp.style.opacity,
        spray: { alive: R.spray.alive, stopped: R.spray.stopped, cleared: G.player._sprayLoop === null },
        pickupsLive: livePickups(), objective: objText(),
        missionsActive: !!G.missions.active
      };
    };

    const out = { errs: 0, basePickups: livePickups() };

    // ---- A. quit-to-title
    const sA = makeTransients();
    G.game.quitToTitle();
    G.missions.abortAll();
    out.afterA = measure(sA); out.setupA = plainSetup(sA);

    // ---- B. New Game: get back into play first, then fire the boundary again
    G.game.startGame(false); G.missions.abortAll();
    const sB = makeTransients();
    G.game.startGame(false); G.missions.abortAll();
    out.afterB = measure(sB); out.setupB = plainSetup(sB);

    // ---- C. Continue: save in a clean play state, recreate transients, quit, then load the save.
    // A control load first: applying a save rebuilds story start markers, so use its scene count as the
    // baseline instead of the pre-save one.
    G.missions.abortAll(); G.police.clear(); G.player.dead = false;
    out.canSave = G.game.canSave();
    G.game.save();
    out.hasSave = G.game.hasSave();
    G.game.quitToTitle(); G.game.startGame(true); G.missions.abortAll();
    out.ctrlC = { scene: G.scene.children.length };
    const sC = makeTransients();
    G.game.quitToTitle();
    G.game.startGame(true); G.missions.abortAll();
    out.afterC = measure(sC); out.setupC = plainSetup(sC);

    // ---- G. a live spray-can loop must also die on respawn (public death flow, not the reset helper)
    const h = { alive: true, stopped: 0, stop() { this.alive = false; this.stopped++; } };
    G.player._sprayLoop = h;
    out.sprayRespawn = { armed: G.player._sprayLoop === h && h.alive, state: G.game.state };
    G.game.respawn('wasted');
    out.sprayRespawn.stopped = h.stopped; out.sprayRespawn.alive = h.alive;
    out.sprayRespawn.cleared = G.player._sprayLoop === null;

    out.errs = window.__errs || 0;
    return out;
  });

  ok('baseline: 10 persistent shop plates live', r.basePickups === 10, 'live=' + r.basePickups);

  const boundary = (tag, s, a, expectState) => {
    ok(tag + ' setup: world event active with a radar blip', s.eventStarted && s.eventActive && s.eventInList, JSON.stringify({ kind: s.eventKind, active: s.eventActive, inList: s.eventInList }));
    ok(tag + ' setup: projectile + fire exist and the mesh is attached', s.projCount > 0 && s.fireCount > 0 && s.projAttached, JSON.stringify({ proj: s.projCount, fires: s.fireCount, attached: s.projAttached }));
    ok(tag + ' setup: taxi duty live with a fare marker and blip', s.mode === 'taxi' && s.taxiMarkers > 0 && s.taxiBlipInList, JSON.stringify({ mode: s.mode, markers: s.taxiMarkers, markersInList: s.taxiMarkersInList, blip: s.taxiBlipInList, steps: s.steps }));
    ok(tag + ' setup: gang heat, last vehicle and hints are dirty', Object.values(s.gangHeat).some(v => v > 0) && s.lastVehSame && s.hints[0] && s.hints[1], JSON.stringify({ heat: s.gangHeat, last: s.lastVehSame, hints: s.hints }));
    ok(tag + ' setup: HUD shows the duty objective', s.objective.length > 0, 'objective=' + JSON.stringify(s.objective));
    ok(tag + ' setup: stale retry offered on the HUD', s.retry.lastFailed && s.retry.canRetry && s.retry.opacity === '1', JSON.stringify(s.retry));
    ok(tag + ' setup: spray-can loop handle is armed', s.spray.present && s.spray.alive, JSON.stringify(s.spray));

    ok(tag + ' result: ' + expectState + ' state', a.state === expectState, 'state=' + a.state);
    ok(tag + ' result: world event cleared and its blip removed', a.worldActive === false && !a.eventBlipInList, JSON.stringify({ active: a.worldActive, blip: a.eventBlipInList }));
    ok(tag + ' result: no projectiles or fires remain', a.projCount === 0 && a.fireCount === 0, JSON.stringify({ proj: a.projCount, fires: a.fireCount }));
    ok(tag + ' result: projectile mesh detached from the scene', !a.projAttached);
    ok(tag + ' result: scene child count back to baseline', a.scene === a.sceneBaseline, JSON.stringify({ scene: a.scene, base: a.sceneBaseline }));
    ok(tag + ' result: duty mode ended', a.mode === null, 'mode=' + a.mode);
    ok(tag + ' result: duty markers removed from the list', a.taxiMarkersStillListed === 0, 'stillListed=' + a.taxiMarkersStillListed);
    ok(tag + ' result: duty blip removed from the radar', !a.taxiBlipStillListed);
    ok(tag + ' result: taxi/vigilante hints re-armed', a.hints[0] === false && a.hints[1] === false, JSON.stringify(a.hints));
    ok(tag + ' result: gang heat cleared', Object.values(a.gangHeat).every(v => v === 0), JSON.stringify(a.gangHeat));
    ok(tag + ' result: lastPlayerVehicle cleared', a.lastPlayerVehicle === null, 'last=' + (a.lastPlayerVehicle && a.lastPlayerVehicle.type));
    ok(tag + ' result: 10 persistent plates still live', a.pickupsLive === 10, 'live=' + a.pickupsLive);
    ok(tag + ' result: duty objective cleared from the HUD', a.objective === '', 'objective=' + JSON.stringify(a.objective));
    ok(tag + ' result: no mission left active after the boundary', !a.missionsActive);
    ok(tag + ' result: stale retry offer cleared', !a.lastFailed && !a.canRetry && a.failOpacity === '0', JSON.stringify({ lastFailed: a.lastFailed, canRetry: a.canRetry, opacity: a.failOpacity }));
    ok(tag + ' result: spray-can loop stopped once and handle cleared', a.spray.stopped === 1 && !a.spray.alive && a.spray.cleared, JSON.stringify(a.spray));
  };

  boundary('A quit', r.setupA, r.afterA, 'title');
  boundary('B new game', r.setupB, r.afterB, 'play');
  ok('C continue: save was allowed outside missions', r.canSave, JSON.stringify({ canSave: r.canSave, hasSave: r.hasSave }));
  ok('C continue: pre-transient scene matches a clean continue load', r.afterC.sceneBaseline === r.ctrlC.scene, JSON.stringify({ base: r.afterC.sceneBaseline, ctrl: r.ctrlC.scene }));
  boundary('C continue', r.setupC, r.afterC, 'play');

  ok('G respawn: spray-can loop armed before respawn', r.sprayRespawn.armed);
  ok('G respawn: spray-can loop stopped once and handle cleared', r.sprayRespawn.stopped === 1 && !r.sprayRespawn.alive && r.sprayRespawn.cleared, JSON.stringify(r.sprayRespawn));

  ok('no page errors', r.errs === 0, 'errs=' + r.errs);

  c.log('RESULT checks=' + checks + ' fails=' + fails);
  if (fails) throw new Error(fails + ' QA check(s) failed');
};
