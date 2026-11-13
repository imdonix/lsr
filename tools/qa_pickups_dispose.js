// Regression: spawning/removing pickups must reuse cached geometries/materials and never leak GPU resources.
// node tools/play.js tools/qa_pickups_dispose.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // Everything measured in one synchronous eval: the game loop cannot advance / alter counters between reads.
  const r = await c.eval(() => {
    const P = G.pickups, R = G.renderer;
    const mem = () => R.info.memory.geometries;
    const render = () => game.renderFrame(0.016);
    const px = G.player.x, pz = G.player.z;
    const spawn = (kind, x, z, o) => { const p = P.spawn(kind, x, z, o); p.group.traverse(n => { n.frustumCulled = false; }); return p; };
    const removeAll = (arr) => { for (const p of arr) P.remove(p); P.update(0); };
    const live = () => P.list.filter(p => !p.dead);
    const KINDS = ['cash', 'health', 'armor', 'star', 'tag'];

    // ---- warm the shared caches once (render registers them with the GPU)
    const warm = KINDS.map(k => spawn(k, px, pz)).concat([spawn('weapon', px, pz, { weapon: 'pistol', ammo: 10 })]);
    render(); removeAll(warm); render();
    const base = mem();
    const before = live().length;

    // ---- cycle A: 48 pickups (8 x 5 kinds + one pistol) must not allocate a geometry each
    const cycle = [];
    for (let i = 0; i < 8; i++) for (const k of KINDS) cycle.push(spawn(k, px + 2 + i * 0.1, pz + 2));
    cycle.push(spawn('weapon', px + 2, pz + 2, { weapon: 'pistol', ammo: 10 }));
    render();
    const mid = mem();
    removeAll(cycle);
    render();
    const after = mem();
    const listA = live().length;
    const detachedA = cycle.every(p => p.group.parent === null);

    // ---- cycle B: repeat; nothing may grow further
    const cycle2 = [];
    for (let i = 0; i < 8; i++) for (const k of KINDS) cycle2.push(spawn(k, px + 2 + i * 0.1, pz + 2));
    cycle2.push(spawn('weapon', px + 2, pz + 2, { weapon: 'pistol', ammo: 10 }));
    render();
    const mid2 = mem();
    removeAll(cycle2);
    render();
    const after2 = mem();
    const detachedB = cycle2.every(p => p.group.parent === null);

    // ---- glow SpriteMaterials are cached per colour and survive removal (after the geometry measurements)
    const glowOf = p => p.group.children.find(o => o.isSprite);
    const cashA = spawn('cash', px + 7, pz + 7), cashB = spawn('cash', px + 7.2, pz + 7), health1 = spawn('health', px + 7.4, pz + 7);
    const cashMat = glowOf(cashA).material, cashMat2 = glowOf(cashB).material, healthMat = glowOf(health1).material;
    const mats = { same: cashMat === cashMat2, diff: cashMat !== healthMat, map: !!cashMat.map && cashMat.map === healthMat.map };
    P.remove(cashA); P.remove(cashB);
    const cashNew = spawn('cash', px + 7, pz + 7);
    mats.reused = glowOf(cashNew).material === cashMat;
    P.remove(cashNew); P.remove(health1); P.update(0);

    // ---- double remove is idempotent (missions.js re-removes already collected pickups)
    const armor = spawn('armor', px + 3, pz + 3);
    let threw = false;
    try { P.remove(armor); P.remove(armor); } catch (e) { threw = true; }
    const dbl = { threw, dead: armor.dead, detached: armor.group.parent === null };

    // ---- cached weapon geometry is still shared after a pickup is removed
    const weaponGeo = (p) => { let g = null; p.group.traverse(o => { if (!g && o.isMesh && o.parent && o.parent.name.indexOf('weapon_') === 0) g = o.geometry; }); return g; };
    const w1 = spawn('weapon', px + 3, pz + 3, { weapon: 'pistol', ammo: 10 });
    const geo1 = weaponGeo(w1);
    P.remove(w1);
    const w2 = spawn('weapon', px + 3, pz + 3, { weapon: 'pistol', ammo: 10 });
    const geo2 = weaponGeo(w2);
    P.remove(w2);
    const shared = !!geo1 && geo1 === geo2;

    // ---- respawn reuses cached shapes and does not leak
    const cash = spawn('cash', px + 6, pz + 6, { amount: 10, respawn: 0.05, life: 60 });
    P.collect(cash);
    P.tickRespawn(0.1);
    const resp = P.list.find(q => !q.dead && q.kind === 'cash' && q.x === cash.x && q.z === cash.z);
    const respawnOk = { found: !!resp, inScene: !!resp && resp.group.parent === G.scene };
    if (resp) resp.group.traverse(n => { n.frustumCulled = false; });
    render();
    const respawnGeo = mem();
    if (resp) P.remove(resp);
    render();
    const respawnAfter = mem();
    P.update(0);

    // ---- collect still works and removes the pickup (after the geometry baseline: equipping registers a held-weapon geometry)
    const smg = spawn('weapon', px + 3, pz + 3, { weapon: 'smg' });
    P.collect(smg);
    const smgOk = { has: !!G.player.weapons.smg, dead: smg.dead, detached: smg.group.parent === null };
    P.update(0);

    return { base, before, mid, after, mid2, after2, listA, detachedA, detachedB, mats, dbl, shared, smgOk, respawnOk, respawnGeo, respawnAfter };
  });

  ok('spawn+remove: geometry count returns to warm baseline', r.after === r.base, JSON.stringify({ base: r.base, mid: r.mid, after: r.after }));
  ok('spawn: shared geometries only (no per-pickup allocation)', r.mid - r.base <= 8, JSON.stringify({ base: r.base, mid: r.mid, growth: r.mid - r.base }));
  ok('spawn+remove: no geometry growth on second cycle', r.after2 === r.base, JSON.stringify({ after2: r.after2, base: r.base }));
  ok('remove: pickup list returns to pre-cycle count', r.listA === r.before, JSON.stringify({ before: r.before, after: r.listA }));
  ok('remove: spawned groups detached from scene', r.detachedA && r.detachedB);
  ok('materials: per-colour SpriteMaterial cached (same colour shared, different colour separate, texture reused)', r.mats.same && r.mats.diff && r.mats.map, JSON.stringify(r.mats));
  ok('materials: SpriteMaterial reused after remove', r.mats.reused, JSON.stringify(r.mats));
  ok('remove: double remove is idempotent and does not throw', !r.dbl.threw && r.dbl.dead && r.dbl.detached, JSON.stringify(r.dbl));
  ok('weapon pickup: cached geometry still shared after remove', r.shared);
  ok('collect weapon: gives smg and removes pickup', r.smgOk.has && r.smgOk.dead && r.smgOk.detached, JSON.stringify(r.smgOk));
  ok('respawn: new live cash at same spot', r.respawnOk.found && r.respawnOk.inScene, JSON.stringify(r.respawnOk));
  ok('respawn: rendered pickup reuses cached geometry', r.respawnGeo === r.base, JSON.stringify({ base: r.base, respawn: r.respawnGeo }));
  ok('respawn: no geometry growth after removal', r.respawnAfter === r.base, JSON.stringify({ base: r.base, respawnAfter: r.respawnAfter }));

  c.log(JSON.stringify({ checks, fails }));
  if (fails) throw new Error(fails + ' QA check(s) failed');
};
