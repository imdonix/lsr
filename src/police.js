// Wanted level, police response (cars, cops, roadblocks, SWAT, helicopter), arrests.
import * as THREE from 'three';
import { G } from './state.js';
import { Ped } from './peds.js';
import { DriverAI } from './driverai.js';
import { clamp, dist2, rrange, TAU, wrapAngle, lerp, damp, dampAngle } from './util.js';
import { CLS } from './mapdata.js';

export class Police {
  constructor() {
    this.stars = 0; this.maxStars = 6;
    this.hideT = 0; this.seenNow = false; this.lastCrimeT = -99; this.spawnT = 0;
    this.playerArmedRecently = false; this.armedT = 0; this.killsRecent = 0; this.killTimer = 0;
    this.arrestT = 0; this.cars = []; this.heli = null; this.roadblocks = []; this.enabled = true;
    this.heliShootT = 0; this.cooldown = 0; this.noWanted = false; this.checkT = 0;
    this.fbi = false; this.swatT = 0; this.rbT = 0;
    this._calm = false; this._held = null;   // cutscene hold: chasers parked until the scene ends
  }
  get wanted() { return this.stars > 0; }

  raise(n, reason = '', min = 0) {
    if (this.noWanted || !this.enabled) return;
    const pl = G.player; if (!pl || pl.dead) return;
    const old = this.stars;
    const now = G.time;
    const T = this._crimeT || (this._crimeT = {});
    let stars = clamp(Math.max(old, min) + (old >= min ? n : 0), 0, this.maxStars);
    // Rate limit: each offence type can add a star at most every 8 s and any star gain at
    // most every 5 s, so a scrape, a burst of hits or a chain of crime hooks on one contact
    // can never jump straight to high heat. The guaranteed level (min) of a serious crime
    // still applies while limited (e.g. killing a cop is always worth 2 stars).
    if (stars > old && ((reason && now - (T[reason] ?? -99) < 8) || now - (T._any ?? -99) < 5)) stars = Math.max(old, min);
    this.stars = stars;
    this.lastCrimeT = now; this.hideT = 0;
    if (this.stars > old) {
      T._any = now; if (reason) T[reason] = now;
      G.audio && G.audio.play('wanted_up');
      G.hud && G.hud.setWanted(this.stars, true);
      G.events.emit('wantedChanged', this.stars, old);
    }
  }
  setStars(n) { const old = this.stars; this.stars = clamp(n, 0, 6); if (this.stars === 0) this.cleanup(); G.hud && G.hud.setWanted(this.stars, this.stars > old); G.events.emit('wantedChanged', this.stars, old); this.hideT = 0; }
  clear() { this.setStars(0); }

  cops() { return G.peds.list.filter(p => !p.dead && (p.role === 'cop' || p.role === 'swat')); }
  witnessed(x, z, rc = 62, rv = 24) {
    for (const p of G.peds.list) {
      if (p.dead || p.isPlayer) continue;
      if ((p.role === 'cop' || p.role === 'swat') && dist2(p.x, p.z, x, z) < rc * rc) return true;
    }
    for (const v of G.vehicles.list) if ((v.type === 'police' || v.type === 'swatvan') && v.driver && dist2(v.x, v.z, x, z) < rc * rc) return true;
    let civ = 0;
    for (const p of G.peds.list) if (!p.dead && !p.isPlayer && (p.role === 'civ') && dist2(p.x, p.z, x, z) < rv * rv && p.mode !== 'flee') civ++;
    return civ > 0 && Math.random() < 0.55;
  }

