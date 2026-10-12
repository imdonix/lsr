// The player character: controls, weapons handling, vehicle driving input, stats.
import * as THREE from 'three';
import { G } from './state.js';
import { Ped } from './peds.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, dist2, rrange, smoothstep } from './util.js';
import { look } from './storylib.js';

const _fa = new THREE.Vector3(), _fa2 = new THREE.Vector3();
const SLOT_KEYS = { Digit1: [0, 1], Digit2: [2], Digit3: [3], Digit4: [4], Digit5: [5], Digit6: [6], Digit7: [7], Digit8: [8], Digit9: [9] };
const CHEATS = {
  hesoyam: p => { p.health = p.maxHealth; p.armor = 100; p.money += 250000; G.hud.notify('Health, armor and $250,000 added'); },
  aezakmi: p => { G.police.clear(); G.hud.notify('Wanted level cleared'); },
  leavemealone: p => { G.police.clear(); G.hud.notify('Wanted level cleared'); },
  weaponset: p => { for (const w of ['bat', 'pistol', 'deagle', 'shotgun', 'smg', 'ak47', 'sniper', 'rpg', 'grenade', 'molotov']) p.give(w, WEAPONS[w].pack * 4, false); G.hud.notify('Weapons added'); },
  bigbang: p => { for (const v of G.vehicles.list) if (v !== p.vehicle && v.totalSpeed < 100 && dist2(v.x, v.z, p.x, p.z) < 80 * 80) v.blowUp(p); },
  speedfreak: p => { G.hud.notify('Nitro not installed. Try flooring it.'); },
  thugstools: p => CHEATS.weaponset(p),
  nightfall: p => { G.sky.hour = 23; },
  sunrise: p => { G.sky.hour = 8; },
  goodday: p => { G.sky.setWeather('clear'); G.sky.lockWeather = true; },
  catchacar: p => { const t = ['sports', 'muscle', 'lowrider', 'coupe'][(Math.random() * 4) | 0]; const f = p.forwardVec(); const v = G.vehicles.spawn(t, p.x + f.x * 5, p.z + f.z * 5, p.yaw, { owner: 'player' }); v.wake(); G.hud.notify('Vehicle delivered'); },
  cheatmode: p => { G.hud.notify('Cheats: hesoyam, weaponset, aezakmi, catchacar, nightfall, sunrise, goodday, bigbang'); }
};

