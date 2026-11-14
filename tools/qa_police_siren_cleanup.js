// Regression: police sirens must stop at the source when a cruiser stops being a police car.
//   1) police.cleanup() (wanted level cleared) must silence every demoted cruiser immediately
//   2) worldEvents.releaseVeh() must silence a demoted event car but keep a wanted chase car's siren
//   3) setSiren(false) must stop the live siren loop even on a sleeping/wrecked car whose update() is short-circuited
// node tools/play.js tools/qa_police_siren_cleanup.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // All setup + measurement in one eval: the live loop cannot advance / alter state between reads.
  const r = await c.eval(async () => {
    const { Ped } = await import('/src/peds.js');
    const { DriverAI } = await import('/src/driverai.js');
    const pl = G.player;
    const sim = (n) => { for (let i = 0; i < n; i++) game.sim(1 / 30); };
    const removeAll = () => { for (const p of G.peds.list.slice()) if (p !== pl) G.peds.remove(p); for (const v of G.vehicles.list.slice()) G.vehicles.remove(v); };
    const policeCars = () => G.vehicles.list.filter(v => v.owner === 'police' && !v.isHeli);
    const snapCar = (v) => ({ id: v.id, owner: v.owner, siren: v.siren, stSiren: !!(v.model && v.model.st && v.model.st.siren), stSlot: v.model && v.model.st ? v.model.st.slot : null, handleAlive: !!(v.sirenHandle && v.sirenHandle.alive) });
    const near = (v, d) => { game.teleport(v.x + d, v.z, v.yaw); };

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

      // ---- A: 3 stars spawns cruisers with live sirens; clearing the wanted level must silence + demote them
      G.police.setStars(3);
      sim(240);
      for (let i = 0; i < 600 && policeCars().length === 0; i++) sim(1);
      let carsA = policeCars();
      if (!carsA.length) return { fatal: 'no police cars spawned', audioReady };
      let nearest = carsA[0], nd = Infinity;
      for (const v of carsA) { const d = Math.hypot(v.x - pl.x, v.z - pl.z); if (d < nd) { nd = d; nearest = v; } }
      near(nearest, 8);
      sim(60);
      carsA = policeCars();
      if (!carsA.length) return { fatal: 'police cars vanished before the snapshot', audioReady };
      const aBefore = carsA.map(snapCar);
      G.police.setStars(0);
      const aClear = carsA.map(snapCar);
      sim(90);   // 3 s
      const aAfter = carsA.map(snapCar);
      const aSirenCount = G.vehicles.sirenCount;

      // ---- B: an event car released without wanted heat is demoted and silenced
      removeAll(); G.lastPlayerVehicle = null; G.police.setStars(0);
      const vB = G.vehicles.spawn('police', x + Math.sin(yaw) * 18, z + Math.cos(yaw) * 18, yaw, { owner: 'event' });
      const dB = new Ped({ x: vB.x, z: vB.z, role: 'cop' }); G.peds.add(dB); dB.noDespawn = true; dB.enterVehicle(vB, 0, true);
      new DriverAI(vB, 'idle');
      near(vB, 6);
      vB.setSiren(true); sim(60);
      const bBefore = snapCar(vB);
      G.worldEvents.releaseVeh(null, vB, false, false);
      const bNow = snapCar(vB);
      sim(60);
      const bAfter = snapCar(vB);

      // ---- C: the same release path must keep a wanted chase car's siren on
      removeAll(); G.lastPlayerVehicle = null;
      const vC = G.vehicles.spawn('police', x + Math.sin(yaw) * 18, z + Math.cos(yaw) * 18, yaw, { owner: 'event' });
      const dC = new Ped({ x: vC.x, z: vC.z, role: 'cop' }); G.peds.add(dC); dC.noDespawn = true; dC.enterVehicle(vC, 0, true);
      new DriverAI(vC, 'idle');
      near(vC, 6);
      vC.setSiren(true); sim(60);
      const cBefore = snapCar(vC);
      G.worldEvents.releaseVeh(null, vC, false, true);
      const cNow = snapCar(vC);
      sim(60);
      const cAfter = snapCar(vC);

      // ---- D: a sleeping car whose update() is short-circuited must still stop its loop on setSiren(false)
      removeAll(); G.lastPlayerVehicle = null;
      const vD = G.vehicles.spawn('police', x, z, yaw, { owner: 'player' });
      const dD = new Ped({ x: vD.x, z: vD.z, role: 'cop' }); G.peds.add(dD); dD.noDespawn = true; dD.enterVehicle(vD, 0, true);
      near(vD, 8);
      vD.setSiren(true); sim(45);
      const dBefore = snapCar(vD);
      dD.exitVehicle(false); if (G.peds.list.includes(dD)) G.peds.remove(dD);
      sim(180);
      for (let i = 0; i < 120 && !vD.sleeping; i++) sim(1);
      const dSleep = { sleeping: vD.sleeping, siren: vD.siren, handleAlive: !!(vD.sirenHandle && vD.sirenHandle.alive) };
      vD.setSiren(false);
      const dAfter = { siren: vD.siren, stSiren: !!(vD.model && vD.model.st && vD.model.st.siren), handleAlive: !!(vD.sirenHandle && vD.sirenHandle.alive), handleNull: vD.sirenHandle === null };

      return { audioReady, aBefore, aClear, aAfter, aSirenCount, bBefore, bNow, bAfter, cBefore, cNow, cAfter, dBefore, dSleep, dAfter };
    } finally {
      G.police.clear(); removeAll();
    }
  });

  ok('audio ready', r.audioReady);
  if (r.fatal) {
    ok('setup: police cars spawned', false, r.fatal);
    c.log(`RESULT checks=${checks} fails=${fails}`);
    return;
  }

  ok('A before: at least one police car with siren on', r.aBefore.some(v => v.siren), JSON.stringify(r.aBefore));
  ok('A before: at least one live siren handle', !r.audioReady || r.aBefore.some(v => v.handleAlive), JSON.stringify(r.aBefore));
  ok('A clear: every former police car demoted', r.aClear.every(v => v.owner !== 'police'), JSON.stringify(r.aClear));
  ok('A clear: every siren flag off', r.aClear.every(v => v.siren === false), JSON.stringify(r.aClear));
  ok('A clear: every lightbar off (st.siren false, st.slot -1)', r.aClear.every(v => v.stSiren === false && v.stSlot === -1), JSON.stringify(r.aClear));
  ok('A clear: every audio handle stopped', !r.audioReady || r.aClear.every(v => !v.handleAlive), JSON.stringify(r.aClear));
  ok('A after 3 s: still silent (no re-flash / no handle)', r.aAfter.every(v => v.siren === false && v.stSiren === false && !v.handleAlive), JSON.stringify(r.aAfter));
  ok('A after 3 s: no siren voices remain', r.aSirenCount === 0, JSON.stringify(r.aSirenCount));

  ok('B release: demoted to traffic', r.bNow.owner === 'traffic', JSON.stringify(r.bNow));
  ok('B release: siren and lightbar off', r.bNow.siren === false && r.bNow.stSiren === false, JSON.stringify(r.bNow));
  ok('B release: handle stopped immediately', !r.audioReady || !r.bNow.handleAlive, JSON.stringify(r.bNow));
  ok('B release: still silent after 2 s', r.bAfter.siren === false && !r.bAfter.handleAlive, JSON.stringify(r.bAfter));

  ok('C wanted: owner stays police', r.cNow.owner === 'police', JSON.stringify(r.cNow));
  ok('C wanted: siren stays on', r.cNow.siren === true && r.cNow.stSiren === true, JSON.stringify(r.cNow));

  ok('D before: siren handle alive (audio)', !r.audioReady || r.dBefore.handleAlive, JSON.stringify(r.dBefore));
  ok('D sleeping: car actually asleep without a driver', r.dSleep.sleeping, JSON.stringify(r.dSleep));
  ok('D sleeping: handle survives while sleeping', !r.audioReady || r.dSleep.handleAlive, JSON.stringify(r.dSleep));
  ok('D setSiren(false): handle stops immediately', !r.audioReady || (!r.dAfter.handleAlive && r.dAfter.handleNull), JSON.stringify(r.dAfter));

  c.log(`RESULT checks=${checks} fails=${fails}`);
};
