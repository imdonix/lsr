// Regression: a recruited homie crew and an active gang raid must not survive quit-to-title / new game.
//   1) quitToTitle() + startGame(false) clears crew + raid, removes raid blips and releases mission ownership
//   2) the recruit prompt works again afterwards (crew gate is open)
// node tools/play.js tools/qa_homies_reset.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // One mostly-synchronous eval: the live loop cannot advance / mutate state between reads.
  const r = await c.eval(async () => {
    const { Ped } = await import('/src/peds.js');
    const { GANG } = await import('/src/mapdata.js');
    const pl = G.player;
    const sim = (n) => { for (let i = 0; i < n; i++) game.sim(1 / 30); };
    const removeAll = () => { for (const p of G.peds.list.slice()) if (p !== pl) G.peds.remove(p); for (const v of G.vehicles.list.slice()) G.vehicles.remove(v); };
    try {
      G.missions.abortAll(); G.police.clear();
      game.state = 'play'; game.inCutscene = false;
      pl.invincible = true; pl.controlEnabled = true; pl.dead = false;
      G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0;
      removeAll();

      // ---- A: recruit 3 real Emerald Row gang peds near the player
      const aPeds = [];
      for (let i = 0; i < 3; i++) {
        const p = new Ped({ x: pl.x + 1 + i * 0.7, z: pl.z + 1, role: 'gang', gang: GANG.EMERALD });
        G.peds.add(p); aPeds.push(p);
      }
      G.promptOverride = null; G.input.pressed.clear(); G.input.pressed.add('KeyG');
      G.homies.update(1 / 30);
      const aPrompt = G.promptOverride;
      const aCrewAfterPress = G.homies.crew.length;
      for (const p of aPeds) if (!G.homies.crew.includes(p)) G.homies.recruit(p);
      const aCrew = G.homies.crew.length;
      const aRoles = aPeds.map(p => p.role);

      // ---- B: start a real raid from a road position (retry a bounded number of times)
      let raid = null;
      const edgeCount = G.map.edges.length;
      for (let attempt = 0; attempt < 40 && !G.homies.raid; attempt++) {
        if (attempt % 4 === 0 && edgeCount) {
          const e = G.map.edges[(attempt * 7) % edgeCount];
          const a = e && e.pts && e.pts[0];
          if (a) game.teleport(a.x, a.z, 0);
        }
        G.homies.startRaid();
      }
      raid = G.homies.raid;
      if (!raid) return { fatal: 'raid did not start after 40 attempts', aPrompt, aCrewAfterPress, aCrew, aRoles };
      const bBlips = raid.blips.slice();
      const bPeds = raid.peds.slice();
      const bCars = raid.cars.slice();
      const bBlipsInList = bBlips.filter(b => G.blips.list.includes(b)).length;
      const bPedsMission = bPeds.map(p => !!p.mission);

      // ---- C: quit to title and start a new game: crew + raid must be released before the wipe
      G.game.quitToTitle();
      G.game.startGame(false);
      G.missions.abortAll();
      const cCrew = G.homies.crew.length;
      const cRaid = G.homies.raid;
      const cBlipsLeft = bBlips.filter(b => G.blips.list.includes(b)).length;
      const cPedsMission = bPeds.map(p => !!p.mission);
      const cCars = bCars.map(v => ({ mission: !!v.mission, owner: v.owner, ai: v.ai ? v.ai.mode : null }));
      const cCrewRoles = aPeds.map(p => p.role);
      const cPromptRecruit = !!(G.promptOverride && G.promptOverride.includes('Recruit'));

      // ---- D: fresh gang peds must make the recruit prompt appear again, and recruiting must work
      G.missions.abortAll();
      G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0;
      G.promptOverride = null; G.input.pressed.clear();
      const dPeds = [];
      for (let i = 0; i < 2; i++) {
        const p = new Ped({ x: pl.x + 1 + i * 0.7, z: pl.z + 1, role: 'gang', gang: GANG.EMERALD });
        G.peds.add(p); dPeds.push(p);
      }
      sim(2);
      G.homies.update(1 / 30);
      const dPrompt = G.promptOverride;
      const dCrewBefore = G.homies.crew.length;
      G.homies.recruit(dPeds[0]);
      const dCrewAfter = G.homies.crew.length;

      return {
        aPrompt, aCrewAfterPress, aCrew, aRoles,
        bBlips: bBlips.length, bBlipsInList, bPedsMission, bCars: bCars.length,
        cCrew, cRaidActive: !!cRaid, cBlipsLeft, cPedsMission, cCars, cCrewRoles, cPromptRecruit,
        dPrompt, dCrewBefore, dCrewAfter,
        errCount: game.errCount || 0
      };
    } finally {
      G.police.clear(); removeAll();
    }
  });

  if (r.fatal) {
    ok('setup: raid started', false, r.fatal);
    c.log(`RESULT checks=${checks} fails=${fails}`);
    return;
  }

  ok('A: recruit prompt shows for gang peds', !!(r.aPrompt && r.aPrompt.includes('Recruit')), JSON.stringify(r.aPrompt));
  ok('A: G key recruits a gang ped', r.aCrewAfterPress === 1, 'crew=' + r.aCrewAfterPress);
  ok('A: crew holds 3 homies', r.aCrew === 3, 'crew=' + r.aCrew);
  ok('A: recruits are allies', r.aRoles.every(x => x === 'ally'), JSON.stringify(r.aRoles));

  ok('B: raid starts', r.bBlips > 0, 'blips=' + r.bBlips + ' cars=' + r.bCars);
  ok('B: raid blips are live', r.bBlipsInList === r.bBlips, JSON.stringify({ inList: r.bBlipsInList, total: r.bBlips }));
  ok('B: raid peds are mission entities', r.bPedsMission.every(Boolean), JSON.stringify(r.bPedsMission));

  ok('C: crew cleared', r.cCrew === 0, 'crew=' + r.cCrew);
  ok('C: raid cleared', r.cRaidActive === false);
  ok('C: raid blips removed', r.cBlipsLeft === 0, 'left=' + r.cBlipsLeft);
  ok('C: raid peds released', r.cPedsMission.every(x => x === false), JSON.stringify(r.cPedsMission));
  ok('C: raid cars released', r.cCars.every(x => x.mission === false && x.owner !== 'mission'), JSON.stringify(r.cCars));
  ok('C: crew peds demoted', r.cCrewRoles.every(x => x !== 'ally'), JSON.stringify(r.cCrewRoles));
  ok('C: recruit prompt cleared', r.cPromptRecruit === false, JSON.stringify(r.cPromptRecruit));

  ok('D: recruit prompt opens again', !!(r.dPrompt && r.dPrompt.includes('Recruit')), JSON.stringify(r.dPrompt));
  ok('D: crew gate was empty', r.dCrewBefore === 0, 'crew=' + r.dCrewBefore);
  ok('D: recruiting works again', r.dCrewAfter === 1, 'crew=' + r.dCrewAfter);
  ok('E: no frame errors', r.errCount === 0, 'errCount=' + r.errCount);

  c.log(`RESULT checks=${checks} fails=${fails}`);
};
