// Spawns and despawns ambient traffic, pedestrians, gangs around the player.
import { G } from './state.js';
import { Ped } from './peds.js';
import { Vehicle } from './vehicles.js';
import { DriverAI } from './driverai.js';
import { clamp, dist2, rrange, pick, pickWeighted, TAU, mulberry32 } from './util.js';
import { CLS, ZONE, GANG, edgePointAt } from './mapdata.js';

const CAR_TYPES = [['sedan', 22], ['coupe', 8], ['hatch', 10], ['suv', 10], ['pickup', 9], ['van', 6], ['lowrider', 6], ['muscle', 4], ['sports', 3], ['taxi', 6], ['bus', 2.0], ['truck', 3], ['limo', 0.6], ['motorbike', 2.4]];
const GANG_CARS = ['lowrider', 'sedan', 'coupe', 'muscle'];

export class Population {
  constructor() {
    this.carTarget = 26; this.pedTarget = 40; this.gangTarget = 6;
    this.timer = 0; this.nearR = 55; this.farR = 210;
    this.enabled = true;
    this.density = 1;
    this.parked = [];
    this._rng = mulberry32(99);
  }

  // parked cars are spawned around the map lazily when chunks load; here we just scatter a few near the player
  update(dt) {
    if (!this.enabled) return;
    const pl = G.player; if (!pl) return;
    this.timer -= dt;
    const night = G.sky ? G.sky.night : 0;
    const stars = G.police ? G.police.stars : 0;
    if (this.timer <= 0) {
      this.timer = 0.25;
      const cx = pl.vehicle ? pl.vehicle.x : pl.x, cz = pl.vehicle ? pl.vehicle.z : pl.z;
      this.cullVehicles(cx, cz); this.cullPeds(cx, cz);
      const zone = G.map.zoneAt(cx, cz);
      const hour = G.sky ? G.sky.hour : 12, rush = (hour > 6.5 && hour < 9.5) || (hour > 16 && hour < 19);
      const dens = this.zoneDensity(zone) * this.density * (1 - night * 0.45) * (G.missionDensity ?? 1);
      let carTarget = Math.round(this.carTarget * dens * (pl.vehicle && pl.vehicle.totalSpeed > 25 ? 0.8 : 1) * (rush ? 1.18 : 1));
      // crowds follow the time of day: beaches by day, downtown office crowds at rush hour, empty industrial areas at night, busy clubs / gangs after dark
      let crowd = 1 - night * (zone === ZONE.DOWNTOWN ? 0.15 : zone === ZONE.INDUSTRIAL || zone === ZONE.DOCKS ? 0.6 : 0.35);
      if (zone === ZONE.BEACH) crowd *= 0.45 + 0.85 * (1 - night) * (G.sky && G.sky.rain > 0.3 ? 0.5 : 1);
      if ((zone === ZONE.DOWNTOWN || zone === ZONE.COMMERCIAL) && rush) crowd *= 1.3;
      if (G.sky && G.sky.rain > 0.2) crowd *= 1 - 0.3 * G.sky.rain;
      if (zone === ZONE.INDUSTRIAL || zone === ZONE.DOCKS) crowd *= (hour > 6 && hour < 18) ? 1.3 : 1;
      let pedTarget = Math.round(this.pedTarget * dens * crowd);
      if (G.ambient && G.ambient.enabled) pedTarget = Math.max(Math.round(pedTarget * 0.45), pedTarget - Math.round(G.ambient.sceneCount * 0.7));   // people in ambient scenes stand in for part of the walkers
      // count ambient (scene / event people have their own budgets)
      let cars = 0, peds = 0, gangs = 0;
      for (const v of G.vehicles.list) if (v.owner === 'traffic' && !v.wrecked && !v.amb) cars++;
      for (const p of G.peds.list) { if (p.dead || p.mission || p.vehicle || p.scene || p.evt) continue; if (p.role === 'civ') peds++; else if (p.role === 'gang') gangs++; }
      if (cars < carTarget) this.spawnTraffic(cx, cz, pl);
      if (peds < pedTarget) this.spawnCiv(cx, cz, pl);
      if (gangs < this.gangTarget * this.gangDensity(cx, cz) * (1 + night * 0.9)) this.spawnGang(cx, cz, pl);
    }
  }
  zoneDensity(zone) {
    switch (zone) { case ZONE.DOWNTOWN: return 1.25; case ZONE.COMMERCIAL: return 1.1; case ZONE.RES_LOW: case ZONE.RES_MID: case ZONE.BEACH: return 1.0; case ZONE.RICH: return 0.6; case ZONE.INDUSTRIAL: return 0.55; case ZONE.WILD: return 0.25; case ZONE.AIRPORT: case ZONE.DOCKS: return 0.5; default: return 0.6; }
  }
  gangDensity(x, z) { const g = G.map.gangAt(x, z); return g ? 1 : 0.15; }

