// Ragdoll QA: death, car run-over and combat stun all end in a physical ragdoll, bodies settle on the ground,
// stunned peds get back up, and nothing goes NaN / leaks the ragdoll budget.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const out = await ctx.eval(async () => {
    const res = {};
    const { Ragdoll } = await import('/src/ragdoll.js');
    const cx = 420, cz = 740;
    QA.tp(cx, cz, 0); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30);
    G.population.pedTarget = 0; G.population.carTarget = 0; G.population.gangTarget = 0; G.police.noWanted = true;

    // ---- 1. death
    const p1 = await QA.ped({ x: cx + 3, z: cz, role: 'civ' });
    p1.die({ dirx: 1, dirz: 0 });
    res.deathStarted = p1.ragdollActive() && p1.rag.state === 'awake';
    QA.sim(0.4);
    const yMid = p1.group.position.y, tilt = p1.group.rotation.x;
    QA.sim(3.0);
    res.deathSettledOnGround = Math.abs(p1.group.position.y - G.world.groundY(p1.group.position.x, p1.group.position.z)) < 0.75;
    res.deathAsleep = p1.rag.state === 'asleep';
    res.deathFell = Math.abs(tilt) > 0.5;
    res.deathGround = { y: +p1.group.position.y.toFixed(2), gy: +G.world.groundY(p1.x, p1.z).toFixed(2) };

    // ---- 2. car run-over
    const p2 = await QA.ped({ x: cx + 40, z: cz, role: 'civ' });
    p2.yaw = -Math.PI / 2;
    const v = await QA.car('sedan', cx + 58, cz, -Math.PI / 2);
    v.vx = -18;
    let hitSeen = false, ragSeen = false, thrown = 0;
    for (let i = 0; i < 60; i++) {
      game.sim(1 / 30);
      if (p2.ragdollActive()) { ragSeen = true; thrown = Math.max(thrown, Math.hypot(p2.rag.px[0] - cx - 40, p2.rag.pz[0] - cz)); }
      if (!p2.alive) hitSeen = true;
      if (p2.ragdollActive() && p2.rag.state !== 'off') hitSeen = true;
    }
    res.carRagdoll = ragSeen; res.carHit = hitSeen; res.carMoved = +thrown.toFixed(2);
    G.vehicles.remove(v);
    QA.sim(2.5);
    res.carSettled = p2.dead ? p2.rag.state === 'asleep' : true;

    // ---- 3. combat stun: force the chance, then check the get-up
    let p3 = null, stunned = false;
    for (let attempt = 0; attempt < 40 && !stunned; attempt++) {
      p3 = await QA.ped({ x: cx - 4, z: cz + 6, role: 'civ' });
      p3.health = 1000;
      p3.damage(20, { melee: true, knock: true, dirx: -1, dirz: 0, source: G.player, weapon: 'bat' });
      stunned = p3.ragdollActive();
      if (!stunned) G.peds.remove(p3);
    }
    res.combatStun = stunned;
    if (stunned) {
      res.stunDownT = +p3.downT.toFixed(2);
      QA.sim(0.5); res.stunLying = p3.ragdollActive();
      QA.sim(4.0);
      res.stoodBackUp = !p3.ragdollActive() && !p3.dead;
      res.getupAction = !!(p3.rig.act && p3.rig.act.name === 'getup') || p3.rig.state !== 'dead';
      res.poseSane = isFinite(p3.x + p3.y + p3.z) && Math.abs(p3.rig.group.rotation.x) < 0.05;
      QA.sim(2.0);
      res.walksAfter = isFinite(p3.x + p3.y + p3.z);
    }

    // ---- 4. budget + cleanup
    const before = Ragdoll.count;
    const bodies = [];
    for (let i = 0; i < 20; i++) { const q = await QA.ped({ x: cx - 20 + i, z: cz + 14, role: 'civ' }); q.health = 1; bodies.push(q); }
    for (const q of bodies) q.damage(50, { dirx: 0, dirz: 1 });
    res.deadCount = bodies.filter(q => q.dead).length;
    res.ragCount = Ragdoll.count;
    res.budgetRespected = Ragdoll.count <= Ragdoll.MAX + 1;         // player not included here
    res.noNaN = QA.nan().length === 0;
    QA.sim(3);
    res.noNaN2 = QA.nan().length === 0;
    res.alivePeds = G.peds.list.filter(q => !q.dead).length;
    const c0 = Ragdoll.count;
    QA.clear();                                                      // dispose → budget released
    res.countReleased = Ragdoll.count < c0 && Ragdoll.count === 0;
    res.before = before;

    // ---- 5. player death ragdoll + respawn cleanup
    const pl = G.player;
    pl.invincible = false;
    pl.die({ dirx: 0, dirz: -1 });
    res.playerRagdoll = pl.ragdollActive();
    QA.sim(1.2);
    res.playerLimp = pl.ragdollActive() && Math.abs(pl.group.rotation.x) > 0.4;
    game.respawn('dead');
    res.playerRespawnOk = !pl.dead && !pl.ragdollActive() && Math.abs(pl.group.rotation.x) < 1e-6 && Math.abs(pl.group.rotation.z) < 1e-6;
    res.playerNoNaN = isFinite(pl.x + pl.y + pl.z);
    pl.invincible = true;

    // ---- 6. player run over → stun ragdoll → gets up
    const pv = await QA.ped({ x: cx + 30, z: cz, role: 'civ' });
    const car2 = await QA.car('van', cx + 42, cz, -Math.PI / 2);
    pl.x = cx + 30; pl.z = cz; pl.y = G.world.groundY(pl.x, pl.z); pl.vx = pl.vz = 0; pl.health = pl.maxHealth;
    car2.vx = -14;
    let playerRag = false;
    for (let i = 0; i < 90; i++) { game.sim(1 / 30); if (pl.ragdollActive()) { playerRag = true; break; } }
    res.playerCarRagdoll = playerRag && !pl.dead;
    QA.sim(6.0);
    res.playerStoodUp = !pl.ragdollActive() && !pl.dead && isFinite(pl.x + pl.y + pl.z);
    G.vehicles.remove(car2); G.peds.remove(pv);

    // ---- 7. get-up lock: a stunned ped must not cover ground while the get-up action still plays
    let p7 = null, ok7 = false;
    for (let i = 0; i < 40 && !ok7; i++) {
      p7 = await QA.ped({ x: cx - 30, z: cz, role: 'civ' }); p7.health = 1000;
      p7.damage(20, { melee: true, knock: true, dirx: 0, dirz: -1, source: G.player, weapon: 'bat' });
      ok7 = p7.ragdollActive(); if (!ok7) G.peds.remove(p7);
    }
    if (ok7) {
      QA.sim(1.4);                                    // stun over, get-up action starts
      const x0 = p7.x, z0 = p7.z;
      QA.sim(0.8);
      res.getupLocked = !!((p7.rig.act && p7.rig.act.name === 'getup') ? Math.hypot(p7.x - x0, p7.z - z0) < 0.6 : true);
      res.getupMoved = +Math.hypot(p7.x - x0, p7.z - z0).toFixed(2);
    }

    // ---- 8. perf: 12 live ragdolls vs baseline sim cost
    QA.clear();
    for (let i = 0; i < 12; i++) { const q = await QA.ped({ x: cx - 6 + i, z: cz + 20, role: 'civ' }); q.die({ dirx: 0, dirz: -1 }); }
    QA.sim(0.2);
    res.perfRags = Ragdoll.count;
    let t0 = performance.now(); for (let i = 0; i < 300; i++) game.sim(1 / 30); const withRag = performance.now() - t0;
    QA.clear();
    t0 = performance.now(); for (let i = 0; i < 300; i++) game.sim(1 / 30); const without = performance.now() - t0;
    res.perfMs = { withRag: +(withRag / 300).toFixed(2), without: +(without / 300).toFixed(2) };
    return res;
  });
  console.log('RAGDOLL QA', JSON.stringify(out, null, 1));

  // ---- visual: a small pile of freshly-killed bodies
  await ctx.eval(async () => {
    QA.clear();
    const cx = 420, cz = 740; QA.tp(cx, cz, 0); for (let i = 0; i < 20; i++) G.world.update(0.05, cx, cz, 30);
    const spots = [[-1, 3, 0.6], [1.4, 4.2, -0.4], [3, 3.2, 0.2], [-2.4, 5, 1.2], [0.4, 6, -1.0]];
    for (const [dx, dz, spin] of spots) { const q = await QA.ped({ x: cx + dx, z: cz + dz, role: 'civ' }); q.die({ dirx: spin, dirz: -1 }); }
    QA.sim(1.6);
    QA.orbit(cx, 0.2, cz + 4, 8, 16, 9, 40);
  });
  await ctx.shot('radgoll_deaths');
  await ctx.eval(() => { const cx = 420, cz = 744; QA.orbit(cx, 0.15, cz, 190, 22, 7, 40); });
  await ctx.shot('radgoll_deaths2');

  // mid-air car hit
  await ctx.eval(async () => {
    QA.clear();
    const cx = 420, cz = 700; QA.tp(cx, cz, 0); for (let i = 0; i < 20; i++) G.world.update(0.05, cx, cz, 30);
    const p = await QA.ped({ x: cx, z: cz + 14, role: 'civ' });
    const v = await QA.car('muscle', cx - 1, cz + 30, Math.PI);
    v.vx = 0; v.vz = -26;
    let t = 0; for (let i = 0; i < 90 && !p.ragdollActive(); i++) { game.sim(1 / 60); t += 1 / 60; }
    for (let i = 0; i < 6; i++) game.sim(1 / 60);
    QA.orbit(p.x, 1.0, p.z, 240, 8, 7, 45);
    window.__hitInfo = { rag: p.ragdollActive(), y: +p.y.toFixed(2), vy: +(p.rag ? p.rag.py[0] : 0).toFixed(2) };
  });
  await ctx.shot('radgoll_carhit');
  console.log('CARHIT', JSON.stringify(await ctx.eval(() => window.__hitInfo)));
};
