// Regression: New Game / load must reset sprayed tags, side activities and owned turf.
// node tools/play.js tools/qa_state_reset.js --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c);
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // ---- 1. Quit to Title -> New Game clears tags / activities / turf / money
  const base = await c.eval(() => {
    G.player.money = 99999;
    G.tags.deserialize([0, 1, 2]);
    G.activities.deserialize(['x', 'y']);
    G.game.territories = new Set(['idlewood', 'jefferson']);
    G.game.applyTerritory('idlewood'); G.game.applyTerritory('jefferson');
    const d = G.landmarks.vk_base.door;
    return { gang: G.map.gang0[G.map._idx(d.x, d.z)] };
  });
  await c.eval(() => { G.game.quitToTitle(); G.game.startGame(false); });
  await c.wait(300);
  const s1 = await c.eval(() => {
    const d = G.landmarks.vk_base.door;
    let gangDiff = 0; for (let i = 0; i < G.map.gang.length; i++) if (G.map.gang[i] !== G.map.gang0[i]) gangDiff++;
    return { tags: G.tags.count(), undone: G.tags.items.every(t => !t.done), acts: G.activities.doneCount(), terr: G.game.territories.size, gang: G.map.gangAt(d.x, d.z), gangDiff, money: G.player.money };
  });
  ok('new game: tags cleared', s1.tags === 0 && s1.undone, JSON.stringify(s1));
  ok('new game: activities cleared', s1.acts === 0, JSON.stringify(s1));
  ok('new game: territories cleared', s1.terr === 0, JSON.stringify(s1));
  ok('new game: gang turf restored to base', s1.gang === base.gang && s1.gangDiff === 0, JSON.stringify({ base, gang: s1.gang, gangDiff: s1.gangDiff }));
  ok('new game: money reset', s1.money === 500, 'money=' + s1.money);

  // ---- 2. Loading an older save reverts extra tags / activities / turf
  await c.eval(() => {
    G.tags.deserialize([0, 1, 2, 3, 4, 5, 6]);
    G.activities.deserialize(['a']);
    G.game.territories = new Set(['idlewood']);
    G.game.save();
    // dirty the live state beyond what the save knows about (keep the paint so applySave must restore it)
    G.tags.deserialize([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    G.activities.deserialize(['a', 'b']);
    G.game.territories.add('jefferson'); G.game.applyTerritory('jefferson');
    G.game.quitToTitle(); G.game.startGame(true);
  });
  await c.wait(300);
  const s2 = await c.eval(() => {
    const b = G.landmarks.vk_base.door, h = G.landmarks.vk_hq.door;
    return {
      tags: G.tags.count(), done: G.tags.items.filter(t => t.done).length,
      acts: G.activities.doneCount(), terr: [...G.game.territories].sort(),
      gangBase: G.map.gangAt(b.x, b.z), baseBase: G.map.gang0[G.map._idx(b.x, b.z)],
      gangHq: G.map.gangAt(h.x, h.z), baseHq: G.map.gang0[G.map._idx(h.x, h.z)]
    };
  });
  ok('older save: only saved tags remain', s2.tags === 7 && s2.done === 7, JSON.stringify(s2));
  ok('older save: only saved activities remain', s2.acts === 1, JSON.stringify(s2));
  ok('older save: only saved territory remains', JSON.stringify(s2.terr) === JSON.stringify(['idlewood']), JSON.stringify(s2.terr));
  ok('older save: saved turf repainted', s2.gangBase === 1, JSON.stringify({ gang: s2.gangBase, base: s2.baseBase }));
  ok('older save: unsaved turf not painted', s2.gangHq === s2.baseHq, JSON.stringify({ gang: s2.gangHq, base: s2.baseHq }));

  // ---- 3. East LS territory repaints on load
  await c.eval(() => {
    G.game.territories = new Set(['eastls']);
    G.game.save();
    G.map.restoreGang();
    G.game.quitToTitle(); G.game.startGame(true);
  });
  await c.wait(300);
  const s3 = await c.eval(() => {
    const d = G.world.placement.districtCentre('East Los Santos');
    return d ? { gang: G.map.gangAt(d.x, d.z), x: d.x, z: d.z } : { skip: true };
  });
  if (s3.skip) c.log('SKIP east ls: district centre missing');
  else ok('east ls: territory repainted on load', s3.gang === 1, JSON.stringify(s3));

  c.log(JSON.stringify({ checks, fails }));
  if (fails) throw new Error(fails + ' QA check(s) failed');
};
