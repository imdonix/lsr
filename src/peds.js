// Pedestrians: physics, combat, AI brains, vehicle enter/exit, manager.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, angleDiff, TAU, dist2, circleVsObb, SpatialHash, pick, rrange, headingTo, smoothstep } from './util.js';
import { WEAPONS } from './weapons.js';
import { edgePointAt, CLS, ZONE, GANG } from './mapdata.js';
import { lifeBrain, lifeStatic, endLife } from './lifebrain.js';
import { Ragdoll } from './ragdoll.js';

const V3 = new THREE.Vector3(), _ev = new THREE.Vector3();

// Per-vehicle vertical nudge of the seated rig (hips are 0.5 above the group origin): keeps shoes inside the floor pan of
// normal cars and heads at window height in tall vans/trucks.
const SEAT_LIFT = { sedan: 0.07, taxi: 0.07, police: 0.07, hatch: 0.06, lowrider: 0.07, limo: 0.07, coupe: 0.03, muscle: 0.03, sports: 0.02, suv: 0.12, pickup: 0.06, van: 0.16, swatvan: 0.2, ambulance: 0.22, truck: 0.26, bus: 0.0 };
const _sp = new THREE.Vector3();
export function seatPedPos(v, seat, out = _sp) {
  const s = v.model.seats[seat] || { x: 0.4, y: 0.8, z: 0 };
  return out.set(s.x, s.y - 0.5 + (SEAT_LIFT[v.type] || 0), s.z);
}

export class Ped {
  constructor(o = {}) {
    const P = G.models.peds;
    this.role = o.role || 'civ';
    this.gang = o.gang || 0;
    this.appearance = o.appearance || P.randomAppearance(Math.random, { gang: this.gang, role: this.role });
    this.rig = new P.PedRig(this.appearance);
    this.group = this.rig.group;
    this.scale = this.appearance.scale || 1;
    this.x = o.x || 0; this.z = o.z || 0; this.yaw = o.yaw || 0; this.y = G.world.groundY(this.x, this.z);
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.health = this.maxHealth = o.health || (this.role === 'swat' ? 160 : this.role === 'cop' ? 120 : 100);
    this.armor = o.armor || (this.role === 'swat' ? 100 : 0);
    this.dead = false; this.deadT = 0; this.downT = 0; this.downElapsed = 0;
    this.weapons = { fist: { ammo: 0, clip: 0 } }; this.weaponId = 'fist';
    this.move = { x: 0, z: 0 }; this.speedTarget = 0; this.faceYaw = this.yaw; this.run = 0;
    this.grounded = true; this.swimming = false; this.crouch = false;
    this.vehicle = null; this.seat = -1; this.enterT = 0; this.enterWalkT = 0; this.enterVeh = null; this.enterSeat = 0;
    this.isPlayer = false;
    this.mode = o.mode || 'walk'; this.modeT = 0; this.brain = o.brain || null;
    this.target = null; this.cool = 0; this.aimT = 0; this.strafe = 1; this.strafeT = 0; this.reloadT = 0;
    this.attackT = 0; this.combo = 0; this.pendingHit = null;
    this.path = null; this.fearPos = null; this.home = { x: this.x, z: this.z };
    this.hostile = false; this.aggroT = 0; this.brave = Math.random() < 0.18;
    this.mission = false; this.noDespawn = false; this.invincible = false;
    this.stuckT = 0; this.lastPos = { x: this.x, z: this.z }; this.unstuckT = 0; this.unstuckDir = 0;
    this.id = Ped._id = (Ped._id || 0) + 1;
    this.airborneT = 0; this.fallStartY = 0; this.lastAttacker = null; this.killedBy = null;
    this.rag = null;
    this.aiming = false; this.aimPitch = 0; this.phoneT = 0;
    this.skillAcc = o.skill ?? (this.role === 'cop' ? 0.48 : this.role === 'swat' ? 0.66 : 0.4);
    this.cash = o.cash ?? (Math.random() < 0.6 ? Math.floor(rrange(5, 70)) : 0);
    this.canDrop = true;
    this.name = o.name || '';
    this.fadeOut = 0; this.removeMe = false; this.stepT = 0;
    this.lookT = 0; this.waitT = 0; this.life = null; this.scene = null; this.sigWait = null; this.sigFree = 0;
    if (o.weapon) this.give(o.weapon, o.ammo ?? 200);
    G.scene.add(this.group);
    this.group.position.set(this.x, this.y, this.z);
  }

  get pos() { return this; }
  get alive() { return !this.dead; }
  get headY() { return this.y + 1.65 * this.scale; }

  // ---------------------------------------------------------------- inventory
  give(wid, ammo = 0, equip = true) {
    const W = WEAPONS[wid]; if (!W) return;
    const cur = this.weapons[wid];
    if (W.melee) { this.weapons[wid] = { ammo: 0, clip: 0 }; }
    else if (cur) { cur.ammo += ammo; }
    else { const clip = Math.min(W.clip, ammo); this.weapons[wid] = { ammo: ammo - clip, clip }; }
    if (equip && (!this.isPlayer || this.weaponId === 'fist')) this.equip(wid);
  }
  equip(wid) {
    if (!this.weapons[wid] && wid !== 'fist') return false;
    this.weaponId = wid; this.reloadT = 0;
    this.rig.setWeapon(wid === 'fist' ? null : wid);
    return true;
  }
  get weapon() { return WEAPONS[this.weaponId] || WEAPONS.fist; }
  get wslot() { return this.weapons[this.weaponId] || { ammo: 0, clip: 0 }; }
  hasGun() { const W = this.weapon; return !W.melee && W.kind !== 'tool'; }
  totalAmmo(wid = this.weaponId) { const s = this.weapons[wid]; return s ? s.ammo + s.clip : 0; }