  // ---- crime hooks
  onShot(shooter, W, x, z) {
    if (!shooter || !shooter.isPlayer) return;
    this.armedT = 12;
    if ((W.noise || 0) > 20 && this.witnessedByCop(x, z, 40)) this.raise(this.stars === 0 ? 1 : 0, 'shots', 1);
  }
  witnessedByCop(x, z, r) {
    for (const p of G.peds.list) if (!p.dead && (p.role === 'cop' || p.role === 'swat') && dist2(p.x, p.z, x, z) < r * r) return true;
    for (const v of G.vehicles.list) if ((v.type === 'police' || v.type === 'swatvan') && v.driver && dist2(v.x, v.z, x, z) < r * r) return true;
    return false;
  }
  onPedKilled(ped, info) {
    const s = info && info.source; if (!s) return;
    const byPlayer = s.isPlayer || (s.vehicle && s.vehicle.driver && s.vehicle.driver.isPlayer);
    if (!byPlayer) return;
    G.player.stats.kills++;
    if (info.headshot) G.player.stats.headshots++;
    if (ped.role === 'cop' || ped.role === 'swat') {
      G.player.stats.copKills++;
      this.raise(1, 'cop kill', 2);
      if (this.stars < 3 && G.player.stats.copKills % 2 === 0) this.raise(1);
    } else if (ped.role === 'civ' || ped.role === 'medic' || ped.role === 'worker') {
      this.killsRecent++; this.killTimer = 25;
      if (this.witnessed(ped.x, ped.z)) this.raise(1, 'murder', this.killsRecent >= 3 ? 2 : 1);
    } else if (ped.role === 'gang' && !ped.hostile && ped.aggroT <= 0 && ped.gang === 1) {
      if (this.witnessed(ped.x, ped.z, 50, 14)) this.raise(1, 'murder', 1);
    }
  }
  // hurting an officer: 1 star, escalating while it continues (raise() rate-limits repeats)
  onAttackCop(cop, src) { if (src && src.isPlayer) this.raise(1, 'assault on officer', 1); }
  onCarTheft(v) { if (this.witnessedByCop(v.x, v.z, 40)) this.raise(1, 'grand theft auto', 1); }
  onCarjack(v, d) { if (this.witnessed(v.x, v.z, 45, 14)) this.raise(1, 'carjacking', 1); }
  onRunOver(ped, v) { if (ped.role === 'cop' || ped.role === 'swat') { this.raise(1, 'hit cop', 1); return; } if (this.witnessedByCop(ped.x, ped.z, 55)) this.raise(1, 'vehicular assault', 1); }
  // bumping police gets their attention (1 star); it does not escalate a chase that is already on
  onPlayerCrash(v, other, speed) { if (other && (other.type === 'police' || other.type === 'swatvan') && speed > 5) this.raise(0, 'police collision', 1); }
  onExplosion(x, z, src) { if (src && (src.isPlayer || (src.vehicle && src.vehicle.driver && src.vehicle.driver.isPlayer)) && this.witnessed(x, z, 70, 40)) this.raise(1, 'explosion', 2); }
  arrestAttempt(cop, dt) {
    const pl = G.player; if (pl.dead || this.stars > 2 || (G.game && G.game.inCutscene)) return;
    if (pl.vehicle && pl.vehicle.totalSpeed > 4) return;
    this.arrestT += dt * 2.3;
    if (this.arrestT > 1.8) { this.arrestT = 0; G.game.onPlayerBusted(); }
  }

  cleanup() {
    for (const v of G.vehicles.list.slice()) if (v.owner === 'police' && !v.mission && !v.isHeli) { v.ai && (v.ai.setMode('traffic')); v.owner = 'traffic'; if (v.driver && v.driver.role === 'cop') { /* stay as traffic cop car */ } }
    for (const p of G.peds.list) if ((p.role === 'cop' || p.role === 'swat') && !p.vehicle && !p.mission) { p.noDespawn = false; }
    if (this.heli) { const hv = this.heli.v; if (G.vehicles.list.includes(hv)) { this.heli.leave = true; hv.setSiren(false); } else { this.heli.audio && this.heli.audio.stop(); this.heli = null; } }
    for (const r of this.roadblocks) {
      r.done = true;
      for (const c of r.cars) if (G.vehicles.list.includes(c) && !c.driver) { if (G.population.visible(c.x, c.y, c.z)) { c.owner = 'parked'; c.siren && c.setSiren(false); c.noAI = false; } else G.vehicles.remove(c); }
      for (const c of r.cops) { c.rbCop = false; c.noDespawn = false; }
    }
    this.roadblocks = [];
    this.arrestT = 0;
  }

