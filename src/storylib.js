// Helpers shared by the story missions: locations, characters, cutscene shots, enemy spawning.
import { G } from './state.js';
import { clamp, dist2, rrange, pick, mulberry32, TAU } from './util.js';
import { CLS, ZONE } from './mapdata.js';
import { DriverAI } from './driverai.js';

export const L = id => G.landmarks[id];
export const doorOf = id => { const l = G.landmarks[id]; return l ? { x: l.door.x, z: l.door.z, yaw: l.yaw, l } : null; };
export const D = name => G.world.placement.districtCentre(name);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const roadAt = (p, r = 140) => G.map.nearestRoad(p.x, p.z, r);

// lane position (right-hand traffic) near p heading along the road; dir=+1/-1 picks travel direction
export function laneSpot(p, dir = 1, r = 140, lane = 0) {
  const n = G.map.nearestRoad(p.x, p.z, r); if (!n) return { x: p.x, z: p.z, yaw: 0, nr: null };
  const off = G.nav.laneOffset(n.edge, lane);
  const tx = n.tx * dir, tz = n.tz * dir;
  return { x: n.x - tz * off, z: n.z + tx * off, yaw: Math.atan2(tx, tz), nr: n };
}
// spot beside the kerb (parked), facing along the road
export function kerbSpot(p, side = 1, r = 140) {
  const n = G.map.nearestRoad(p.x, p.z, r); if (!n) return { x: p.x, z: p.z, yaw: 0 };
  const off = n.edge.w / 2 - 0.6;
  return { x: n.x + n.tz * side * off, z: n.z - n.tx * side * off, yaw: Math.atan2(n.tx, n.tz) + (side > 0 ? 0 : Math.PI), nr: n };
}
// free walkable spot around (cx,cz)
export function walkSpot(cx, cz, rmin = 2, rmax = 12) {
  const m = G.map, w = G.world;
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * TAU, r = rmin + Math.random() * (rmax - rmin); const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (m.roadDistAt(x, z) < -1) continue; const c = m.classAt(x, z); if (c === CLS.WATER || c === CLS.RUNWAY) continue;
    if (w.groundY(x, z) < 0.6) continue; if (!w.placement.propClear(x, z, 0.8)) continue;
    return { x, z };
  }
  return { x: cx, z: cz };
}
export function aroundSpots(cx, cz, n, rmin = 4, rmax = 14) { const out = []; for (let i = 0; i < n; i++) out.push(walkSpot(cx, cz, rmin, rmax)); return out; }
// deterministic walkable spot (same answer every call): used for things that must not move between marker refreshes
const _stable = new Map();
export function stableSpot(key, cx, cz, rmin = 3, rmax = 14) {
  if (_stable.has(key)) return _stable.get(key);
  const rng = mulberry32(key.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
  const m = G.map, w = G.world; let out = { x: cx, z: cz };
  for (let i = 0; i < 80; i++) {
    const a = rng() * TAU, r = rmin + rng() * (rmax - rmin); const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (m.roadDistAt(x, z) < 1.5) continue; const c = m.classAt(x, z); if (c === CLS.WATER || c === CLS.RUNWAY) continue;
    if (w.groundY(x, z) < 0.6 || !w.placement.propClear(x, z, 1.0)) continue; out = { x, z }; break;
  }
  _stable.set(key, out); return out;
}
export function gy(x, z) { return G.world.groundY(x, z); }
export function P3(x, z, h = 0) { return { x, y: G.world.groundY(x, z) + h, z }; }

// ---- character appearances
const SEEDS = { ray: 11, marcus: 23, nia: 37, tee: 41, harlan: 53, calloway: 67, duke: 79, jay: 97, park: 101, cody: 113, dre: 127, mack: 131, pak: 137, sal: 139, wexler: 149, birdie: 151, hollis: 157, marsh: 163, ellis: 167, sol: 173 };
export function look(name) {
  const R = G.models.peds.randomAppearance;
  name = String(name || '').toLowerCase();
  const rng = mulberry32(SEEDS[name] || 5);
  switch (name) {
    case 'ray': return { ...R(rng, { role: 'civ', gender: 'm' }), gender: 'm', skin: 0x7a4a30, hair: 0xc8c8c8, hairStyle: 'short', shirt: 0x4a6a4a, shirtType: 'jacket', pants: 0x3a3a48, hat: 'none', glasses: true, build: 'normal', scale: 1.0 };
    case 'jay': return { ...R(rng, { role: 'civ', gender: 'm' }), gender: 'm', skin: 0x7a4a30, hair: 0x111111, hairStyle: 'short', shirt: 0xf0f0f0, shirtType: 'tee', pants: 0x25304a, shoes: 0xf5f5f5, hat: 'none', glasses: false, bandana: null, build: 'normal', scale: 1.0 };
    case 'marcus': return { ...R(rng, { role: 'gangster', gang: 1, gender: 'm' }), gender: 'm', skin: 0x5a3820, hair: 0x111111, hairStyle: 'short', shirt: 0x2f9a4a, shirtType: 'tee', pants: 0x26304a, hat: 'cap', hatColor: 0x2f9a4a, bandana: null, build: 'big', scale: 1.03 };
    case 'nia': return { ...R(rng, { role: 'civ', gender: 'f' }), gender: 'f', skin: 0x7a4a30, hair: 0x1a1008, hairStyle: 'long', shirt: 0xe8e0d0, shirtType: 'tee', pants: 0x3a5a9a, hat: 'none', build: 'slim', scale: 0.96 };
    case 'tee': return { ...R(rng, { role: 'civ', gender: 'f' }), gender: 'f', skin: 0xa8734a, hair: 0x221100, hairStyle: 'bun', shirt: 0xd04a8a, shirtType: 'hoodie', pants: 0x222630, hat: 'none', glasses: true, build: 'slim', scale: 0.97 };
    case 'harlan': return { ...R(rng, { role: 'cop', gender: 'm' }), gender: 'm', skin: 0xd8a888, hair: 0x7a6a50, hairStyle: 'short', shirt: 0x1d2a44, shirtType: 'jacket', pants: 0x1d2236, hat: 'none', glasses: true, build: 'big', scale: 1.04 };
    case 'calloway': return { ...R(rng, { role: 'business', gender: 'm' }), gender: 'm', skin: 0xd8b090, hair: 0xe8e8e8, hairStyle: 'short', shirt: 0x15151c, shirtType: 'suit', pants: 0x15151c, glasses: true, hat: 'none', build: 'normal', scale: 1.0 };
    case 'duke': return { ...R(rng, { role: 'gangster', gang: 2, gender: 'm' }), gender: 'm', skin: 0x5a3820, hair: 0x111111, hairStyle: 'braids', shirt: 0x7a3aaa, shirtType: 'jacket', pants: 0x2a2030, hat: 'none', bandana: 0x7a3aaa, build: 'big', scale: 1.06 };
    case 'cody': return { ...R(rng, { role: 'gangster', gang: 1, gender: 'm' }), gender: 'm', skin: 0xc89468, hair: 0x5a3a1a, hairStyle: 'afro', shirt: 0x2f9a4a, shirtType: 'tank', pants: 0x3a3a42, shorts: false, hat: 'none', bandana: 0x2f9a4a, build: 'slim', scale: 0.98 };
    case 'dre': return { ...R(rng, { role: 'gangster', gang: 1, gender: 'm' }), gender: 'm', skin: 0x4a2c18, hair: 0x111111, hairStyle: 'braids', shirt: 0xe8e8e8, shirtType: 'hoodie', pants: 0x1b1b1f, hat: 'none', bandana: null, glasses: false, build: 'big', scale: 1.05 };
    case 'mack': return { ...R(rng, { role: 'worker', gender: 'm' }), gender: 'm', skin: 0xb88660, hair: 0x3a2a1a, hairStyle: 'short', shirt: 0xe07a30, shirtType: 'vest', pants: 0x3a4658, hat: 'hardhat', hatColor: 0xf0c020, glasses: false, build: 'big', scale: 1.04 };
    case 'pak': return { ...R(rng, { role: 'civ', gender: 'm' }), gender: 'm', skin: 0xd8b088, hair: 0xb8b8b8, hairStyle: 'short', shirt: 0xf2efe6, shirtType: 'tee', pants: 0x5a5a66, hat: 'none', glasses: true, build: 'normal', scale: 0.96 };
    case 'sal': return { ...R(rng, { role: 'civ', gender: 'm' }), gender: 'm', skin: 0x6a4028, hair: 0x111111, hairStyle: 'bald', shirt: 0xd04030, shirtType: 'tank', pants: 0x222630, hat: 'none', glasses: false, build: 'big', scale: 1.08 };
    // ---- Chapter II: the Hollow Crown
    case 'wexler': return { ...R(rng, { role: 'business', gender: 'f' }), gender: 'f', skin: 0xdcb89a, hair: 0xd8d4cc, hairStyle: 'bun', shirt: 0x14141c, shirtType: 'suit', pants: 0x14141c, shoes: 0x3a2a20, hat: 'none', glasses: true, bandana: null, build: 'slim', scale: 1.0 };
    case 'birdie': return { ...R(rng, { role: 'civ', gender: 'f' }), gender: 'f', skin: 0x9a6a44, hair: 0x22c8c8, hairStyle: 'mohawk', shirt: 0x22242e, shirtType: 'hoodie', pants: 0x191921, hat: 'beanie', hatColor: 0x2a2a3a, glasses: true, bandana: null, build: 'slim', scale: 0.95 };
    case 'hollis': return { ...R(rng, { role: 'worker', gender: 'm' }), gender: 'm', skin: 0x6a4028, hair: 0x111111, hairStyle: 'short', shirt: 0xd8a020, shirtType: 'vest', pants: 0x3a4658, hat: 'cap', hatColor: 0x24304a, glasses: false, build: 'big', scale: 1.05 };
    case 'marsh': return { ...R(rng, { role: 'business', gender: 'm' }), gender: 'm', skin: 0xd8b090, hair: 0x111111, hairStyle: 'bald', shirt: 0x15151c, shirtType: 'suit', pants: 0x15151c, hat: 'none', glasses: true, bandana: null, build: 'big', scale: 1.06 };
    case 'ellis': return { ...R(rng, { role: 'civ', gender: 'm' }), gender: 'm', skin: 0xe0c0a0, hair: 0x8a6a3a, hairStyle: 'short', shirt: 0x6a7a9a, shirtType: 'jacket', pants: 0x2a2a34, hat: 'none', glasses: true, bandana: null, build: 'slim', scale: 0.98 };
    case 'sol': return { ...R(rng, { role: 'gangster', gang: 4, gender: 'm' }), gender: 'm', skin: 0x8a5a38, hair: 0x111111, hairStyle: 'short', shirt: 0x2450b0, shirtType: 'tee', pants: 0x1a1a22, hat: 'none', bandana: 0x2a52ff, glasses: false, build: 'big', scale: 1.04 };
    default: return R(rng, { role: 'civ' });
  }
}

// ---- cinematic shots
// from/look: {x,z,h?} h = height above ground
export function shot(from, look, dur, o = {}) {
  const fy = from.y ?? (gy(from.x, from.z) + (from.h ?? 2)), ly = look.y ?? (gy(look.x, look.z) + (look.h ?? 1.3));
  const s = { from: { x: from.x, y: fy, z: from.z }, look: { x: look.x, y: ly, z: look.z }, dur, fov: o.fov || 55 };
  if (o.to) s.to = { x: o.to.x, y: o.to.y ?? (gy(o.to.x, o.to.z) + (o.to.h ?? 2)), z: o.to.z };
  if (o.lookTo) s.lookTo = { x: o.lookTo.x, y: o.lookTo.y ?? (gy(o.lookTo.x, o.lookTo.z) + (o.lookTo.h ?? 1.3)), z: o.lookTo.z };
  if (o.ease === false) s.ease = false;
  return s;
}
// orbit shot around a point
export function orbit(c, radius, h, a0, a1, dur, o = {}) {
  const f = { x: c.x + Math.cos(a0) * radius, z: c.z + Math.sin(a0) * radius, h }, t = { x: c.x + Math.cos(a1) * radius, z: c.z + Math.sin(a1) * radius, h };
  return shot(f, { x: c.x, z: c.z, h: o.lookH ?? 1.4 }, dur, { to: t, fov: o.fov || 50 });
}
// frame two characters: camera at angle offset, looking at midpoint
export function twoShot(a, b, dur, o = {}) {
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2; const ang = Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2 * (o.side ?? 1);
  const d = (o.dist ?? 5.5);
  return shot({ x: mx + Math.cos(ang) * d, z: mz + Math.sin(ang) * d, h: o.h ?? 1.8 }, { x: mx, z: mz, h: 1.4 }, dur, { fov: o.fov || 45, to: o.drift ? { x: mx + Math.cos(ang + o.drift) * d, z: mz + Math.sin(ang + o.drift) * d, h: o.h ?? 1.8 } : undefined });
}
export function faceEachOther(a, b) { a.yaw = Math.atan2(b.x - a.x, b.z - a.z); b.yaw = Math.atan2(a.x - b.x, a.z - b.z); a.faceOverride = a.yaw; b.faceOverride = b.yaw; }
export function lookAt(a, b) { a.yaw = Math.atan2(b.x - a.x, b.z - a.z); a.faceOverride = a.yaw; }

// ---- enemies
// spawn a group of gang enemies. opts: {gang, weapons:[..], health, sightRange, guard, hostile:true, blip}
export function spawnGang(r, cx, cz, n, o = {}) {
  const out = []; const gang = o.gang ?? 2;
  for (let i = 0; i < n; i++) {
    const s = walkSpot(cx, cz, o.rmin ?? 2, o.rmax ?? 10);
    const w = pick(o.weapons || ['pistol', 'pistol', 'smg']);
    const app = G.models.peds.randomAppearance(Math.random, { gang, role: o.role || 'gangster' });
    const p = r.ped({ x: s.x, z: s.z, role: 'enemy', gang, hostile: true, appearance: app, weapon: w, ammo: 999, yaw: Math.random() * TAU, health: o.health ?? 85, blip: o.blip ? { color: '#ff3030', label: 'Enemy' } : false, skill: o.skill ?? 0.3 });
    p.sightRange = o.sightRange ?? 34; p.guard = o.guard ?? true; p.home = { x: s.x, z: s.z }; p.mode = 'loiter'; p.modeT = rrange(2, 6); p.canDrop = true; p.cash = 0;
    if (o.cop) { const ap = G.models.peds.randomAppearance(Math.random, { role: 'cop' }); }
    out.push(p);
  }
  return out;
}
export function spawnCops(r, cx, cz, n, o = {}) { // crooked cops (hostile, uniform)
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = walkSpot(cx, cz, o.rmin ?? 2, o.rmax ?? 10);
    const p = r.ped({ x: s.x, z: s.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'cop' }), weapon: pick(o.weapons || ['pistol', 'shotgun', 'smg']), ammo: 999, health: o.health ?? 100, blip: o.blip ? { color: '#ff3030' } : false, skill: o.skill ?? 0.34 });
    p.sightRange = o.sightRange ?? 36; p.guard = true; p.home = { x: s.x, z: s.z }; p.mode = 'loiter'; p.canDrop = true; out.push(p);
  }
  return out;
}
// hostile car with occupants that chases the player; occupants bail out near the player on foot
export function hostileCar(r, type, x, z, yaw, o = {}) {
  const v = r.car(type, x, z, yaw, { color: o.color, blip: o.blip ? { color: '#ff3030', label: 'Enemy vehicle' } : false });
  const n = o.n ?? 2; const gang = o.gang ?? 2; const peds = [];
  for (let i = 0; i < n; i++) {
    const p = r.ped({ x, z, role: 'enemy', gang, hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { gang, role: 'gangster' }), weapon: i === 0 ? (o.driverWeapon || 'pistol') : (o.weapon || 'smg'), ammo: 999, health: o.health ?? 75, skill: o.skill ?? 0.28 });
    p.sightRange = 60; p.aggroT = 999; p.enterVehicle(v, i, true); peds.push(p);
  }
  const ai = new DriverAI(v, o.mode || 'chase', { target: o.target || G.player, aggressive: true, ignoreLights: true, stopDist: 8 });
  ai.pursuitSpeed = o.speed ?? 32; ai.ramTarget = true;
  v.ai = ai;
  if (!o.noBail) r.tick(() => {
    if (v.wrecked || !v.driver) return;
    const pl = G.player; if (pl.vehicle) return;
    if (dist2(v.x, v.z, pl.x, pl.z) < 22 * 22 && v.totalSpeed < 7) { for (const p of v.occupants()) { p.exitVehicle(false); p.setMode('attack', 60); p.target = pl; p.aggroT = 60; } v.ai = null; v.input.handbrake = true; }
  });
  return { v, peds };
}
export function sleepFrames() { return new Promise(r => requestAnimationFrame(r)); }

