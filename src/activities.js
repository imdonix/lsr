// Side activities: spray tags (collectibles), taxi fares, vigilante duty.
import * as THREE from 'three';
import { G } from './state.js';
import { Ped } from './peds.js';
import { DriverAI } from './driverai.js';
import { clamp, dist2, rrange, pick, mulberry32, TAU } from './util.js';

function tagTexture(kind, seed) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const r = mulberry32(seed);
  x.lineCap = 'round'; x.lineJoin = 'round';
  const col = kind === 'rival' ? '#9a4fd0' : '#3fe06a';
  for (let pass = 0; pass < 2; pass++) {
    x.strokeStyle = pass === 0 ? '#111' : col; x.lineWidth = pass === 0 ? 11 : 6;
    x.beginPath();
    let px = 14, py = 70 + r() * 20; x.moveTo(px, py);
    for (let i = 0; i < 7; i++) { px += 14 + r() * 8; py = 30 + r() * 70; x.lineTo(px, py); if (r() < 0.5) x.quadraticCurveTo(px + 6, py - 20 - r() * 18, px + 12, py + 8); }
    x.stroke();
    if (pass === 1) { x.beginPath(); x.moveTo(16, 104); x.lineTo(112, 100); x.stroke(); }
  }
  if (kind === 'rival') { x.fillStyle = 'rgba(255,255,255,0.0)'; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Tags {
  constructor() {
    this.items = []; this.done = new Set();
    const rng = mulberry32(777); const bl = G.world.placement.buildings.filter(b => b.h > 3 && ['house_small', 'house_ranch', 'duplex', 'apartment_low', 'shop_strip', 'liquor_store', 'warehouse', 'warehouse_small', 'garage_shop', 'apartment_mid'].includes(b.type));
    const texR = [0, 1, 2].map(i => tagTexture('rival', 11 + i)), texG = [0, 1, 2].map(i => tagTexture('mine', 50 + i));
    const used = [];
    let tries = 0;
    while (this.items.length < 28 && tries++ < 4000) {
      const b = bl[Math.floor(rng() * bl.length)]; if (!b) break;
      if (Math.abs(b.x) > 950 || Math.abs(b.z) > 950) continue;
      let ok = true; for (const u of used) if (dist2(u.x, u.z, b.x, b.z) < 110 * 110) { ok = false; break; } if (!ok) continue;
      // put it on the front (street) wall
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      const x = b.x + fx * (b.d / 2 + 0.12), z = b.z + fz * (b.d / 2 + 0.12);
      const gy = G.world.groundY(x, z);
      const i = this.items.length;
      const mat = new THREE.MeshBasicMaterial({ map: texR[i % 3], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), mat); m.position.set(x, gy + 1.9, z); m.rotation.y = b.yaw;
      m.userData.tag = i; G.scene.add(m);
      const it = { x, z, y: gy + 1.9, yaw: b.yaw, mesh: m, prog: 0, texG: texG[i % 3], texR: texR[i % 3], done: false, blip: null, nx: fx, nz: fz };
      this.items.push(it); used.push(it);
    }
    this.timeB = 0;
  }
  total() { return this.items.length; }
  count() { return this.done.size; }
  serialize() { return [...this.done]; }
  reset() {
    this.done.clear();
    for (const t of this.items) {
      t.done = false; t.prog = 0; t.mesh.material.map = t.texR; t.mesh.material.needsUpdate = true;
      if (t.blip) { G.blips.remove(t.blip); t.blip = null; }
    }
  }
  deserialize(a) {
    this.reset();
    for (const i of a || []) {
      const t = this.items[i]; if (!t) continue;
      t.done = true; t.mesh.material.map = t.texG; t.mesh.material.needsUpdate = true; this.done.add(i);
    }
  }
  spray(pl, dt) {
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw); let best = null, bd = 4.2;
    for (const t of this.items) { if (t.done) continue; const dx = t.x - pl.x, dz = t.z - pl.z, d = Math.hypot(dx, dz); if (d > bd) continue; if ((dx * fx + dz * fz) / d < 0.4) continue; bd = d; best = t; }
    if (!best) { G.hud.progress('', null); return; }
    best.prog += dt / 2.6;
    G.fx.smoke.emit({ x: pl.x + fx * 0.5, y: pl.y + 1.2, z: pl.z + fz * 0.5, vx: (best.x - pl.x) * 1.2, vy: 0.2, vz: (best.z - pl.z) * 1.2, life: 0.35, s0: 0.12, s1: 0.4, c0: [0.3, 0.9, 0.4, 0.6], c1: [0.3, 0.9, 0.4, 0] });
    G.hud.progress('Spraying…', best.prog);
    if (best.prog >= 1) {
      best.done = true; best.mesh.material.map = best.texG; best.mesh.material.needsUpdate = true;
      this.done.add(this.items.indexOf(best)); pl.stats.tags = this.done.size; pl.addMoney(100); pl.respect += 1; G.audio.play('cash');
      G.hud.notify(`Tag sprayed (${this.done.size}/${this.items.length})`, 'cash'); G.hud.progress('', null);
      if (this.done.size === this.items.length) { pl.addMoney(10000); G.hud.notify('All tags sprayed! +$10,000', 'cash'); }
    }
  }
  update(dt) {
    this.timeB -= dt; if (this.timeB > 0) return; this.timeB = 0.6;
    const pl = G.player;
    for (const t of this.items) {
      const near = !t.done && dist2(pl.x, pl.z, t.x, t.z) < 85 * 85;
      if (near && !t.blip) t.blip = G.blips.add({ x: t.x, z: t.z, color: '#ff4fe0', icon: 'dot', label: 'Gang tag', priority: 0 });
      else if (!near && t.blip) { G.blips.remove(t.blip); t.blip = null; }
    }
    if (pl.weaponId !== 'spraycan') G.hud.progress('', null);
  }
}

