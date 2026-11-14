// Regression: vigilante duty must release its criminal cars/peds (mission/noDespawn flags, owner, AI, blips) on every
// exit path: real player exit event, 140 s timeout, and level success. Also guards the player-driving case.
// node tools/play.js tools/qa_vigilante_cleanup.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // Everything setup + measured in one synchronous eval: the game loop cannot advance / alter state between reads.
  const r = await c.eval(() => {
    const pl = G.player, A = G.activities, TAU = Math.PI * 2;
    const removeAll = () => { for (const p of G.peds.list.slice()) if (p !== pl) G.peds.remove(p); for (const v of G.vehicles.list.slice()) G.vehicles.remove(v); };
    const missionCount = () => { let cars = 0, peds = 0; for (const v of G.vehicles.list) if (v.mission || v.owner === 'mission') cars++; for (const p of G.peds.list) if (p.mission) peds++; return { cars, peds }; };
    const flags = (c) => ({ mission: c.mission, criminal: c.criminal, owner: c.owner, mode: c.ai && c.ai.mode, panicT: c.ai && c.ai.panicT, blip: !!c.blipObj, hasPeds: !!c.criminalPeds });
    const pedFlags = (peds) => peds.map(p => ({ mission: p.mission, noDespawn: p.noDespawn, dead: p.dead, inList: G.peds.list.indexOf(p) >= 0 }));
    const teleportFar = (x, z) => {
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU, nr = G.map.nearestRoad(x + Math.cos(a) * 420, z + Math.sin(a) * 420, 80);
        if (nr && G.world.groundY(nr.x, nr.z) > 0.5) { game.teleport(nr.x, nr.z, 0); return true; }
      }
      return false;
    };
    const sim = (n) => { for (let i = 0; i < n; i++) game.sim(1 / 30); };
    const setup = () => {
      if (A.vig || A.mode) A.endDuty('');
      removeAll();
      const st = QA.findStraight(220) || G.map.nearestRoad(pl.x, pl.z, 400);
      const x = st ? st.x : pl.x, z = st ? st.z : pl.z, yaw = st ? st.yaw || 0 : 0;
      game.teleport(x, z, yaw);
      const v = G.vehicles.spawn('police', x, z, yaw, { owner: 'player' });
      v.y = G.world.groundY(x, z) + v.def.wheelRadius; v.applyTransform();
      pl.enterVehicle(v, 0, true);
      A.startVigilante(v); A.spawnCriminals();
      const V = A.vig, targets = V.targets.slice(), peds = [];
      for (const t of targets) for (const p of (t.criminalPeds || t.occupants())) peds.push(p);
      return { v, V, targets, peds, level: V.level };
    };

    // ---- A: real player exit -> playerExitVehicle -> endDuty
    const a = setup();
    if (!a.targets.length) return { fatal: 'spawnCriminals produced 0 targets (section A)' };
    a.peds[0].noDespawn = true;
    const aSirenBefore = a.v.siren;
    pl.exitVehicle(false);
    const aExited = A.mode === null && !A.vig;
    const aFlags = a.targets.map(flags), aPedFlags = pedFlags(a.peds);
    const aPolice = { has: G.vehicles.list.indexOf(a.v) >= 0, owner: a.v.owner, mission: a.v.mission, siren: a.v.siren };
    const aTp = teleportFar(a.targets[0].x, a.targets[0].z); sim(90);
    const aGone = { cars: a.targets.filter(t => G.vehicles.list.indexOf(t) < 0).length, peds: a.peds.filter(p => G.peds.list.indexOf(p) < 0).length, mc: missionCount() };

    // ---- B: timeout
    const b = setup();
    if (!b.targets.length) return { fatal: 'spawnCriminals produced 0 targets (section B)' };
    b.V.t = 141; A.updateVigilante(0.05);
    const bFlags = b.targets.map(flags), bPedFlags = pedFlags(b.peds);
    const bCleared = A.vig && A.vig.targets.length === 0;
    const bTp = teleportFar(b.targets[0].x, b.targets[0].z); sim(90);
    const bGone = { cars: b.targets.filter(t => G.vehicles.list.indexOf(t) < 0).length, peds: b.peds.filter(p => G.peds.list.indexOf(p) < 0).length, mc: missionCount() };

    // ---- C: success
    const c3 = setup();
    if (!c3.targets.length) return { fatal: 'spawnCriminals produced 0 targets (section C)' };
    for (const p of c3.peds) p.die({ source: pl });
    A.updateVigilante(0.05);
    const cFlags = c3.targets.map(flags), cPedFlags = pedFlags(c3.peds);
    const cLevel = { before: c3.level, after: A.vig.level, targets: A.vig.targets.length };
    const cTp = teleportFar(c3.targets[0].x, c3.targets[0].z); sim(900);
    const cGone = { cars: c3.targets.filter(t => G.vehicles.list.indexOf(t) < 0).length, peds: c3.peds.filter(p => G.peds.list.indexOf(p) < 0).length, mc: missionCount() };

    // ---- player-driver guard + idempotency (pure unit, no scene entities)
    const pdPed = { mission: true, noDespawn: true };
    const pd = { mission: true, criminal: true, owner: 'mission', blipObj: null, criminalPeds: [pdPed], driver: pl, ai: { panicT: 1e9, setMode() { throw new Error('player-driven AI must not be retargeted'); } } };
    let pdErr = null;
    try { A.cleanupCriminal(pd); A.cleanupCriminal(pd); } catch (e) { pdErr = String(e && e.message || e); }
    const pdOut = { owner: pd.owner, mission: pd.mission, criminal: pd.criminal, ai: pd.ai, criminalPeds: pd.criminalPeds, pedMission: pdPed.mission, pedNoDespawn: pdPed.noDespawn, err: pdErr };

    A.endDuty(''); removeAll();
    return { a: { flags: aFlags, peds: aPedFlags, police: aPolice, exited: aExited, sirenBefore: aSirenBefore, tp: aTp, gone: aGone }, b: { flags: bFlags, peds: bPedFlags, cleared: bCleared, tp: bTp, gone: bGone }, c: { flags: cFlags, peds: cPedFlags, level: cLevel, tp: cTp, gone: cGone }, pd: pdOut };
  });

  if (r.fatal) { ok('setup', false, r.fatal); c.log(`RESULT checks=${checks} fails=${fails}`); return; }

  const cleanFlags = (f) => f.mission === false && f.criminal === false && f.owner === 'traffic' && f.mode === 'traffic' && f.panicT === 0 && f.blip === false && f.hasPeds === false;
  const cleanPeds = (ps) => ps.length > 0 && ps.every(p => p.mission === false && p.noDespawn === false);

  // A: real exit path
  ok('A exit: real player exit cleared duty', r.a.exited);
  ok('A exit: criminal car released (mission/owner/AI/blip)', r.a.flags.every(cleanFlags), JSON.stringify(r.a.flags));
  ok('A exit: every criminal ped mission=false + noDespawn=false (incl. seated)', cleanPeds(r.a.peds), JSON.stringify(r.a.peds));
  ok('A exit: siren off on duty vehicle', r.a.sirenBefore === true && r.a.police.siren === false, JSON.stringify({ before: r.a.sirenBefore, after: r.a.police.siren }));
  ok('A exit: player police car untouched', r.a.police.has && r.a.police.owner === 'player' && r.a.police.mission === false, JSON.stringify(r.a.police));
  ok('A exit: far teleport available', r.a.tp);
  ok('A exit: criminal cars culled', r.a.gone.cars === r.a.flags.length, JSON.stringify(r.a.gone));
  ok('A exit: criminal peds culled', r.a.gone.peds === r.a.peds.length, JSON.stringify(r.a.gone));
  ok('A exit: no global mission cars/peds', r.a.gone.mc.cars === 0 && r.a.gone.mc.peds === 0, JSON.stringify(r.a.gone.mc));

  // B: timeout
  ok('B timeout: criminal car released (mission/owner/AI/blip)', r.b.flags.every(cleanFlags), JSON.stringify(r.b.flags));
  ok('B timeout: every criminal ped mission=false', cleanPeds(r.b.peds), JSON.stringify(r.b.peds));
  ok('B timeout: targets cleared', r.b.cleared);
  ok('B timeout: far teleport available', r.b.tp);
  ok('B timeout: criminal cars culled', r.b.gone.cars === r.b.flags.length, JSON.stringify(r.b.gone));
  ok('B timeout: criminal peds culled', r.b.gone.peds === r.b.peds.length, JSON.stringify(r.b.gone));
  ok('B timeout: no global mission cars/peds', r.b.gone.mc.cars === 0 && r.b.gone.mc.peds === 0, JSON.stringify(r.b.gone.mc));

  // C: success
  ok('C success: level advanced and targets cleared', r.c.level.after === r.c.level.before + 1 && r.c.level.targets === 0, JSON.stringify(r.c.level));
  ok('C success: criminal car released (mission/owner)', r.c.flags.every(f => f.mission === false && f.owner === 'traffic'), JSON.stringify(r.c.flags));
  ok('C success: dead criminal peds mission=false', cleanPeds(r.c.peds) && r.c.peds.every(p => p.dead), JSON.stringify(r.c.peds));
  ok('C success: far teleport available', r.c.tp);
  ok('C success: criminal cars culled', r.c.gone.cars === r.c.flags.length, JSON.stringify(r.c.gone));
  ok('C success: dead criminal peds culled', r.c.gone.peds === r.c.peds.length, JSON.stringify(r.c.gone));
  ok('C success: no global mission cars/peds', r.c.gone.mc.cars === 0 && r.c.gone.mc.peds === 0, JSON.stringify(r.c.gone.mc));

  // D: player-driver guard + idempotency
  ok('D player-driver: ownership still released', r.pd.owner === 'traffic' && r.pd.mission === false && r.pd.criminal === false, JSON.stringify(r.pd));
  ok('D player-driver: AI dropped, criminal peds refs cleared', r.pd.ai === null && r.pd.criminalPeds === null, JSON.stringify(r.pd));
  ok('D player-driver: ped mission/noDespawn cleared', r.pd.pedMission === false && r.pd.pedNoDespawn === false, JSON.stringify(r.pd));
  ok('D player-driver: no throw across idempotent calls', r.pd.err === null, JSON.stringify(r.pd));

  c.log(`RESULT checks=${checks} fails=${fails}`);
};
