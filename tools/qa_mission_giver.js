// Regression: directly started missions must always get a giver ped (scripts read r.giver in the opening cutscene),
// and the normal start-marker path must still adopt its ped instead of spawning a duplicate.
// node tools/play.js tools/qa_mission_giver.js --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c);
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // ---- 1. direct M.start(def) with no marker and no opts.where still hands the script a giver
  const ids = ['m02', 'm03', 'm05', 'm08', 'm10', 'm11', 'm12', 'm15', 'm16', 'm17', 'm18', 'm19', 'm20', 'm22', 'm23', 's4'];
  const res = await c.eval((ids) => {
    const M = G.missions; M.abortAll(); M.clearStarts();
    const k = M.defs.findIndex(d => d.id === 'm11');
    for (let i = 0; i <= k; i++) M.done.add(M.defs[i].id);
    M.refreshStarts();
    const out = []; let spawns = 0, spawned = null; const orig = M.spawnGiver.bind(M);
    M.spawnGiver = (d, w) => { spawns++; spawned = orig(d, w); return spawned; };
    for (const id of ids) {
      const def = M.defs.find(d => d.id === id); M.clearStarts();
      if (!def) { out.push({ id, missing: true }); continue; }
      spawns = 0; spawned = null;
      M.start(def);
      const r = M.active, g = r && r.giver;
      out.push({ id, active: !!(r && r.def.id === id), spawned: spawns, spawnMission: !!(spawned && spawned.mission === true), isGiver: !!g && g === spawned, inList: !!(g && G.peds.list.includes(g)), mission: !!(g && g.mission === true), marker: M.startMarkers.has(id) });
      M.abortAll();
    }
    M.spawnGiver = orig;
    return { out, leak: G.peds.list.filter(p => p.mission && !p.isPlayer && !p.removeMe).length };
  }, ids);
  // m03/m20/m22 turn their giver into an ally inside their sync opening and clear r.giver, so there only the spawn is asserted.
  const consumed = ['m03', 'm20', 'm22'];
  for (const r of res.out) {
    const okAll = r.active && !r.marker && r.spawned === 1 && r.spawnMission;
    ok(r.id + ' direct start: giver handed to script', consumed.includes(r.id) ? okAll : okAll && r.isGiver && r.inList && r.mission, JSON.stringify(r));
  }
  ok('direct starts: no leaked givers / mission peds', res.leak === 0, 'leak=' + res.leak);

  // ---- 2. normal start-marker path: the marker ped is adopted, not duplicated
  const b = await c.eval(() => {
    const M = G.missions; M.abortAll(); M.done = new Set(['m01']); M.clearStarts(); M.refreshStarts();
    const def = M.defs.find(d => d.id === 'm02');
    const ent = M.startMarkers.get('m02'), ped = ent && ent.ped;
    const w = def.where(); game.teleport(w.x + 3, w.z + 3, 0);
    M.start(def);
    return { hadMarker: !!ped, adopted: !!(M.active && M.active.giver === ped), active: M.active && M.active.def.id, markerGone: !M.startMarkers.has('m02') };
  });
  ok('marker start: giver ped adopted (no duplicate)', b.hadMarker && b.active === 'm02' && b.adopted && b.markerGone, JSON.stringify(b));
  await c.eval(() => { G.missions.abortAll(); });
  const leak = await c.eval(() => G.peds.list.filter(p => p.mission && !p.isPlayer && !p.removeMe).length);
  ok('marker start: no mission ped leak', leak === 0, 'leak=' + leak);

  c.log(JSON.stringify({ checks, fails }));
  if (fails) throw new Error(fails + ' QA check(s) failed');
};
