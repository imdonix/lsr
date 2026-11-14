// Regression: the police helicopter must not leak once the wanted level clears. At 0 stars an existing heli
// keeps flying out and is removed once far enough (or culled externally): rotor audio stops, model leaves the
// scene, owner stays 'police' so respawn can remove it, and siren/searchlight turn off. It must never respawn
// at 0 stars and a live 4-star heli must keep flying. Also covers the 4->3 star drop (no cleanup), external
// vehicle removal (stale reference) and quit-to-title (all vehicles removed before police.clear()).
// node tools/play.js tools/qa_police_heli.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // All setup + measurement in one synchronous eval: the live loop cannot advance / alter state between reads.
  const r = await c.eval(() => {
    const pl = G.player;
    const sim = (n) => { for (let i = 0; i < n; i++) game.sim(1 / 30); };
    const removeAll = () => { for (const p of G.peds.list.slice()) if (p !== pl) G.peds.remove(p); for (const v of G.vehicles.list.slice()) G.vehicles.remove(v); };
    const helis = () => G.vehicles.list.filter(v => v.isHeli);
    const snap = (H) => ({ heli: !!H, leave: !!(H && H.leave), owner: H && H.v.owner, siren: H && H.v.siren, beam: !!(H && H.v.model && H.v.model.beam && H.v.model.beam.visible), alive: !!(H && H.audio && H.audio.alive), inScene: !!(H && H.v.group.parent === G.scene) });

    try {
      G.missions.abortAll(); G.police.clear();
      game.state = 'play'; game.inCutscene = false; G.police._calm = false;
      pl.invincible = true;
      removeAll();
      G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0;
      const st = QA.findStraight(220) || G.map.nearestRoad(pl.x, pl.z, 400);
      const x = st ? st.x : pl.x, z = st ? st.z : pl.z, yaw = st ? st.yaw || 0 : 0;
      game.teleport(x, z, yaw);

      const audioReady = G.audio.ready === true;

      // ---- A: 4 stars spawns one heli with live rotor audio; clearing thins it out and culls it cleanly
      G.police.setStars(4);
      sim(60);
      const H1 = G.police.heli, v1 = H1 && H1.v;
      const aSpawn = { ...snap(H1), heliCount: helis().length };
      G.police.setStars(0);
      const aClear = snap(H1);
      sim(600);   // 20 s: leave target is ~566 m, removal at 450 m (~13 s) or population cull at 340 m
      const aGone = { heli: G.police.heli === null, heliCount: helis().length, alive: !!(H1 && H1.audio && H1.audio.alive), parentNull: !!(v1 && v1.group.parent === null) };

      // ---- B: 0 stars never respawns a heli
      sim(150);
      const b = { heli: G.police.heli === null, heliCount: helis().length };

      // ---- C: respawn must remove the heli (owner stays police) and never throw
      G.police.setStars(4);
      sim(60);
      const H2 = G.police.heli, v2 = H2 && H2.v;
      let respawnErr = null;
      try { game.respawn('wasted'); } catch (e) { respawnErr = String(e && e.message || e); }
      const cAfter = { stars: G.police.stars };
      sim(600);
      const cGone = { heli: G.police.heli === null, heliCount: helis().length, alive: !!(H2 && H2.audio && H2.audio.alive), parentNull: !!(v2 && v2.group.parent === null) };

      // ---- D: a live 4-star heli keeps flying (the fix must not remove a wanted heli)
      G.police.setStars(4);
      sim(60);
      const H3 = G.police.heli, v3 = H3 && H3.v;
      const x0 = v3 && v3.x, z0 = v3 && v3.z;
      sim(300);   // 10 s still at 4 stars
      const d = { ...snap(H3), heliCount: helis().length, moved: v3 ? Math.hypot(v3.x - x0, v3.z - z0) : 0 };

      // spawn a fresh heli: clears any leftover one at 0 stars first
      const freshHeli = () => {
        if (G.police.heli) { G.police.setStars(0); sim(600); }
        G.police.setStars(4); sim(60);
        return G.police.heli;
      };

      // ---- E: 4 -> 3 star drop does not call cleanup() but must still darken the heli and send it away
      const H4 = freshHeli(), v4 = H4 && H4.v, audio4 = H4 && H4.audio;
      G.police.setStars(3);
      sim(2);   // setStars(3) does not touch the heli synchronously; the next update flips it
      const eDrop = snap(H4);
      sim(600);
      const eGone = { heli: G.police.heli === null, heliCount: helis().length, alive: !!(audio4 && audio4.alive), parentNull: !!(v4 && v4.group.parent === null) };

      // ---- F: external removal of the heli (cull/death) must drop the stale reference and allow a fresh spawn
      const H5 = freshHeli(), v5 = H5 && H5.v, audio5 = H5 && H5.audio;
      let extErr = null;
      try { G.vehicles.remove(v5); } catch (e) { extErr = String(e && e.message || e); }
      sim(1);
      const fStale = { heli: G.police.heli === null, alive: !!(audio5 && audio5.alive) };
      sim(60);
      const H5b = G.police.heli;
      const fRespawn = { heliCount: helis().length, heli: !!H5b, alive: !!(H5b && H5b.audio && H5b.audio.alive) };

      // ---- G: quit to title removes all vehicles before police.clear(); the stale heli must be dropped cleanly
      const H6 = freshHeli(), v6 = H6 && H6.v, audio6 = H6 && H6.audio;
      let quitErr = null;
      try { game.quitToTitle(); } catch (e) { quitErr = String(e && e.message || e); }
      const gQuit = { err: quitErr, heli: G.police.heli === null, alive: !!(audio6 && audio6.alive), parentNull: !!(v6 && v6.group.parent === null) };

      return { audioReady, aSpawn, aClear, aGone, b, respawnErr, cAfter, cGone, d, eDrop, eGone, extErr, fStale, fRespawn, gQuit };
    } finally {
      G.police.clear(); removeAll();
    }
  });

  // audio readiness first: without a live AudioContext the rotor-handle assertions would pass vacuously
  ok('audio ready', r.audioReady);
  ok('A spawn: heli exists with live rotor audio', r.aSpawn.heli && r.aSpawn.alive, JSON.stringify(r.aSpawn));
  ok('A spawn: exactly one heli in the world', r.aSpawn.heliCount === 1, JSON.stringify(r.aSpawn));
  ok('A spawn: heli model in the scene', r.aSpawn.inScene, JSON.stringify(r.aSpawn));

  ok('A clear: heli ordered to leave', r.aClear.leave, JSON.stringify(r.aClear));
  ok('A clear: heli owner stays police (respawn can remove it)', r.aClear.owner === 'police', JSON.stringify(r.aClear));
  ok('A clear: siren off', r.aClear.siren === false, JSON.stringify(r.aClear));
  ok('A clear: searchlight beam off', r.aClear.beam === false, JSON.stringify(r.aClear));

  ok('A gone: police.heli cleared after 20 s', r.aGone.heli, JSON.stringify(r.aGone));
  ok('A gone: no heli left in the vehicle list', r.aGone.heliCount === 0, JSON.stringify(r.aGone));
  ok('A gone: rotor audio stopped', r.aGone.alive === false, JSON.stringify(r.aGone));
  ok('A gone: heli model detached from the scene', r.aGone.parentNull, JSON.stringify(r.aGone));

  ok('B: no heli respawns at 0 stars', r.b.heli && r.b.heliCount === 0, JSON.stringify(r.b));

  ok('C respawn: no throw', r.respawnErr === null, JSON.stringify(r.respawnErr));
  ok('C respawn: wanted level cleared', r.cAfter.stars === 0, JSON.stringify(r.cAfter));
  ok('C respawn: police.heli cleared', r.cGone.heli, JSON.stringify(r.cGone));
  ok('C respawn: no heli left in the vehicle list', r.cGone.heliCount === 0, JSON.stringify(r.cGone));
  ok('C respawn: rotor audio stopped', r.cGone.alive === false, JSON.stringify(r.cGone));
  ok('C respawn: heli model detached from the scene', r.cGone.parentNull, JSON.stringify(r.cGone));

  ok('D 4-star: heli still present', r.d.heli && r.d.heliCount === 1, JSON.stringify(r.d));
  ok('D 4-star: not leaving', r.d.leave === false, JSON.stringify(r.d));
  ok('D 4-star: moved > 10 m in 10 s', r.d.moved > 10, JSON.stringify(r.d));
  ok('D 4-star: rotor audio alive', r.d.alive === true, JSON.stringify(r.d));

  ok('E 4->3: heli ordered to leave', r.eDrop.leave, JSON.stringify(r.eDrop));
  ok('E 4->3: siren off without cleanup', r.eDrop.siren === false, JSON.stringify(r.eDrop));
  ok('E 4->3: searchlight beam off without cleanup', r.eDrop.beam === false, JSON.stringify(r.eDrop));
  ok('E 4->3: police.heli cleared after 20 s', r.eGone.heli, JSON.stringify(r.eGone));
  ok('E 4->3: no heli left in the vehicle list', r.eGone.heliCount === 0, JSON.stringify(r.eGone));
  ok('E 4->3: rotor audio stopped', r.eGone.alive === false, JSON.stringify(r.eGone));
  ok('E 4->3: heli model detached from the scene', r.eGone.parentNull, JSON.stringify(r.eGone));

  ok('F external remove: no throw', r.extErr === null, JSON.stringify(r.extErr));
  ok('F external remove: stale police.heli dropped', r.fStale.heli, JSON.stringify(r.fStale));
  ok('F external remove: stale rotor audio stopped', r.fStale.alive === false, JSON.stringify(r.fStale));
  ok('F external remove: fresh heli spawns afterwards', r.fRespawn.heliCount === 1 && r.fRespawn.heli, JSON.stringify(r.fRespawn));
  ok('F external remove: fresh rotor audio alive', r.fRespawn.alive === true, JSON.stringify(r.fRespawn));

  ok('G quit to title: no throw', r.gQuit.err === null, JSON.stringify(r.gQuit));
  ok('G quit to title: police.heli cleared', r.gQuit.heli, JSON.stringify(r.gQuit));
  ok('G quit to title: rotor audio stopped', r.gQuit.alive === false, JSON.stringify(r.gQuit));
  ok('G quit to title: heli model detached from the scene', r.gQuit.parentNull, JSON.stringify(r.gQuit));

  c.log(`RESULT checks=${checks} fails=${fails}`);
};