  // ---- cutscene hold: while a scripted scene runs the police keep the streets but stop attacking.
  // Chase cars park (handbrake) and their state is remembered; on-foot cops freeze and drop target.
  hold() {
    this._held = [];
    for (const v of G.vehicles.list) {
      const ai = v.ai, d = v.driver;
      if (!ai || !d || d.isPlayer || v.mission || v.wrecked || v.exploded) continue;
      if (ai.mode !== 'chase' || (d.role !== 'cop' && d.role !== 'swat')) continue;
      this._held.push({ v, target: ai.target, pursuitSpeed: ai.pursuitSpeed, ramTarget: ai.ramTarget, stopDist: ai.stopDist });
      ai.setMode('idle'); v.input.handbrake = true;
    }
    for (const p of G.peds.list) {
      if (p.dead || p.isPlayer || p.vehicle || !(p.role === 'cop' || p.role === 'swat')) continue;
      p.aiming = false; p.target = null; p.move.x = p.move.z = 0; p.speedTarget = 0;
    }
    this.arrestT = 0;
  }
  resume() {
    const held = this._held; this._held = null;
    if (!held || this.stars <= 0) return;   // heat cleared during the scene: nothing to resume
    for (const h of held) {
      const v = h.v; if (!G.vehicles.list.includes(v) || v.wrecked || v.exploded || !v.ai) continue;
      const d = v.driver; if (!d || (d.role !== 'cop' && d.role !== 'swat')) continue;
      v.ai.setMode('chase', { target: h.target || G.player.vehicle || G.player, stopDist: h.stopDist ?? 7, pursuitSpeed: h.pursuitSpeed, ramTarget: !!h.ramTarget });
      v.setSiren(true);
    }
  }

  // ---- update
  update(dt) {
    const pl = G.player; if (!pl) return;
    // scripted cutscenes put the police on hold: no attacks, arrests or fresh units while the camera runs
    const cut = !!(G.game && G.game.inCutscene);
    if (cut !== this._calm) { this._calm = cut; if (cut) this.hold(); else this.resume(); }
    if (cut) { this.updateHeli(dt); return; }
    if (this.pendingPax && this.pendingPax.length) {
      const q = this.pendingPax.shift();
      if (G.vehicles.list.includes(q.v) && !q.v.wrecked && !q.v.seatPeds[q.i] && this.stars > 0) {
        const p = new Ped({ x: q.v.x, z: q.v.z, role: q.role, appearance: G.models.peds.randomAppearance(Math.random, { role: q.role }) }); p.noDespawn = true;
        p.give(q.type === 'swatvan' ? 'ak47' : (this.stars >= 4 ? 'smg' : 'pistol'), 300, true); G.peds.add(p); p.enterVehicle(q.v, q.i, true);
      }
    }
    this.killTimer -= dt; if (this.killTimer <= 0) this.killsRecent = 0;
    this.armedT -= dt; this.playerArmedRecently = this.armedT > 0;
    if (pl.dead) { return; }
    if (this.stars > 0) {
      this.updateSeen(dt);
      this.updateSpawns(dt);
      this.updateHeli(dt);
      this.updateRoadblocks(dt);
      this.updateCops(dt);
      // decay
      const limit = 14 + this.stars * 4;
      if (!this.seenNow) { this.hideT += dt; if (this.hideT > limit) { this.hideT = 0; this.setStars(this.stars - 1); G.hud && G.hud.notify(this.stars === 0 ? 'Wanted level lost' : 'Wanted level dropping'); } }
      else this.hideT = Math.max(0, this.hideT - dt * 0.5);
      if (this.arrestT > 0) this.arrestT = Math.max(0, this.arrestT - dt * 1.5);
    } else { this.seenNow = false; this.updateCops(dt); if (this.heli) this.updateHeli(dt); }
    // police in traffic mode: parked/ambient cop cars patrol
  }

  updateSeen(dt) {
    this.checkT -= dt; if (this.checkT > 0) return; this.checkT = 0.4;
    const pl = G.player; let seen = false;
    const px = pl.vehicle ? pl.vehicle.x : pl.x, pz = pl.vehicle ? pl.vehicle.z : pl.z;
    const R = 55 + this.stars * 8;
    for (const p of G.peds.list) {
      if (p.dead || !(p.role === 'cop' || p.role === 'swat')) continue;
      const d2 = dist2(p.x, p.z, px, pz); if (d2 > R * R) continue;
      if (!G.world.raycast(p.x, p.z, px, pz, p.y + 1.4, pl.y + 1.2)) { seen = true; break; }
    }
    if (!seen && this.heli && this.heli.v && !this.heli.leave && dist2(this.heli.v.x, this.heli.v.z, px, pz) < 140 * 140 && !G.world.raycast(this.heli.v.x, this.heli.v.z, px, pz, this.heli.v.y - 2, pl.y + 1.2)) seen = true;   // the helicopter needs a clear line too (tall buildings / cover hide you)
    this.seenNow = seen;
    G.hud && G.hud.setPoliceSeen(seen);
  }