// ---------------------------------------------------------------------------------------------------------------
export class Activities {
  constructor() {
    this.doneSet = new Set(); this.mode = null; this.taxi = null; this.vig = null;
    this.nTimer = 0;
    G.events.on('playerExitVehicle', () => { if (this.mode === 'taxi' || this.mode === 'vigilante') this.endDuty('You left the vehicle'); });
  }
  doneCount() { return this.doneSet.size; }
  serialize() { return [...this.doneSet]; }
  deserialize(a) { this.doneSet = new Set(a || []); }
  busyWithStory() { return G.missions && G.missions.active; }

  // -------------------------------------------------- taxi / vigilante duty
  update(dt) {
    if (G.tags) G.tags.update(dt);
    const pl = G.player; const v = pl.vehicle;
    if (!this.busyWithStory()) {
      if (v && v.driver === pl && pl.controlEnabled && G.input.wasPressed('KeyN')) {
        if (v.type === 'taxi') { if (this.mode === 'taxi') this.endDuty('Off duty'); else this.startTaxi(v); }
        else if (v.type === 'police' || v.type === 'swatvan') { if (this.mode === 'vigilante') this.endDuty('Off duty'); else this.startVigilante(v); }
      }
      if (v && v.type === 'taxi' && !this.mode && !this._taxiHint) { this._taxiHint = true; G.hud.notify('Press N to start taxi duty'); }
      if (v && v.type === 'police' && !this.mode && !this._vigHint) { this._vigHint = true; G.hud.notify('Press N to start vigilante duty'); }
    } else if (this.busyWithStory() && this.mode) this.endDuty('');
    if (this.mode === 'taxi') this.updateTaxi(dt);
    if (this.mode === 'vigilante') this.updateVigilante(dt);
  }
  endDuty(msg) {
    const dutyV = (this.vig && this.vig.v) || (this.taxi && this.taxi.v);
    if (this.taxi) { this.taxi.markers.forEach(m => G.markers.remove(m)); if (this.taxi.blip) G.blips.remove(this.taxi.blip); if (this.taxi.ped) { this.taxi.ped.mission = false; if (this.taxi.ped.vehicle) this.taxi.ped.exitVehicle(false); this.taxi.ped.role = 'civ'; this.taxi.ped.setMode('walk'); } this.taxi = null; }
    if (this.vig) { for (const c of this.vig.targets) this.cleanupCriminal(c); this.vig = null; }
    if (this.mode && msg) G.hud.notify(msg); this.mode = null; G.hud.objective(''); G.hud.timer(null); G.hud.counter(null);
    for (const v of [dutyV, G.player.vehicle]) if (v && (v.type === 'police' || v.type === 'swatvan')) v.setSiren(false);
  }
  // session boundary: end any duty, clear its markers/blips/peds, and re-arm the one-time tips
  resetSession() { this.endDuty(''); this._taxiHint = false; this._vigHint = false; }
  startTaxi(v) { this.mode = 'taxi'; this.taxi = { v, state: 'find', fares: 0, earned: 0, markers: [], blip: null, ped: null, t: 0, streak: 0 }; v.setSiren && 0; G.hud.notify('Taxi duty started'); this.newFare(); }
  newFare() {
    const T = this.taxi; const pl = G.player; const pop = G.population;
    const nr = pop.pickRoadSpot(pl.x, pl.z, 120, 420, 14); if (!nr) { T.retry = 2; return; }
    const e = nr.edge; const side = Math.random() < 0.5 ? 1 : -1; const x = nr.x + nr.tz * side * (e.w / 2 + 1.5), z = nr.z - nr.tx * side * (e.w / 2 + 1.5);
    const ped = new Ped({ x, z, role: 'civ', appearance: G.models.peds.randomAppearance(Math.random, { role: Math.random() < 0.3 ? 'business' : 'civ' }) }); ped.mission = true; ped.setMode('idle', 999); G.peds.add(ped);
    T.ped = ped; T.state = 'pickup'; T.fx = x; T.fz = z;
    T.markers.forEach(m => G.markers.remove(m)); T.markers = [G.markers.add({ x, z, radius: 6, color: 0xffd040, vehicleOnly: true, once: false, arrow: true })];
    if (T.blip) G.blips.remove(T.blip); T.blip = G.blips.add({ x, z, color: '#ffd040', icon: 'dot', label: 'Fare', priority: 2 });
    G.hud.objective('Pick up the <b>fare</b>');
  }
  updateTaxi(dt) {
    const T = this.taxi; const pl = G.player; const v = pl.vehicle; if (!v || v !== T.v) return this.endDuty('Off duty');
    if (T.retry > 0) { T.retry -= dt; if (T.retry <= 0) this.newFare(); return; }
    if (T.state === 'pickup') {
      if (Math.hypot(v.x - T.fx, v.z - T.fz) < 7 && v.totalSpeed < 6) {
        const p = T.ped; p.setMode('idle', 999); T.state = 'boarding'; T.bt = 0; p.enterVehicle(v, 1, false);
      }
    } else if (T.state === 'boarding') {
      T.bt += dt; const p = T.ped; if (p.vehicle === v) { T.state = 'drive'; T.t = 0; this.pickDest(); } else if (T.bt > 5) { this.pickDest(true); }
    } else if (T.state === 'drive') {
      T.t += dt; const left = T.limit - T.t; G.hud.timer('Fare', Math.max(0, left));
      if (Math.hypot(v.x - T.dx, v.z - T.dz) < 7 && v.totalSpeed < 7) {
        const fare = Math.floor(30 + T.dist * 0.07 + Math.max(0, left) * 0.5); T.ped.exitVehicle(false); T.ped.mission = false; T.ped.role = 'civ'; T.ped.setMode('walk'); T.ped.path = null;
        pl.addMoney(fare); G.audio.play('cash'); T.fares++; T.streak++; T.earned += fare; G.hud.notify(`Fare delivered: +$${fare}`, 'cash');
        if (T.fares % 5 === 0) { pl.addMoney(500); G.hud.notify('5 fares bonus: +$500', 'cash'); }
        T.markers.forEach(m => G.markers.remove(m)); T.markers = []; if (T.blip) { G.blips.remove(T.blip); T.blip = null; } G.hud.timer(null); T.ped = null; T.retry = 2.5; T.state = 'find';
        if (T.fares >= 8) { this.doneSet.add('taxi'); }
      } else if (left < -10) { T.ped.exitVehicle(false); T.ped.role = 'civ'; T.ped.mission = false; T.ped.flee(pl.x, pl.z, 10); G.hud.notify('The passenger bailed out, too slow!'); T.markers.forEach(m => G.markers.remove(m)); T.markers = []; if (T.blip) G.blips.remove(T.blip); T.blip = null; G.hud.timer(null); T.ped = null; T.retry = 2; T.state = 'find'; T.streak = 0; }
    }
  }
  pickDest(force) {
    const T = this.taxi; const pl = G.player; const v = pl.vehicle;
    let nr = null; for (let i = 0; i < 12 && !nr; i++) { const a = Math.random() * TAU, r = rrange(350, 900); const q = G.map.nearestRoad(clamp(v.x + Math.cos(a) * r, -950, 950), clamp(v.z + Math.sin(a) * r, -950, 950), 40); if (q && G.world.groundY(q.x, q.z) > 0.5) nr = q; }
    if (!nr) nr = G.map.nearestRoad(0, 0, 2000);
    T.dx = nr.x; T.dz = nr.z; T.dist = Math.hypot(nr.x - v.x, nr.z - v.z); T.limit = 22 + T.dist / 17;
    T.markers.forEach(m => G.markers.remove(m)); T.markers = [G.markers.add({ x: nr.x, z: nr.z, radius: 7, color: 0x40ff80, vehicleOnly: true, once: false })];
    if (T.blip) G.blips.remove(T.blip); T.blip = G.blips.add({ x: nr.x, z: nr.z, color: '#40ff80', icon: 'dot', label: 'Destination', priority: 2 });
    G.hud.objective('Take the passenger to the <b>destination</b>');
  }