  // ---------------------------------------------------------------- damage
  damage(amount, info = {}) {
    if (this.dead || this.invincible || amount <= 0) return;
    if (this.vehicle && info.explosion === undefined && info.vehicleCrash) amount *= 0.5;
    if (this.armor > 0) { const soak = this.isPlayer ? 0.85 : 0.75, eff = this.isPlayer ? 0.95 : 0.9; const a = Math.min(this.armor, amount * soak); this.armor -= a; amount -= a * eff; }
    this.health -= amount;
    if (this.life) endLife(this);
    if (info.source && info.source !== this) this.lastAttacker = info.source;
    this.flash = 1; this.rig.setHitFlash && this.rig.setHitFlash(1);
    if (this.health <= 0) { this.killedBy = info.source || null; this.die(info); return; }
    if (amount > 8 && !this.vehicle && !this.attackT) this.rig.playAction('hit');
    if (info.knock || info.explosion) this.knockdown(info.explosion ? 1.8 : 1.0);
    // going limp: heavy melee, blasts and big hits have a chance to throw the body into a ragdoll (death always does)
    if (!this.isPlayer && !this.vehicle && amount > 8) {
      const chance = info.explosion ? 0.85 : info.knock ? 0.5 : info.melee ? 0.16 : 0;
      if (chance > 0 && Math.random() < chance) this.startRagdoll({ vx: (info.dirx || 0) * 2.2, vy: 0.7, vz: (info.dirz || 0) * 2.2, spin: 0.85, dur: 1.0 + Math.random() * 0.9 });
    }
    if (G.audio && amount > 6 && Math.random() < 0.5) G.audio.play(this.appearance.gender === 'f' ? 'scream_female' : 'scream_male', { pos: this, volume: 0.6, pitch: rrange(0.9, 1.1) });
    this.onDamaged(amount, info);
    this.react(info);
  }
  onDamaged() {}
  react(info) {
    const src = info.source; if (!src || src === this) return;
    if (this.role === 'civ') {
      if (this.brave && (info.melee || info.weapon === 'fist') && Math.random() < 0.7) { this.target = src; this.setMode('fight', 8); }
      else this.flee(src.x, src.z, 8 + Math.random() * 5);
    } else if (this.role === 'gang' || this.role === 'enemy') { if (src.isPlayer || src.role === 'civ' || src.gang !== this.gang) { this.target = src; this.aggroT = 60; if (this.mode !== 'attack') this.setMode('attack', 60); } }
    else if (this.role === 'cop' || this.role === 'swat') { if (src.isPlayer) G.police && G.police.onAttackCop(this, src); }
    if (this.role === 'gang' && src.isPlayer && this.gang && G.gangHeat) G.gangHeat[this.gang] = 120;
  }
  knockdown(t = 1.2) {
    if (this.dead || this.vehicle) return;
    this.downT = Math.max(this.downT, t); this.downElapsed = 0; this.attackT = 0;
  }
  die(info = {}) {
    if (this.dead) return;
    this.dead = true; this.deadT = 0; this.health = 0;
    if (this.life) endLife(this, null);
    if (this.vehicle) this.exitVehicle(true);
    this.aiming = false; this.rig.setWeapon(null);
    this.killedBy = info.source || this.killedBy;
    if (G.audio) G.audio.play(this.appearance.gender === 'f' ? 'scream_female' : 'scream_male', { pos: this, volume: 0.8, pitch: rrange(0.85, 1.05) });
    if (info.explosion) { this.vy = Math.max(this.vy, 5); this.airborneT = 1; }
    else { this.vx += (info.dirx || 0) * 3; this.vz += (info.dirz || 0) * 3; }
    // the body goes limp: every death ends in a ragdoll (scripted fallback if the ragdoll budget is exhausted)
    {
      const vel = info.vel;
      if (vel) {
        const l = Math.hypot(vel.x, vel.z) || 1;
        this.startRagdoll({ vx: vel.x - this.vx, vy: vel.y, vz: vel.z - this.vz, spin: Math.min(4, 0.5 + l * 0.14), axis: { x: vel.z / l, y: 0, z: -vel.x / l } });
      } else if (info.explosion) this.startRagdoll({ vx: (info.dirx || 0) * 8, vy: 3.5, vz: (info.dirz || 0) * 8, spin: 1.3 });
      else if (info.vehicleCrash) this.startRagdoll({ vx: (info.dirx || 0) * 5, vy: 2.2, vz: (info.dirz || 0) * 5, spin: 1.0 });
      else this.startRagdoll({ vx: (info.dirx || 0) * 1.2, vy: 0.7, vz: (info.dirz || 0) * 1.2, spin: 0.6 });
    }
    // drops
    if (!this.isPlayer && this.canDrop && G.pickups) {
      if (this.cash > 0 && (info.source && info.source.isPlayer || Math.random() < 0.3)) G.pickups.spawn('cash', this.x + (Math.random() - 0.5), this.z + (Math.random() - 0.5), { amount: this.cash });
      const w = this.weapon; if (!w.melee && w.id !== 'spraycan' && (this.role === 'gang' || this.role === 'cop' || this.role === 'swat' || this.role === 'enemy') && Math.random() < 0.7) G.pickups.spawn('weapon', this.x + (Math.random() - 0.5), this.z + 0.5, { weapon: w.id, ammo: Math.max(6, Math.floor((w.pack || 20) * 0.5)) });
      if (this.role === 'swat' && Math.random() < 0.5) G.pickups.spawn('armor', this.x, this.z - 0.6, {});
    }
    G.events.emit('pedKilled', this, info);
    if (G.police) G.police.onPedKilled(this, info);
    if (this.gang && info.source && info.source.isPlayer && G.gangHeat) G.gangHeat[this.gang] = 180;
  }

  // ---------------------------------------------------------------- AI reactions
  hear(type, x, z, source, dist) {
    if (this.dead || this.isPlayer || this.vehicle) return;
    if (type === 'horn') {   // a car horn: heads turn, the odd shout
      if ((this.role === 'civ' || this.role === 'worker') && !this.mission && !this.life && this.mode === 'walk' && dist < 16 && Math.random() < 0.6) { this.lookT = 1.4 + Math.random(); this.lookAt = { x, z }; if (dist < 9 && Math.random() < 0.5 && G.ambient) G.ambient.say(this, pick(['Hey!', 'Watch it!', 'Take it easy!', 'Learn to drive!'])); }
      return;
    }
    if (this.role === 'civ') {
      if ((type === 'shot' || type === 'explosion') && this.mode !== 'flee' && this.mode !== 'cower' && this.mode !== 'fight') {
        if (dist < 55 || type === 'explosion') { if (Math.random() < 0.85) this.flee(x, z, 7 + Math.random() * 6); }
      }
    } else if (this.role === 'gang') {
      if ((type === 'shot' || type === 'explosion') && source && source.isPlayer && this.gang !== GANG.EMERALD && dist < 50 && this.mode !== 'attack') {
        if (G.gangHeat && G.gangHeat[this.gang] > 0 || this.hostile) { this.target = source; this.setMode('attack', 40); }
      }
    }
  }
  flee(x, z, dur = 8) {
    if (this.dead || this.isPlayer) return;
    if (this.role !== 'civ' && this.role !== 'medic' && this.role !== 'worker') return;
    this.fearPos = { x, z }; this.setMode('flee', dur); this.path = null;
    if (G.ambient && Math.random() < 0.4) G.ambient.say(this, pick(['Help!', 'Run!', 'Oh my god!', 'Somebody call the cops!', 'He has a gun!', 'Aaaah!']));
    if (G.audio && Math.random() < 0.35) G.audio.play(this.appearance.gender === 'f' ? 'scream_female' : 'scream_male', { pos: this, volume: 0.6, pitch: rrange(0.9, 1.15) });
  }
  setMode(m, t = 0) { this.mode = m; this.modeT = t; this.stuckT = 0; if (this.life) { const L = this.life; this.life = null; L.cleanup && L.cleanup(this); this.crouch = false; this.aiming = false; } }

  isHostileTo(o) {
    if (!o || o.dead) return false;
    if (this.role === 'cop' || this.role === 'swat') return o.isPlayer ? (G.police && G.police.stars > 0) : (o.hostile && o.role === 'enemy');
    if (this.role === 'gang' || this.role === 'enemy') {
      if (o.isPlayer) return this.hostile || this.aggroT > 0 || (this.gang !== GANG.EMERALD && this.gang && ((G.gangHeat && G.gangHeat[this.gang] > 0) || (G.map.gangAt(o.x, o.z) === this.gang && o.hasGun() && !o.vehicle)));
      if (o.role === 'gang' || o.role === 'enemy' || o.role === 'ally') return o.gang !== this.gang && (o.gang === GANG.EMERALD || this.gang === GANG.EMERALD) && false;
    }
    return false;
  }