  targetCars() { return [0, 1, 2, 3, 5, 6, 7][this.stars]; }

  updateSpawns(dt) {
    this.spawnT -= dt; if (this.spawnT > 0) return; this.spawnT = 1.4;
    const pl = G.player; const ref = pl.vehicle || pl;
    // count active chasers: cars with a cop at the wheel + (half of) the cops chasing on foot
    let n = 0, foot = 0;
    for (const v of G.vehicles.list) {
      if (v.owner !== 'police' || v.wrecked || v.isHeli || v.noAI) continue;
      const d2 = dist2(v.x, v.z, ref.x, ref.z);
      if (v.driver && v.driver.role !== 'player' && (v.driver.role === 'cop' || v.driver.role === 'swat') && !v.driver.dead) {
        n++; v.abandonT = 0;
        if (v.ai && v.ai.mode !== 'chase' && !v.mission) v.ai.setMode('chase', { target: ref });
        if (v.ai) v.ai.target = ref;
        if (d2 > 380 * 380) G.vehicles.remove(v);
      } else if (!v.driver && !v.mission) {
        // abandoned cop car (cops got out): clear it once it is far enough / out of view so the scene does not fill with empty cruisers
        v.abandonT = (v.abandonT || 0) + 1.4;
        if (v.abandonT > 20 && d2 > 45 * 45 && !G.population.visible(v.x, v.y, v.z)) G.vehicles.remove(v);
        else if (v.abandonT > 90 && d2 > 25 * 25) G.vehicles.remove(v);
      }
    }
    for (const p of G.peds.list.slice()) {
      if (p.dead || p.vehicle || !(p.role === 'cop' || p.role === 'swat') || p.mission || p.rbCop) continue;
      const d2 = dist2(p.x, p.z, ref.x, ref.z);
      if (d2 < 140 * 140) foot++;
      else if (d2 > 230 * 230 && !G.population.visible(p.x, p.y, p.z)) G.peds.remove(p);   // left far behind by the chase
    }
    n += Math.floor(foot / 2);
    if (n < this.targetCars() && this.stars > 0) {
      const spot = G.population.pickRoadSpot(ref.x, ref.z, 110, 230, 12, 160); if (!spot) return;
      this.spawnPoliceCar(spot, ref, this.stars >= 4 && Math.random() < 0.3 ? 'swatvan' : 'police');
    }
  }

  spawnPoliceCar(spot, ref, type = 'police') {
    const e = spot.edge; const nav = G.nav;
    const dir = ((ref.x - spot.x) * spot.tx + (ref.z - spot.z) * spot.tz) > 0 ? 1 : -1; // facing the player
    const agent = { edge: e, dir, s: dir > 0 ? spot.s : e.len - spot.s, lane: 0, route: null };
    nav.lanePoint(agent, agent.s, _sp);
    for (const v of G.vehicles.list) if (dist2(v.x, v.z, _sp.x, _sp.z) < 10 * 10) return null;
    const color = (this.stars >= 5 && type === 'police' && this.fbi) ? 0x111114 : undefined;
    const v = G.vehicles.spawn(type, _sp.x, _sp.z, Math.atan2(_sp.tx, _sp.tz), { owner: 'police', color: type === 'police' ? 0xeeeeee : 0x1a1a1e });
    const role = type === 'swatvan' ? 'swat' : 'cop';
    const app = G.models.peds.randomAppearance(Math.random, { role });
    const d = new Ped({ x: v.x, z: v.z, role, appearance: app }); G.peds.add(d); d.noDespawn = true;
    d.give(this.stars >= 4 || type === 'swatvan' ? 'smg' : 'pistol', 300, true); if (this.stars >= 5 || type === 'swatvan') d.give('ak47', 300, true);
    d.enterVehicle(v, 0, true);
    const ai = new DriverAI(v, 'chase', { target: ref, aggressive: true, ignoreLights: true, stopDist: 7 }); ai.pursuitSpeed = 34 + this.stars * 2.5; ai.ramTarget = this.stars >= 3;
    v.vx = _sp.tx * 14; v.vz = _sp.tz * 14;
    v.setSiren(true);
    // passenger cops at 3+ stars
    const seats = v.model.seats.length;
    const extra = type === 'swatvan' ? 3 : (this.stars >= 3 ? 1 : 0);
    // passengers are created one per frame afterwards (building a ped rig costs a few ms; avoids a frame hitch)
    for (let i = 1; i <= extra && i < seats; i++) (this.pendingPax || (this.pendingPax = [])).push({ v, role, i, type });
    return v;
  }

