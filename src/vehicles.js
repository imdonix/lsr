// Vehicle physics (arcade), damage, occupants, and the vehicle manager.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, angleDiff, TAU, SpatialHash, circleVsObb, pick, rrange, smoothstep, mulberry32, dist2 } from './util.js';
import { CLS } from './mapdata.js';

// vmax m/s, acc m/s^2, brake m/s^2, grip lateral m/s^2, steer rad, mass kg, hp
export const PHYS = {
  sedan: { vmax: 44, acc: 7, brake: 14.4, grip: 17, steer: 0.55, mass: 1500, hp: 1000, kind: 'car' },
  coupe: { vmax: 50, acc: 8.5, brake: 15.3, grip: 18, steer: 0.55, mass: 1300, hp: 1000, kind: 'car' },
  muscle: { vmax: 54, acc: 10.5, brake: 15.3, grip: 15, steer: 0.5, mass: 1700, hp: 1000, kind: 'sport' },
  lowrider: { vmax: 40, acc: 6.5, brake: 12.8, grip: 15, steer: 0.5, mass: 1900, hp: 1000, kind: 'car' },
  sports: { vmax: 62, acc: 12.5, brake: 18.7, grip: 21, steer: 0.55, mass: 1200, hp: 900, kind: 'sport' },
  hatch: { vmax: 40, acc: 7.2, brake: 13.6, grip: 17, steer: 0.6, mass: 1050, hp: 900, kind: 'car' },
  suv: { vmax: 42, acc: 6.6, brake: 12.8, grip: 15, steer: 0.5, mass: 2100, hp: 1200, kind: 'truck' },
  pickup: { vmax: 40, acc: 6.2, brake: 12.8, grip: 15, steer: 0.5, mass: 2000, hp: 1100, kind: 'truck' },
  van: { vmax: 36, acc: 5, brake: 11.9, grip: 14, steer: 0.48, mass: 2600, hp: 1100, kind: 'truck' },
  taxi: { vmax: 44, acc: 7.2, brake: 14.4, grip: 17, steer: 0.55, mass: 1500, hp: 1000, kind: 'car' },
  police: { vmax: 52, acc: 10, brake: 16.1, grip: 18, steer: 0.55, mass: 1700, hp: 1100, kind: 'car' },
  swatvan: { vmax: 38, acc: 5.5, brake: 11.9, grip: 14, steer: 0.45, mass: 3800, hp: 1800, kind: 'truck' },
  ambulance: { vmax: 40, acc: 5.8, brake: 12.8, grip: 14, steer: 0.45, mass: 3200, hp: 1200, kind: 'truck' },
  bus: { vmax: 27, acc: 3.6, brake: 9.3, grip: 12, steer: 0.4, mass: 11000, hp: 2400, kind: 'truck' },
  truck: { vmax: 30, acc: 4, brake: 10.2, grip: 12, steer: 0.42, mass: 6500, hp: 1800, kind: 'truck' },
  limo: { vmax: 40, acc: 5.8, brake: 11.9, grip: 15, steer: 0.42, mass: 2800, hp: 1100, kind: 'car' },
  motorbike: { vmax: 58, acc: 12, brake: 12.8, grip: 22, steer: 0.7, mass: 260, hp: 600, kind: 'bike' },
  bicycle: { vmax: 8.5, acc: 2.6, brake: 6, grip: 13, steer: 0.7, mass: 90, hp: 300, kind: 'bike' },
  policeheli: { vmax: 55, acc: 10, brake: 10, grip: 10, steer: 0.5, mass: 3000, hp: 1500, kind: 'heli' }
};

const _v3 = new THREE.Vector3();
const DEFAULT_DEF = { length: 4.6, width: 1.85, height: 1.5, wheelRadius: 0.34, wheelbase: 2.7, track: 1.55, seats: 4 };

