// Weapon definitions + combat system (hitscan bullets, melee, explosions, projectiles, noise).
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, lerp, TAU, dist2, segVsObb, rrange, wrapAngle } from './util.js';

// slot ordering used for weapon switching
export const WEAPONS = {
  fist: { id: 'fist', name: 'Fists', slot: 0, melee: true, dmg: 14, range: 1.7, rate: 0.42, kind: 'melee', noise: 5 },
  bat: { id: 'bat', name: 'Baseball Bat', slot: 1, melee: true, dmg: 38, range: 2.4, rate: 0.68, kind: 'melee', noise: 8, price: 60 },
  knife: { id: 'knife', name: 'Knife', slot: 1, melee: true, dmg: 45, range: 1.7, rate: 0.45, kind: 'melee', noise: 4, price: 80 },
  pistol: { id: 'pistol', name: '9mm Pistol', slot: 2, clip: 17, dmg: 24, rate: 0.26, spread: 0.014, range: 80, auto: false, reload: 1.3, snd: 'shot_pistol', kind: 'pistol', noise: 55, price: 200, pack: 34, flash: 0.4 },
  deagle: { id: 'deagle', name: 'Desert Eagle', slot: 2, clip: 7, dmg: 62, rate: 0.55, spread: 0.008, range: 100, auto: false, reload: 1.8, snd: 'shot_deagle', kind: 'pistol', noise: 70, price: 700, pack: 21, flash: 0.6, kick: 0.6 },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun', slot: 3, clip: 6, dmg: 12, pellets: 9, rate: 0.95, spread: 0.075, range: 38, auto: false, reload: 2.2, snd: 'shot_shotgun', kind: 'long', noise: 75, price: 900, pack: 18, flash: 0.9, kick: 0.9 },
  smg: { id: 'smg', name: 'Micro SMG', slot: 4, clip: 30, dmg: 11, rate: 0.065, spread: 0.04, range: 60, auto: true, reload: 1.6, snd: 'shot_smg', kind: 'pistol', noise: 55, price: 600, pack: 90, flash: 0.45 },
  ak47: { id: 'ak47', name: 'AK-47', slot: 5, clip: 30, dmg: 20, rate: 0.1, spread: 0.022, range: 130, auto: true, reload: 2.0, snd: 'shot_ak', kind: 'long', noise: 80, price: 1100, pack: 90, flash: 0.7 },
  sniper: { id: 'sniper', name: 'Sniper Rifle', slot: 6, clip: 5, dmg: 140, rate: 1.25, spread: 0.0, range: 420, auto: false, reload: 2.4, snd: 'shot_sniper', kind: 'long', noise: 90, price: 1800, pack: 15, flash: 0.8, scope: true, kick: 1.0 },
  rpg: { id: 'rpg', name: 'RPG', slot: 7, clip: 1, dmg: 500, rate: 1.5, spread: 0, range: 200, auto: false, reload: 2.6, snd: 'shot_rpg', kind: 'rpg', noise: 100, price: 4000, pack: 3, projectile: 'rocket' },
  grenade: { id: 'grenade', name: 'Grenade', slot: 8, clip: 1, dmg: 350, rate: 1.0, kind: 'throw', noise: 10, price: 350, pack: 5, projectile: 'grenade', throwKind: 'grenade' },
  molotov: { id: 'molotov', name: 'Molotov Cocktail', slot: 8, clip: 1, dmg: 0, rate: 1.0, kind: 'throw', noise: 10, price: 200, pack: 5, projectile: 'molotov', throwKind: 'molotov' },
  spraycan: { id: 'spraycan', name: 'Spray Can', slot: 9, melee: false, clip: 500, dmg: 0, rate: 0.05, auto: true, kind: 'tool', noise: 2, price: 20, pack: 500 }
};
export const WEAPON_ORDER = ['fist', 'bat', 'knife', 'pistol', 'deagle', 'shotgun', 'smg', 'ak47', 'sniper', 'rpg', 'grenade', 'molotov', 'spraycan'];

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Projectile {
  constructor(kind, x, y, z, vx, vy, vz, owner, weaponId) {
    this.kind = kind; this.x = x; this.y = y; this.z = z; this.vx = vx; this.vy = vy; this.vz = vz; this.owner = owner; this.t = 0; this.dead = false; this.weaponId = weaponId;
    this.fuse = kind === 'grenade' ? 3.2 : 99;
    let mesh;
    if (kind === 'rocket') { mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), new THREE.MeshBasicMaterial({ color: 0x555555 })); mesh.geometry.rotateX(Math.PI / 2); }
    else if (kind === 'grenade') { mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3a5a2a })); }
    else { mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.24, 8), new THREE.MeshLambertMaterial({ color: 0x6a8a3a, transparent: true, opacity: 0.85 })); }
    this.mesh = mesh; G.scene.add(mesh); mesh.position.set(x, y, z);
  }
}