  // ---------------------------------------------------------------- vehicle
  enterVehicle(v, seat = 0, instant = false) {
    if (this.dead || this.vehicle || this.ragdollActive() || v.exploded) return false;
    if (seat === 0 && v.driver && v.driver !== this) {
      const d = v.driver; d.exitVehicle(true, true); // carjack
      if (d.role === 'civ' || d.role === 'medic') d.flee(this.x, this.z, 12); else if (d.role === 'gang' && this.isPlayer) { d.target = this; d.setMode('attack', 60); }
      if (this.isPlayer && G.police) G.police.onCarjack(v, d);
    } else if (v.seatPeds[seat] && v.seatPeds[seat] !== this) { seat = v.freeSeat(); if (seat < 0) return false; }
    if (instant) { this._attach(v, seat); return true; }
    if (this.enterVeh === v && (this.enterT > 0 || this.enterWalkT > 0)) return true;
    this.enterVeh = v; this.enterSeat = seat;
    v.seatPeds[seat] = this; if (seat === 0) { v.driver = this; v.wake(); } // reserve
    // not at the door yet: run up to it first (otherwise the body would slide across the map in half a second)
    const dw = v.doorWorldPos(seat);
    if (Math.hypot(dw.x - this.x, dw.z - this.z) > 1.6 && Math.abs(dw.y - this.y) < 3) { this.enterWalkT = 0.3 + Math.min(6, Math.hypot(dw.x - this.x, dw.z - this.z) / 4.5); this.enterWalkMax = this.enterWalkT; return true; }
    this.beginEnter();
    return true;
  }
  cancelEnter() {
    const v = this.enterVeh; if (!v) { this.enterT = 0; this.enterWalkT = 0; return; }
    if (v.seatPeds[this.enterSeat] === this) v.seatPeds[this.enterSeat] = null;
    if (v.driver === this) v.driver = null;
    this.enterVeh = null; this.enterT = 0; this.enterWalkT = 0; this.faceOverride = null; this.speedTarget = 0;
  }
  beginEnter() {
    this.enterWalkT = 0; this.enterT = 0.5; this.enterFrom = { x: this.x, z: this.z, y: this.y };
    this.move.x = this.move.z = 0; this.speedTarget = 0; this.faceOverride = null;
    this.rig.playAction('enter');
  }
  updateEnterWalk(dt) {
    const v = this.enterVeh;
    if (!v || v.exploded || this.dead) { this.cancelEnter(); return; }
    this.enterWalkT -= dt;
    const dw = v.doorWorldPos(this.enterSeat); const dx = dw.x - this.x, dz = dw.z - this.z, d = Math.hypot(dx, dz);
    if (d < 0.9 || this.enterWalkT <= 0) {
      if (v.totalSpeed > 14 || (this.isPlayer && d > 4)) { this.cancelEnter(); return; }   // car is racing away / player lost it: give up
      if (d > 2.5) { this.x = dw.x; this.z = dw.z; this.y = Math.max(this.y, G.world.groundY(dw.x, dw.z)); }   // NPCs never fail to get in (missions rely on it): snap to the door
      this.beginEnter(); return;
    }
    // door on the far side of the car? walk round the nearer end instead of pushing against the bodywork
    let tx = dw.x, tz = dw.z;
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), px = this.x - v.x, pz = this.z - v.z;
    const lx = px * cy - pz * sy, lz = px * sy + pz * cy;
    const hw = v.def.width / 2, hl = v.def.length / 2;
    const dlx = (dw.x - v.x) * cy - (dw.z - v.z) * sy;
    if (lx * dlx < 0 && Math.abs(lx) < hw + 1.6 || (lx * dlx < 0 && Math.abs(lz) < hl + 0.9)) {
      const zs = lz >= 0 ? 1 : -1, xs = lx >= 0 ? 1 : -1;
      if (Math.abs(lz) < hl + 0.7) { // still alongside the body: head for the corner first
        const cxl = xs * (hw + 1.1), czl = zs * (hl + 1.1);
        tx = v.x + cxl * cy + czl * sy; tz = v.z - cxl * sy + czl * cy;
      } else { const cxl = 0, czl = zs * (hl + 1.1); tx = v.x + czl * sy + cxl * cy; tz = v.z + czl * cy - cxl * sy; }
    }
    const wx = tx - this.x, wz = tz - this.z, wd = Math.hypot(wx, wz) || 1;
    this.move.x = wx / wd; this.move.z = wz / wd; this.speedTarget = this.isPlayer ? 6.4 : 5.4; this.faceOverride = Math.atan2(wx, wz);
    this.enterWalkT += dt * 0.5;   // detours take a little longer
    this.physics(dt); this.animate(dt);
  }
  _attach(v, seat) {
    this.vehicle = v; this.seat = seat; this.enterVeh = null; this.enterT = 0;
    v.seatPeds[seat] = this; if (seat === 0) v.driver = this;
    v.wake();
    v.model.group.add(this.group);
    this.group.position.copy(seatPedPos(v, seat)); this.group.rotation.set(0, 0, 0);
    this.rig.setState(v.isBike ? 'bikeride' : seat === 0 ? 'drive' : 'passenger');
    this.vx = this.vz = 0; this.vy = 0;
    this.x = v.x; this.z = v.z; this.y = v.y;
    if (this.isPlayer) G.events.emit('playerEnterVehicle', v);
    G.events.emit('pedEnterVehicle', this, v);
  }
  exitVehicle(forced = false, jacked = false) {
    const v = this.vehicle || this.enterVeh; if (!v) return;
    const seat = this.vehicle ? this.seat : this.enterSeat;
    const w = V3.set(0, 0, 0);
    let ex, ez;
    let sfx = 0, sfy = 0, sfz = 0, slide = false;
    if (this.vehicle) {
      const dw = v.doorWorldPos(seat);
      ex = dw.x; ez = dw.z;
      if (!forced) { this.group.updateWorldMatrix(true, false); V3.setFromMatrixPosition(this.group.matrixWorld); sfx = V3.x; sfy = V3.y; sfz = V3.z; slide = true; }
      v.model.group.remove(this.group); G.scene.add(this.group);
    } else { ex = this.x; ez = this.z; }
    if (v.seatPeds[seat] === this) v.seatPeds[seat] = null;
    if (v.driver === this) v.driver = null;
    this.vehicle = null; this.enterVeh = null; this.enterT = 0; this.enterWalkT = 0; this.seat = -1; this.faceOverride = null;
    this.group.rotation.set(0, 0, 0);
    // place
    const pos = { x: ex, z: ez };
    G.world.pushCircle(pos, 0.4);
    this.x = pos.x; this.z = pos.z; this.y = Math.max(G.world.groundY(this.x, this.z), v.y - v.def.wheelRadius);
    this.yaw = this.faceYaw = v.yaw + (seat === 0 || v.model.seats[seat]?.x >= 0 ? Math.PI / 2 : -Math.PI / 2);
    this.rig.setState('idle');
    if (forced || v.totalSpeed > 6) { this.vx = v.vx * 0.7; this.vz = v.vz * 0.7; if (v.totalSpeed > 8) { this.vy = 2; this.knockdown(1.0); this.damage(Math.max(0, (v.totalSpeed - 8)) * 3.5, { fall: true }); } }
    if (this.isPlayer) G.events.emit('playerExitVehicle', v);
    if (!jacked) G.events.emit('pedExitVehicle', this, v);
    this.group.position.set(this.x, this.y, this.z);
    // visual only: the body slides from the seat out through the door over a quarter second
    if (slide && !(v.totalSpeed > 6)) this.exitSlide = { dx: sfx - this.x, dy: sfy - this.y, dz: sfz - this.z, t: 0.26 };
  }

  // ---------------------------------------------------------------- actions
  attackMelee() {
    if (this.attackT > 0 || this.dead || this.vehicle || this.downT > 0) return false;
    const wid = this.weaponId; const W = this.weapon;
    let act = 'punch', dur = 0.42;
    if (wid === 'bat') { act = 'bat'; dur = 0.7; }
    else if (wid === 'knife') { act = 'knife'; dur = 0.45; }
    else { this.combo = (this.combo + 1) % 3; act = this.combo === 0 ? 'punch' : this.combo === 1 ? 'punch2' : 'kick'; dur = this.combo === 2 ? 0.55 : 0.4; }
    this.attackT = dur; this.rig.playAction(act);
    this.pendingHit = { t: dur * 0.4, wid, combo: this.combo };
    G.audio && G.audio.play(wid === 'bat' ? 'swing_bat' : (act === 'kick' ? 'kick' : 'punch'), { pos: this, volume: 0.6 });
    if (G.combat) G.combat.noise(this.x, this.z, W.noise || 6, this, 'fight');
    return true;
  }
  // fire the current gun at a world point; returns true if fired
  shootAt(tx, ty, tz, opts = {}) {
    const W = this.weapon; if (!this.hasGun() || this.cool > 0 || this.reloadT > 0) return false;
    const slot = this.wslot;
    if (slot.clip <= 0) { if (!opts.infinite && slot.ammo <= 0) { if (this.isPlayer) G.audio && G.audio.play('empty_click'); this.cool = 0.3; return false; } this.reload(); return false; }
    const m = this.rig.getMuzzleWorldPos ? this.rig.getMuzzleWorldPos() : V3.set(this.x, this.y + 1.4, this.z);
    let ox = m.x, oy = m.y, oz = m.z;
    let dx = tx - ox, dy = ty - oy, dz = tz - oz; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    if (W.kind === 'throw' || W.kind === 'rpg') { G.combat.launch(this, this.weaponId, ox, oy, oz, dx, dy, dz, clamp(l / 18, 0.5, 1.4), W.kind === 'throw' ? l : null); }
    else G.combat.fire(this, this.weaponId, ox, oy, oz, dx, dy, dz, opts);
    if (!opts.infinite || this.isPlayer) slot.clip--;
    else slot.clip = Math.max(slot.clip - 1, 0);
    this.cool = (W.rate || 0.3) * (opts.rateMul ?? 1);
    this.rig.playAction('fire');
    if (W.kind === 'throw') { this.rig.playAction('throw'); if (slot.clip <= 0 && slot.ammo > 0) { slot.clip = 1; slot.ammo--; } else if (slot.clip <= 0) { delete this.weapons[this.weaponId]; this.equip('fist'); } }
    else if (W.id === 'rpg' && slot.clip <= 0 && slot.ammo <= 0) { delete this.weapons.rpg; this.equip('fist'); }
    return true;
  }
  reload() {
    const W = this.weapon, s = this.wslot;
    if (!this.hasGun() || this.reloadT > 0 || s.clip >= W.clip || s.ammo <= 0 && !this.infiniteAmmo) return;
    this.reloadT = W.reload || 1.5; this.rig.playAction('reload'); G.audio && G.audio.play('reload', { pos: this, volume: 0.6 });
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 3.5); this.rig.setHitFlash && this.rig.setHitFlash(this.flash); }
    if (this.dead) return this.updateDead(dt);
    this.cool = Math.max(0, this.cool - dt);
    if (this.attackT > 0) {
      this.attackT -= dt;
      if (this.pendingHit) { this.pendingHit.t -= dt; if (this.pendingHit.t <= 0) { G.combat.melee(this, this.pendingHit.wid, this.pendingHit.combo); this.pendingHit = null; } }
    }
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const W = this.weapon, s = this.wslot; const need = W.clip - s.clip; const take = this.infiniteAmmo ? need : Math.min(need, s.ammo); s.clip += take; if (!this.infiniteAmmo) s.ammo -= take; } }
    if (this.aggroT > 0) this.aggroT -= dt;
    if (this.enterWalkT > 0) { this.updateEnterWalk(dt); return; }
    if (this.enterT > 0) { this.updateEntering(dt); return; }
    if (this.vehicle) { this.updateSeated(dt); return; }
    if (this.downT > 0 || this.ragdollActive()) { this.updateDown(dt); return; }
    const gettingUp = !!(this.rig.act && this.rig.act.name === 'getup');
    if (!gettingUp) this.think(dt);
    else { this.move.x = this.move.z = 0; this.speedTarget = 0; }
    if (this.life && this.life.frozen) { lifeStatic(this, dt); return; }
    this.physics(dt);
    this.animate(dt);
  }

  updateEntering(dt) {
    const v = this.enterVeh; if (!v || v.exploded) { this.enterT = 0; this.enterVeh = null; return; }
    this.enterT -= dt; const t = 1 - clamp(this.enterT / 0.5, 0, 1);
    const sp = v.seatWorldPos(this.enterSeat, V3);
    this.x = lerp(this.enterFrom.x, sp.x, t); this.z = lerp(this.enterFrom.z, sp.z, t);
    // slide in through the door, rising onto the seat during the second half
    const sp2 = seatPedPos(v, this.enterSeat, _ev); const seatY = v.y - v.def.wheelRadius + sp2.y;
    this.y = lerp(this.enterFrom.y, Math.max(this.enterFrom.y, seatY), t * t);
    const seated = t > 0.55;
    this.yaw = dampAngle(this.yaw, seated ? v.yaw : v.yaw + (v.model.seats[this.enterSeat]?.x >= 0 ? -Math.PI / 2 : Math.PI / 2), 10, dt);
    this.group.position.set(this.x, this.y, this.z); this.group.rotation.y = this.yaw;
    if (seated) this.rig.setState(v.isBike ? 'bikeride' : this.enterSeat === 0 ? 'drive' : 'passenger');
    this.rig.update(dt, { speed: 0 });
    if (this.enterT <= 0) this._attach(v, this.enterSeat);
  }
  updateSeated(dt) {
    const v = this.vehicle;
    this.x = v.x; this.z = v.z; this.y = v.y;
    this.rig.update(dt, { speed: 0, steer: v.steerCur ? v.steerCur / Math.max(0.1, v.phys.steer) : 0, aiming: this.aiming, aimPitch: this.aimPitch, lean: v.lean });
    this.cool = Math.max(0, this.cool);
    if (!this.isPlayer) this.think(dt);
  }
  updateDown(dt) {
    if (this.ragdollActive()) {   // limp body: the ragdoll owns the visuals until the stun timer runs out
      this.downT -= dt; this.downElapsed += dt;
      if (this.enterVeh) this.cancelEnter();
      this.rag.step(dt); this.rag.syncPed();
      if (this.downT <= 0) this.recoverRagdoll();
      return;
    }
    this.downT -= dt; this.downElapsed += dt;
    this.rig.setDeadPose && this.rig.setDeadPose(clamp(this.downElapsed / 0.35, 0, 1));
    // slide
    this.vx *= Math.exp(-dt * 4); this.vz *= Math.exp(-dt * 4);
    this.physicsMove(dt);
    if (this.downT <= 0) { this.rig.playAction('getup'); }
    this.rig.update(dt, { speed: 0 });
    this.syncGroup();
  }
  updateDead(dt) {
    this.deadT += dt;
    if (this.ragdollActive()) {
      this.rag.step(dt); this.rag.syncPed();
    } else {
      this.rig.setDeadPose(clamp(this.deadT / 0.6, 0, 1));
      this.vx *= Math.exp(-dt * 4); this.vz *= Math.exp(-dt * 4);
      if (!this.vehicle) this.physicsMove(dt);
      this.rig.update(dt, { speed: 0 });
      this.syncGroup();
    }
    if (this.deadT > 28 && !this.isPlayer && !this.mission) { this.fadeOut += dt; this.group.position.y -= dt * 0.3; if (this.fadeOut > 3) this.removeMe = true; }
  }

  // ---------------------------------------------------------------- ragdoll
  ragdollActive() { return !!(this.rag && this.rag.active); }
  /** throw the body into a physical ragdoll (car impacts, combat stuns, death).  o: {vx, vy, vz, spin, axis, dur}. */
  startRagdoll(o = {}) {
    if (this.vehicle) return false;
    if (!this.rag) {
      if (!this.isPlayer && Ragdoll.count >= Ragdoll.MAX) return false;
      this.rag = new Ragdoll(this);
    }
    if (this.enterVeh) this.cancelEnter();
    this.rag.start(o);
    if (!this.dead) { this.downT = Math.max(this.downT, o.dur ?? 1.4); this.downElapsed = 0; }
    this.attackT = 0; this.pendingHit = null; this.aiming = false;
    this.speedTarget = 0; this.move.x = this.move.z = 0;
    return true;
  }
  /** stand back up where the ragdoll left off (the get-up action starts from the settled pose instead of popping). */
  recoverRagdoll() {
    const R = this.rag; if (!R || !R.active) return;
    const cap = R.capture();
    R.stop();
    this.x = cap.x; this.z = cap.z; this.y = cap.y;
    this.yaw = this.faceYaw = cap.yaw; this.faceOverride = null;
    this.downT = 0; this.downElapsed = 0;
    this.vx = this.vz = this.vy = 0; this.grounded = true; this.airborneT = 0;
    const g = this.group;
    g.position.set(this.x, this.y, this.z);
    g.quaternion.identity();
    g.rotation.set(0, cap.yaw, 0);
    this.rig.setGetupPose(cap.pose, cap.face);
    this.rig.playAction('getup');
  }

  think(dt) {
    // default: stand still. subclasses / brains override via this.brain(p,dt)
    if (this.brain) this.brain(this, dt); else if (!(this.life && !this.vehicle && lifeBrain(this, dt))) runBrain(this, dt);
  }

  // movement intent → velocity → collisions → ground
  physics(dt) {
    const W = G.world;
    // swimming?
    const gy = W.groundY(this.x, this.z);
    const depth = -gy;
    const wasSwim = this.swimming;
    this.swimming = depth > 0.75 && this.y < 0.2;
    if (this.swimming && !wasSwim) { G.fx.splash(this.x, this.z, 10, 1); G.audio && G.audio.play('splash', { pos: this }); this.vy = 0; }
    let spd = this.speedTarget;
    if (this.swimming) spd = Math.min(spd, 2.4);
    const tvx = this.move.x * spd, tvz = this.move.z * spd;
    const accel = this.grounded ? 14 : 2.5;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (tvx - this.vx) * k; this.vz += (tvz - this.vz) * k;
    // face
    const moving = Math.hypot(this.vx, this.vz) > 0.3;
    if (this.faceOverride !== undefined && this.faceOverride !== null) this.yaw = dampAngle(this.yaw, this.faceOverride, 14, dt);
    else if (moving) this.yaw = dampAngle(this.yaw, Math.atan2(this.vx, this.vz), 11, dt);
    this.physicsMove(dt);
  }
  physicsMove(dt) {
    const W = G.world;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // static collisions
    const pos = this._pos || (this._pos = { x: 0, z: 0 }); pos.x = this.x; pos.z = this.z;
    if (W.pushCircle(pos, 0.36 * this.scale)) { this.x = pos.x; this.z = pos.z; }
    // world bounds
    const lim = 1012; this.x = clamp(this.x, -lim, lim); this.z = clamp(this.z, -lim, lim);
    // ped-ped separation
    if (G.peds && !this.isPlayer) G.peds.separate(this, dt);
    // vertical
    const gy = W.groundY(this.x, this.z);
    if (this.swimming) { this.y = lerp(this.y, -0.55, 1 - Math.exp(-dt * 6)); this.vy = 0; this.grounded = false; }
    else {
      if (this.y > gy + 0.06 || this.vy > 0) {
        this.vy -= 22 * dt; this.y += this.vy * dt; this.grounded = false; this.airborneT += dt;
        if (this.y <= gy) {
          const impact = -this.vy; this.y = gy; this.vy = 0; this.grounded = true;
          if (impact > 12.5 && !this.dead) this.damage((impact - 12) * 10, { fall: true });
          if (impact > 5 && !this.dead) G.audio && G.audio.play('hit_body_fall', { pos: this, volume: 0.4 });
          this.airborneT = 0;
        }
      } else { // stick to ground
        this.y = this.y + (gy - this.y) * Math.min(1, dt * 22); this.grounded = true; this.airborneT = 0;
        // step down speed
      }
    }
  }
  syncGroup(dt = 0.016) {
    this.group.position.set(this.x, this.y, this.z);
    const es = this.exitSlide;
    if (es) { es.t -= dt; const k = Math.max(0, es.t / 0.26); const kk = k * k * (3 - 2 * k); if (es.t <= 0) this.exitSlide = null; else this.group.position.set(this.x + es.dx * kk, this.y + es.dy * kk, this.z + es.dz * kk); }
    this.group.rotation.y = this.yaw;
  }
  animate(dt) {
    const sp = Math.hypot(this.vx, this.vz);
    let st = 'idle';
    if (this.swimming) st = 'swim';
    else if (!this.grounded && this.airborneT > 0.12) st = this.vy > 0 ? 'jump' : 'fall';
    else if (this.crouch) st = 'crouch';
    else if (this.mode === 'cower') st = 'cower';
    else if (this.phoneT > 0) { st = sp < 0.4 ? 'phone' : 'walk'; this.phoneT -= dt; }
    else if (sp > 4.9) st = 'sprint'; else if (sp > 2.6) st = 'run'; else if (sp > 0.35) st = 'walk';
    if (this.mode === 'dance') st = 'dance';
    this.rig.setState(st);
    this.rig.update(dt, { speed: sp, aiming: this.aiming, aimPitch: this.aimPitch, lean: 0 });
    this.syncGroup(dt);
  }

  dispose() {
    if (this.rag) { this.rag.stop(); this.rag = null; }
    if (this.vehicle) { const v = this.vehicle; if (v.seatPeds[this.seat] === this) v.seatPeds[this.seat] = null; if (v.driver === this) v.driver = null; v.model.group.remove(this.group); }
    G.scene.remove(this.group); this.rig.dispose && this.rig.dispose();
  }
}