export class Vehicle {
  constructor(type, x, z, yaw, opts = {}) {
    this.type = type;
    const M = G.models.vehicles;
    const colors = opts.colors || { body: opts.color ?? pickColor(), secondary: null };
    this.model = M.createVehicleModel(type, colors);
    this.def = this.model.def || M.VEHICLE_DEFS[type] || DEFAULT_DEF;
    this.phys = PHYS[type] || PHYS.sedan;
    this.group = this.model.group;
    this.colors = colors;
    this.x = x; this.z = z; this.yaw = yaw; this.y = G.world.groundY(x, z) + this.def.wheelRadius;
    this.vx = 0; this.vz = 0; this.vy = 0; this.yawRate = 0;
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0;
    this.steerCur = 0;
    this.input = { throttle: 0, steer: 0, handbrake: false, brake: 0 };
    this.health = this.phys.hp; this.maxHealth = this.phys.hp;
    this.onFire = false; this.fireT = 0; this.exploded = false; this.wrecked = false; this.wreckT = 0;
    this.driver = null; this.seatPeds = new Array((this.model.seats || []).length).fill(null);
    this.owner = opts.owner || 'traffic';      // 'traffic'|'parked'|'player'|'police'|'mission'|'gang'
    this.ai = null;                             // DriverAI
    this.mission = false;                       // flagged by mission scripts (never despawn)
    this.locked = false;
    this.speed = 0; this.latSpeed = 0; this.lastSpeed = 0;
    this.sleeping = opts.owner === 'parked';
    this.airborne = false; this.groundY = this.y;
    this.hornT = 0; this.siren = false; this.lights = false; this.braking = false; this.reversing = false;
    this.skid = 0; this.driftT = 0; this.engineHandle = null; this.sirenHandle = null;
    this.radius = Math.hypot(this.def.width, this.def.length) / 2;
    this.obb = { x, z, hw: this.def.width / 2, hd: this.def.length / 2, yaw, h: this.def.height, kind: 'vehicle', ref: this };
    this.id = Vehicle._id = (Vehicle._id || 0) + 1;
    this.lastHitBy = null; this.stuckT = 0;
    this.isBike = this.phys.kind === 'bike'; this.isHeli = this.phys.kind === 'heli';
    this.lean = 0;
    this.smokeT = 0; this.tireT = 0;
    this.removeT = 0;
    this.noDamage = false;
    this.plateTint = null;
    this.spawnTime = G.time;
    this.name = this.def.name || type;
    // circle chain for collisions
    const r = this.def.width * 0.46;
    const L = this.def.length / 2 - r;
    this.circleR = r;
    this.circleOffs = this.isBike ? [0.55, -0.55] : (L > 2.2 ? [L, L * 0.33, -L * 0.33, -L] : [L, 0, -L]);
    this.applyTransform();
    G.scene.add(this.group);
  }

  get speedKmh() { return Math.abs(this.speed) * 3.6; }
  get occupied() { return !!this.driver; }
  get isPlayerDriven() { return this.driver && this.driver.isPlayer; }
  get forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
  get totalSpeed() { return Math.hypot(this.vx, this.vz); }

  wake() { this.sleeping = false; }

  seatWorldPos(i, out = new THREE.Vector3()) {
    const s = this.model.seats[i] || { x: 0, y: 1, z: 0 };
    _v3.set(s.x, s.y, s.z); this.group.localToWorld(out.copy(_v3)); return out;
  }
  // world position of the door used to enter seat i
  doorWorldPos(i, out = new THREE.Vector3()) {
    const s = this.model.seats[i] || { x: 0.4, y: 0, z: 0 };
    const side = s.x >= 0 ? 1 : -1;
    _v3.set(side * (this.def.width / 2 + 0.75), 0, s.z); this.group.localToWorld(out.copy(_v3)); out.y = this.y - this.def.wheelRadius; return out;
  }
  freeSeat() { if (!this.driver) return 0; for (let i = 1; i < this.seatPeds.length; i++) if (!this.seatPeds[i]) return i; return -1; }

  damage(amount, info = {}) {
    if (this.noDamage || this.exploded || amount <= 0) return;
    if (info.source) this.lastHitBy = info.source;
    const before = this.health;
    this.health -= amount;
    this.wake();
    if (this.health <= 0 && !this.exploded) { this.health = 0; if (info.instant || before < 300 || this.onFire) this.blowUp(info.source); else { this.health = Math.min(before, 240); this.ignite(); } }
    else if (this.health < 260 && !this.onFire) this.ignite();
    this.model.setDamage(1 - clamp(this.health / this.maxHealth, 0, 1));
  }
  ignite() { if (this.onFire) return; this.onFire = true; this.fireT = 4 + Math.random() * 4; }
  repair() { this.health = this.maxHealth; this.onFire = false; this.model.setDamage(0); this.model.setBurnt && this.model.setBurnt(false); this.wrecked = false; this.exploded = false; }

  blowUp(source) {
    if (this.exploded) return;
    this.exploded = true; this.wrecked = true; this.onFire = true; this.wreckT = 0;
    this.lastHitBy = source || this.lastHitBy;
    G.combat.explode(this.x, this.y + 0.5, this.z, this.isBike ? 5 : 8.5, 260, { source: source || this.lastHitBy, vehicle: this });
    this.vy = 7 + Math.random() * 3; this.airborne = true; this.yawRate = (Math.random() - 0.5) * 4; this.rollV = (Math.random() - 0.5) * 3;
    this.model.setBurnt && this.model.setBurnt(true);
    this.input.throttle = 0; this.input.steer = 0; this.input.handbrake = false;
    // occupants die / get thrown out
    for (const p of this.occupants()) { p.exitVehicle(true); p.damage(400, { source: source || this.lastHitBy, explosion: true }); }
    G.audio && G.audio.stopHandle && 0;
    if (this.engineHandle) { this.engineHandle.stop(); this.engineHandle = null; }
    if (this.sirenHandle) { this.sirenHandle.stop(); this.sirenHandle = null; }
    if (this.ai) this.ai = null;
    G.events && G.events.emit('vehicleDestroyed', this);
  }

