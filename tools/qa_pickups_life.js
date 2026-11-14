// Regression: non-persistent pickups expire, respawn copies inherit their kind default, and armor
// plates are not consumed at full armor.
// node tools/play.js tools/qa_pickups_life.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // Everything measured in one synchronous eval: the game loop cannot advance / alter counters between reads.
  const r = await c.eval(() => {
    const P = G.pickups, S = G.scene, R = G.renderer, pl = G.player;
    const live = () => P.list.filter(p => !p.dead);
    const spawn = (kind, x, z, o) => { const p = P.spawn(kind, x, z, o); p.group.traverse(n => { n.frustumCulled = false; }); return p; };
    const removeAll = (arr) => { for (const p of arr) P.remove(p); };
    const px = pl.x, pz = pl.z;
    const baseLive = live().length, baseScene = S.children.length;

    // ---- 1: default lifetimes, spawned far from the player so nothing is collected
    const fx = px + 40, fz = pz + 40;
    const bare = {
      cash: spawn('cash', fx, fz),
      weapon: spawn('weapon', fx + 1, fz, { weapon: 'pistol', ammo: 10 }),
      health: spawn('health', fx + 2, fz),
      armor: spawn('armor', fx + 3, fz),
      star: spawn('star', fx + 4, fz),
      tag: spawn('tag', fx + 5, fz)
    };
    const explicit = spawn('cash', fx + 6, fz, { life: 1e9 });
    const persist = spawn('armor', fx + 7, fz, { persistent: true });
    const batch = [bare.cash, bare.weapon, bare.health, bare.armor, bare.star, bare.tag, explicit, persist];
    const lives = { cash: bare.cash.life, weapon: bare.weapon.life, health: bare.health.life, armor: bare.armor.life, star: bare.star.life, tag: bare.tag.life, explicit: explicit.life, persistent: persist.life };

    // ---- 2: expiry (61 s kills cash/weapon; the rest die by 181 s)
    P.update(61);
    const alive61 = batch.filter(p => !p.dead && p !== explicit && p !== persist);
    const after61Kinds = alive61.map(p => p.kind).sort();
    const after61Ok = alive61.length === 4 && after61Kinds.join(',') === 'armor,health,star,tag';
    const shipped61 = { cash: bare.cash.dead, weapon: bare.weapon.dead, detachedCash: bare.cash.group.parent === null, detachedWeapon: bare.weapon.group.parent === null };
    const scene61 = S.children.length;
    P.update(120);
    const bareDead181 = ['health', 'armor', 'star', 'tag'].every(k => bare[k].dead && bare[k].group.parent === null);
    const list181 = live().length, scene181 = S.children.length;
    removeAll([persist, explicit]);
    const afterCleanup = { live: live().length, scene: S.children.length };

    // ---- 3: expiry removes the attached blip
    const tag = spawn('tag', px + 40, pz + 50);
    const blip = G.blips.add({ x: tag.x, z: tag.z, color: '#ff40a0' });
    tag.blip = blip;
    P.update(181);
    const blipOk = { dead: tag.dead, removed: G.blips.list.indexOf(blip) < 0, detached: tag.group.parent === null };

    // ---- 4: 100 pickups are drawn, then all expire back to the baseline
    const mx = px + 30, mz = pz + 30, my = G.world.groundY(mx, mz);
    G.cam.position.set(mx + 0.5, my + 3, mz + 8);
    G.cam.lookAt(mx, my + 1, mz);
    G.cam.updateMatrixWorld();
    game.renderFrame(0.016);
    const baseCalls = R.info.render.calls, baseLiveM = live().length, baseSceneM = S.children.length;
    const mass = [];
    for (let i = 0; i < 100; i++) mass.push(spawn('armor', mx, mz));
    game.renderFrame(0.016);
    const massCalls = R.info.render.calls, massLive = live().length;
    P.update(181);
    game.renderFrame(0.016);
    const afterCalls = R.info.render.calls;
    const massOk = { dead: mass.every(p => p.dead), live: live().length, scene: S.children.length, calls: afterCalls };

    // ---- 5: respawn copies inherit the kind default (or stay persistent)
    const rx = px + 70, rz = pz + 70;
    const cash = spawn('cash', rx, rz, { amount: 10, respawn: 0.05 });
    P.collect(cash); P.tickRespawn(0.1);
    const rCash = P.list.find(q => !q.dead && q.kind === 'cash' && q.x === rx && q.z === rz);
    pl.armor = 0;
    const armor = spawn('armor', rx + 2, rz, { respawn: 0.05 });
    P.collect(armor); P.tickRespawn(0.1);
    const rArmor = P.list.find(q => !q.dead && q.kind === 'armor' && q.x === rx + 2 && q.z === rz);
    pl.armor = 0;
    const plate = spawn('armor', rx + 4, rz, { persistent: true, respawn: 0.05 });
    P.collect(plate); P.tickRespawn(0.1);
    const rPlate = P.list.find(q => !q.dead && q.kind === 'armor' && q.x === rx + 4 && q.z === rz);
    const respawnOk = {
      cash: !!rCash && rCash.life === 60 && !rCash.persistent,
      armor: !!rArmor && rArmor.life === 180 && !rArmor.persistent,
      plate: !!rPlate && rPlate.persistent === true && rPlate.life > 1e8,
      cashLife: rCash && rCash.life, armorLife: rArmor && rArmor.life, plateLife: rPlate && rPlate.life
    };
    removeAll([rCash, rArmor, rPlate].filter(Boolean));

    // ---- 6: full armor is not consumed; the existing health rule is unchanged
    pl.armor = 100;
    const plateFull = spawn('armor', pl.x, pl.z, { y: pl.y + 0.75 });
    P.update(0.1);
    const fullArmorOk = { alive: !plateFull.dead, armor: pl.armor };
    P.remove(plateFull);
    pl.armor = 0;
    const plateEmpty = spawn('armor', pl.x, pl.z, { y: pl.y + 0.75 });
    P.update(0.1);
    const emptyArmorOk = { dead: plateEmpty.dead, armor: pl.armor };
    pl.health = pl.maxHealth;
    const healthFull = spawn('health', pl.x, pl.z, { y: pl.y + 0.75 });
    P.update(0.1);
    const fullHealthOk = { alive: !healthFull.dead };
    P.remove(healthFull);
    pl.health = 0;
    const healthEmpty = spawn('health', pl.x, pl.z, { y: pl.y + 0.75 });
    P.update(0.1);
    const emptyHealthOk = { dead: healthEmpty.dead, health: pl.health };

    // ---- 7: final cleanliness
    const finalOk = { live: live().length, scene: S.children.length };

    return {
      baseLive, baseScene, maxHealth: pl.maxHealth, lives, after61Ok, after61Kinds, shipped61, scene61,
      bareDead181, list181, scene181, afterCleanup, blipOk, baseCalls, massCalls, massLive, baseLiveM,
      baseSceneM, massOk, respawnOk, fullArmorOk, emptyArmorOk, fullHealthOk, emptyHealthOk, finalOk
    };
  });

  ok('defaults: cash and non-temp weapon live 60 s', r.lives.cash === 60 && r.lives.weapon === 60, JSON.stringify(r.lives));
  ok('defaults: health/armor/star/tag live 180 s', r.lives.health === 180 && r.lives.armor === 180 && r.lives.star === 180 && r.lives.tag === 180, JSON.stringify(r.lives));
  ok('defaults: explicit life honoured and persistent defaults to immortal', r.lives.explicit === 1e9 && r.lives.persistent === 1e9, JSON.stringify(r.lives));
  ok('expiry: after 61 s only health/armor/star/tag of the batch remain', r.after61Ok, JSON.stringify(r.after61Kinds));
  ok('expiry: cash and weapon removed and detached at 61 s', r.shipped61.cash && r.shipped61.weapon && r.shipped61.detachedCash && r.shipped61.detachedWeapon, JSON.stringify(r.shipped61));
  ok('expiry: after 181 s every bare kind is gone and detached', r.bareDead181);
  ok('expiry: live list and scene return to baseline + the 2 immortal pickups', r.list181 === r.baseLive + 2 && r.scene181 === r.baseScene + 2, JSON.stringify({ live: r.list181, scene: r.scene181, baseLive: r.baseLive, baseScene: r.baseScene }));
  ok('expiry: removing the immortal pair restores the baseline', r.afterCleanup.live === r.baseLive && r.afterCleanup.scene === r.baseScene, JSON.stringify(r.afterCleanup));
  ok('blip: an expiring tag drops its blip', r.blipOk.dead && r.blipOk.removed && r.blipOk.detached, JSON.stringify(r.blipOk));
  ok('mass: 100 armor pickups are drawn', r.massLive === r.baseLiveM + 100 && r.massCalls - r.baseCalls >= 150, JSON.stringify({ live: r.massLive, calls: r.massCalls, base: r.baseCalls }));
  ok('mass: 100 pickups all expire and detach', r.massOk.dead, JSON.stringify(r.massOk));
  ok('mass: live list and scene return to the pre-spawn baseline', r.massOk.live === r.baseLiveM && r.massOk.scene === r.baseSceneM, JSON.stringify(r.massOk));
  ok('mass: draw calls return to the baseline', Math.abs(r.massOk.calls - r.baseCalls) <= 2, JSON.stringify({ base: r.baseCalls, after: r.massOk.calls }));
  ok('respawn: generic cash inherits 60 s and is not persistent', r.respawnOk.cash, JSON.stringify(r.respawnOk));
  ok('respawn: generic armor inherits 180 s', r.respawnOk.armor, JSON.stringify(r.respawnOk));
  ok('respawn: persistent armor stays immortal', r.respawnOk.plate, JSON.stringify(r.respawnOk));
  ok('armor: full armor is not consumed', r.fullArmorOk.alive && r.fullArmorOk.armor === 100, JSON.stringify(r.fullArmorOk));
  ok('armor: empty armor is collected', r.emptyArmorOk.dead && r.emptyArmorOk.armor === 100, JSON.stringify(r.emptyArmorOk));
  ok('health: full health is not consumed', r.fullHealthOk.alive, JSON.stringify(r.fullHealthOk));
  ok('health: empty health is collected', r.emptyHealthOk.dead && r.emptyHealthOk.health === r.maxHealth, JSON.stringify(r.emptyHealthOk));
  ok('final: live list and scene are back at the starting baseline', r.finalOk.live === r.baseLive && r.finalOk.scene === r.baseScene, JSON.stringify({ ...r.finalOk, baseLive: r.baseLive, baseScene: r.baseScene }));

  c.log(JSON.stringify({ checks, fails }));
  if (fails) throw new Error(fails + ' QA check(s) failed');
};
