// Pickups (cash, health, armor, weapons, police bribe stars), knockable props, markers and blips.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, lerp, dist2, TAU, rrange } from './util.js';
import { WEAPONS } from './weapons.js';

const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

function starGeometry() {
  const s = new THREE.Shape(); const R = 0.32, r = 0.14;
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? s.lineTo(x, y) : s.moveTo(x, y); }
  s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false }); g.translate(0, 0, -0.04); return g;
}
const MAT = {
  cash: new THREE.MeshLambertMaterial({ color: 0x3ea850, emissive: 0x0a3a14 }),
  health: new THREE.MeshLambertMaterial({ color: 0xe03030, emissive: 0x501010 }),
  armor: new THREE.MeshLambertMaterial({ color: 0x3a7ae0, emissive: 0x102050 }),
  star: new THREE.MeshLambertMaterial({ color: 0xffd040, emissive: 0x705000 }),
  white: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666 }),
  spray: new THREE.MeshLambertMaterial({ color: 0xff40a0, emissive: 0x602040 })
};
// Fixed pickup shapes are shared by every instance (never disposed: pickups only detach on remove).
const GEO = {
  cash: new THREE.BoxGeometry(0.42, 0.04, 0.22),
  healthA: new THREE.BoxGeometry(0.46, 0.14, 0.14),
  healthB: new THREE.BoxGeometry(0.14, 0.46, 0.14),
  armor: new THREE.BoxGeometry(0.5, 0.55, 0.12),
  star: starGeometry(),
  tag: new THREE.SphereGeometry(0.22, 10, 8),
  weaponBox: new THREE.BoxGeometry(0.5, 0.15, 0.15)
};
const glowMats = new Map();
function glowMaterial(col) {
  let m = glowMats.get(col);
  if (!m) { m = new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }); glowMats.set(col, m); }
  return m;
}