  // swallowed by the sea: out of action for good, but no blast (nobody is hurt)
  sink() {
    if (this.exploded) return;
    this.exploded = true; this.wrecked = true; this.sunk = true; this.onFire = false; this.health = 0; this.wreckT = 30; this.vx = this.vz = 0;
    this.model.setBurnt && this.model.setBurnt(true);
    this.input.throttle = 0; this.input.steer = 0; this.input.handbrake = false;
    for (const p of this.occupants()) p.exitVehicle(true);
    if (this.engineHandle) { this.engineHandle.stop(); this.engineHandle = null; }
    if (this.sirenHandle) { this.sirenHandle.stop(); this.sirenHandle = null; }
    this.ai = null;
    G.events && G.events.emit('vehicleDestroyed', this);
  }

  occupants() { const r = []; if (this.driver) r.push(this.driver); for (const p of this.seatPeds) if (p && p !== this.driver) r.push(p); return r; }

  // ------------------------------------------------------------------ update
  update(dt) {
    const W = G.world;
    const ph = this.phys, def = this.def;
    if (this.ghost > 0) this.ghost -= dt;
    if (this.isHeli && !this.wrecked) { this.updateHeli(dt); return; }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (this.wrecked) { this.updateWreck(dt, fx, fz); return; }
    if (this.sleeping && !this.driver && !this.onFire) return;

    // --- fire
    if (this.onFire && !this.wrecked) { this.fireT -= dt; this.health -= 22 * dt; if (this.health <= 0 || this.fireT <= 0) this.blowUp(this.lastHitBy); this.model.setDamage(1 - clamp(this.health / this.maxHealth, 0, 1)); }

    // --- inputs
    let thr = this.input.throttle, st = this.input.steer, hb = this.input.handbrake;
    if (!this.driver && !this.ai) { thr = 0; st = 0; hb = this.totalSpeed > 0.3; }
    if (this.health < 250) thr *= 0.7;
    const surf = W.surfaceAt(this.x, this.z);
    let gripMul = 1, rollRes = 1;
    if (surf === 'grass') { gripMul = 0.62; rollRes = 2.2; } else if (surf === 'sand') { gripMul = 0.55; rollRes = 3.5; } else if (surf === 'sidewalk') gripMul = 0.95;
    else if (surf === 'water') { gripMul = 0.3; rollRes = 8; }
    if (G.sky && G.sky.rain > 0.3) gripMul *= 1 - 0.25 * G.sky.rain;

    let vf = this.vx * fx + this.vz * fz;            // forward speed
    let vl = this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw); // lateral speed (left +)
    this.speed = vf; this.latSpeed = vl;
    const vmax = ph.vmax * (this.health < 400 ? 0.85 : 1);

    const grounded = !this.airborne;
    if (grounded) {
      // slope gravity
      const slopeX = (W.groundY(this.x + fx, this.z + fz) - W.groundY(this.x - fx, this.z - fz)) / 2; // rise per metre forward
      let a = 0;
      this.braking = false; this.reversing = false;
      if (thr > 0.02) {
        if (vf > -0.8) { a = thr * ph.acc * (1 - clamp(Math.max(0, vf) / vmax, 0, 1) ** 1.6) * (surf === 'grass' ? 0.7 : 1); }
        else { a = ph.brake * thr; this.braking = true; }
      } else if (thr < -0.02) {
        if (vf > 0.8) { a = -ph.brake * -thr; this.braking = true; }
        else { a = -thr * -1 * ph.acc * 0.55 * (1 - clamp(-vf / (vmax * 0.3), 0, 1)); a = -Math.abs(a); this.reversing = true; }
      } else { a = -Math.sign(vf) * Math.min(Math.abs(vf) / Math.max(dt, 1e-3), 1.6 * rollRes); }
      if (this.input.brake > 0) { a -= Math.sign(vf) * Math.min(Math.abs(vf) / Math.max(dt, 1e-3), ph.brake * this.input.brake); this.braking = true; }
      if (hb) { a -= Math.sign(vf) * Math.min(Math.abs(vf) / Math.max(dt, 1e-3), ph.brake * 0.4); }
      a -= slopeX * 9.81 * 0.75;
      // air drag
      a -= vf * Math.abs(vf) * 0.0006 * (this.isBike ? 1.5 : 1);
      vf += a * dt;
      if (Math.abs(vf) < 0.05 && Math.abs(thr) < 0.02 && !hb) vf = 0;
      // rolling resistance on rough ground
      if (rollRes > 1) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (rollRes - 1) * 0.6 * dt * Math.abs(vf) * 0.3);