// ======================================================================= brains
function runBrain(p, dt) {
  if (p.vehicle) { return seatedBrain(p, dt); }
  switch (p.role) {
    case 'gang': case 'enemy': return gangBrain(p, dt);
    case 'cop': case 'swat': return copBrain(p, dt);
    case 'ally': return allyBrain(p, dt);
    case 'script': return scriptBrain(p, dt);
    default: return civBrain(p, dt);
  }
}

function seatedBrain(p, dt) {
  const v = p.vehicle;
  if (!v) return;
  // passengers (and riders of non-moving cars) can shoot from windows
  if (p.role === 'cop' && p.seat > 0 && G.police && G.police.stars >= 3 && !(G.game && G.game.inCutscene)) {
    const pl = G.player; if (pl && !pl.dead && dist2(p.x, p.z, pl.x, pl.z) < 30 * 30) { p.aiming = true; p.aimPitch = 0; if (p.cool <= 0) { const e = aimError(p, pl, Math.hypot(pl.x - p.x, pl.z - p.z)); p.shootAt(pl.x + e.x, pl.y + 1.2 + e.y, pl.z + e.z, { infinite: true, rateMul: 2.2, spreadMul: 2 }); } } else p.aiming = false;
    return;
  }
  if ((p.role === 'gang' || p.role === 'enemy') && (p.seat > 0 || (p.seat === 0 && v.ai === null)) && (p.aggroT > 0 || p.hostile)) {
    const t = (p.target && !p.target.dead) ? p.target : G.player;
    if (t && !t.dead && dist2(p.x, p.z, t.x, t.z) < 38 * 38 && p.hasGun()) { p.aiming = true; if (p.cool <= 0) { const e = aimError(p, t, Math.hypot(t.x - p.x, t.z - p.z)); p.shootAt(t.x + e.x, t.y + 1.2 + e.y, t.z + e.z, { infinite: true, rateMul: 2, spreadMul: 2 }); } } else p.aiming = false;
    return;
  }
  if (p.role === 'ally' && p.seat > 0 && p.hasGun()) {
    let best = null, bd = 34 * 34;
    for (const q of G.peds.list) { if (q.dead || q === p || q.isPlayer || q.vehicle && q.vehicle === v) continue; if (!(q.hostile || q.role === 'enemy' || (q.role === 'gang' && q.aggroT > 0))) continue; const d = dist2(q.x, q.z, p.x, p.z); if (d < bd) { bd = d; best = q; } }
    if (best) { p.aiming = true; if (p.cool <= 0) { const e = aimError(p, best, Math.sqrt(bd)); p.shootAt(best.x + e.x, best.y + 1.2 + e.y, best.z + e.z, { infinite: true, rateMul: 2, spreadMul: 2 }); } } else p.aiming = false;
  }
}