export class Pickups {
  constructor() { this.list = []; this.t = 0; this.respawnQueue = []; }
  spawn(kind, x, z, o = {}) {
    const g = new THREE.Group();
    let mesh, glowCol = 0xffffff;
    if (kind === 'cash') { mesh = new THREE.Mesh(GEO.cash, MAT.cash); const m2 = mesh.clone(); m2.position.y = 0.05; m2.rotation.y = 0.5; g.add(mesh, m2); glowCol = 0x60ff80; }
    else if (kind === 'health') { const a = new THREE.Mesh(GEO.healthA, MAT.health), b = new THREE.Mesh(GEO.healthB, MAT.health); g.add(a, b); glowCol = 0xff5050; }
    else if (kind === 'armor') { const a = new THREE.Mesh(GEO.armor, MAT.armor); g.add(a); glowCol = 0x5090ff; }
    else if (kind === 'star') { mesh = new THREE.Mesh(GEO.star, MAT.star); g.add(mesh); glowCol = 0xffd040; }
    else if (kind === 'weapon') {
      const W = G.models.weapons; let m = null; try { m = W.createWeaponModel(o.weapon); } catch (e) { }
      if (m) { m.scale.setScalar(1.5); m.rotation.y = 0; g.add(m); } else g.add(new THREE.Mesh(GEO.weaponBox, MAT.white));
      glowCol = 0xffffff;
    } else if (kind === 'tag') { g.add(new THREE.Mesh(GEO.tag, MAT.spray)); glowCol = 0xff40a0; }
    const glow = new THREE.Sprite(glowMaterial(glowCol)); glow.scale.set(1.6, 1.6, 1); g.add(glow);
    const y = (o.y ?? G.world.groundY(x, z)) + 0.75;
    g.position.set(x, y, z); G.scene.add(g);
    const p = { kind, x, z, y, group: g, amount: o.amount || 0, weapon: o.weapon, ammo: o.ammo || 0, t: Math.random() * 6, life: o.life ?? (o.persistent ? 1e9 : kind === 'cash' || (kind === 'weapon' && o.temp !== false) ? 60 : 180), respawn: o.respawn ?? 0, dead: false, onCollect: o.onCollect, blip: null, radius: o.radius ?? 1.5, persistent: o.persistent };
    this.list.push(p);
    return p;
  }
  remove(p) { if (p.dead) return; p.dead = true; G.scene.remove(p.group); if (p.blip) G.blips.remove(p.blip); }
  update(dt) {
    this.t += dt; const pl = G.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.dead) { this.list.splice(i, 1); continue; }
      p.t += dt; p.life -= dt; p.group.rotation.y += dt * 2.2; p.group.position.y = p.y + Math.sin(p.t * 2.4) * 0.12;
      if (p.life <= 0) { this.remove(p); continue; }
      if (p.life < 6) p.group.visible = Math.floor(p.t * 6) % 2 === 0;
      if (!pl || pl.dead) continue;
      const d2 = dist2(pl.x, pl.z, p.x, p.z);
      if (d2 < 150 * 150 || true) { if (d2 < p.radius * p.radius && Math.abs(pl.y - (p.y - 0.75)) < 2.5 && (!pl.vehicle || p.kind !== 'weapon')) this.collect(p); }
    }
  }
  collect(p) {
    const pl = G.player;
    switch (p.kind) {
      case 'cash': pl.addMoney(p.amount); G.audio.play('cash'); G.hud.notify('+$' + p.amount, 'cash'); break;
      case 'health': if (pl.health >= pl.maxHealth && !p.force) return; pl.health = pl.maxHealth; G.audio.play('pickup'); G.hud.notify('Health restored'); break;
      case 'armor': if (pl.armor >= 100 && !p.force) return; pl.armor = 100; G.audio.play('pickup'); G.hud.notify('Body armor'); break;
      case 'star': if (G.police.stars <= 0) return; G.police.setStars(G.police.stars - 1); G.audio.play('pickup'); G.hud.notify('Police bribe: wanted level reduced'); break;
      case 'weapon': { const W = WEAPONS[p.weapon]; const had = pl.weapons[p.weapon]; pl.give(p.weapon, p.ammo || W.pack || 20, !had); G.audio.play('pickup'); G.hud.notify((had ? '' : 'Picked up ') + W.name + (W.melee ? '' : ' (+' + (p.ammo || W.pack) + ' ammo)')); G.hud.weaponChanged(); break; }
    }
    // the pickup always disappears, even if a mission's onCollect callback throws
    if (p.onCollect) { try { p.onCollect(p); } catch (e) { console.error('pickup onCollect', e); } }
    if (p.respawn > 0) { const k = { kind: p.kind, x: p.x, z: p.z, o: { amount: p.amount, weapon: p.weapon, ammo: p.ammo, respawn: p.respawn, persistent: p.persistent, y: p.y - 0.75 }, t: p.respawn }; this.respawnQueue.push(k); }
    this.remove(p);
  }
  // session boundary (quit to title / new game / load): drop transient pickups and their pending respawns.
  // Persistent plates are seeded once by Places and must survive; a new Pickups instance would duplicate them.
  // Live mission pickups stay owned by Runner.cleanup()/missions.reset() and are spliced here once dead.
  resetSession() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p) { this.list.splice(i, 1); continue; }
      if (p.dead) { this.list.splice(i, 1); continue; }
      if (p.persistent || p.mission) continue;
      this.remove(p); this.list.splice(i, 1);
    }
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const q = this.respawnQueue[i];
      if (!q || !q.o || !q.o.persistent) this.respawnQueue.splice(i, 1);
    }
  }
  tickRespawn(dt) { for (let i = this.respawnQueue.length - 1; i >= 0; i--) { const q = this.respawnQueue[i]; q.t -= dt; if (q.t <= 0) { this.spawn(q.kind, q.x, q.z, q.o); this.respawnQueue.splice(i, 1); } } }
}