      // steering
      const speedAbs = Math.abs(vf);
      const maxSteer = ph.steer / (1 + (speedAbs / (this.isBike ? 18 : 15)) ** 2);
      this.steerCur = damp(this.steerCur, st * maxSteer, this.isBike ? 9 : 7.5, dt);
      let yawTarget = vf / def.wheelbase * Math.tan(this.steerCur);
      if (Math.abs(vf) < 1.2) yawTarget *= Math.abs(vf) / 1.2;
      let gripA = ph.grip * gripMul * (1 - 0.2 * smoothstep(3, 14, Math.abs(vl)));
      // the body can only rotate about as fast as the tyres can turn the velocity (otherwise the car just slides sideways);
      // a little extra is allowed so cornering has a lively, slightly oversteery SA feel
      const yawCap = ph.grip * gripMul * 1.0 / Math.max(Math.abs(vf), 6);
      if (yawTarget > yawCap) yawTarget = yawCap; else if (yawTarget < -yawCap) yawTarget = -yawCap;
      if (hb) {
        // handbrake: rear tyres lock -> tail steps out.  Use the real travel speed (not just the forward part) so the spin keeps going
        // while the car is already sliding sideways; returns to normal steering once released.
        gripA *= 0.2; if (this.totalSpeed > 6) this.driftT = 0.7;
        const ref = (vf >= -0.5 ? 1 : -1) * Math.max(Math.abs(vf), 0.65 * this.totalSpeed);
        yawTarget = clamp(ref / def.wheelbase * Math.tan(clamp(this.steerCur * 2.2, -ph.steer, ph.steer)), -2.5, 2.5);
        if (Math.abs(ref) < 1.2) yawTarget *= Math.abs(ref) / 1.2;
      }
      if (!hb && this.driftT > 0) { this.driftT -= dt; gripA *= 0.4 + 0.6 * (1 - this.driftT / 0.7); } // tyres bite again gradually after a handbrake slide
      this.yawRate = damp(this.yawRate, yawTarget, hb ? 4.5 : 9, dt);
      // the world velocity is unchanged by the body rotating; grip then removes the new lateral component
      const c0 = Math.cos(this.yaw), s0 = Math.sin(this.yaw);
      const wvx = fx * vf + c0 * vl, wvz = fz * vf - s0 * vl;
      this.yaw += this.yawRate * dt;
      const fx2 = Math.sin(this.yaw), fz2 = Math.cos(this.yaw), c2 = Math.cos(this.yaw), s2 = Math.sin(this.yaw);
      vf = wvx * fx2 + wvz * fz2; vl = wvx * c2 - wvz * s2;
      const slip = Math.abs(vl);
      vl -= clamp(vl, -gripA * dt, gripA * dt);
      this.skid = clamp((slip - 3.0) / 6 + (hb && speedAbs > 6 ? 0.8 : 0) + (this.braking && speedAbs > 14 ? 0.5 : 0), 0, 1);
      this.vx = fx2 * vf + c2 * vl; this.vz = fz2 * vf - s2 * vl;
      if (this.isBike) { this.lean = damp(this.lean, clamp(-(this.steerCur / ph.steer) * clamp(speedAbs / 12, 0, 1) * 0.55 - vl * 0.04, -0.75, 0.75), 6, dt); }
    } else {
      this.yaw += this.yawRate * dt; this.yawRate *= 0.999;
    }
    // integrate position
    this.x += this.vx * dt; this.z += this.vz * dt;

    // world bounds
    const lim = 1010;
    if (Math.abs(this.x) > lim) { this.x = clamp(this.x, -lim, lim); this.vx *= -0.3; }
    if (Math.abs(this.z) > lim) { this.z = clamp(this.z, -lim, lim); this.vz *= -0.3; }

    // --- vertical: terrain following with launch off crests
    const R = def.wheelRadius;
    const hw2 = def.track / 2, hl = def.wheelbase / 2, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const gh = (lx, lz) => W.groundY(this.x + lx * cy + lz * sy, this.z - lx * sy + lz * cy);
    const hFL = gh(hw2, hl), hFR = gh(-hw2, hl), hRL = gh(hw2, -hl), hRR = gh(-hw2, -hl);
    const gAvg = (hFL + hFR + hRL + hRR) / 4;
    let targetPitch = -Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, def.wheelbase);
    let targetRoll = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, def.track);
    const waterDepth = -gAvg;
    if (waterDepth > 0.6 && !this.wrecked) { // in water: sink slowly, occupants bail out and swim, the car is a write-off (no explosion)
      this.submerged = (this.submerged || 0) + dt;
      this.y = lerp(this.y, -0.4 - this.def.height * 0.2 - Math.min(this.submerged * 0.3, 2.2), 1 - Math.exp(-dt * 1.2)); this.vx *= 1 - dt * 1.2; this.vz *= 1 - dt * 1.2;
      this.pitch = damp(this.pitch, 0.12, 1.5, dt);
      if (this.submerged > 1.3 && !this.isHeli) for (const o of this.occupants()) o.exitVehicle(true);
      if (this.submerged > 7) this.sink();
      if (Math.random() < dt * 6) G.fx.splash(this.x + (Math.random() - 0.5) * 2, this.z + (Math.random() - 0.5) * 2, 2, 0.8);
    } else {
      this.submerged = 0;
      const yg = gAvg + R;
      const prevG = this.groundY; this.groundY = yg; // track every frame: after a jump, groundY must be the terrain just landed on (not the takeoff height), else rise spikes and the launch check catapults the car
      if (!this.airborne) {
        const rise = clamp((yg - prevG) / Math.max(dt, 1e-4), -20, 20);
        // launch off a crest: we were climbing and the ground now falls away faster than a ballistic path
        if ((this._lastVy || 0) > 2.0 && rise < this._lastVy - 1.8 && this.totalSpeed > 8) { this.airborne = true; this.vy = this._lastVy; this.y += this.vy * dt; }
        else { this.y = yg; this.vy = rise; this._lastVy = rise; }
      } else {
        this.vy -= 9.81 * dt; this.y += this.vy * dt;
        targetPitch = this.pitch; targetRoll = this.roll;
        if (this.y <= yg) {
          const impact = -this.vy; this.y = yg; this.airborne = false; this._lastVy = 0;
          if (impact > 5) { this.damage((impact - 4) * (impact - 4) * 4.5, { source: this.lastHitBy }); G.fx.dust(this.x, this.y - 0.3, this.z, 6, 1.2); G.audio && G.audio.play('car_hit_heavy', { pos: this, volume: clamp(impact / 12, 0.3, 1) }); G.camera && G.camera.shake(clamp(impact / 25, 0.05, 0.5), 0.3); }
          this.vy = 0;
        }
      }
    }
    // body pitch/roll dynamics (visual + slope)
    const accelLong = (vf - this.lastSpeed) / Math.max(dt, 1e-3); this.lastSpeed = vf;
    const visPitch = clamp(accelLong * -0.004, -0.06, 0.06) * (this.isBike ? 0.5 : 1);
    const visRoll = this.isBike ? 0 : clamp(-vl * 0.012 - this.yawRate * Math.abs(vf) * 0.0008, -0.09, 0.09) * 0;
    const rollLat = this.isBike ? 0 : clamp(this.yawRate * vf * 0.0042, -0.085, 0.085);
    this.pitch = damp(this.pitch, targetPitch + visPitch, 10, dt);
    this.roll = damp(this.roll, targetRoll + rollLat + visRoll, 9, dt);

    // --- collisions
    this.collideStatic(dt);
    this.obb.x = this.x; this.obb.z = this.z; this.obb.yaw = this.yaw;
    this.applyTransform();
    this.updateEffects(dt, vf, surf);
    if (this.hornT > 0) this.hornT -= dt;
    if (!this.driver && !this.ai && this.totalSpeed < 0.06 && !this.airborne && !this.onFire && !(this.submerged > 0)) { this.sleepT = (this.sleepT || 0) + dt; if (this.sleepT > 2) { this.sleeping = true; this.vx = this.vz = 0; } } else this.sleepT = 0;
  }

  collideStatic(dt) {
    const W = G.world;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const pos = { x: 0, z: 0 }; const out = {};
    let worst = 0, nxw = 0, nzw = 0, hitOff = 0, hit = false;
    for (const off of this.circleOffs) {
      pos.x = this.x + fx * off; pos.z = this.z + fz * off;
      const px = pos.x, pz = pos.z;
      if (W.pushCircle(pos, this.circleR, out, this.y - 0.6, this.y + this.def.height)) {
        const dx = pos.x - px, dz = pos.z - pz;
        this.x += dx; this.z += dz;
        const vn = this.vx * out.nx + this.vz * out.nz; // <0 means moving into the surface
        if (vn < 0) {
          const e = 0.12;
          this.vx -= (1 + e) * vn * out.nx; this.vz -= (1 + e) * vn * out.nz;
          // scrape friction
          this.vx *= 0.985; this.vz *= 0.985;
          if (-vn > worst) { worst = -vn; nxw = out.nx; nzw = out.nz; hitOff = off; }
          // spin from off-centre hit
          const lat = (out.nx * Math.cos(this.yaw) - out.nz * Math.sin(this.yaw));
          this.yawRate += clamp(-off * lat * vn * 0.05, -2.2, 2.2) * -1;
        }
        hit = true;
        // knock over soft props
        const c = out.c; if (c && c.prop && G.props) G.props.knock(c.prop, this, -vn);
      }
    }
    if (worst > 2.5) {
      this.crash(worst, 'static', nxw, nzw);
    }
    // keep on the world's static colliders: wall pinch safety -> if very stuck, small shove
    if (hit) this.stuckT += dt; else this.stuckT = 0;
  }

  crash(speed, what, nx, nz, other = null) {
    const now = G.time;
    if (now - (this._lastCrash || 0) > 0.12) {
      this._lastCrash = now;
      const heavy = speed > 9;
      if (G.audio) G.audio.play(heavy ? 'car_hit_heavy' : 'car_hit_light', { pos: this, volume: clamp(speed / 14, 0.25, 1) });
      if (speed > 4) G.fx.sparks(this.x + nx * -1, this.y + 0.2, this.z + nz * -1, Math.min(10, Math.floor(speed)), nx, nz);
      if (speed > 8) { G.fx.debris(this.x, this.y + 0.3, this.z, 4); if (this.isPlayerDriven) G.camera.shake(clamp(speed / 30, 0.08, 0.6), 0.35); }
      if (speed > 12 && this.model.setDamage) { /* glass etc via damage */ }
      if (speed > 4.5) { if (G.audio && speed > 7) G.audio.play('glass_break', { pos: this, volume: 0.35 }); }
    }
    let dmg = (speed * speed) * 0.85 * (what === 'static' ? 1 : 0.8);
    if (this.isBike) dmg *= 2;
    if (speed > 4) { this.damage(dmg, { source: other ? other.driver : null }); this.onCrash(speed, other); }
  }
  onCrash(speed, other) {
    // riders fall off bikes when crashing hard
    if (this.isBike && speed > 9 && this.driver) { const d = this.driver; d.exitVehicle(true); d.damage(speed * 4, {}); d.vx = this.vx * 0.5; d.vz = this.vz * 0.5; d.vy = 3; }
    if (G.police && this.isPlayerDriven) G.police.onPlayerCrash(this, other, speed);
    if (this.driver && !this.driver.isPlayer && this.ai) { this.ai.onHit(other ? other.driver : null, speed); }
  }

  updateWreck(dt, fx, fz) {
    this.wreckT += dt;
    // simple ballistic + friction
    const W = G.world; const gy = W.groundY(this.x, this.z) + this.def.wheelRadius * 0.6;
    this.x += this.vx * dt; this.z += this.vz * dt;
    if (this.airborne) { this.vy -= 9.81 * dt; this.y += this.vy * dt; if (this.y <= gy) { this.y = gy; this.airborne = false; this.vy = 0; } }
    else this.y = lerp(this.y, gy, 0.3);
    this.vx *= Math.exp(-dt * 0.9); this.vz *= Math.exp(-dt * 0.9); this.yaw += this.yawRate * dt; this.yawRate *= Math.exp(-dt * 1.2);
    this.roll += this.rollV * dt; this.rollV *= 0.98; this.roll = clamp(this.roll, -0.6, 0.6);
    const pos = { x: this.x, z: this.z };
    if (W.pushCircle(pos, this.circleR, {})) { this.x = pos.x; this.z = pos.z; }
    if (G.fx && this.wreckT < 40 && !this.sunk) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.05; G.fx.fire(this.x + (Math.random() - 0.5) * 1.5, this.y + 0.6, this.z + (Math.random() - 0.5) * 2.4, 1.3); }
    }
    this.obb.x = this.x; this.obb.z = this.z; this.obb.yaw = this.yaw;
    this.applyTransform();
  }

  updateHeli(dt) {
    this.model.update && this.model.update(dt);
    this.obb.x = this.x; this.obb.z = this.z; this.applyTransform();
  }

  updateEffects(dt, vf, surf) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // wheels
    const w = this.model.wheels, spin = vf / Math.max(0.2, this.def.wheelRadius) * dt;
    for (let i = 0; i < w.length; i++) {
      if (w[i].spin) w[i].spin.rotation.x += spin;
      if (w[i].steer && w[i].pivot) w[i].pivot.rotation.y = this.steerCur;
    }
    // lights
    const dark = G.sky ? G.sky.dark : 0;
    const wantLights = (this.driver || this.owner === 'traffic' || this.owner === 'police') && (dark > 0.45);
    if (wantLights !== this.lights) { this.lights = wantLights; this.model.setHeadlights(wantLights); }
    const br = (this.braking || this.input.handbrake) && this.driver;
    if (br !== this._brakeState) { this._brakeState = br; this.model.setBrake(!!br); }
    if (this.reversing !== this._revState) { this._revState = this.reversing; this.model.setReverse && this.model.setReverse(this.reversing); }
    if (this.model.update) this.model.update(dt);
    // damage smoke
    if (this.health < 500 && !this.wrecked) {
      this.smokeT -= dt; const sev = 1 - this.health / 500;
      if (this.smokeT <= 0) { this.smokeT = 0.12 - sev * 0.08; G.fx.smokePuff(this.x + fx * (this.def.length * 0.35), this.y + 0.9, this.z + fz * (this.def.length * 0.35), 0.8 + sev, 1.4, this.health < 250 ? 0.1 : 0.45 + (1 - sev) * 0.2); }
      if (this.onFire) G.fx.fire(this.x + fx * this.def.length * 0.35, this.y + 0.9, this.z + fz * this.def.length * 0.35, 1.1);
    }
    // tyre smoke
    if (this.skid > 0.25 && !this.airborne && this.totalSpeed > 3) {
      this.tireT -= dt; if (this.tireT <= 0) { this.tireT = 0.05; const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw); for (const sgn of [1, -1]) G.fx.tireSmoke(this.x - fx * this.def.wheelbase * 0.5 + sgn * cy * this.def.track * 0.5, this.y - this.def.wheelRadius + 0.15, this.z - fz * this.def.wheelbase * 0.5 - sgn * sy * this.def.track * 0.5, this.vx, this.vz); }
    }
    if (surf === 'grass' || surf === 'sand') { if (this.totalSpeed > 6 && Math.random() < dt * 14) G.fx.dust(this.x - fx * 1.6, this.y - 0.2, this.z - fz * 1.6, 1, 1, surf === 'sand' ? [0.85, 0.78, 0.6] : [0.45, 0.42, 0.3]); }
    // audio handles
    this.updateAudio(dt);
  }

  updateAudio(dt) {
    const A = G.audio; if (!A || !A.ready) return;
    const near = this.isPlayerDriven || (G.player && dist2(G.player.x, G.player.z, this.x, this.z) < 45 * 45);
    if (this.type === 'bicycle') { if (this.engineHandle) { this.engineHandle.stop(); this.engineHandle = null; } }   // no motor noise on a pushbike
    else if (near && (this.driver || this.ai) && !this.wrecked) {
      const VM = G.vehicles;   // cap simultaneous engine voices (audio budget): the player's car always gets one
      if (!this.engineHandle && (this.isPlayerDriven || !VM || (VM.engineCount || 0) < 8)) { this.engineHandle = A.engine(this.phys.kind === 'bike' ? 'bike' : this.phys.kind); if (this.engineHandle && VM) VM.engineCount = (VM.engineCount || 0) + 1; }
      if (this.engineHandle) {
        const rpm = clamp(0.18 + Math.abs(this.speed) / Math.max(1, this.phys.vmax) * 0.95 % 0.85 + Math.abs(this.input.throttle) * 0.12, 0, 1);
        const gear = Math.min(5, Math.floor(Math.abs(this.speed) / (this.phys.vmax / 5.2)));
        const gsp = (Math.abs(this.speed) % (this.phys.vmax / 5.2)) / (this.phys.vmax / 5.2);
        const r = clamp(0.2 + gsp * 0.72 + Math.abs(this.input.throttle) * 0.08, 0.15, 1);
        this.engineHandle.update(this.isPlayerDriven && Math.abs(this.speed) < 0.5 ? 0.15 + Math.abs(this.input.throttle) * 0.5 : r, Math.abs(this.input.throttle), this);
        this.engineHandle.setVolume(this.isPlayerDriven ? 1 : 0.8);
      }
    } else if (this.engineHandle) { this.engineHandle.stop(); this.engineHandle = null; }
    // skid sound for the player's car
    if (this.isPlayerDriven) {
      if (this.skid > 0.4 && !this.skidHandle) this.skidHandle = A.loop('tire_skid', { pos: this, volume: 0.6 });
      if (this.skidHandle) { this.skidHandle.setVolume(clamp(this.skid, 0, 1) * 0.8); this.skidHandle.setPos(this); if (this.skid < 0.2) { this.skidHandle.stop(); this.skidHandle = null; } }
    }
    const wantSiren = this.siren && (near || this.isPlayerDriven);
    if (wantSiren && !this.sirenHandle && (this.isPlayerDriven || !G.vehicles || (G.vehicles.sirenCount || 0) < 4)) { if (G.vehicles) G.vehicles.sirenCount = (G.vehicles.sirenCount || 0) + 1; this.sirenHandle = A.loop(this.type === 'ambulance' ? 'siren_ambulance' : 'siren_police', { pos: this, volume: 0.5 }); }   // at most 4 siren voices at once
    if (this.sirenHandle) { if (wantSiren) this.sirenHandle.setPos(this); else { this.sirenHandle.stop(); this.sirenHandle = null; } }
  }

  applyTransform() {
    this.group.position.set(this.x, this.y - this.def.wheelRadius, this.z);
    let roll = this.roll;
    this.group.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
    if (this.isBike) this.group.rotation.set(this.pitch, this.yaw, this.roll + this.lean, 'YXZ');
  }

  setSiren(on) {
    on = !!on;
    if (!on && this.sirenHandle) { this.sirenHandle.stop(); this.sirenHandle = null; }
    this.siren = on; this.model.setSiren && this.model.setSiren(on);
  }
  honk() { if (this.hornT <= 0) { this.hornT = 0.25; G.audio && G.audio.play('horn', { pos: this, pitch: this.phys.kind === 'truck' ? 0.75 : 1 }); G.combat && G.combat.noise(this.x, this.z, 30, null, 'horn'); } }

  dispose() {
    if (this.engineHandle) this.engineHandle.stop();
    if (this.sirenHandle) this.sirenHandle.stop();
    if (this.skidHandle) this.skidHandle.stop();
    if (this.rotorHandle) { this.rotorHandle.stop(); this.rotorHandle = null; }
    G.scene.remove(this.group);
    this.model.dispose && this.model.dispose();
  }

  // bullet / melee / explosion hit hook
  onHit(dmg, info) { this.damage(dmg * (info && info.explosion ? 1 : 0.9), info); if (this.ai && info && info.source) this.ai.onHit(info.source, 0); if (info && info.bullet && this.health < 240 && !this.onFire && Math.random() < 0.15) this.ignite(); }
}

