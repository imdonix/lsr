// Ragdoll visual QA: deterministic frames (game paused, sim advanced manually step by step).
// Death pile, get-up sequence, car run-over, and a knocked-about body against a wall.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  await ctx.eval(() => { G.hud.root.style.visibility = 'hidden'; G.missions && G.missions.abortAll && G.missions.abortAll(); QA.clear(); });
  const cx = 420, cz = 740;
  const gy = await ctx.eval((x, z) => { QA.tp(x, z, 0); for (let i = 0; i < 30; i++) G.world.update(0.05, x, z, 30); return G.world.groundY(x, z); }, cx, cz);
  const look = async (x, y, z, a, p, d, f = 42) => ctx.eval((x, y, z, a, p, d, f) => QA.orbit(x, y, z, a, p, d, f), x, y, z, a, p, d, f);

  // ---------------- fresh death (mid-fall) + settled pile
  const pile = await ctx.eval(async (cx, cz) => {
    G.paused = true;
    const a = await QA.ped({ x: cx - 1.4, z: cz + 5, role: 'civ' }); a.die({ dirx: 0.3, dirz: -1 });
    const b = await QA.ped({ x: cx + 1.2, z: cz + 5.6, role: 'civ' }); b.die({ dirx: -0.5, dirz: -1 });
    QA.sim(3.5);
    const c = await QA.ped({ x: cx + 0.2, z: cz + 4.2, role: 'civ' }); c.die({ dirx: 0.1, dirz: -1 });
    QA.sim(0.25);
    const r = [];
    for (const p of [a, b, c]) r.push({ y: +(p.group.position.y - G.world.groundY(p.x, p.z)).toFixed(2), rx: +p.group.rotation.x.toFixed(2), state: p.rag.state });
    window.__pile = [a, b, c];
    return r;
  }, cx, cz);
  console.log('PILE', JSON.stringify(pile));
  await look(cx + 0.3, gy + 0.6, cz + 4.9, 30, 24, 5.2); await ctx.shot('rd1_fall');
  await ctx.eval(() => QA.sim(2.5));
  await look(cx + 0.3, gy + 0.45, cz + 4.9, 30, 30, 5.2); await ctx.shot('rd2_pile_a');
  await look(cx + 0.3, gy + 0.45, cz + 4.9, 150, 30, 5.2); await ctx.shot('rd3_pile_b');

  // ---------------- combat stun get-up strip (frozen frames)
  const stun = await ctx.eval(async (cx, cz) => {
    G.paused = false; QA.clear();
    let p = null, ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      p = await QA.ped({ x: cx - 0.5, z: cz + 3.6, role: 'civ' }); p.health = 1000;
      p.damage(20, { melee: true, knock: true, dirx: 0, dirz: -1, source: G.player, weapon: 'bat' });
      ok = p.ragdollActive(); if (!ok) G.peds.remove(p);
    }
    G.paused = true;
    QA.sim(1.05);                                  // just before the stun timer runs out
    window.__stun = p;
    return { ok, downT: +p.downT.toFixed(2), state: p.rag.state };
  }, cx, cz);
  console.log('STUN', JSON.stringify(stun));
  for (let i = 0; i < 5; i++) {
    await look(cx - 0.5, gy + 0.5, cz + 3.6, 15, 18, 4.4, 46);
    await ctx.shot('rd4_getup_' + i);
    await ctx.eval(() => QA.sim(0.34));
  }

  // ---------------- car run-over, frozen mid-flight (camera follows the body)
  const car = await ctx.eval(async (cx, cz) => {
    G.paused = false; QA.clear();
    const p = await QA.ped({ x: cx, z: cz + 16, role: 'civ' });
    const v = await QA.car('muscle', cx, cz + 34, Math.PI);
    v.vx = 0; v.vz = -24;
    for (let i = 0; i < 240; i++) { game.sim(1 / 60); if (p.ragdollActive()) break; }
    for (let i = 0; i < 8; i++) game.sim(1 / 60);
    G.paused = true;
    window.__carPed = p; window.__car = v;
    return { rag: p.ragdollActive(), dead: p.dead, air: +(p.rag.py[0] - G.world.groundY(p.rag.px[0], p.rag.pz[0])).toFixed(2) };
  }, cx, cz);
  console.log('CAR', JSON.stringify(car));
  const bp = await ctx.eval(() => { const p = window.__carPed; return [p.x, p.rag.py[0] + 0.6, p.z]; });
  await look(bp[0], bp[1], bp[2], 240, 8, 6.5); await ctx.shot('rd5_car_air');
  await ctx.eval(() => QA.sim(2.2));
  const lp = await ctx.eval(() => { const p = window.__carPed; return [p.x, G.world.groundY(p.x, p.z) + 0.5, p.z]; });
  await look(lp[0], lp[1], lp[2], 240, 22, 5.5); await ctx.shot('rd6_car_landed');
  console.log('CAR-LAND', JSON.stringify(await ctx.eval(() => { const p = window.__carPed; return { dead: p.dead, state: p.rag.state, rot: +p.group.rotation.x.toFixed(2), y: +(p.group.position.y - G.world.groundY(p.x, p.z)).toFixed(2) }; })));

  // ---------------- explosion: bodies thrown
  await ctx.eval(async (cx, cz) => {
    G.paused = false; QA.clear();
    for (let i = 0; i < 4; i++) { const q = await QA.ped({ x: cx - 2 + i * 1.4, z: cz + 6 + (i % 2), role: 'civ' }); q.health = 60; }
    G.combat.explode(cx, G.world.groundY(cx, cz + 6.5) + 0.4, cz + 6.5, 5, 300, { source: G.player });
    game.sim(1 / 60); game.sim(0.12);
    G.paused = true;
  }, cx, cz);
  await look(cx, gy + 1.6, cz + 6.5, 330, 12, 9); await ctx.shot('rd7_blast_air');
  await ctx.eval(() => QA.sim(2.5));
  await look(cx, gy + 0.6, cz + 6.5, 330, 22, 8); await ctx.shot('rd8_blast_landed');
  await ctx.eval(() => { G.paused = false; });
};