// ---------------------------------------------------------------------------------------------- props
const KNOCK = new Set(['trashcan', 'mailbox', 'newspaper', 'parkingmeter', 'cone', 'barrel', 'bollard', 'streetsign', 'sign_stop', 'phonebooth', 'vending', 'hydrant', 'crate', 'pallet', 'tyre_stack', 'umbrella_beach', 'grill', 'bench']);
export class PropManager {
  constructor() { this.dyn = []; this.dirtyChunks = new Set(); this.dirtyT = 0; }
  knock(prop, src, speed) {
    if (!KNOCK.has(prop.kind) || prop.removed) return;
    if (speed < 2.2 && !(src && src.vx !== undefined && Math.hypot(src.vx, src.vz) > 2.2)) return;
    prop.removed = true;
    const col = G.world.placement.colliders.find(c => c.prop === prop);
    if (col) { col.dead = true; G.world.removeCollider(col); }
    const geo = G.world._propGeo(prop.kind, prop.variant);
    const mesh = new THREE.Mesh(geo, G.world.propMat); mesh.castShadow = true;
    const y = prop.y ?? G.world.groundY(prop.x, prop.z);
    mesh.position.set(prop.x, y, prop.z); mesh.rotation.y = prop.yaw; mesh.scale.setScalar(prop.s || 1);
    G.scene.add(mesh);
    const svx = (src && src.vx !== undefined ? src.vx : 0), svz = (src && src.vz !== undefined ? src.vz : 0);
    const sp = Math.max(3, Math.hypot(svx, svz));
    const d = { mesh, x: prop.x, y, z: prop.z, vx: svx * 0.9 + (Math.random() - 0.5) * 2, vz: svz * 0.9 + (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 3 + sp * 0.12, rx: (Math.random() - 0.5) * 9, rz: (Math.random() - 0.5) * 9, t: 0, rest: false, kind: prop.kind };
    this.dyn.push(d);
    if (this.dyn.length > 50) { const o = this.dyn.shift(); G.scene.remove(o.mesh); }
    const ck = Math.floor(prop.x / 128) + ',' + Math.floor(prop.z / 128); this.dirtyChunks.add([prop.x, prop.z]);
    this.dirtyT = 0.2;
    if (prop.kind === 'hydrant') { this.water = this.water || []; this.water.push({ x: prop.x, z: prop.z, t: 10 }); }
    G.audio && G.audio.play('hit_body_fall', { pos: prop, volume: 0.4, pitch: 1.5 });
  }
  explosion(x, z, R) {
    for (const c of G.world.placement.colliders) { if (!c.prop || c.dead) continue; const d = Math.hypot(c.x - x, c.z - z); if (d < R) this.knock(c.prop, { vx: (c.x - x) / (d || 1) * 14, vz: (c.z - z) / (d || 1) * 14 }, 14); }
  }
  update(dt) {
    for (let i = this.dyn.length - 1; i >= 0; i--) {
      const d = this.dyn[i]; if (d.rest) { d.t += dt; if (d.t > 90) { G.scene.remove(d.mesh); this.dyn.splice(i, 1); } continue; }
      d.t += dt; d.vy -= 18 * dt; d.x += d.vx * dt; d.z += d.vz * dt; d.y += d.vy * dt;
      const gy = G.world.groundY(d.x, d.z);
      if (d.y < gy) { d.y = gy; if (Math.abs(d.vy) > 2) { d.vy = -d.vy * 0.35; d.vx *= 0.7; d.vz *= 0.7; d.rx *= 0.6; d.rz *= 0.6; } else { d.vy = 0; d.vx *= 0.9; d.vz *= 0.9; d.rx *= 0.9; d.rz *= 0.9; if (Math.hypot(d.vx, d.vz) < 0.2) { d.rest = true; d.t = 0; d.mesh.rotation.x = Math.round(d.mesh.rotation.x / 1.5708) * 1.5708; d.mesh.rotation.z = Math.round(d.mesh.rotation.z / 1.5708) * 1.5708; } } }
      d.mesh.position.set(d.x, d.y, d.z); d.mesh.rotation.x += d.rx * dt; d.mesh.rotation.z += d.rz * dt;
    }
    if (this.water) for (let i = this.water.length - 1; i >= 0; i--) { const w = this.water[i]; w.t -= dt; for (let k = 0; k < 2; k++) G.fx.smoke.emit({ x: w.x, y: G.world.groundY(w.x, w.z) + 0.6, z: w.z, vx: (Math.random() - 0.5) * 1.2, vy: 7 + Math.random() * 3, vz: (Math.random() - 0.5) * 1.2, life: 1.0, s0: 0.25, s1: 0.4, c0: [0.8, 0.9, 1, 0.6], c1: [0.8, 0.9, 1, 0], grav: 14 }); if (w.t <= 0) this.water.splice(i, 1); }
    if (this.dirtyT > 0) { this.dirtyT -= dt; if (this.dirtyT <= 0) { for (const [x, z] of this.dirtyChunks) G.world.rebuildPropChunk(x, z); this.dirtyChunks.clear(); } }
  }
}

// ---------------------------------------------------------------------------------------------- markers & blips
export class Blips {
  constructor() { this.list = []; }
  add(o) { const b = { x: 0, z: 0, color: '#ffffff', icon: 'dot', label: '', flash: false, radius: 0, entity: null, priority: 1, route: false, ...o }; this.list.push(b); return b; }
  remove(b) { const i = this.list.indexOf(b); if (i >= 0) this.list.splice(i, 1); }
  update() {
    for (const b of this.list) {
      if (!b.entity) continue;
      b.x = b.entity.x; b.z = b.entity.z;
      const e = b.entity;
      // kill targets drop off radar and map the moment they die (or their vehicle is wrecked / removed)
      b.hidden = !!(e.dead || e.removeMe || e.wrecked);
    }
  }
}

export class Markers {
  constructor() { this.list = []; this.t = 0; this.tex = null; }
  add(o) {
    const col = o.color ?? 0xff3030, r = o.radius ?? 2.4;
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(r, r, 60, 24, 1, true); geo.translate(0, 30, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uCol: { value: new THREE.Color(col) }, uT: { value: 0 } },
      vertexShader: 'varying float vY; varying vec3 vW; void main(){ vY = position.y; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uCol; uniform float uT; varying float vY; varying vec3 vW; void main(){ float a = clamp(1.0 - vY / 18.0, 0.0, 1.0); a = a*a*0.4 + (vY < 0.6 ? 0.25 : 0.0); a *= smoothstep(3.0, 14.0, distance(vW.xz, cameraPosition.xz)); gl_FragColor = vec4(uCol * (0.75 + 0.2*sin(uT*4.0)), a); }'
    });
    const cyl = new THREE.Mesh(geo, mat); cyl.frustumCulled = false; g.add(cyl);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.85, r, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
    const y = o.y ?? G.world.groundY(o.x, o.z); g.position.set(o.x, y, o.z);
    if (o.arrow !== false) { const arr = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), new THREE.MeshBasicMaterial({ color: col })); arr.rotation.x = Math.PI; arr.position.y = 3.2; g.add(arr); g.userData.arrow = arr; }
    G.scene.add(g);
    const m = { x: o.x, z: o.z, y, radius: r, mode: o.mode || 'any', onEnter: o.onEnter, group: g, mat, once: o.once !== false, blip: o.blip ? G.blips.add({ x: o.x, z: o.z, ...o.blip }) : null, dead: false, vehicleOnly: o.vehicleOnly, footOnly: o.footOnly, needVehicle: o.needVehicle, height: o.height ?? 4, tag: o.tag, entity: o.entity, isMarker: true, hint: o.hint };
    this.list.push(m); return m;
  }
  remove(m) { if (m.dead) return; m.dead = true; G.scene.remove(m.group); if (m.blip) G.blips.remove(m.blip); m.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  clearTag(tag) { for (const m of this.list) if (m.tag === tag) this.remove(m); }
  update(dt) {
    this.t += dt; const pl = G.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i]; if (m.dead) { this.list.splice(i, 1); continue; }
      if (m.entity) { m.x = m.entity.x; m.z = m.entity.z; m.group.position.set(m.x, (m.entity.y || 0) + (m.entity.vehicle ? 0 : 0), m.z); if (m.blip) { m.blip.x = m.x; m.blip.z = m.z; const e = m.entity; m.blip.hidden = !!(e.dead || e.removeMe || e.wrecked); } }
      m.mat.uniforms.uT.value = this.t; if (m.group.userData.arrow) { const a = m.group.userData.arrow; a.rotation.y += dt * 2.5; a.position.y = 3.3 + Math.sin(this.t * 3) * 0.25; }
      if (!pl || pl.dead || pl.enterT > 0) continue;
      const px = pl.vehicle ? pl.vehicle.x : pl.x, pz = pl.vehicle ? pl.vehicle.z : pl.z;
      const d2 = dist2(px, pz, m.x, m.z);
      if (d2 < m.radius * m.radius && Math.abs((pl.vehicle ? pl.vehicle.y : pl.y) - m.y) < m.height) {
        if (m.footOnly && pl.vehicle) continue; if (m.vehicleOnly && !pl.vehicle) continue;
        if (m.needVehicle && pl.vehicle !== m.needVehicle) continue;
        if (m.onEnter) m.onEnter(m);
        if (m.once) this.remove(m);
      }
    }
  }
}