  cleanupCriminal(c) {
    if (c.blipObj) G.blips.remove(c.blipObj); c.blipObj = null;
    for (const p of (c.criminalPeds || (c.occupants ? c.occupants() : []))) { p.mission = false; p.noDespawn = false; }
    c.criminalPeds = null; c.mission = false; c.criminal = false; c.owner = 'traffic';
    if (c.ai) { if (c.driver && c.driver.isPlayer) c.ai = null; else { c.ai.panicT = 0; c.ai.fleeFrom = null; c.ai.setMode('traffic'); } }
  }
  startVigilante(v) {
    this.mode = 'vigilante'; this.vig = { v, level: 1, targets: [], kills: 0, t: 0, state: 'spawn' }; v.setSiren(true); G.hud.notify('Vigilante duty started');
  }
  spawnCriminals() {
    const V = this.vig; const pl = G.player; const n = 1 + Math.floor(V.level / 2) + (V.level > 3 ? 1 : 0);
    const pop = G.population;
    V.targets = [];
    for (let i = 0; i < n; i++) {
      const nr = pop.pickRoadSpot(pl.x, pl.z, 90, 300, 12); if (!nr) continue;
      const e = nr.edge; const dir = Math.random() < 0.5 ? 1 : -1; const agent = { edge: e, dir, s: dir > 0 ? nr.s : e.len - nr.s, lane: 0, route: null }; G.nav.lanePoint(agent, agent.s, {});
      const p = {}; G.nav.lanePoint(agent, agent.s, p);
      const gang = pick([2, 3, 4]); const car = G.vehicles.spawn(pick(['sedan', 'coupe', 'muscle', 'lowrider']), p.x, p.z, Math.atan2(p.tx, p.tz), { owner: 'mission' }); car.mission = true;
      const d = new Ped({ x: p.x, z: p.z, role: 'gang', gang, appearance: G.models.peds.randomAppearance(Math.random, { gang, role: 'gangster' }) }); d.mission = true; d.give('smg', 200); G.peds.add(d); d.enterVehicle(car, 0, true);
      const p2 = new Ped({ x: p.x, z: p.z, role: 'gang', gang, appearance: G.models.peds.randomAppearance(Math.random, { gang, role: 'gangster' }) }); p2.mission = true; p2.give('pistol', 100); G.peds.add(p2); p2.enterVehicle(car, 1, true);
      car.criminalPeds = [d, p2];
      const ai = new DriverAI(car, 'flee', {}); ai.panicT = 1e9; ai.fleeFrom = { x: pl.x, z: pl.z }; car.ai = ai; car.blipObj = G.blips.add({ x: car.x, z: car.z, color: '#ff3030', icon: 'dot', label: 'Criminal', entity: car, priority: 3 });
      car.criminal = true; V.targets.push(car);
    }
    // transient pickRoadSpot failure: stay in 'spawn' and retry (the spawn timer fires again in ~1.5 s)
    if (!V.targets.length) { V.state = 'spawn'; V.wait = 0; G.hud.objective('Vigilante: looking for criminals…'); G.hud.counter(null); return; }
    V.t = 0; V.state = 'hunt'; G.hud.objective(`Vigilante level ${V.level}: take out <b>${V.targets.length}</b> criminal${V.targets.length > 1 ? 's' : ''}`);
  }
  updateVigilante(dt) {
    const V = this.vig; const pl = G.player; const v = pl.vehicle;
    if (!v || v !== V.v) return this.endDuty('Off duty');
    if (V.state === 'spawn') { V.wait = (V.wait || 0) + dt; if (V.wait > 1.5) { V.wait = 0; this.spawnCriminals(); } return; }
    V.t += dt;
    for (const c of V.targets) { if (c.ai && c.ai.mode === 'flee') { c.ai.fleeFrom = { x: pl.x, z: pl.z }; c.ai.panicT = 99; } }
    // all dead? wrecked, dead driver, or every occupant dead (an empty car counts as cleared, as before)
    const cleared = (c) => c.wrecked || (c.driver && c.driver.dead) || c.occupants().every(p => p.dead);
    const remaining = V.targets.filter(c => !cleared(c));
    G.hud.counter(`Criminals remaining: ${remaining.length}`);
    const done = V.targets.length > 0 && remaining.length === 0;
    if (done) {
      const reward = 400 + V.level * 250; pl.addMoney(reward); G.audio.play('mission_pass'); G.hud.notify(`Level ${V.level} complete: +$${reward}`, 'cash');
      for (const c of V.targets) this.cleanupCriminal(c);
      V.level++; V.state = 'spawn'; V.wait = -1.5; V.targets = []; pl.health = Math.min(pl.maxHealth, pl.health + 20);
      if (V.level > 6) this.doneSet.add('vigilante');
    }
    if (V.t > 140) { G.hud.notify('The criminals got away'); for (const c of V.targets) this.cleanupCriminal(c); V.targets = []; V.state = 'spawn'; V.wait = -1; }
  }
}