export class Combat {
  constructor() {
    this.projectiles = []; this.fires = []; this.lastNoise = { t: -99 };
    this.tmpBox = { x: 0, z: 0, hw: 0, hd: 0, yaw: 0 };
  }

  // ---- perception / noise
  noise(x, z, radius, source, type = 'shot') {
    for (const p of G.peds.list) { if (p.dead || p === source) continue; const d2 = dist2(p.x, p.z, x, z); if (d2 < radius * radius) p.hear(type, x, z, source, Math.sqrt(d2)); }
    if (type === 'shot' || type === 'explosion') this.lastNoise = { x, z, t: G.time, source, type };
  }

  // ---- hitscan trace
  // returns {t (0..1 of segment), kind, ped, vehicle, x,y,z, nx,nz}
  trace(ox, oy, oz, dx, dy, dz, range, shooter, opts = {}) {
    const ex = ox + dx * range, ey = oy + dy * range, ez = oz + dz * range;
    let best = { t: 1, kind: 'none', x: ex, y: ey, z: ez };
    const consider = (t, kind, ref) => { if (t >= 0 && t < best.t) { best = { t, kind, x: ox + (ex - ox) * t, y: oy + (ey - oy) * t, z: oz + (ez - oz) * t, ...ref }; } };
    // static world
    const w = G.world.raycast(ox, oz, ex, ez, oy, ey); if (w) consider(w.t, 'static', { collider: w.c });
    // ground / water
    const steps = Math.min(140, Math.max(6, Math.ceil(range / 1.6)));
    let prevT = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps; const y = oy + (ey - oy) * t;
      if (t > best.t) break;
      const gy = G.world.groundY(ox + (ex - ox) * t, oz + (ez - oz) * t);
      if (y <= gy) { const tt = lerp(prevT, t, 0.5); consider(tt, gy < -0.05 ? 'water' : 'ground', {}); break; }
      prevT = t;
    }
    // peds
    if (!opts.skipPeds) {
      const sx = ex - ox, sz = ez - oz, l2 = sx * sx + sz * sz || 1e-9;
      for (const p of G.peds.list) {
        if (p === shooter || (p.dead && !opts.hitDead)) continue;
        if (p.vehicle && p.vehicle === shooter?.vehicle) continue;
        let t = ((p.x - ox) * sx + (p.z - oz) * sz) / l2; if (t < 0 || t > best.t) continue;
        const px = ox + sx * t, pz = oz + sz * t, rr = (p.dead ? 0.6 : p.vehicle ? 0.0 : 0.42);
        if (rr === 0) continue;
        if ((px - p.x) ** 2 + (pz - p.z) ** 2 > rr * rr) continue;
        const y = oy + (ey - oy) * t, top = p.y + 1.8 * (p.scale || 1);
        const base = p.dead ? p.y - 0.05 : p.y - 0.05;
        if (y > top || y < base) { if (!(p.dead && y < p.y + 0.6 && y > p.y - 0.1)) continue; }
        consider(t, 'ped', { ped: p, head: y > p.y + 1.52 * (p.scale || 1) && !p.dead });
      }
    }
    // vehicles
    if (!opts.skipVehicles) {
      const box = this.tmpBox;
      for (const v of G.vehicles.list) {
        if (shooter && shooter.vehicle === v && !opts.hitOwnVehicle) continue;
        const R = v.radius + 1; if ((v.x - ox) ** 2 + (v.z - oz) ** 2 > (range + R) ** 2) continue;
        const t = segVsObb(v.obb, ox, oz, ex, ez); if (t < 0 || t >= best.t) continue;
        const y = oy + (ey - oy) * t; if (y < v.y - v.def.wheelRadius - 0.1 || y > v.y - v.def.wheelRadius + v.def.height + 0.3) continue;
        consider(t, 'vehicle', { vehicle: v });
      }
    }
    return best;
  }

  // dir must be normalised.
  fire(shooter, wid, ox, oy, oz, dx, dy, dz, opts = {}) {
    const W = WEAPONS[wid]; if (!W) return;
    const pellets = W.pellets || 1;
    const sp = (W.spread || 0) * (opts.spreadMul ?? 1);
    let first = null;
    for (let i = 0; i < pellets; i++) {
      let ddx = dx, ddy = dy, ddz = dz;
      if (sp > 0) { ddx += (Math.random() + Math.random() - 1) * sp; ddy += (Math.random() + Math.random() - 1) * sp; ddz += (Math.random() + Math.random() - 1) * sp; const l = Math.hypot(ddx, ddy, ddz); ddx /= l; ddy /= l; ddz /= l; }
      const hit = this.trace(ox, oy, oz, ddx, ddy, ddz, W.range, shooter);
      if (!first) first = hit;
      const dmgMul = opts.dmgMul ?? 1;
      const info = { source: shooter, weapon: wid, bullet: true, dirx: ddx, dirz: ddz };
      if (hit.kind === 'ped') {
        const headshot = hit.head; info.headshot = headshot;
        const falloff = W.pellets ? clamp(1.3 - hit.t * W.range / W.range * 1.0, 0.4, 1) : 1;
        // NPC bullets hurt the player less so gunfights are survivable (headshots on the player are not x3)
        const npcMul = hit.ped.isPlayer && shooter && !shooter.isPlayer ? 0.6 : 1;
        hit.ped.damage(W.dmg * (headshot && !hit.ped.isPlayer ? 3.0 : headshot ? 1.3 : 1) * dmgMul * falloff * npcMul, info);
        G.fx.blood(hit.x, hit.y, hit.z, ddx, ddz, headshot ? 14 : 7);
        if (shooter && shooter.isPlayer) G.hud && G.hud.hitMarker(headshot);
      } else if (hit.kind === 'vehicle') {
        hit.vehicle.onHit(W.dmg * dmgMul * (W.pellets ? 0.4 : 1), info);
        G.fx.sparks(hit.x, hit.y, hit.z, 5, -ddx, -ddz);
        // occupants can be hit through the windows
        const v = hit.vehicle; const occ = v.occupants();
        if (occ.length && hit.y > v.y - v.def.wheelRadius + 0.75) { const tgt = occ[(Math.random() * occ.length) | 0]; if (Math.random() < 0.45 && tgt !== shooter) { const occMul = tgt.isPlayer && shooter && !shooter.isPlayer ? 0.6 : 1; tgt.damage(W.dmg * dmgMul * occMul, info); G.fx.blood(hit.x, hit.y, hit.z, ddx, ddz, 6); } }
        if (G.audio && Math.random() < 0.5) G.audio.play('ricochet', { pos: hit, volume: 0.5 });
      } else if (hit.kind === 'static') {
        G.fx.sparks(hit.x, hit.y, hit.z, 3, -ddx, -ddz); G.fx.dust(hit.x, hit.y, hit.z, 2, 0.5, [0.6, 0.58, 0.54]);
        if (hit.collider && hit.collider.prop && G.props) G.props.knock(hit.collider.prop, { vx: ddx * 6, vz: ddz * 6 }, 6);
      } else if (hit.kind === 'ground') { G.fx.dust(hit.x, hit.y + 0.05, hit.z, 3, 0.6); }
      else if (hit.kind === 'water') { G.fx.splash(hit.x, hit.z, 5, 0.6); }
      // tracer
      if (i < 3 || pellets === 1) {
        G.fx.tracer({ x: ox + ddx * 0.6, y: oy + ddy * 0.6, z: oz + ddz * 0.6 }, { x: hit.x, y: hit.y, z: hit.z }, W.range > 200 ? 0.2 : 0.1);
      }
      // whiz for the player when a hostile round passes nearby
      if (G.player && shooter !== G.player && G.audio && hit.t > 0.05) {
        const p = G.player; const sx = hit.x - ox, sz = hit.z - oz, l2 = sx * sx + sz * sz || 1e-9;
        const t = clamp(((p.x - ox) * sx + (p.z - oz) * sz) / l2, 0, 1);
        const cx = ox + sx * t, cz = oz + sz * t; if ((cx - p.x) ** 2 + (cz - p.z) ** 2 < 4 && G.time - (this._whizT || 0) > 0.15) { this._whizT = G.time; G.audio.play('bullet_whiz', { pos: { x: cx, y: p.y + 1.5, z: cz } }); }
      }
    }
    // effects
    const nx = dx, nz = dz;
    if (W.flash) G.fx.muzzle(ox, oy, oz, nx, nz, W.flash);
    if (G.audio) G.audio.play(W.snd, { pos: { x: ox, y: oy, z: oz }, volume: shooter && shooter.isPlayer ? 1 : 0.9 });
    this.noise(ox, oz, W.noise * 1.2, shooter, 'shot');
    if (G.police) G.police.onShot(shooter, W, ox, oz);
    return first;
  }

  // ---- melee
  melee(attacker, wid, comboIdx = 0) {
    const W = WEAPONS[wid] || WEAPONS.fist;
    const fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
    let best = null, bs = 1e9;
    for (const p of G.peds.list) {
      if (p === attacker || p.dead || p.vehicle) continue;
      const dx = p.x - attacker.x, dz = p.z - attacker.z, d = Math.hypot(dx, dz);
      if (d > W.range + 0.3) continue;
      const dot = (dx * fx + dz * fz) / (d || 1); if (dot < 0.35) continue;
      const score = d - dot; if (score < bs) { bs = score; best = p; }
    }
    if (best) {
      const heavy = comboIdx >= 2 || W.id === 'bat';
      const info = { source: attacker, weapon: wid, melee: true, dirx: fx, dirz: fz, knock: heavy };
      const npcMul = best.isPlayer && !attacker.isPlayer ? 0.6 : 1;
      best.damage(W.dmg * (wid === 'fist' ? (1 + comboIdx * 0.25) : 1) * npcMul, info);
      best.vx += fx * (heavy ? 4.5 : 2.2); best.vz += fz * (heavy ? 4.5 : 2.2);
      G.fx.blood(best.x, best.y + 1.3, best.z, fx, fz, 4);
      G.audio && G.audio.play(wid === 'bat' ? 'hit_bat' : 'hit_flesh', { pos: best, volume: 0.9 });
      if (attacker.isPlayer) G.hud && G.hud.hitMarker(false);
      return best;
    }
    // swing at a vehicle
    const v = G.vehicles.nearest(attacker.x + fx * 1.4, attacker.z + fz * 1.4, 2.6, q => !q.exploded);
    if (v && wid !== 'fist') { v.damage(W.dmg * 0.35, { source: attacker }); G.audio && G.audio.play('hit_bat', { pos: v, volume: 0.5 }); G.fx.sparks(v.x, v.y + 0.5, v.z, 3); }
    return null;
  }

  // ---- projectiles
  // dist (optional) = 3D distance to the aimed point: grenades / molotovs are then thrown on a proper arc that lands there (max ~38 m)
  launch(shooter, wid, ox, oy, oz, dx, dy, dz, speedMul = 1, dist = null) {
    const W = WEAPONS[wid];
    if (W.projectile === 'rocket') {
      const p = new Projectile('rocket', ox, oy, oz, dx * 42, dy * 42, dz * 42, shooter, wid); this.projectiles.push(p);
      G.audio && G.audio.play('shot_rpg', { pos: { x: ox, y: oy, z: oz } }); G.fx.muzzle(ox, oy, oz, -dx, -dz, 1.4); this.noise(ox, oz, 100, shooter, 'shot');
      if (G.police) G.police.onShot(shooter, W, ox, oz);
    } else {
      let vx, vy, vz;
      const hl = Math.hypot(dx, dz);
      if (dist != null && hl > 1e-4) {
        const h = Math.min(dist * hl, 38), Y = dist * dy, g = 12;
        const T = clamp(0.45 + h * 0.036, 0.55, 1.8);
        const vh = h / T; vx = dx / hl * vh; vz = dz / hl * vh; vy = (Y + 0.5 * g * T * T) / T;
      } else { const sp = 13 * speedMul; vx = dx * sp; vy = dy * sp + 4.5; vz = dz * sp; }
      const p = new Projectile(W.projectile, ox, oy, oz, vx, vy, vz, shooter, wid); this.projectiles.push(p);
      if (G.police) G.police.onShot(shooter, { noise: 5, id: wid, kind: 'throw' }, ox, oz);
    }
  }

  explode(x, y, z, r, dmg, o = {}) {
    G.fx.explosion(x, y, z, r);
    G.audio && G.audio.play('explosion', { pos: { x, y, z }, volume: 1 });
    if (G.camera) { const d = Math.hypot(G.camera.pos.x - x, G.camera.pos.z - z); G.camera.shake(clamp(1.1 - d / 70, 0, 1) * 1.0, 0.7); }
    const src = o.source || null;
    const R = r * 1.5;
    for (const p of G.peds.list) {
      if (p.dead && p.deadT > 1) continue;
      const d = Math.hypot(p.x - x, p.z - z); if (d > R) continue;
      const f = clamp(1 - d / R, 0, 1);
      const dx = (p.x - x) / (d || 1), dz = (p.z - z) / (d || 1);
      p.damage(dmg * f * f * 1.2, { source: src, explosion: true, dirx: dx, dirz: dz });
      p.vx += dx * 10 * f; p.vz += dz * 10 * f; p.vy = 4 + 5 * f; p.airborneT = 0.8;
      if (p.ragdollActive()) p.rag.impulse(dx * 10 * f, 4 + 5 * f, dz * 10 * f, 0.9);
      if (!p.dead && !p.ragdollActive()) p.knockdown(1.6);
    }
    for (const v of G.vehicles.list) {
      if (v === o.vehicle) continue;
      const d = Math.hypot(v.x - x, v.z - z); if (d > R + v.radius) continue;
      // a blast only reaches a helicopter if it goes off near its altitude (so you must hit it)
      if (v.isHeli && Math.abs(v.y - y) > r + 4) continue;
      const f = clamp(1 - d / (R + v.radius), 0, 1);
      const dx = (v.x - x) / (d || 1), dz = (v.z - z) / (d || 1);
      // one rocket always brings a helicopter down
      if (v.isHeli && o.rocket) { v.damage(1e6, { source: src, explosion: true, instant: true }); continue; }
      v.damage(dmg * f * 2.6, { source: src, explosion: true });
      const m = 1500 / v.phys.mass;
      v.vx += dx * 14 * f * m; v.vz += dz * 14 * f * m; if (!v.wrecked && f > 0.3) { v.vy = 3 + 4 * f; v.airborne = true; v.yawRate += (Math.random() - 0.5) * 3 * f; }
      v.wake();
    }
    if (G.props) G.props.explosion(x, z, R);
    this.noise(x, z, 120, src, 'explosion');
    if (G.police) G.police.onExplosion(x, z, src);
    G.events.emit('explosion', x, y, z, r, src);
  }

  startFire(x, z, radius = 4, dur = 9, source = null) {
    this.fires.push({ x, z, r: radius, t: dur, src: source, tick: 0 });
  }

  update(dt) {
    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.t += dt;
      const ox = p.x, oy = p.y, oz = p.z;
      if (p.kind !== 'rocket') p.vy -= 12 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      let hit = false;
      if (p.kind === 'rocket') {
        const len = Math.hypot(p.x - ox, p.y - oy, p.z - oz) || 1;
        const t = this.trace(ox, oy, oz, (p.x - ox) / len, (p.y - oy) / len, (p.z - oz) / len, len + 0.3, p.owner, { skipPeds: false });
        if (t.kind !== 'none' || p.t > 8) { p.x = t.x; p.y = t.y; p.z = t.z; hit = true; }
        if (Math.random() < 0.9) G.fx.smokePuff(p.x, p.y, p.z, 0.6, 1.2, 0.7, 0.3);
        G.fx.glow.emit({ x: p.x, y: p.y, z: p.z, life: 0.12, s0: 0.5, s1: 0.1, c0: [1, 0.7, 0.3, 1], c1: [1, 0.3, 0, 0] });
        p.mesh.position.set(p.x, p.y, p.z); p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      } else {
        // bounce on ground / walls
        const gy = G.world.groundY(p.x, p.z) + 0.1;
        if (p.y < gy) { p.y = gy; p.vy = -p.vy * 0.35; p.vx *= 0.6; p.vz *= 0.6; if (p.kind === 'molotov') hit = true; else if (Math.abs(p.vy) > 1.2) G.audio && G.audio.play('grenade_bounce', { pos: p }); }
        const w = G.world.raycast(ox, oz, p.x, p.z, oy, p.y);
        if (w) { p.x = ox; p.z = oz; p.vx *= -0.35; p.vz *= -0.35; if (p.kind === 'molotov') hit = true; }
        if (p.kind === 'molotov') { // break on vehicles/peds
          for (const v of G.vehicles.list) if (dist2(v.x, v.z, p.x, p.z) < (v.radius) ** 2 && Math.abs(p.y - v.y) < 2) hit = true;
          for (const q of G.peds.list) if (!q.dead && q !== p.owner && dist2(q.x, q.z, p.x, p.z) < 0.6 && Math.abs(p.y - q.y - 1) < 1.2) hit = true;
        }
        p.mesh.position.set(p.x, p.y, p.z); p.mesh.rotation.x += dt * 8;
        p.fuse -= dt; if (p.kind === 'grenade' && p.fuse <= 0) hit = true;
      }
      if (hit) {
        if (p.kind === 'molotov') { this.startFire(p.x, p.z, 4.5, 10, p.owner); G.audio && G.audio.play('glass_break', { pos: p }); G.audio && G.audio.play('fire_whoosh', { pos: p }); this.noise(p.x, p.z, 60, p.owner, 'explosion'); if (G.police) G.police.onExplosion(p.x, p.z, p.owner); }
        else this.explode(p.x, p.y, p.z, p.kind === 'rocket' ? 9.5 : 7, p.kind === 'rocket' ? 520 : 380, { source: p.owner, rocket: p.kind === 'rocket' });
        G.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); this.projectiles.splice(i, 1);
      }
    }
    // fires (molotov)
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i]; f.t -= dt; f.tick -= dt;
      for (let k = 0; k < 3; k++) { const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * f.r; G.fx.fire(f.x + Math.cos(a) * rr, G.world.groundY(f.x, f.z) + 0.2, f.z + Math.sin(a) * rr, 1.2); }
      if (f.tick <= 0) {
        f.tick = 0.3;
        for (const p of G.peds.list) if (!p.dead && dist2(p.x, p.z, f.x, f.z) < f.r * f.r) p.damage(9, { source: f.src, fire: true });
        for (const v of G.vehicles.list) if (!v.exploded && dist2(v.x, v.z, f.x, f.z) < (f.r + v.radius) ** 2) { v.damage(14, { source: f.src }); if (v.health < 260) v.ignite(); }
      }
      if (f.t <= 0) this.fires.splice(i, 1);
    }
  }
}