// --- walking along sidewalks
function pedPathInit(p, preferNear = true) {
  const map = G.map;
  const nr = map.nearestRoad(p.x, p.z, 60); if (!nr) return false;
  const e = nr.edge;
  const left = Math.random() < 0.5 ? 1 : -1;
  p.path = { edge: e, dir: Math.random() < 0.5 ? 1 : -1, s: nr.s, side: left };
  return true;
}
function pathPoint(p, s, out) {
  const pa = p.path, e = pa.edge; edgePointAt(e, clamp(s, 0, e.len), out);
  const nx = out.tz, nz = -out.tx; // left normal
  const off = (e.w / 2 + 1.7) * pa.side;
  out.x += nx * off; out.z += nz * off;
  // the drawn road is a little wider than the graph edge says: nudge the target out until it really is on the pavement
  const map = G.map, sx = nx * pa.side, sz = nz * pa.side;
  for (let i = 0; i < 2; i++) { const rd = map.roadDistAt(out.x, out.z); if (rd >= 1.3) break; out.x += sx * (1.6 - rd); out.z += sz * (1.6 - rd); }
  return out;
}
const _pp = {};
function walkPath(p, dt, speed, depth = 0) {
  if (depth > 3) { p.move.x = p.move.z = 0; p.speedTarget = 0; return; }
  if (!p.path && !pedPathInit(p)) { p.move.x = p.move.z = 0; p.speedTarget = 0; return; }
  const pa = p.path, e = pa.edge;
  // progress: project onto edge
  const look = 3.5;
  const nr = G.map.nearestRoad(p.x, p.z, 40);
  if (nr && nr.edge === e) pa.s = nr.s;
  else if (nr && dist2(p.x, p.z, nr.x, nr.z) < 25 * 25 && Math.random() < 0.5) { /* crossing onto other edge */ }
  const along = pa.s + pa.dir * look;
  let tx, tz;
  if (along > e.len - 1 || along < 1) {
    // approaching a node: choose next edge
    const node = G.map.nodes[pa.dir > 0 ? e.b : e.a];
    if (dist2(p.x, p.z, node.x, node.z) < (node.maxW / 2 + 5) ** 2 || !nr) {
      const opts = node.edges.filter(id => id !== e.id);
      const nid = opts.length ? opts[(Math.random() * opts.length) | 0] : e.id;
      const ne = G.map.edges[nid]; const nd = ne.a === node.id ? 1 : -1;
      p.path = { edge: ne, dir: ne === e ? -pa.dir : nd, s: nd > 0 || ne === e ? 0 : ne.len, side: Math.random() < 0.6 ? pa.side : -pa.side };
      if (ne === e) p.path.s = pa.dir > 0 ? e.len : 0;
      p.path.s = (p.path.dir > 0) ? 0 : ne.len;
      return walkPath(p, dt, speed, depth + 1);
    }
    pathPoint(p, pa.dir > 0 ? e.len : 0, _pp); tx = _pp.x; tz = _pp.z;
  } else { pathPoint(p, along, _pp); tx = _pp.x; tz = _pp.z; }
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1;
  p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = speed * (G.map.roadDistAt(p.x, p.z) < 0 ? 1.35 : 1); // hurry across the roadway
}