let colorPool = [0xc0c0c8, 0x1d1d22, 0xf2f2f2, 0x9a1c1c, 0x1c3a8a, 0x2a6a3a, 0xb58a1a, 0x5a5a66, 0x7a3a9a, 0xd06a1c, 0x22262e, 0x6a3a1a, 0x3a7a9a, 0xe8d8b0];
function pickColor() { return colorPool[(Math.random() * colorPool.length) | 0]; }

// ---------------------------------------------------------------------------
export class VehicleManager {
  constructor() {
    this.list = []; this.hash = new SpatialHash(12); this.removeQueue = [];
  }
  spawn(type, x, z, yaw, opts = {}) {
    const v = new Vehicle(type, x, z, yaw, opts);
    this.list.push(v);
    return v;
  }
  remove(v) {
    const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1);
    for (const p of v.occupants()) { if (p.isPlayer) { v.vx = v.vz = 0; p.exitVehicle(true); continue; } p.vehicle = null; G.peds.remove(p); }   // never leave the player 'driving' a deleted car
    v.dispose();
  }
  nearest(x, z, maxD = 4, filter = null) {
    let best = null, bd = maxD * maxD;
    for (const v of this.list) { if (v.exploded || (filter && !filter(v))) continue; const d = dist2(x, z, v.x, v.z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  update(dt) {
    const L = this.list;
    let ec = 0, sc = 0; for (const v of L) { if (v.engineHandle) ec++; if (v.sirenHandle) sc++; } this.engineCount = ec; this.sirenCount = sc;
    this.hash = this._h || (this._h = new SpatialHash(12));
    this.hash.map.clear();
    for (const v of L) this.hash.insertBounds(v, v.x - v.radius, v.z - v.radius, v.x + v.radius, v.z + v.radius);
    for (let i = L.length - 1; i >= 0; i--) {
      const v = L[i];
      if (v.ai) v.ai.update(dt);
      v.update(dt);
    }
    // vehicle-vehicle collisions
    const tmp = [];
    for (const a of L) {
      if (a.isHeli || (a.sleeping && !a.driver)) { /* still collide if other is moving */ }
      this.hash.queryRadius(a.x, a.z, a.radius + 2, tmp);
      for (const b of tmp) { if (b.id <= a.id || b.isHeli || a.isHeli) continue; if (a.sleeping && b.sleeping) continue; collideVehicles(a, b); }
    }
    // wreck removal
    for (let i = L.length - 1; i >= 0; i--) { const v = L[i]; if (v.wrecked && v.wreckT > 45 && !v.mission) this.remove(v); }
  }
}

function collideVehicles(a, b) {
  if (a.ghost > 0 || b.ghost > 0) return;
  const fxa = Math.sin(a.yaw), fza = Math.cos(a.yaw), fxb = Math.sin(b.yaw), fzb = Math.cos(b.yaw);
  let hit = false;
  for (const oa of a.circleOffs) {
    const ax = a.x + fxa * oa, az = a.z + fza * oa;
    for (const ob of b.circleOffs) {
      const bx = b.x + fxb * ob, bz = b.z + fzb * ob;
      const dx = bx - ax, dz = bz - az, rr = a.circleR + b.circleR, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4, nx = dx / d, nz = dz / d, pen = rr - d;
      const ia = 1 / a.phys.mass, ib = 1 / b.phys.mass;
      const wa = ia / (ia + ib), wb = ib / (ia + ib);
      a.x -= nx * pen * wa; a.z -= nz * pen * wa; b.x += nx * pen * wb; b.z += nz * pen * wb;
      const rvx = b.vx - a.vx, rvz = b.vz - a.vz, vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const e = 0.25, j = -(1 + e) * vn / (ia + ib);
        a.vx -= j * ia * nx; a.vz -= j * ia * nz; b.vx += j * ib * nx; b.vz += j * ib * nz;
        // spin
        const lata = nx * Math.cos(a.yaw) - nz * Math.sin(a.yaw), latb = nx * Math.cos(b.yaw) - nz * Math.sin(b.yaw);
        a.yawRate += clamp(oa * lata * vn * 0.03 * wa * 1.5, -2, 2); b.yawRate += clamp(-ob * latb * vn * 0.03 * wb * 1.5, -2, 2);
        const speed = -vn;
        if (speed > 2.5) {
          a.crash(speed * (wb * 1.4), 'vehicle', nx, nz, b); b.crash(speed * (wa * 1.4), 'vehicle', -nx, -nz, a);
          a.wake(); b.wake();
        }
      }
      hit = true;
    }
  }
  if (hit) { a.wake(); b.wake(); }
}