export class Player extends Ped {
  constructor(x, z) {
    super({ x, z, yaw: 0, role: 'player', gang: 1, health: 150, appearance: look('jay') });
    this.appearance.name = 'Jay';
    this.isPlayer = true;
    this.maxHealth = 150; this.health = 150; this.armor = 0;
    this.money = 500; this.respect = 0; this.stamina = 100; this.maxStamina = 100;
    this.aimMode = false; this.lockTarget = null; this.sprinting = false;
    this.stats = { kills: 0, copKills: 0, distance: 0, carsStolen: 0, moneyEarned: 0, missions: 0, deaths: 0, busted: 0, playTime: 0, tags: 0, headshots: 0 };
    this.give('fist', 0, false);
    this.give('bat', 0, false); this.equip('fist');
    this.stepT = 0; this.cheatBuf = '';
    this.lastInVeh = null;
    this.controlEnabled = true;
    this.invHit = 0;
    this.scopeZoom = 0;
    this.noDespawn = true; this.canDrop = false;
    this.lastDamageT = -99; this.regenDelay = 0;
    this.enterTarget = null;
    this.walkOnly = false;
  }
  forwardVec() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
  hasGunDrawn() { return this.hasGun() && this.weaponId !== 'spraycan'; }
  onDamaged(amount, info) {
    this.lastDamageT = G.time;
    G.hud && G.hud.damageFlash(amount);
    G.camera.shake(clamp(amount / 40, 0.05, 0.4), 0.25);
    G.audio && Math.random() < 0.4 && G.audio.play('scream_male', { volume: 0.5, pitch: 0.85 });
  }
  react() {}
  addMoney(n, reason) { this.money += n; if (n > 0) this.stats.moneyEarned += n; if (G.hud) G.hud.moneyChanged(n); }
  die(info) {
    if (this.dead) return;
    super.die(info);
    this.stats.deaths++;
    G.game.onPlayerDeath(info);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 3.5); this.rig.setHitFlash && this.rig.setHitFlash(this.flash); }
    if (this.dead) { this.updateDead(dt); return; }
    this.cool = Math.max(0, this.cool - dt);
    if (this.aggroT > 0) this.aggroT -= dt;
    if (this.attackT > 0) {
      this.attackT -= dt;
      if (this.pendingHit) { this.pendingHit.t -= dt; if (this.pendingHit.t <= 0) { G.combat.melee(this, this.pendingHit.wid, this.pendingHit.combo); this.pendingHit = null; } }
    }
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const W = this.weapon, s = this.wslot; const take = Math.min(W.clip - s.clip, s.ammo); s.clip += take; s.ammo -= take; } }
    // regen armor/health? (no auto regen like SA)
    this.stats.playTime += dt;
    this.safetyCheck(dt);
    this.handleCheats();
    if (this.enterWalkT > 0) { this.aimMode = false; this.updateEnterWalk(dt); return; }
    if (this.enterT > 0) { this.updateEntering(dt); return; }
    if (this.vehicle) { this.updateDriving(dt); return; }
    if (this.downT > 0 || this.ragdollActive()) { this.updateDown(dt); this.aimMode = false; return; }
    this.updateOnFoot(dt);
  }

  // Last-resort unstick: remember the last sane position; restore it if the player ever ends up NaN / fallen through the world /
  // wedged inside solid geometry for a couple of seconds.
  safetyCheck(dt) {
    const W = G.world; const v = this.vehicle;
    const x = v ? v.x : this.x, z = v ? v.z : this.z, y = v ? v.y : this.y;
    if (!isFinite(x + y + z)) { this.recoverTo(this.lastSafe || G.game.spawnPoint); return; }
    const gy = W.groundY(x, z);
    if (y < gy - 8 && gy > -1) { this.fallT = (this.fallT || 0) + dt; if (this.fallT > 1.5) { this.fallT = 0; this.recoverTo(this.lastSafe || G.game.spawnPoint); return; } } else this.fallT = 0;   // (teleports leave y stale for a frame: only react if it persists)
    this.safeT = (this.safeT || 0) - dt;
    if (this.safeT > 0) return; this.safeT = 0.5;
    const probe = this._sp || (this._sp = { x: 0, z: 0 }); probe.x = x; probe.z = z;
    const inside = !v && W.pushCircle(probe, 0.3, this._so || (this._so = {})) && Math.hypot(probe.x - x, probe.z - z) > 1.2;   // deep inside a collider
    if (inside) { this.wedgeT = (this.wedgeT || 0) + 0.5; if (this.wedgeT >= 2) { this.wedgeT = 0; this.recoverTo(this.lastSafe || G.game.spawnPoint); } return; }
    this.wedgeT = 0;
    if (!v && this.grounded && !this.swimming && gy > 0.4 && this.downT <= 0 && !W.pushCircle(probe, 0.5, this._so)) this.lastSafe = { x, z };
    else if (v && !v.airborne && gy > 0.4 && v.totalSpeed < 40 && v.health > 0) { probe.x = x; probe.z = z; if (!W.pushCircle(probe, v.circleR, this._so)) this.lastSafe = { x, z }; }
  }
  recoverTo(p) {
    if (!p) return;
    const v = this.vehicle;
    if (v) { v.x = p.x; v.z = p.z; v.vx = v.vz = 0; v.vy = 0; v.airborne = false; v.y = G.world.groundY(p.x, p.z) + v.def.wheelRadius; v.groundY = v.y; v.ghost = 2; v.applyTransform(); }
    else { this.x = p.x; this.z = p.z; this.vx = this.vz = 0; this.vy = 0; this.y = G.world.groundY(p.x, p.z); this.grounded = true; this.syncGroup(); }
    G.hud && G.hud.notify && G.hud.notify('Back on your feet');
  }

  handleCheats() {
    const I = G.input; if (G.paused) return;
    for (const code of I.pressed) {
      if (code.startsWith('Key')) {
        this.cheatBuf = (this.cheatBuf + code.slice(3).toLowerCase()).slice(-14);
        for (const k in CHEATS) if (this.cheatBuf.endsWith(k)) { CHEATS[k](this); this.cheatBuf = ''; break; }
      }
    }
  }

  updateOnFoot(dt) {
    const I = G.input; const cam = G.camera;
    const W = this.weapon;
    // ---- aim state
    const wantAim = this.controlEnabled && I.aimHeld && (this.hasGun() || W.kind === 'throw');
    this.aimMode = wantAim;
    this.aiming = wantAim || (this.cool > 0 && this.cool > (W.rate || 0) - 0.35 && this.hasGun()) || (this.fireHoldT > 0);
    if (this.fireHoldT > 0) this.fireHoldT -= dt;
    // keep the lock-on highlight current while aiming (cheap: one trace)
    if (this.aimMode && this.controlEnabled && this.hasGun()) this.findAimAssist(G.camera.aimPoint(this, this._ap2 || (this._ap2 = new THREE.Vector3()), 120)); else if (this.lockTarget) this.lockTarget = null;
    // ---- movement
    let mx = 0, mz = 0;
    if (this.controlEnabled) {
      const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
      const my = I.moveY, mxx = I.moveX;
      mx = fx * my + rx * mxx; mz = fz * my + rz * mxx;
    }
    const rawLen = Math.hypot(mx, mz);
    const mag = Math.min(1, rawLen);
    if (rawLen > 0.01) { mx /= rawLen; mz /= rawLen; }
    const wantSprint = this.controlEnabled && (I.isDown('ShiftLeft') || I.isDown('ShiftRight') || (I.gpBtn && I.gpBtn.l3)) && mag > 0.1 && !this.aimMode && !this.crouch;
    if (this.stamina <= 0.5) this.exhausted = true; if (this.stamina > 25) this.exhausted = false;
    this.sprinting = wantSprint && !this.exhausted && this.grounded;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 14); else this.stamina = Math.min(this.maxStamina, this.stamina + dt * (mag > 0.05 ? 7 : 16));
    if (this.controlEnabled && I.anyPressed('ControlLeft', 'KeyC') && !this.swimming) this.crouch = !this.crouch;
    if (this.swimming || this.sprinting) this.crouch = false;
    let sp = 4.1; // jog
    if (this.sprinting) sp = 6.6; else if (this.crouch) sp = 1.9; else if (this.aimMode) sp = 2.6; else if (this.walkOnly || I.isDown('AltLeft')) sp = 1.6;
    if (this.swimming) sp = 2.6;
    if (this.speedBoost) sp *= this.speedBoost;
    this.move.x = mx; this.move.z = mz; this.speedTarget = sp * Math.max(mag, 0) ;
    if (I.gpAx && mag > 0 && mag < 0.6) this.speedTarget *= 0.45;
    // ---- facing
    if (this.aimMode) this.faceOverride = cam.yaw; else if (mag > 0.05 && this.attackT <= 0) this.faceOverride = null;
    else if (this.attackT > 0) { /* keep facing */ this.faceOverride = this.attackYaw ?? this.yaw; }
    else this.faceOverride = null;
    // ---- jump
    if (this.controlEnabled && I.wasPressed('Space') && this.grounded && !this.swimming && this.downT <= 0) { this.vy = 5.8; this.grounded = false; this.airborneT = 0.01; G.audio && G.audio.play('footstep_concrete', { pos: this, volume: 0.5 }); this.crouch = false; }
    // ---- weapons
    if (this.controlEnabled) this.handleWeapons(dt);
    // ---- vehicle enter
    if (this.controlEnabled && (I.wasPressed('KeyF') || I.pressed.has('GP_KeyF'))) this.tryEnterVehicle();
    // physics
    this.physics(dt);
    // footsteps
    const spd = Math.hypot(this.vx, this.vz);
    if (this.grounded && spd > 0.8 && !this.swimming) {
      this.stepT -= dt * spd * 0.23; if (this.stepT <= 0) { this.stepT = 1; const s = G.world.surfaceAt(this.x, this.z); G.audio && G.audio.play(s === 'grass' ? 'footstep_grass' : s === 'sand' ? 'footstep_sand' : 'footstep_concrete', { pos: this, volume: this.crouch ? 0.25 : 0.45 }); }
    }
    this.stats.distance += spd * dt;
    // aim pitch for rig
    this.aimPitch = this.aimMode ? -cam.pitch * 0.9 : 0;
    this.animate(dt);
  }

  handleWeapons(dt) {
    const I = G.input; const W = this.weapon;
    // switching
    if (I.wheel !== 0) { if (this.aimMode && W.scope) G.camera.scopeZoom = clamp(G.camera.scopeZoom + (I.wheel < 0 ? 0.25 : -0.25), 0, 1); else this.cycleWeapon(I.wheel > 0 ? 1 : -1); }
    if (I.anyPressed('KeyE', 'GP_KeyE') && !(G.interactions && G.interactions.target)) this.cycleWeapon(1);
    if (I.anyPressed('KeyQ', 'GP_KeyQ')) this.cycleWeapon(-1);
    for (const k in SLOT_KEYS) if (I.wasPressed(k)) this.selectSlot(SLOT_KEYS[k]);
    if (I.wasPressed('KeyR')) this.reload();
    const fire = I.fireHeld; const firePressed = I.btnDown(0) || (I.gpAx && I.gpAx.rt > 0.5 && !this._rtPrev);
    this._rtPrev = I.gpAx && I.gpAx.rt > 0.5;
    if (W.melee) {
      if (firePressed || (fire && this.cool <= 0 && this.attackT <= 0)) {
        // auto-face nearest target
        const t = G.peds.nearest(this.x, this.z, 3.0, q => !q.dead && q !== this && !q.vehicle);
        if (t && !this.aimMode) { this.yaw = Math.atan2(t.x - this.x, t.z - this.z); this.faceOverride = this.yaw; }
        else if (!this.aimMode) { const cam = G.camera; if (I.moveY !== 0 || I.moveX !== 0) { /* keep move facing */ } }
        this.attackYaw = this.yaw;
        this.attackMelee();
        this.cool = 0.12;
      }
      return;
    }
    if (W.kind === 'tool') { // spray can
      if (fire && this.wslot.clip > 0) { this.sprayT = (this.sprayT || 0) + dt; this.wslot.clip = Math.max(0, this.wslot.clip - dt * 10); this.aiming = true; this.rig.setState; G.tags && G.tags.spray(this, dt); if (!this._sprayLoop) this._sprayLoop = G.audio && G.audio.loop('spraycan', { pos: this, volume: 0.6 }); }
      else if (this._sprayLoop) { this._sprayLoop.stop(); this._sprayLoop = null; }
      return;
    }
    if (this._sprayLoop) { this._sprayLoop.stop(); this._sprayLoop = null; }
    // guns
    const auto = W.auto;
    const want = auto ? fire : firePressed || (fire && this.cool <= 0 && W.kind !== 'throw' && W.kind !== 'rpg' && false);
    if (want && this.cool <= 0) {
      // aim point
      let tp = G.camera.aimPoint(this, this._ap || (this._ap = new THREE.Vector3()), 200);
      // lock-on assist
      const ass = this.findAimAssist(tp);
      if (ass) tp = ass;
      const muzzle = this.rig.getMuzzleWorldPos();
      // avoid degenerate close aim
      const dd = Math.hypot(tp.x - muzzle.x, tp.z - muzzle.z);
      if (dd < 2.0) { const f = G.camera.aimDir(new THREE.Vector3()); tp = new THREE.Vector3(muzzle.x + f.x * 30, muzzle.y + f.y * 30, muzzle.z + f.z * 30); }
      const s = this.wslot;
      if (s.clip <= 0 && s.ammo > 0) { this.reload(); }
      else if (s.clip <= 0 && s.ammo <= 0 && W.kind !== 'throw') { if (firePressed) { G.audio && G.audio.play('empty_click'); this.cool = 0.25; } }
      else {
        this.faceOverride = G.camera.yaw; this.yaw = G.camera.yaw;
        const fired = this.shootAt(tp.x, tp.y, tp.z, { spreadMul: this.aimMode ? 1 : 2.6 });
        if (fired) { this.fireHoldT = 0.6; this.aiming = true; G.camera.shake(0.03 + (W.kick || 0.25) * 0.05, 0.12); if (W.scope) this.scoped = true; this.stats.shots = (this.stats.shots || 0) + 1; }
        if (this.weapons[this.weaponId] === undefined) this.equip('fist');
      }
    }
  }

  // Soft lock-on: if the crosshair is already on somebody the shot goes exactly where the player points (headshots!);
  // otherwise a small cone around the crosshair snaps to the nearest visible person (enemies preferred over bystanders).
  findAimAssist(point) {
    if (!G.settings.lockOn) { this.lockTarget = null; return null; }
    const cam = G.camera; const W = this.weapon;
    if (point && point.hit && point.hit.kind === 'ped' && !point.hit.ped.dead) { this.lockTarget = point.hit.ped; return null; }
    const f = cam.aimDir(_fa);
    const minDot = Math.cos(this.aimMode ? 0.115 : 0.065);        // ~6.6 deg while aiming, ~3.7 deg from the hip
    let best = null, bs = 1e9;
    for (const p of G.peds.list) {
      if (p.dead || p === this || (p.vehicle && !p.isHostileTo(this))) continue;
      const dx = p.x - cam.pos.x, dy = p.y + 1.25 - cam.pos.y, dz = p.z - cam.pos.z; const d = Math.hypot(dx, dy, dz); if (d > (W.range || 60) || d < 2) continue;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / d; if (dot < minDot) continue;
      const hostile = p.hostile || p.role === 'enemy' || p.aggroT > 0 || (p.role === 'cop' || p.role === 'swat') && G.police.stars > 0 || p.mode === 'attack';
      const score = Math.acos(Math.min(1, dot)) * (hostile ? 0.55 : 1) + d * 0.0004;
      if (score < bs) { if (G.world.raycast(cam.pos.x, cam.pos.z, p.x, p.z, cam.pos.y, p.y + 1.25)) continue; bs = score; best = p; }
    }
    this.lockTarget = best;
    if (!best) return null;
    return _fa2.set(best.x, best.y + 1.3, best.z);
  }

  cycleWeapon(dir) {
    const owned = WEAPON_ORDER.filter(id => this.weapons[id] || id === 'fist');
    let i = owned.indexOf(this.weaponId); i = (i + dir + owned.length) % owned.length;
    this.equip(owned[i]); G.hud && G.hud.weaponChanged();
  }
  selectSlot(slots) {
    const cands = WEAPON_ORDER.filter(id => (this.weapons[id] || id === 'fist') && slots.includes(WEAPONS[id].slot));
    if (!cands.length) return;
    let i = cands.indexOf(this.weaponId); this.equip(cands[(i + 1) % cands.length]); G.hud && G.hud.weaponChanged();
  }

  tryEnterVehicle() {
    // nearest vehicle by door distance
    let best = null, bd = 4.8 * 4.8, bseat = 0;
    for (const v of G.vehicles.list) {
      if (v.exploded || v.locked) continue;
      if (dist2(v.x, v.z, this.x, this.z) > (v.radius + 5) ** 2) continue;
      for (let s = 0; s < (v.model.seats || []).length; s++) {
        if (s > 0 && !v.driver) continue; // passengers only if someone drives
        if (s > 0 && v.seatPeds[s]) continue;
        const dw = v.doorWorldPos(s); const d = dist2(dw.x, dw.z, this.x, this.z);
        const bonus = (s === 0) ? 0 : 6; // prefer driving
        if (d + bonus < bd) { bd = d + bonus; best = v; bseat = s; }
      }
    }
    if (best) {
      // allies driving → passenger; hostile/civ → carjack
      const v = best; let seat = bseat;
      if (v.driver && v.driver.role === 'ally') seat = v.freeSeat(); else if (v.driver) seat = 0;
      if (seat < 0) return;
      this.crouch = false; this.aimMode = false;
      if (this.enterVehicle(v, seat)) { if (seat === 0 && v.owner !== 'player' && !v.mission) { this.stats.carsStolen++; if (G.police) G.police.onCarTheft(v); v.owner = 'player'; } }
    }
  }

  updateDriving(dt) {
    const I = G.input; const v = this.vehicle;
    const W = this.weapon;
    if (!v || v.exploded) return;
    // inputs (driver only)
    if (this.seat === 0 && this.controlEnabled) {
      let thr = (I.isDown('KeyW') || I.isDown('ArrowUp') ? 1 : 0) - (I.isDown('KeyS') || I.isDown('ArrowDown') ? 1 : 0);
      if (I.gpAx) thr += I.gpAx.rt - I.gpAx.lt;
      let steer = -I.moveX;
      v.input.throttle = clamp(thr, -1, 1); v.input.steer = clamp(steer, -1, 1);
      v.input.handbrake = I.isDown('Space') || (I.gpBtn && I.gpBtn.a);
      if (I.isDown('KeyH') || (I.gpBtn && I.gpBtn.r3)) v.honk();
      G.camera.lookBack = I.isDown('KeyC') || I.isDown('KeyZ');
      if (I.anyPressed('KeyR', 'GP_KeyE')) G.audio.radio.next();
      if (I.anyPressed('KeyT', 'GP_KeyQ')) G.audio.radio.prev();
      if (I.anyPressed('KeyX')) { G.audio.radio.set(-1); }
      if (v.type === 'police' || v.type === 'ambulance' || v.type === 'taxi') { if (I.wasPressed('KeyN')) { v.setSiren(!v.siren); } }
    } else if (this.seat !== 0) { G.camera.lookBack = false; }
    // drive-by shooting
    const isGun = this.hasGun() && W.kind === 'pistol' && !v.isBike || (v.isBike && W.kind === 'pistol');
    this.aimMode = false;
    if (isGun && this.controlEnabled) {
      const aimOn = I.aimHeld;
      this.aiming = aimOn; this.aimMode = aimOn;
      if (aimOn) {
        this.aimPitch = -G.camera.pitch * 0.5;
        const fire = W.auto ? I.fireHeld : I.btnDown(0);
        if (fire && this.cool <= 0 && this.wslot.clip > 0) {
          const tp = G.camera.aimPoint(this, this._ap || (this._ap = new THREE.Vector3()), 120);
          const ass = this.findAimAssist(tp);
          const t = ass || tp; const m = this.rig.getMuzzleWorldPos();
          if (Math.hypot(t.x - m.x, t.z - m.z) > 2) this.shootAt(t.x, t.y, t.z, { spreadMul: 2.2 }); else { const f = G.camera.aimDir(new THREE.Vector3()); this.shootAt(m.x + f.x * 30, m.y + f.y * 30, m.z + f.z * 30, { spreadMul: 2.2 }); }
        } else if (fire && this.wslot.clip <= 0) this.reload();
        if (I.wasPressed('KeyR')) this.reload();
      }
    } else this.aiming = false;
    if (this.controlEnabled && I.anyPressed('KeyE')) { /* reserved */ }
    // exit
    if (this.controlEnabled && (I.wasPressed('KeyF') || I.pressed.has('GP_KeyF'))) {
      // consume the press so later sim substeps in this same frame don't see F again and
      // immediately climb back in through updateOnFoot's tryEnterVehicle()
      I.pressed.delete('KeyF'); I.pressed.delete('GP_KeyF');
      if (v.totalSpeed > 14 && this.seat === 0) { /* jump out anyway */ }
      const wasDriver = this.seat === 0;
      this.exitVehicle(false);
      if (wasDriver) { v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = v.totalSpeed < 2; }
      G.camera.lookBack = false;
      return;
    }
    this.x = v.x; this.z = v.z; this.y = v.y;
    const steer = v.steerCur ? v.steerCur / Math.max(0.1, v.phys.steer) : 0;
    this.rig.update(dt, { speed: 0, steer, aiming: this.aiming, aimPitch: this.aimPitch, lean: v.lean });
    this.rig.setState(v.isBike ? 'bikeride' : this.seat === 0 ? 'drive' : 'passenger');
    this.stats.distance += v.totalSpeed * dt;
  }
}
