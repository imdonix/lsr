// Regression: cullVehicles must collect abandoned player-owned cars (carjacks / mission handovers),
// must keep protected player cars (occupied, lastPlayerVehicle, mission, in range), and must call
// visible(x, y, z) - y is height, z is world Z - not the old swapped (x, z, y).
// node tools/play.js tools/qa_cull_player_cars.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  // Everything setup + measured in one eval: the game loop cannot advance / cull between reads.
  const r = await c.eval(async () => {
    const { Ped } = await import('/src/peds.js');
    const pl = G.player, P = G.population, TAU = Math.PI * 2, out = {};
    const prevLast = G.lastPlayerVehicle, ownVisible = Object.prototype.hasOwnProperty.call(P, 'visible'), prevVisible = P.visible;
    const removeAll = () => { for (const p of G.peds.list.slice()) if (p !== pl) G.peds.remove(p); for (const v of G.vehicles.list.slice()) G.vehicles.remove(v); };
    const spawnCar = (owner, x, z, yaw = 0, type = 'sedan') => {
      const v = G.vehicles.spawn(type, x, z, yaw, { owner });
      v.y = G.world.groundY(v.x, v.z) + v.def.wheelRadius; v.applyTransform();
      return v;
    };
    // road point dist metres from (x,z); minD rejects snaps that came back too close
    const farSpot = (x, z, dist, minD) => {
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * TAU, nr = G.map.nearestRoad(x + Math.cos(a) * dist, z + Math.sin(a) * dist, 80);
        if (nr && Math.hypot(nr.x - x, nr.z - z) >= minD && G.world.groundY(nr.x, nr.z) > 0.5) return nr;
      }
      return null;
    };
    const nearSpot = (x, z, dist) => {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU, nr = G.map.nearestRoad(x + Math.cos(a) * dist, z + Math.sin(a) * dist, 40);
        if (nr && G.world.groundY(nr.x, nr.z) > 0.5) return nr;
      }
      return { x: x + dist, z, y: G.world.groundY(x + dist, z) };
    };
    const inList = v => G.vehicles.list.indexOf(v) >= 0;

    try {
      // ---- A: abandoned player cars + traffic control are culled when the player is far away
      removeAll(); G.lastPlayerVehicle = null;
      const st = QA.findStraight(220) || G.map.nearestRoad(pl.x, pl.z, 400);
      const ax = st ? st.x : pl.x, az = st ? st.z : pl.z, ayaw = st ? st.yaw || 0 : 0;
      game.teleport(ax, az, ayaw);
      const abandoned = [];
      for (let i = 0; i < 10; i++) abandoned.push(spawnCar('player', ax + (i - 4.5) * 5.4, az + (i % 2 ? 4 : 0), ayaw));
      const control = spawnCar('traffic', ax, az + 12, ayaw);
      const far = farSpot(ax, az, 425, 365);
      if (!far) throw new Error('section A: no far road found');
      game.teleport(far.x, far.z, 0);
      const farX = far.x, farZ = far.z;
      P.cullVehicles(farX, farZ); P.cullVehicles(farX, farZ);
      out.a = {
        dist: Math.round(Math.hypot(farX - ax, farZ - az)),
        removed: abandoned.filter(v => !inList(v)).length,
        survivors: abandoned.filter(v => inList(v)).map(v => [Math.round(v.x), Math.round(v.z)]),
        trafficRemoved: !inList(control)
      };

      // ---- B: protected player cars survive the same cull (spawned beyond the ~250 m cull radius)
      const bp = farSpot(farX, farZ, 320, 270);
      if (!bp) throw new Error('section B: no 320 m road found');
      const occupied = spawnCar('player', bp.x, bp.z, 0);
      const homie = new Ped({ x: bp.x + 2, z: bp.z, role: 'civ' });
      G.peds.add(homie); homie.noDespawn = true; homie.enterVehicle(occupied, 0, true);
      const lastCar = spawnCar('player', bp.x + 8, bp.z + 2, 0);
      const missionCar = spawnCar('player', bp.x + 16, bp.z + 4, 0); missionCar.mission = true;
      const np = nearSpot(farX, farZ, 100);
      const nearCar = spawnCar('player', np.x, np.z, 0);
      G.lastPlayerVehicle = lastCar;
      P.cullVehicles(farX, farZ); P.cullVehicles(farX, farZ);
      out.b = {
        dist: Math.round(Math.hypot(bp.x - farX, bp.z - farZ)),
        nearDist: Math.round(Math.hypot(nearCar.x - farX, nearCar.z - farZ)),
        occupiedDriver: occupied.occupants().length === 1 && !!occupied.driver && !occupied.driver.isPlayer,
        occupied: inList(occupied), last: inList(lastCar), mission: inList(missionCar), near: inList(nearCar)
      };
      G.lastPlayerVehicle = prevLast;

      // ---- C: visible() must be called with (x, y, z); the stuck-traffic branch is easiest to trigger
      removeAll();
      const ctrl = spawnCar('traffic', farX + 100, farZ, 0);
      ctrl.ai = { stuckCount: 4 }; ctrl.driver = null;
      const calls = [];
      P.visible = (...args) => { calls.push(args); return true; };
      P.cullVehicles(farX, farZ);
      out.c = {
        calls: calls.map(a => a.slice(0, 4)), kept: inList(ctrl),
        x: ctrl.x, y: ctrl.y, z: ctrl.z, dist: Math.round(Math.hypot(ctrl.x - farX, ctrl.z - farZ))
      };
      removeAll();
    } catch (e) {
      out.error = String(e && e.message || e);
    } finally {
      if (ownVisible) P.visible = prevVisible; else delete P.visible;
      G.lastPlayerVehicle = prevLast;
    }
    out.restored = { hasOwnVisible: Object.prototype.hasOwnProperty.call(P, 'visible'), visibleIsFn: typeof P.visible === 'function', lastOk: G.lastPlayerVehicle === prevLast };
    return out;
  });

  if (r.error) ok('no exceptions in cull setup', false, r.error);
  else {
    ok('A: abandoned player cars are cull-eligible (10/10 removed)', r.a.removed === 10, JSON.stringify(r.a));
    ok('A: far teleport > cull radius', r.a.dist >= 250, JSON.stringify({ dist: r.a.dist }));
    ok('A: traffic control car still culled (existing behaviour)', r.a.trafficRemoved);
    ok('B: protection cars are beyond the cull radius (test is meaningful)', r.b.dist >= 250, JSON.stringify({ dist: r.b.dist }));
    ok('B: occupied player car survives (homies/passengers)', r.b.occupiedDriver && r.b.occupied, JSON.stringify(r.b));
    ok('B: G.lastPlayerVehicle survives', r.b.last);
    ok('B: mission player car survives', r.b.mission);
    ok('B: player car within farR survives', r.b.near && r.b.nearDist < 250, JSON.stringify({ nearDist: r.b.nearDist }));
    const call = r.c.calls[0] || [];
    ok('C: stuck traffic car emitted exactly one visible() call', r.c.calls.length === 1, JSON.stringify(r.c.calls));
    ok('C: visible() called as (x, y, z), not (x, z, y)', call.length >= 3 && call[0] === r.c.x && call[1] === r.c.y && call[2] === r.c.z, JSON.stringify({ got: call, want: [r.c.x, r.c.y, r.c.z] }));
    ok('C: height and world Z differ (swap would be detected)', r.c.y !== r.c.z, JSON.stringify({ y: r.c.y, z: r.c.z }));
    ok('C: stubbed visible() kept the car', r.c.kept);
  }
  ok('cleanup: prototype visible() restored, lastPlayerVehicle restored', r.restored && !r.restored.hasOwnVisible && r.restored.visibleIsFn && r.restored.lastOk, JSON.stringify(r.restored));

  c.log('RESULT ' + JSON.stringify({ checks, fails }));
  if (fails) throw new Error(fails + ' QA check(s) failed');
};