  // on-foot cops: driver/passengers exit when near the player on foot or when the car is stuck/stopped near
  updateCops(dt) {
    const pl = G.player;
    if (this.stars <= 0) return;
    for (const v of G.vehicles.list) {
      if (v.owner !== 'police' || !v.driver || v.wrecked) continue;
      const d = Math.hypot(v.x - pl.x, v.z - pl.z);
      const plVeh = pl.vehicle;
      const exit = (!plVeh && d < 26 && v.totalSpeed < 8) || (plVeh && d < 12 && v.totalSpeed < 1.5 && plVeh.totalSpeed < 2) || (v.ai && v.ai.stuckCount > 3 && d < 60 && v.totalSpeed < 1);
      if (exit) { for (const p of v.occupants()) { if (p.role === 'cop' || p.role === 'swat') { if (p === v.driver) { v.ai && (v.ai.mode = 'idle'); v.input.handbrake = true; } p.exitVehicle(false); p.noDespawn = true; p.mode = 'chase'; } } }
    }
  }

  updateRoadblocks(dt) {
    this.rbT -= dt; if (this.rbT > 0 || this.stars < 3) return; this.rbT = 9;
    const pl = G.player; const ref = pl.vehicle || pl;
    // roadblocks the player has left far behind are dismantled (cars would otherwise block the road network for the rest of the session)
    for (const r of this.roadblocks) if (!r.done && dist2(r.x, r.z, ref.x, ref.z) > 300 * 300 && !G.population.visible(r.x, 0, r.z)) {
      r.done = true; for (const c of r.cars) if (G.vehicles.list.includes(c) && !c.driver) G.vehicles.remove(c); for (const c of r.cops) if (G.peds.list.includes(c)) G.peds.remove(c);
    }
    this.roadblocks = this.roadblocks.filter(r => !r.done);
    if (!pl.vehicle || pl.vehicle.totalSpeed < 8) return;
    if (this.roadblocks.length >= (this.stars >= 4 ? 2 : 1)) { this.roadblocks = this.roadblocks.filter(r => !r.done); if (this.roadblocks.length >= 2) return; }
    const v = pl.vehicle; const sp = v.totalSpeed; const fx = v.vx / sp, fz = v.vz / sp;
    const nr = G.map.nearestRoad(v.x + fx * 170, v.z + fz * 170, 40); if (!nr) return;
    if (dist2(nr.x, nr.z, v.x, v.z) < 110 * 110) return;
    const e = nr.edge; const yaw = Math.atan2(nr.tx, nr.tz);
    const rb = { cars: [], cops: [], done: false, x: nr.x, z: nr.z };
    // two cars across the road
    for (const off of [-e.w * 0.22, e.w * 0.22]) {
      const cx = nr.x + nr.tz * off, cz = nr.z - nr.tx * off;
      const c = G.vehicles.spawn('police', cx, cz, yaw + Math.PI / 2 + (Math.random() - 0.5) * 0.3, { owner: 'police', color: 0xeeeeee }); c.setSiren(true); c.input.handbrake = true; c.wake(); rb.cars.push(c); c.mission = false; c.sleeping = true; c.noAI = true;
      const cop = new Ped({ x: cx + nr.tx * 3, z: cz + nr.tz * 3, role: 'cop', appearance: G.models.peds.randomAppearance(Math.random, { role: 'cop' }) }); cop.noDespawn = true; cop.rbCop = true; cop.give('pistol', 200); if (this.stars >= 4) cop.give('shotgun', 100); G.peds.add(cop); rb.cops.push(cop);
    }
    this.roadblocks.push(rb);
  }