  cullVehicles(cx, cz) {
    for (const v of G.vehicles.list.slice()) {
      if (v.owner !== 'traffic' && v.owner !== 'police' && v.owner !== 'parked' && v.owner !== 'player') continue;
      if (v.mission || v.driver && v.driver.isPlayer || v === G.lastPlayerVehicle) continue;
      if (v.owner === 'player' && v.occupants().length) continue;
      const d2 = dist2(v.x, v.z, cx, cz);
      const far = v.owner === 'police' ? 340 : this.farR + 40;
      if (d2 > far * far && !this.visible(v.x, v.y, v.z)) { G.vehicles.remove(v); }
      else if (d2 > 90 * 90 && v.owner === 'traffic' && v.ai && v.ai.stuckCount > 3 && !this.visible(v.x, v.y, v.z)) G.vehicles.remove(v);
    }
  }
  cullPeds(cx, cz) {
    for (const p of G.peds.list.slice()) {
      if (p.isPlayer || p.mission || p.noDespawn) continue;
      if (p.vehicle) continue;
      const d2 = dist2(p.x, p.z, cx, cz);
      if (d2 > 165 * 165 || (p.dead && p.deadT > 15 && d2 > 40 * 40 && !this.visible(p.x, p.y, p.z)) ) G.peds.remove(p);
    }
  }
  // is (x,z) inside (or close to) what the player's camera can see?  maxD = how far ahead counts as visible
  visible(x, y, z, maxD = 150) {
    const cam = G.camera; if (!cam) return false;
    const dx = x - cam.pos.x, dz = z - cam.pos.z; const d = Math.hypot(dx, dz); if (d < 40) return true;
    const f = cam.fwd; const fl = Math.hypot(f.x, f.z) || 1; return (dx * f.x + dz * f.z) / (d * fl || 1) > 0.45 && d < maxD;
  }