function avoidTraffic(p) {
  // stop if a moving vehicle is about to run us over while we're on/near the road
  if (!G.vehicles) return false;
  const rd = G.map.roadDistAt(p.x, p.z);
  if (rd > 3.5) return false;
  const mx = p.move.x, mz = p.move.z;
  for (const v of G.vehicles.list) {
    if (v.totalSpeed < 2) continue;
    const dx = p.x - v.x, dz = p.z - v.z; const d2 = dx * dx + dz * dz; if (d2 > 26 * 26) continue;
    const vf = v.forward; const ahead = dx * vf.x + dz * vf.z; if (ahead < 0 || ahead > 18) continue;
    const lat = Math.abs(dx * vf.z - dz * vf.x); if (lat > v.def.width / 2 + 1.6) continue;
    return true;
  }
  return false;
}

// Pedestrian signals: before stepping off the kerb onto a road next to a traffic light, wait until the cars on that road have a red.
function waitForSignal(p, dt) {
  const nav = G.nav; if (!nav || !nav.sigByNode.size) return false;
  if (p.sigWait) {
    const w = p.sigWait; w.t += dt;
    const st = nav.lightState(w.node, w.axis);
    if (st === 'red' || w.t > 28 || G.map.roadDistAt(p.x, p.z) < 0) { p.sigWait = null; p.sigFree = G.time + 9; return false; }   // cars are stopped (or we have waited long enough): go
    p.move.x = p.move.z = 0; p.speedTarget = 0; p.faceOverride = w.face; return true;
  }
  if (G.time < p.sigFree) return false;
  const rd = G.map.roadDistAt(p.x, p.z); if (rd < 0 || rd > 2.6) return false;
  const mx = p.move.x, mz = p.move.z; if (mx * mx + mz * mz < 0.01) return false;
  if (G.map.roadDistAt(p.x + mx * 2.4, p.z + mz * 2.4) >= 0) return false;      // not about to step onto the carriageway
  const nr = G.map.nearestRoad(p.x + mx * 2.4, p.z + mz * 2.4, 10); if (!nr) return false;
  const e = nr.edge, na = G.map.nodes[e.a], nb = G.map.nodes[e.b];
  const da = dist2(na.x, na.z, p.x, p.z), db = dist2(nb.x, nb.z, p.x, p.z);
  const node = da < db ? na : nb, dd = Math.min(da, db);
  if (!nav.sigByNode.has(node.id) || dd > (node.maxW / 2 + 16) ** 2) return false;
  const axis = Math.abs(nr.tx) > Math.abs(nr.tz) ? 0 : 1;
  if (nav.lightState(node.id, axis) === 'red') return false;
  p.sigWait = { node: node.id, axis, t: 0, face: Math.atan2(nr.x - p.x, nr.z - p.z) };
  p.move.x = p.move.z = 0; p.speedTarget = 0; return true;
}

function civBrain(p, dt) {
  p.modeT -= dt;
  if (p.mode !== 'fight' && p.faceOverride != null && !(p.lookT > 0) && !p.sigWait) p.faceOverride = null;
  switch (p.mode) {
    case 'flee': {
      if (!p.fearPos) { p.setMode('walk'); break; }
      const dx = p.x - p.fearPos.x, dz = p.z - p.fearPos.z, d = Math.hypot(dx, dz) || 1;
      let mx = dx / d, mz = dz / d;
      if (p.unstuckT > 0) { const a = Math.atan2(mx, mz) + p.unstuckDir; mx = Math.sin(a); mz = Math.cos(a); p.unstuckT -= dt; }
      p.move.x = mx; p.move.z = mz; p.speedTarget = 5.2; p.aiming = false;
      trackStuck(p, dt);
      if (p.modeT <= 0) { if (Math.random() < 0.4) p.setMode('cower', 4 + Math.random() * 4); else { p.setMode('walk'); p.path = null; } }
      break;
    }
    case 'cower': p.move.x = p.move.z = 0; p.speedTarget = 0; if (p.modeT <= 0) { p.setMode('walk'); p.path = null; } break;
    case 'fight': {
      const t = p.target; if (!t || t.dead || p.modeT <= 0) { p.setMode('walk'); p.path = null; p.target = null; p.faceOverride = null; p.duel = false; break; }
      if (p.duel && (p.health < p.maxHealth * 0.55 || t.health < t.maxHealth * 0.55)) {   // a bar fight ends when somebody has had enough
        const loser = p.health < t.health ? p : t; const winner = loser === p ? t : p;
        p.setMode('walk'); p.path = null; p.target = null; p.faceOverride = null; p.duel = false;
        if (loser === p && p.role === 'civ') { p.flee(t.x, t.z, 9); } break;
      }
      meleeChase(p, t, dt);
      break;
    }
    case 'idle': p.move.x = p.move.z = 0; p.speedTarget = 0; if (p.modeT <= 0) p.setMode('walk'); break;
    case 'dance': p.move.x = p.move.z = 0; p.speedTarget = 0; break;
    default: { // walk
      p.aiming = false;
      if (p.lookT > 0) {   // glance at whatever made the noise / the player passing close by
        p.lookT -= dt; const la = p.lookAt || G.player;
        if (la) { p.faceOverride = Math.atan2(la.x - p.x, la.z - p.z); if (p.lookT > 0.5) { p.move.x = p.move.z = 0; p.speedTarget = 0; break; } }
      }
      if (avoidTraffic(p)) { p.move.x = p.move.z = 0; p.speedTarget = 0; break; }
      walkPath(p, dt, (p.walkSpeed || (1.3 + (p.id % 7) * 0.05)) * (G.sky && G.sky.rain > 0.3 ? 1 + G.sky.rain * 0.35 : 1));   // people hurry through the rain
      if (!p.mission && waitForSignal(p, dt)) break;
      if (Math.random() < dt * 0.02) { p.setMode(Math.random() < 0.5 ? 'idle' : 'idle', 2 + Math.random() * 5); if (Math.random() < 0.4) p.phoneT = 6; }
      trackStuck(p, dt, true);
    }
  }
}