  updateHeli(dt) {
    const pl = G.player; const ref = pl.vehicle || pl;
    if (this.stars >= 4 && !this.heli && !this._calm) {
      const ang = Math.random() * TAU; const x = ref.x + Math.cos(ang) * 200, z = ref.z + Math.sin(ang) * 200;
      const v = G.vehicles.spawn('policeheli', x, z, 0, { owner: 'police' });
      v.y = G.world.groundY(x, z) + 50; v.def = v.def; v.isHeli = true; v.noDamage = false; v.sleeping = false;
      v.setSiren(true);
      const audioH = G.audio && G.audio.loop('heli_rotor', { pos: v, volume: 0.8 });
      v.rotorHandle = audioH;
      this.heli = { v, ang, h: 38, leave: false, audio: audioH, t: 0 };
    }
    const H = this.heli; if (!H) return;
    const v = H.v;
    if (!v.exploded && this.stars < 4 && !H.leave) { H.leave = true; v.setSiren(false); }
    if (v.exploded || !G.vehicles.list.includes(v) || (H.leave && dist2(v.x, v.z, ref.x, ref.z) > 450 * 450)) { H.audio && H.audio.stop(); if (!v.exploded && G.vehicles.list.includes(v)) G.vehicles.remove(v); this.heli = null; return; }
    H.t += dt;
    const tx = ref.x + (H.leave ? 400 : Math.cos(H.ang) * 24), tz = ref.z + (H.leave ? 400 : Math.sin(H.ang) * 24);
    H.ang += dt * 0.35;
    const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz) || 1;
    const sp = Math.min(d * 0.8, 38) * (H.leave ? 1.3 : 1);
    v.vx = damp(v.vx, dx / d * sp, 1.4, dt); v.vz = damp(v.vz, dz / d * sp, 1.4, dt);
    v.x += v.vx * dt; v.z += v.vz * dt;
    const gy = G.world.groundY(v.x, v.z);
    v.y = damp(v.y, Math.max(gy, ref.y) + 36 + Math.sin(H.t * 0.5) * 2, 1.0, dt);
    v.yaw = dampAngle(v.yaw, Math.atan2(ref.x - v.x, ref.z - v.z), 1.5, dt);
    v.pitch = damp(v.pitch, clamp(-Math.hypot(v.vx, v.vz) * 0.012, -0.2, 0), 2, dt); v.roll = damp(v.roll, clamp(v.vx * 0.004 * Math.cos(v.yaw) - v.vz * 0.004 * Math.sin(v.yaw), -0.2, 0.2), 2, dt);
    v.group.position.set(v.x, v.y, v.z); v.group.rotation.set(v.pitch, v.yaw, v.roll, 'YXZ'); v.obb.x = v.x; v.obb.z = v.z; v.model.update && v.model.update(dt);
    if (H.audio) H.audio.setPos(v);
    // shooting at 5+ (never during a cutscene: the helicopter just flies over)
    if (this.stars >= 5 && !H.leave && !this._calm) {
      this.heliShootT -= dt;
      if (this.heliShootT <= 0 && this.seenNow && Math.hypot(v.x - ref.x, v.z - ref.z) < 70) {
        this.heliShootT = 0.14;
        const tx2 = ref.x + (Math.random() - 0.5) * 4, ty2 = ref.y + 1 + (Math.random() - 0.5) * 2, tz2 = ref.z + (Math.random() - 0.5) * 4;
        let ddx = tx2 - v.x, ddy = ty2 - (v.y - 2), ddz = tz2 - v.z; const l = Math.hypot(ddx, ddy, ddz); ddx /= l; ddy /= l; ddz /= l;
        G.combat.fire({ isHeli: true }, 'smg', v.x, v.y - 2, v.z, ddx, ddy, ddz, { dmgMul: 0.55, spreadMul: 1.2 });
        if (Math.random() < 0.08) this.heliShootT = 1.6;
      }
    }
  }
}
const _sp = {};