  // random point on a road at distance [rmin,rmax] from (cx,cz), preferably out of view
  pickRoadSpot(cx, cz, rmin, rmax, tries = 10, hideR = 110) {
    const map = G.map;
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * TAU, r = rrange(rmin, rmax);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!map.inBounds(x, z, 30)) continue;
      const nr = map.nearestRoad(x, z, 30); if (!nr) continue;
      if (nr.edge.len < 25) continue;
      if (this.visible(nr.x, 0, nr.z, hideR) && Math.hypot(nr.x - cx, nr.z - cz) < hideR) continue;
      if (G.world.groundY(nr.x, nr.z) < 0.3) continue;
      return nr;
    }
    return null;
  }

  spawnTraffic(cx, cz, pl) {
    const nr = this.pickRoadSpot(cx, cz, 80, this.farR, 10, 205); if (!nr) return;
    const e = nr.edge; const nav = G.nav;
    // reject dead-end edges
    const na = G.map.nodes[e.a], nb = G.map.nodes[e.b]; if (na.deg < 2 && nb.deg < 2) return;
    const dir = Math.random() < 0.5 ? 1 : -1; const lane = Math.floor(Math.random() * nav.laneCount(e));
    const agent = { edge: e, dir, s: dir > 0 ? nr.s : e.len - nr.s, lane, route: null };
    nav.lanePoint(agent, agent.s, _lp);
    // spacing vs other vehicles
    for (const v of G.vehicles.list) if (dist2(v.x, v.z, _lp.x, _lp.z) < 11 * 11) return;
    const type = pickWeighted(CAR_TYPES, e => e[1])[0];
    const yaw = Math.atan2(_lp.tx, _lp.tz);
    const v = G.vehicles.spawn(type, _lp.x, _lp.z, yaw, { owner: 'traffic' });
    v.y = G.world.groundY(v.x, v.z) + v.def.wheelRadius; v.applyTransform();
    const app = G.models.peds.randomAppearance(Math.random, { role: type === 'bus' ? 'worker' : 'civ' });
    const d = new Ped({ x: v.x, z: v.z, role: 'civ', appearance: app }); G.peds.add(d);
    d.enterVehicle(v, 0, true);
    d.cash = Math.floor(rrange(20, 150));
    const ai = new DriverAI(v, 'traffic', {}); ai.agent = agent; ai.agent.lane = lane;
    v.speed = 0; const sp = Math.min(e.cls === CLS.FREEWAY ? 24 : 12, 12); v.vx = _lp.tx * sp; v.vz = _lp.tz * sp;
    // passengers sometimes
    if (v.model.seats.length > 1 && Math.random() < 0.2) { const p2 = new Ped({ x: v.x, z: v.z, role: 'civ' }); G.peds.add(p2); p2.enterVehicle(v, 1, true); }
    if (type === 'taxi') v.taxi = true;
    return v;
  }

  spawnCiv(cx, cz, pl) {
    const nr = this.pickRoadSpot(cx, cz, 25, 140, 12, 150); if (!nr) return;
    const e = nr.edge;
    const zone = G.map.zoneAt(nr.x, nr.z);
    if (zone === ZONE.WILD || zone === ZONE.NONE && Math.random() < 0.7) return;
    const side = Math.random() < 0.5 ? 1 : -1; const nx = nr.tz * side, nz = -nr.tx * side;
    const off = e.w / 2 + 1.7 + (Math.random() - 0.5) * 1.2;
    const x = nr.x + nx * off, z = nr.z + nz * off;
    if (G.world.groundY(x, z) < 0.4) return;
    { const q = { x, z }; if (G.world.pushCircle(q, 0.6)) return; }   // not inside a prop / wall
    for (const p of G.peds.list) if (dist2(p.x, p.z, x, z) < 4) return;
    let role = 'civ';
    const night = G.sky ? G.sky.night : 0, hour = G.sky ? G.sky.hour : 12, rush = (hour > 6.5 && hour < 9.5) || (hour > 16 && hour < 19);
    const beachDay = zone === ZONE.BEACH && night < 0.5;
    const look = beachDay && Math.random() < 0.7 ? 'tourist' : zone === ZONE.BEACH && Math.random() < 0.25 ? 'tourist' : zone === ZONE.INDUSTRIAL || zone === ZONE.DOCKS ? (night < 0.5 ? 'worker' : 'civ') : zone === ZONE.DOWNTOWN && Math.random() < (rush ? 0.75 : 0.4) ? 'business' : (zone === ZONE.COMMERCIAL && rush && Math.random() < 0.4) ? 'business' : 'civ';
    const app = G.models.peds.randomAppearance(Math.random, { role: look });
    if (night > 0.6 && look === 'civ' && Math.random() < 0.5) { app.shirtType = Math.random() < 0.6 ? 'hoodie' : 'jacket'; app.shorts = false; }
    const p = new Ped({ x, z, role, appearance: app, yaw: Math.atan2(nr.tx, nr.tz) });
    p.path = { edge: e, dir: Math.random() < 0.5 ? 1 : -1, s: nr.s, side };
    p.walkSpeed = (1.15 + Math.random() * 0.5) * (app.build === 'big' ? 0.92 : app.build === 'slim' ? 1.05 : 1) * (look === 'business' && rush ? 1.3 : 1);
    if (app.hairStyle && (app.hair === 0x8c8c8c || app.hair === 0xd8d8d8 || app.hair === 0x9a9a9a)) p.walkSpeed *= 0.8;   // old people take their time
    G.peds.add(p);
    if (Math.random() < 0.07) p.phoneT = 30;
    // night owls: a wobbling drunk now and then
    if (night > 0.6 && (zone === ZONE.COMMERCIAL || zone === ZONE.DOWNTOWN) && Math.random() < 0.05) p.life = { type: 'drunk', t: rrange(40, 100) };
    return p;
  }

  spawnGang(cx, cz, pl) {
    const map = G.map;
    // pick a point inside gang territory near the player
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU, r = rrange(40, 130);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const g = map.gangAt(x, z); if (!g) continue;
      if (map.roadDistAt(x, z) < 2.5 || map.roadDistAt(x, z) > 18) continue;
      if (this.visible(x, 0, z, 150) && Math.hypot(x - cx, z - cz) < 150) continue;
      if (G.world.groundY(x, z) < 0.5) continue;
      { const q = { x, z }; if (G.world.pushCircle(q, 2.0)) continue; }   // clear ground for the whole group
      const n = 2 + ((Math.random() * 3) | 0);
      const hx = x, hz = z; let grp = null;
      for (let k = 0; k < n; k++) {
        const px = hx + (Math.random() - 0.5) * 5, pz = hz + (Math.random() - 0.5) * 5;
        const app = G.models.peds.randomAppearance(Math.random, { gang: g, role: 'gangster' });
        const p = new Ped({ x: px, z: pz, role: 'gang', gang: g, appearance: app, yaw: Math.random() * TAU, health: 100 });
        p.home = { x: hx, z: hz }; p.mode = 'loiter'; p.modeT = rrange(4, 14);
        (grp || (grp = [])).push(p);
        if (g !== GANG.EMERALD && Math.random() < 0.85) p.give(Math.random() < 0.7 ? 'pistol' : Math.random() < 0.5 ? 'smg' : 'shotgun', 60);
        if (g === GANG.EMERALD && Math.random() < 0.4) p.give('pistol', 40);
        if (Math.random() < 0.3) p.equip('fist');
        G.peds.add(p);
      }
      // hanging out: pairs talk to each other, the odd one is on the phone
      if (grp) for (let i = 0; i + 1 < grp.length; i += 2) {
        const a = grp[i], b = grp[i + 1], t = rrange(30, 90);
        a.life = { type: 'stand', state: 'idle', partner: b, t, face: { x: b.x, z: b.z } }; b.life = { type: 'stand', state: 'idle', partner: a, t, face: { x: a.x, z: a.z } };
        a.yaw = Math.atan2(b.x - a.x, b.z - a.z); b.yaw = Math.atan2(a.x - b.x, a.z - b.z);
      }
      if (grp && grp.length % 2 === 1) { const a = grp[grp.length - 1]; a.life = { type: 'stand', state: Math.random() < 0.5 ? 'phone' : 'idle', t: rrange(20, 70) }; }
      return;
    }
  }

  // parked cars along roads in residential/commercial zones near a location
  seedParked(cx, cz, radius, n) {
    let made = 0;
    for (let i = 0; i < n * 3 && made < n; i++) {
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * radius;
      const nr = G.map.nearestRoad(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 40); if (!nr || nr.edge.cls === CLS.FREEWAY) continue;
      const e = nr.edge; const side = Math.random() < 0.5 ? 1 : -1; const nx = nr.tz * side, nz = -nr.tx * side;
      const off = e.w / 2 - 0.6; const x = nr.x + nx * off, z = nr.z + nz * off;
      if (G.world.groundY(x, z) < 0.5) continue;
      let ok = true; for (const v of G.vehicles.list) if (dist2(v.x, v.z, x, z) < 36) { ok = false; break; } if (!ok) continue;
      const type = pickWeighted(CAR_TYPES.filter(c => c[0] !== 'bus' && c[0] !== 'taxi' && c[0] !== 'motorbike'), e => e[1])[0];
      const v = G.vehicles.spawn(type, x, z, Math.atan2(nr.tx, nr.tz) + (Math.random() < 0.5 ? 0 : Math.PI), { owner: 'parked' });
      made++;
    }
  }
}
const _lp = {};