function trackStuck(p, dt, repath = false) {
  p.stuckT += dt;
  if (p.stuckT > 0.8) {
    const moved = Math.hypot(p.x - p.lastPos.x, p.z - p.lastPos.z);
    if (moved < 0.35 * p.stuckT * Math.max(0.4, p.speedTarget) * 0.5 && p.speedTarget > 0.5) { p.unstuckT = 0.7; p.unstuckDir = (Math.random() < 0.5 ? 1 : -1) * rrange(1.0, 2.4); if (repath) p.path = null; }
    p.lastPos.x = p.x; p.lastPos.z = p.z; p.stuckT = 0;
  }
}

function meleeChase(p, t, dt) {
  const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
  p.faceOverride = Math.atan2(dx, dz);
  if (d > 1.3) { p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = d > 6 ? 5 : 2.8; }
  else { p.move.x = p.move.z = 0; p.speedTarget = 0; if (p.cool <= 0) { p.attackMelee(); p.cool = 0.5 + Math.random() * 0.4; } }
  p.aiming = false;
}

// aiming error (metres at the target) for NPC gunmen: gets worse with range and with a moving target, better with skill.
// skill 0.4 (gangster) standing target: ~27% of pistol shots hit at 10 m, ~13% at 25 m; a sprinting player is much harder to hit.
function aimGauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 2; }
function aimError(p, t, d) {
  const tsp = t.vehicle ? t.vehicle.totalSpeed : Math.hypot(t.vx || 0, t.vz || 0);
  const sigma = (1 - p.skillAcc) * (0.9 + d * 0.045) + Math.min(tsp, 25) * 0.1;
  return { x: aimGauss() * sigma, z: aimGauss() * sigma, y: aimGauss() * sigma * 0.6 };
}

// shared combat movement: approach / strafe / shoot. returns distance.
function combatMove(p, t, dt, prefer) {
  const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
  const W = p.weapon; const gun = p.hasGun();
  const tx = t.x, ty = t.y + (t.vehicle ? 1.2 : 1.2), tz = t.z;
  p.faceOverride = Math.atan2(dx, dz);
  let los = true;
  if (d < 90) { const r = G.world.raycast(p.x, p.z, t.x, t.z, p.y + 1.4, t.y + 1.2); los = !r; }
  if (!gun) { meleeChase(p, t, dt); return d; }
  const pref = prefer || (W.kind === 'long' ? 22 : 14);
  p.strafeT -= dt; if (p.strafeT <= 0) { p.strafeT = rrange(1.2, 3); p.strafe = Math.random() < 0.5 ? 1 : -1; }
  let mx = 0, mz = 0, sp = 0;
  if (d > pref + 3 || !los) { mx = dx / d; mz = dz / d; sp = d > pref + 14 ? 5.2 : 3.6; }
  else if (d < pref * 0.45) { mx = -dx / d; mz = -dz / d; sp = 2.2; }
  else { mx = -dz / d * p.strafe; mz = dx / d * p.strafe; sp = 1.8; }
  if (p.unstuckT > 0) { const a = Math.atan2(mx, mz) + p.unstuckDir; mx = Math.sin(a); mz = Math.cos(a); p.unstuckT -= dt; sp = Math.max(sp, 3); }
  p.move.x = mx; p.move.z = mz; p.speedTarget = sp;
  trackStuck(p, dt);
  p.aiming = los && d < (W.range || 60) * 0.8;
  p.aimPitch = 0;
  if (p.aiming) {
    p.aimT += dt;
    if (p.aimT > 0.45 && p.cool <= 0) {
      const e = aimError(p, t, d);
      p.shootAt(tx + e.x, ty + e.y, tz + e.z, { infinite: true, rateMul: W.auto ? 1.8 : 2.0, spreadMul: 1.5 });
      if (W.auto && Math.random() < 0.12) p.cool += 0.6;
    }
  } else p.aimT = 0;
  return d;
}

function gangBrain(p, dt) {
  p.faceOverride = null;
  const pl = G.player;
  // allies to player (Emerald Row) help in fights
  if (p.gang === GANG.EMERALD && p.role !== 'enemy') return allyBrain(p, dt);
  switch (p.mode) {
    case 'attack': {
      const t = p.target && !p.target.dead ? p.target : (pl && !pl.dead ? pl : null);
      p.modeT -= dt;
      if (!t || p.modeT <= 0 || dist2(p.x, p.z, t.x, t.z) > 90 * 90) { p.setMode('loiter'); p.target = null; p.aiming = false; p.faceOverride = null; break; }
      combatMove(p, t, dt, p.weapon.kind === 'long' ? 18 : 11);
      break;
    }
    case 'flee': civBrain(p, dt); break;
    case 'walk': {
      p.aiming = false;
      if (scanPlayerThreat(p)) break;
      walkPath(p, dt, 1.4); trackStuck(p, dt, true);
      if (Math.random() < dt * 0.03) p.setMode('loiter', 8 + Math.random() * 12);
      break;
    }
    default: { // loiter
      p.aiming = false; p.move.x = p.move.z = 0; p.speedTarget = 0;
      if (scanPlayerThreat(p)) break;
      // wander a bit near home
      p.modeT -= dt; if (p.modeT <= 0) { p.modeT = 6 + Math.random() * 10; if (Math.random() < 0.35) { p.setMode('walk'); p.path = null; } else if (Math.random() < 0.3) p.phoneT = 5; }
      if (p.role === 'enemy' && p.guard) { const dx = p.home.x - p.x, dz = p.home.z - p.z; if (dx * dx + dz * dz > 25) { const d = Math.hypot(dx, dz); p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = 1.8; } }
    }
  }
}
function scanPlayerThreat(p) {
  const pl = G.player; if (!pl || pl.dead) return false;
  if (p.isHostileTo(pl) && dist2(p.x, p.z, pl.x, pl.z) < (p.sightRange || 38) ** 2) {
    p.target = pl; p.setMode('attack', 45); p.aggroT = Math.max(p.aggroT, 20);
    if (!p.hasGun() && p.role === 'gang') { /* melee */ }
    return true;
  }
  return false;
}

function allyBrain(p, dt) {
  const pl = G.player; p.faceOverride = null;
  if (p.health < p.maxHealth) p.health = Math.min(p.maxHealth, p.health + dt * 3.5);
  // find enemy to fight near the player
  let enemy = null, bd = 1e9;
  if (p.followPlayer !== false) {
    for (const q of G.peds.list) {
      if (q.dead || q === p || q.isPlayer) continue;
      if (!(q.hostile || (q.role === 'enemy') || ((q.role === 'gang') && q.gang !== p.gang && q.aggroT > 0))) continue;
      const d = dist2(q.x, q.z, p.x, p.z); if (d < 38 * 38 && d < bd) { bd = d; enemy = q; }
    }
  }
  if (enemy) { p.aiming = true; combatMove(p, enemy, dt, 13); return; }
  p.aiming = false;
  if (p.followPlayer && pl && !pl.dead) {
    const dx = pl.x - p.x, dz = pl.z - p.z, d = Math.hypot(dx, dz);
    if (d > 6) { p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = d > 14 ? 5 : 2.6; } else { p.move.x = p.move.z = 0; p.speedTarget = 0; }
    trackStuck(p, dt);
    if (d > 70) { p.x = pl.x + 3; p.z = pl.z + 3; }
    return;
  }
  // otherwise idle / civilian-like
  if (p.mode === 'flee') return civBrain(p, dt);
  if (p.mode === 'walk') { walkPath(p, dt, 1.3); trackStuck(p, dt, true); if (Math.random() < dt * 0.03) p.setMode('loiter', 8); return; }
  p.move.x = p.move.z = 0; p.speedTarget = 0; p.modeT -= dt; if (p.modeT <= 0) { p.modeT = 8 + Math.random() * 10; if (Math.random() < 0.3) { p.setMode('walk'); p.path = null; } else p.mode = 'loiter'; }
}