// position beside a landmark door: side = local right (+) / left (-) in metres, fwd = metres in front of the door
export function besideDoor(id, side = 0, fwd = 0) {
  const d = doorOf(id); if (!d) return null;
  const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw);
  let x = d.x + fx * fwd + rx * side, z = d.z + fz * fwd + rz * side;
  // keep the spot on the pavement/lawn, never in the roadway
  for (let i = 0; i < 14 && G.map.roadDistAt(x, z) < 1.4; i++) { x -= fx * 0.8; z -= fz * 0.8; }
  return { x, z, yaw: d.yaw };
}
// timed lines while the player drives/walks (seconds since start): [[t, speaker, text, dur]]
export function chatter(r, lines) {
  let t = 0; let i = 0;
  r.tick(dt => { if (G.game.inCutscene) return; t += dt; while (i < lines.length && t >= lines[i][0]) { const l = lines[i++]; G.hud.subtitle(l[2], l[3] ?? Math.max(2.6, l[2].length * 0.055), l[1]); } });
}
// keep ally peds with the player: they enter / leave the player's vehicle like a real crew
export function squad(r, allies) {
  let t = 0;
  r.tick(dt => {
    t += dt; if (t < 0.6) return; t = 0;
    const pl = G.player; const pv = pl.vehicle;
    for (const a of allies) {
      if (a.dead) continue;
      if (pv && !a.vehicle && !a.enterVeh && dist2(a.x, a.z, pl.x, pl.z) < 30 * 30) { const seat = pv.freeSeat(); if (seat > 0) a.enterVehicle(pv, seat, dist2(a.x, a.z, pl.x, pl.z) < 25); }
      else if (!pv && a.vehicle && a.vehicle.totalSpeed < 3) { a.exitVehicle(false); }
    }
  });
}
export function ally(r, who, x, z, o = {}) {
  const p = r.ped({ x, z, role: 'ally', gang: 1, appearance: look(who), name: who, weapon: o.weapon || 'pistol', ammo: 999, health: (o.health ?? 160) * 1.6 });
  p.armor = 60;
  p.followPlayer = o.follow ?? true; p.skillAcc = 0.6; p.canDrop = false; p.brave = true;
  // story companions cannot be killed by stray fire (a scripted death clears this first)
  p.invincible = true;
  if (p.followPlayer === false) p.mode = 'loiter';
  return p;
}
export function marker(r, pos, opts = {}) { return r.marker(pos.x, pos.z, opts); }