function copBrain(p, dt) {
  p.faceOverride = null;
  const pl = G.player; const stars = G.police ? G.police.stars : 0;
  if (p.mode === 'flee') return civBrain(p, dt);
  // during a cutscene the police stand down and let the scene play; the pursuit resumes afterwards
  if (G.game && G.game.inCutscene) { p.aiming = false; p.target = null; p.move.x = p.move.z = 0; p.speedTarget = 0; return; }
  if (stars > 0 && pl && !pl.dead) {
    p.target = pl;
    const d = dist2(p.x, p.z, pl.x, pl.z);
    if (d > 130 * 130 && !p.mission) { p.move.x = p.move.z = 0; p.speedTarget = 0; return; }
    if (stars <= 1 && !pl.hasGunDrawn() || (stars <= 2 && !G.police.playerArmedRecently)) {
      // arrest mode: run up to the suspect and cuff them (no punching: the player is being detained, not beaten up)
      const dd = Math.sqrt(d); p.faceOverride = Math.atan2(pl.x - p.x, pl.z - p.z); p.aiming = false;
      const reach = pl.vehicle ? pl.vehicle.def.length / 2 + 0.9 : 1.5;
      if (dd > reach) { p.move.x = (pl.x - p.x) / dd; p.move.z = (pl.z - p.z) / dd; p.speedTarget = dd > 6 ? 5 : 3.2; trackStuck(p, dt); }
      else { p.move.x = p.move.z = 0; p.speedTarget = 0; G.police.arrestAttempt(p, dt); }
      return;
    }
    combatMove(p, pl, dt, p.weapon.kind === 'long' ? 20 : 12);
    return;
  }
  // patrol
  p.aiming = false;
  walkPath(p, dt, 1.3); trackStuck(p, dt, true);
}

function scriptBrain(p, dt) {
  const s = p.script; p.faceOverride = null;
  if (!s) { p.move.x = p.move.z = 0; p.speedTarget = 0; return; }
  switch (s.type) {
    case 'goto': {
      const dx = s.x - p.x, dz = s.z - p.z, d = Math.hypot(dx, dz);
      if (d < (s.radius || 1.2)) { p.move.x = p.move.z = 0; p.speedTarget = 0; s.done = true; if (s.onArrive) s.onArrive(p); p.script = s.next || null; break; }
      p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = s.speed || 2.4; trackStuck(p, dt);
      if (p.unstuckT > 0) { const a = Math.atan2(p.move.x, p.move.z) + p.unstuckDir; p.move.x = Math.sin(a); p.move.z = Math.cos(a); p.unstuckT -= dt; }
      break;
    }
    case 'attack': { const t = s.target; if (!t || t.dead) { p.script = null; break; } combatMove(p, t, dt, s.prefer); break; }
    case 'follow': { const t = s.target; if (!t) break; const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz); const keep = s.dist || 5; if (d > keep) { p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = d > keep + 10 ? 5.2 : 2.6; } else { p.move.x = p.move.z = 0; p.speedTarget = 0; } trackStuck(p, dt); break; }
    case 'flee': { const t = s.from; const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz) || 1; p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = 5.4; trackStuck(p, dt); break; }
    case 'stand': default: p.move.x = p.move.z = 0; p.speedTarget = 0; if (s.look) p.faceOverride = Math.atan2(s.look.x - p.x, s.look.z - p.z);
  }
}

// ======================================================================= manager
export { walkPath, trackStuck, avoidTraffic, pathPoint, meleeChase };
export class PedManager {
  constructor() { this.list = []; this.hash = new SpatialHash(4); }
  add(p) { this.list.push(p); return p; }
  spawn(o) { const p = new Ped(o); this.list.push(p); return p; }
  remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); p.dispose(); }
  separate(p, dt) {
    const near = this.hash.queryRadius(p.x, p.z, 0.9, this._t || (this._t = []));
    for (const q of near) {
      if (q === p || q.dead || q.vehicle) continue;
      const dx = p.x - q.x, dz = p.z - q.z, d2 = dx * dx + dz * dz; const rr = 0.7;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), push = (rr - d) * 0.5; p.x += dx / d * push; p.z += dz / d * push; }
    }
  }
  update(dt) {
    this.hash.map.clear();
    for (const p of this.list) if (!p.vehicle) this.hash.insertPoint(p, p.x, p.z);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.removeMe) { this.list.splice(i, 1); p.dispose(); continue; }
      p.update(dt);
    }
    // ped vs vehicle
    const V = G.vehicles.list;
    for (const v of V) {
      const sp = v.totalSpeed;
      if (v.wrecked && sp < 0.5) continue;
      const near = this.hash.queryRadius(v.x, v.z, v.radius + 1, this._t2 || (this._t2 = []));
      for (const p of near) {
        if (p.vehicle || p.enterT > 0) continue;
        const hit = circleVsObb(v.obb, p.x, p.z, 0.4);
        if (!hit) continue;
        if (p.y > v.y + v.def.height) continue;
        if (sp > 1.6 && !(v.driver === p)) {
          if (p.dead) { if (sp > 4) { p.vx += v.vx * 0.3; p.vz += v.vz * 0.3; if (p.ragdollActive()) p.rag.impulse(v.vx * 0.45, 0.6, v.vz * 0.45, 0.5); } continue; }
          // one impact per contact: a pedestrian that was just hit (or is lying down) is nudged aside, not damaged every frame
          if (G.time - (p.lastVehHit || -9) < 0.9 || (p.downT > 0 && sp < 5)) {
            p.x += hit.nx * hit.depth; p.z += hit.nz * hit.depth;
            if (p.ragdollActive()) p.rag.impulse(hit.nx * 1.4, 0.15, hit.nz * 1.4, 0.4);
            else { p.vx += hit.nx * 1.5 * dt * 10; p.vz += hit.nz * 1.5 * dt * 10; }
            continue;
          }
          p.lastVehHit = G.time;
          const rel = sp;
          const ax = v.vx / sp, az = v.vz / sp;
          p.damage(rel * rel * 2.4 * (v.phys.mass / 1500) ** 0.4 * (p.isPlayer ? 0.32 : 1), { source: v.driver, vehicle: v, vehicleCrash: true, dirx: ax, dirz: az, vel: { x: v.vx, y: 3 + Math.min(4, rel * 0.2), z: v.vz } });
          p.vx = v.vx * 0.8 + hit.nx * 2; p.vz = v.vz * 0.8 + hit.nz * 2; p.vy = 3 + Math.min(4, rel * 0.2); p.grounded = false; p.airborneT = 0.3;
          // a run-over throws the body into a ragdoll - always (unless the ragdoll budget is exhausted)
          if (!p.dead) p.startRagdoll({ vy: 1.4 + Math.min(3.2, rel * 0.18), spin: Math.min(4.2, 0.5 + rel * 0.15), axis: { x: az, y: 0, z: -ax }, dur: rel > 8 ? 2.2 : 1.3 });
          p.knockdown(rel > 8 ? 2.2 : 1.2);
          v.vx *= 0.96; v.vz *= 0.96;
          G.fx.blood(p.x, p.y + 1, p.z, v.vx / sp, v.vz / sp, 6);
          G.audio && G.audio.play('hit_body_fall', { pos: p, volume: 0.8 });
          if (v.driver && v.driver.isPlayer && G.police) G.police.onRunOver(p, v);
          else if (v.driver && v.ai) v.ai.onRanOver(p);
        } else { p.x += hit.nx * hit.depth; p.z += hit.nz * hit.depth; }
      }
    }
  }
  nearest(x, z, maxD, filter) {
    let best = null, bd = maxD * maxD;
    for (const p of this.list) { if (filter && !filter(p)) continue; const d = dist2(p.x, p.z, x, z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
}
