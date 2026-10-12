// Procedural low-poly humanoid ("ped") rig for Los Santos Rising (PEDS worker).
//
//  * PedRig       : hierarchical Object3D rig (hips/spine/neck/shoulders/elbows/hips/knees), 11 meshes per ped
//                   (head, torso, pelvis, 2x upper arm, 2x forearm+hand, 2x thigh, 2x shin+shoe) + held weapon.
//  * Geometry is vertex coloured, cached (ref-counted) by outfit, material is a single shared Lambert material.
//  * Animation is fully procedural: pose = flat set of joint angles, cross-faded (~0.16 s) between modes,
//    one-shot overlay actions (punch, kick, ...) are blended on top.  Hands are IK'd (2-bone) to targets so
//    weapons, steering wheel, phone etc. line up.
//  * Conventions: faces +Z, left = +X, right = -X, origin at the feet.  yaw>0 turns left.
//
// Seated states ('drive','passenger','sit','bikeride'): the hips are SEAT_HIP_HEIGHT above the group origin,
// directly above it (z = 0), legs extend forward.  => place the group at seatPos - (0, SEAT_HIP_HEIGHT, 0).
// Swim: body is horizontal, centred on the group origin height (origin = water surface).
import * as THREE from 'three';
import { GeoBuilder, createWeaponModel, WEAPON_DEFS } from './models_weapons.js';

export const SEAT_HIP_HEIGHT = 0.5;
export const PED_STATES = ['idle', 'walk', 'run', 'sprint', 'crouch', 'jump', 'fall', 'swim', 'drive', 'passenger', 'dead',
  'cower', 'phone', 'sit', 'bikeride', 'aim', 'dance'];
export const PED_ACTIONS = { punch: 0.36, punch2: 0.36, kick: 0.6, bat: 0.75, knife: 0.45, throw: 0.65, reload: 1.3, hit: 0.4,
  getup: 1.4, wave: 1.6, enter: 0.9, fire: 0.14 };

// ------------------------------------------------------------------------------------------------ constants
const L1 = 0.45, L2 = 0.47;            // thigh, shin(+foot) lengths
const LU = 0.30, LF = 0.27, EFF = 0.305; // upper arm, forearm, effector (hand centre) distance from elbow
const SP_Y = 0.06, SH_Y = 0.47, NECK_Y = 0.53;
// nominal joint distances (rig-local metres, before the appearance scale); the ragdoll builds its rest lengths from these
export const RIG_DIMS = { L1, L2, LU, LF, EFF, SP_Y, SH_Y, NECK_Y, HEAD: 0.165, FOOT: 0.44 };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const seg = (u, a, b) => smooth((u - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

function shade(hex, k) {
  const r = clamp(((hex >> 16) & 255) * k, 0, 255) | 0, g = clamp(((hex >> 8) & 255) * k, 0, 255) | 0, b = clamp((hex & 255) * k, 0, 255) | 0;
  return (r << 16) | (g << 8) | b;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------------------------------------ appearance
const DEFAULT_APP = { gender: 'm', skin: 0xd9a77a, hair: 0x2a1c12, hairStyle: 'short', shirt: 0xcc3333, shirtType: 'tee', pants: 0x2f4a7a,
  shorts: false, shoes: 0xeeeeee, bandana: null, glasses: false, hat: 'none', hatColor: 0x333333, scale: 1, build: 'normal' };

function normApp(a0) {
  const a = Object.assign({}, DEFAULT_APP, a0 || {});
  if (a.hairStyle === 'cap' && (!a.hat || a.hat === 'none')) { a.hat = 'cap'; }
  if (!a.sleeves) a.sleeves = (a.shirtType === 'tee') ? 'short' : (a.shirtType === 'tank' || a.shirtType === 'dress' || a.shirtType === 'vest') ? 'none' : 'long';
  if (a.shirtType === 'dress' && !a.skirt) a.skirt = 'knee';
  a.scale = a.scale || 1;
  return a;
}
function dimsOf(a) {
  const f = a.gender === 'f';
  const b = a.build === 'slim' ? 0.9 : a.build === 'big' ? 1.2 : 1.0;
  return { f, b, big: a.build === 'big', shW: (f ? 0.93 : 1) * b, bd: a.build === 'big' ? 1.22 : a.build === 'slim' ? 0.92 : 1,
    hipW: (f ? 1.1 : 1) * (0.55 * b + 0.45), limb: (f ? 0.88 : 1) * (0.55 * b + 0.45), headS: f ? 0.95 : 1 };
}

// ------------------------------------------------------------------------------------------------ geometry cache
const GEO = new Map();
function acquire(key, fn) { let e = GEO.get(key); if (!e) { e = { geo: fn(), refs: 0 }; GEO.set(key, e); } e.refs++; return e.geo; }
function release(key) { const e = GEO.get(key); if (e && --e.refs <= 0) { e.geo.dispose(); GEO.delete(key); } }
let _pedMat = null;
function pedMaterial() { if (!_pedMat) _pedMat = new THREE.MeshLambertMaterial({ vertexColors: true }); return _pedMat; }

// ------------------------------------------------------------------------------------------------ part geometry
function torsoSecs(a, dm) {
  const longHem = a.shirtType === 'jacket' || a.shirtType === 'hoodie' || a.shirtType === 'suit';
  const bulk = (longHem || a.armor) ? 0.015 : 0;
  const S = [[longHem ? -0.09 : -0.025, 0.35 + (longHem ? 0.03 : 0), 0.21], [0.06, 0.315, 0.195], [0.22, 0.345, 0.212], [0.36, 0.40, 0.232],
    [0.47, 0.42, 0.21], [0.54, 0.30, 0.17], [0.585, 0.13, 0.11]];
  return S.map(([y, w, d], i) => {
    let ww = w * dm.shW + (i > 0 && i < 5 ? bulk : 0), dd = d * dm.bd + (i > 0 && i < 5 ? bulk : 0);
    if (dm.big && (i === 1 || i === 2)) { ww *= 1.05; dd *= 1.18; }
    if (dm.f) { if (i === 1) ww *= 0.93; if (i === 2) ww *= 0.96; if (i === 3) dd *= 1.14; if (i === 2) dd *= 1.04; if (i === 4) ww *= 0.96; }
    return { y, w: ww, d: dd };
  });
}
function secAt(S, y) {
  for (let i = 0; i < S.length - 1; i++) if (y <= S[i + 1].y) { const t = clamp((y - S[i].y) / (S[i + 1].y - S[i].y), 0, 1); return { y, w: lerp(S[i].w, S[i + 1].w, t), d: lerp(S[i].d, S[i + 1].d, t) }; }
  return S[S.length - 1];
}
function bandSecs(S, y0, y1, grow) { // slice of the torso with slightly enlarged sections
  const out = [], n = 3;
  for (let i = 0; i <= n; i++) { const s = secAt(S, lerp(y0, y1, i / n)); out.push({ y: s.y, w: s.w + grow, d: s.d + grow }); }
  return out;
}

function torsoGeo(a, dm) {
  const b = new GeoBuilder(), S = torsoSecs(a, dm), t = a.shirtType, sc = a.shirt, skin = a.skin;
  const rnd = mulberry(hashStr('t' + sc + t));
  const topY = S[S.length - 1].y;
  const zf = y => secAt(S, y).d / 2;
  const main = t === 'vest' ? (a.under != null ? a.under : skin) : sc;
  b.loft(S, main, { n: 12, p: 2.6 });
  const collar = shade(sc, 0.82);
  if (t === 'tee' || t === 'tank' || t === 'dress') {
    if (t === 'tee') b.cyl(0.058, 0.066, 0.024, 10, 0, 0.577, 0, collar);
    else { // scoop neck patch (skin)
      b.cyl(0.075 * dm.shW, 0.075 * dm.shW, 0.02, 12, 0, 0.5, zf(0.5) - 0.006, skin, Math.PI / 2 - 0.35, 0, 0, 1, 1, 1.25);
      b.cyl(0.05, 0.06, 0.02, 10, 0, 0.58, 0, skin);
    }
  }
  if (t === 'jacket' || t === 'suit') {
    b.cyl(0.06, 0.075, 0.04, 10, 0, 0.575, 0, collar);
    if (t === 'jacket') b.box(0.01, 0.42, 0.012, 0, 0.27, zf(0.27) + 0.004, shade(sc, 0.55));
    if (t === 'suit') for (const s of [-1, 1]) { b.box(0.05 * dm.shW, 0.11, 0.06, s * 0.08, 0.53, zf(0.53) - 0.005, collar, -0.25, 0, -s * 0.6); }
  }
  if (t === 'hoodie') {
    b.sphere(0.095, 0, 0.555, -0.085, sc, 1.25, 0.85, 0.85, 8, 6);
    b.cyl(0.055, 0.07, 0.03, 10, 0, 0.575, 0, shade(sc, 0.8));
    b.box(0.2 * dm.shW, 0.1, 0.02, 0, 0.13, zf(0.13) + 0.004, shade(sc, 0.82));
    for (const s of [-1, 1]) b.box(0.008, 0.08, 0.008, s * 0.035, 0.49, zf(0.49) + 0.002, 0xe8e8e0);
  }
  if (t === 'suit') {
    const z = zf(0.42);
    b.box(0.1, 0.27, 0.014, 0, 0.42, z + 0.001, 0xf4f4f4, -0.08);            // white shirt
    for (const s of [-1, 1]) b.box(0.05, 0.22, 0.014, s * 0.065, 0.39, z + 0.005, shade(sc, 0.72), -0.08, 0, s * 0.28); // lapels
    b.box(0.03, 0.23, 0.014, 0, 0.36, z + 0.008, a.accent != null ? a.accent : 0xaa2222, -0.08);  // tie
    b.box(0.04, 0.03, 0.02, 0, 0.49, z - 0.002, a.accent != null ? a.accent : 0xaa2222, -0.3);
  }
  if (t === 'vest') {
    b.loft(bandSecs(S, -0.02, 0.5, 0.014), sc, { n: 12, p: 2.6, capTop: false, capBottom: false });
    b.box(0.09, 0.14, 0.012, 0, 0.43, zf(0.43) + 0.013, main, -0.15);           // shirt / chest showing at the V
    b.box(0.01, 0.4, 0.012, 0, 0.27, zf(0.27) + 0.02, shade(sc, 0.5));
    if (a.trim != null) {
      b.loft(bandSecs(S, 0.13, 0.19, 0.02), a.trim, { n: 12, p: 2.6, capTop: false, capBottom: false });
      b.loft(bandSecs(S, 0.3, 0.36, 0.02), a.trim, { n: 12, p: 2.6, capTop: false, capBottom: false });
    }
  } else if (a.trim != null) { // stripes (medic, fireman)
    b.loft(bandSecs(S, 0.1, 0.16, 0.012), a.trim, { n: 12, p: 2.6, capTop: false, capBottom: false });
    b.loft(bandSecs(S, 0.27, 0.33, 0.012), a.trim, { n: 12, p: 2.6, capTop: false, capBottom: false });
  }
  if (a.pattern === 'hawaii') {
    const cols = [a.accent != null ? a.accent : 0xffffff, 0xffffff, 0xffe066, 0xff6a88];
    for (let i = 0; i < 16; i++) {
      const front = i < 10, y = 0.08 + rnd() * 0.38, x = (rnd() - 0.5) * 0.3 * dm.shW, z = (front ? 1 : -1) * (zf(y) - 0.002);
      b.box(0.04 + rnd() * 0.03, 0.04 + rnd() * 0.03, 0.012, x, y, z, cols[(rnd() * cols.length) | 0], 0, front ? 0 : Math.PI, rnd() * 3);
    }
  }
  if (a.badge) b.box(0.03, 0.036, 0.012, 0.09 * dm.shW, 0.36, zf(0.36) + 0.001, 0xe0b73a, 0, 0, 0.0);
  if (a.badge) { b.box(0.05, 0.02, 0.012, -0.09 * dm.shW, 0.36, zf(0.36) + 0.001, 0xd8d8d8); b.box(0.022, 0.03, 0.03, 0.17 * dm.shW, 0.52, 0.0, 0x222222); }
  if (a.armor) {
    b.box(0.3 * dm.shW, 0.32, 0.05, 0, 0.33, zf(0.33) + 0.012, 0x24262a, -0.04);       // front plate
    b.box(0.3 * dm.shW, 0.32, 0.05, 0, 0.33, -zf(0.33) - 0.012, 0x24262a, 0.04);       // back plate
    for (const s of [-1, 1]) {
      b.sphere(0.075, s * 0.205 * dm.shW, 0.49, 0, 0x1c1d20, 1, 0.75, 1.1, 8, 5);      // shoulder pads
      b.box(0.065, 0.08, 0.04, s * 0.095, 0.17, zf(0.17) + 0.02, 0x303338);            // mag pouches
      b.box(0.065, 0.08, 0.04, s * 0.095 * 0.0 + s * 0.02, 0.17, zf(0.17) + 0.02, 0x303338);
    }
    b.box(0.05, 0.03, 0.02, 0, 0.47, zf(0.47) + 0.03, 0x6a6e76);
    b.box(0.02, 0.05, 0.03, -0.17, 0.53, 0.0, 0x222222);                               // radio
  }
  return b.build();
}

function pelvisGeo(a, dm) {
  const b = new GeoBuilder(), hw = dm.hipW, sk = a.skirt;
  const pc = sk ? (a.shirtType === 'dress' ? a.shirt : a.pants) : a.pants;
  b.loft([{ y: -0.1, w: 0.29 * hw, d: 0.2 * dm.bd }, { y: -0.01, w: 0.335 * hw, d: 0.21 * dm.bd }, { y: 0.05, w: 0.325 * hw, d: 0.198 * dm.bd }, { y: 0.085, w: 0.305 * hw, d: 0.185 * dm.bd }], pc, { n: 12, p: 2.4 });
  if (!sk || a.belt) {
    b.loft([{ y: -0.03, w: 0.336 * hw, d: 0.222 * dm.bd }, { y: 0.014, w: 0.338 * hw, d: 0.224 * dm.bd }], a.beltColor != null ? a.beltColor : 0x241a12, { n: 12, p: 2.4, capTop: false, capBottom: false });
    b.box(0.03, 0.03, 0.012, 0, -0.008, 0.113 * dm.bd, 0xc8a24a);
  }
  if (sk) {
    const len = sk === 'mini' ? 0.2 : 0.36, rb = sk === 'mini' ? 0.225 : 0.245;
    b.cyl(0.175 * hw, rb * hw, len, 12, 0, 0.05 - len / 2, 0, pc, 0, 0, 0, 1, 1, 0.88 * dm.bd);
  }
  if (a.belt) { // cop / swat duty belt gear
    b.box(0.05, 0.13, 0.09, -0.175 * hw, -0.03, 0.02, 0x141416);   // holster (right hip)
    b.box(0.05, 0.05, 0.06, 0.16 * hw, 0.0, 0.05, 0x141416);       // pouch
    b.box(0.05, 0.05, 0.06, -0.06, 0.0, -0.12, 0x141416);
    b.box(0.03, 0.05, 0.03, 0.06, 0.0, -0.12, 0x9aa0a8);           // cuffs
  }
  if (a.bandana != null && a.role !== 'cop' && (a.hat === 'none' || a.hat === 'cap')) { // bandana hanging out of the back pocket
    b.box(0.07, 0.11, 0.012, 0.09 * hw, -0.03, -0.108 * dm.bd, a.bandana, 0.1, 0, 0.1);
  }
  return b.build();
}

function upperArmGeo(a, dm) {
  const b = new GeoBuilder(), k = dm.limb, skin = a.skin, sl = a.sleeves, sc = a.shirtType === 'vest' ? (a.under != null ? a.under : null) : a.shirt;
  const r0 = 0.052 * k, r1 = 0.043 * k, rAt = y => lerp(r0, r1, -y / LU);
  const sleeveOn = sl !== 'none' && sc != null;
  b.cyl(r1, r0, LU, 8, 0, -LU / 2, 0, skin);
  b.sphere(r0 * 1.02, 0, 0, 0, skin, 1, 1, 1, 8, 6);
  b.sphere(r1 * 1.05, 0, -LU, 0, skin, 1, 1, 1, 8, 6);
  if (sleeveOn) {
    const len = sl === 'long' ? LU : 0.135;
    const ra = rAt(0) + 0.009, rb = rAt(-len) + 0.009;
    b.cyl(rb, ra, len, 8, 0, -len / 2, 0, sc);
    b.sphere(r0 * 1.02 + 0.009, 0, 0, 0, sc, 1, 1, 1, 8, 6);
    if (sl === 'long') b.sphere(r1 * 1.05 + 0.009, 0, -LU, 0, sc, 1, 1, 1, 8, 6);
    else b.cyl(rb + 0.004, rb + 0.004, 0.018, 8, 0, -len + 0.009, 0, shade(sc, 0.82));
  }
  if (a.armor) b.box(0.11, 0.08, 0.11, 0, -0.03, 0, 0x1c1d20, 0, 0, 0);
  return b.build();
}

function foreArmGeo(a, dm) {
  const b = new GeoBuilder(), k = dm.limb, skin = a.skin, sl = a.sleeves, sc = a.shirtType === 'vest' ? (a.under != null ? a.under : null) : a.shirt;
  const hand = a.gloves != null ? a.gloves : skin;
  b.cyl(0.033 * k, 0.042 * k, LF, 8, 0, -LF / 2, 0, skin);
  b.sphere(0.04 * k, 0, 0, 0, skin, 1, 1, 1, 8, 6);
  if (sl === 'long' && sc != null) {
    b.cyl(0.037 * k + 0.008, 0.042 * k + 0.009, LF - 0.05, 8, 0, -(LF - 0.05) / 2, 0, sc);
    b.sphere(0.04 * k + 0.009, 0, 0, 0, sc, 1, 1, 1, 8, 6);
    b.cyl(0.036 * k + 0.012, 0.036 * k + 0.012, 0.016, 8, 0, -(LF - 0.05), 0, shade(sc, 0.8));
  }
  if (a.gloves != null) b.cyl(0.04 * k, 0.034 * k, 0.07, 8, 0, -LF + 0.03, 0, hand);
  b.sphere(0.042 * k, 0, -0.305, 0.0, hand, 0.9, 1.15, 0.72, 8, 6);   // fist
  b.sphere(0.0155, 0, -0.285, 0.036 * k + 0.004, hand, 1, 1.2, 1, 6, 5);  // thumb
  return b.build();
}

function thighGeo(a, dm) {
  const b = new GeoBuilder(), k = dm.limb, pc = a.pants, skin = a.skin;
  const r0 = 0.088 * k, r1 = 0.066 * k, rAt = y => lerp(r0, r1, -y / L1);
  const long = !a.shorts && !a.skirt;
  b.cyl(r1, r0, L1, 9, 0, -L1 / 2, 0, long ? pc : skin);
  b.sphere(r1 * 1.03, 0, -L1, 0, long ? pc : skin, 1, 1, 1, 8, 6);
  if (!long && !a.skirt) { // shorts
    const len = 0.3;
    b.cyl(rAt(-len) + 0.01, r0 + 0.01, len, 9, 0, -len / 2, 0, pc);
    b.cyl(rAt(-len) + 0.013, rAt(-len) + 0.013, 0.02, 9, 0, -len + 0.01, 0, shade(pc, 0.8));
  }
  return b.build();
}

function shinGeo(a, dm) {
  const b = new GeoBuilder(), k = dm.limb, pc = a.pants, skin = a.skin;
  const long = !a.shorts && !a.skirt;
  b.cyl(0.046 * k, 0.064 * k, 0.40, 9, 0, -0.20, 0, long ? pc : skin);
  if (long) b.cyl(0.05 * k + 0.004, 0.05 * k + 0.004, 0.03, 9, 0, -0.365, 0, shade(pc, 0.85));
  else b.cyl(0.05 * k, 0.05 * k, 0.05, 9, 0, -0.355, 0, 0xf2f2f2);          // sock
  const sh = a.shoes, sole = a.boots ? 0x141414 : (sh === 0xeeeeee || sh > 0xd8d8d8 ? 0x9a9a9a : 0xf2f2f2), w = 0.092 * k + 0.004;
  if (a.boots) b.cyl(0.056 * k, 0.06 * k, 0.12, 9, 0, -0.33, -0.005, sh);   // boot shaft
  b.box(w, 0.07, 0.205, 0, -0.43, 0.045, sh);
  b.sphere(0.047 * k + 0.002, 0, -0.437, 0.145, sh, 1.0, 0.85, 1.05, 8, 6);
  b.box(w + 0.004, 0.024, 0.165, 0, -0.459, 0.0, sole);
  b.sphere(0.049 * k + 0.002, 0, -0.459, 0.14, sole, 1.0, 0.5, 1.05, 8, 4);
  b.box(w * 0.55, 0.012, 0.07, 0, -0.394, 0.07, a.boots ? 0x2a2a2a : 0xf4f4f4);            // laces/tongue
  return b.build();
}

function headGeo(a, dm) {
  const b = new GeoBuilder(), hs = dm.headS, skin = a.skin, hc = a.hair, rnd = mulberry(hashStr('h' + a.hair + a.hairStyle));
  const f = dm.f;
  b.cyl(0.05 * hs, 0.056 * hs, 0.12, 9, 0, 0.04, 0, shade(skin, 0.95));            // neck
  const hy = 0.165, R = 0.118 * hs;
  const HS = [[-0.128, 0.05, 0.06, 0.028], [-0.108, 0.10, 0.11, 0.022], [-0.07, 0.165, 0.165, 0.012], [-0.02, 0.212, 0.218, 0.002], [0.035, 0.226, 0.236, 0],
    [0.085, 0.196, 0.206, -0.002], [0.12, 0.135, 0.145, -0.004], [0.138, 0.05, 0.06, -0.004]].map(([y, w, d, z]) => ({ y: hy + y * hs, w: w * hs, d: d * hs, z: z * hs }));
  const zfr = y => { for (let i = 0; i < HS.length - 1; i++) if (y <= HS[i + 1].y) { const t = clamp((y - HS[i].y) / (HS[i + 1].y - HS[i].y), 0, 1); return lerp(HS[i].z + HS[i].d / 2, HS[i + 1].z + HS[i + 1].d / 2, t); } return 0.04; };
  b.loft(HS, skin, { n: 14, p: 2.0 });                                            // head (cranium + jaw in one smooth loft)
  for (const s of [-1, 1]) {
    b.sphere(0.027, s * 0.108 * hs, hy - 0.0, -0.005, skin, 0.45, 1, 0.75, 6, 5);   // ears
    b.box(0.024, 0.016, 0.012, s * 0.042 * hs, hy + 0.017, zfr(hy + 0.017) - 0.002, 0x1b1412);          // eyes
    b.box(0.034, 0.008, 0.012, s * 0.043 * hs, hy + 0.04, zfr(hy + 0.04) - 0.002, a.hairStyle === 'bald' ? 0x3a2a1c : shade(hc, 0.85)); // brows
  }
  b.box(0.022, 0.036, 0.03, 0, hy - 0.017, zfr(hy - 0.017) + 0.0, shade(skin, 0.94));               // nose
  b.box(f ? 0.038 : 0.042, 0.008, 0.012, 0, hy - 0.057, zfr(hy - 0.057) - 0.002, f ? 0xb24a52 : 0x7a3a3a);   // mouth
  const hy2 = hy + 0.005;
  const hairCap = (r, theta, tilt, col, yoff = 0) => b.cap(r, theta, 0, hy2 + yoff, -0.004, col, 0.94, 1.12, 1.0, -tilt, 0, 0, 12, 7);
  const hsty = a.hairStyle;
  const capTheta = 1.05 + 0.45, capTilt = 0.45;
  if (hsty === 'short' || hsty === 'cap') { hairCap(R * 1.14, capTheta, capTilt, hc); for (const s of [-1, 1]) b.box(0.014, 0.05, 0.035, s * R * 0.97, 0.205, 0.01, hc); }
  else if (hsty === 'long') {
    hairCap(R * 1.14, capTheta, capTilt, hc);
    b.box(0.25 * hs, 0.36, 0.06, 0, 0.075, -0.135, hc);
    for (const s of [-1, 1]) b.box(0.03, 0.2, 0.08, s * R * 1.0, 0.12, 0.0, hc);
  } else if (hsty === 'afro') { b.sphere(0.165 * hs, 0, 0.215, -0.062, hc, 1.06, 0.94, 1.0, 12, 9); }
  else if (hsty === 'braids') {
    hairCap(R * 1.14, capTheta, capTilt, hc);
    for (let i = 0; i < 8; i++) {
      const ang = -2.0 + i * (4.0 / 7);
      const x = Math.sin(ang) * R * 0.92, z = -Math.cos(ang) * R * 0.9;
      b.cyl(0.008, 0.013, 0.27, 5, x, 0.085 + (i % 2) * 0.01, z, hc, 0, 0, 0);
      b.sphere(0.013, x, -0.045, z, i % 2 ? 0xe0c060 : 0xeeeeee, 1, 1, 1, 5, 4);
    }
  } else if (hsty === 'bun') { hairCap(R * 1.14, capTheta, capTilt, hc); b.sphere(0.055, 0, 0.3, -0.075, hc, 1, 0.95, 1, 8, 6); b.box(0.12, 0.012, 0.02, 0, 0.27, -0.07, shade(hc, 0.7), 0.8); }
  else if (hsty === 'mohawk') {
    hairCap(R * 1.02, capTheta + 0.1, capTilt, shade(hc, 0.45));
    for (let i = 0; i < 9; i++) { const t = -1.45 + i * 0.29; b.box(0.026, 0.06 + 0.03 * Math.cos(t * 0.9), 0.05, 0, hy + Math.cos(t) * 0.152 + 0.02, Math.sin(t) * 0.135, hc, t); }
  }
  // beard
  if (a.beard != null) { b.sphere(R * 0.74, 0, hy - 0.075, 0.018, a.beard, 1.08, 0.72, 1.06, 10, 6); b.box(0.055, 0.012, 0.014, 0, hy - 0.04, zfr(hy - 0.04) + 0.0, a.beard); }
  // glasses
  if (a.glasses) {
    const gc = 0x0d0d10;
    for (const s of [-1, 1]) { b.box(0.046, 0.028, 0.012, s * 0.042 * hs, hy + 0.017, zfr(hy + 0.017) + 0.003, gc); b.box(0.006, 0.006, 0.12, s * (0.107 * hs), hy + 0.02, 0.05, 0x222226); }
    b.box(0.02, 0.008, 0.012, 0, hy + 0.022, zfr(hy + 0.022) + 0.003, gc);
  }
  // hats
  const hat = a.hat, hcol = a.hatColor;
  if (hat === 'cap') {
    b.cap(R * 1.24, 1.45, 0, hy + 0.012, -0.006, hcol, 0.94, 1.12, 1.0, -0.3);
    b.box(0.13 * hs, 0.009, 0.06, 0, 0.222, R * 1.06, hcol, 0.14);
    for (const s of [-1, 1]) b.box(0.06 * hs, 0.009, 0.06, s * 0.05, 0.222, R * 1.03, hcol, 0.14, -s * 0.5);
    b.sphere(0.011, 0, 0.31, -0.012, shade(hcol, 0.8), 1, 0.7, 1, 6, 4);
  } else if (hat === 'beanie') {
    b.cap(R * 1.27, 1.55, 0, hy + 0.01, -0.012, hcol, 0.94, 1.22, 1.0, -0.22);
    b.cyl(R * 1.06, R * 1.07, 0.05, 12, 0, 0.225, -0.008, shade(hcol, 1.25), -0.2, 0, 0, 0.94, 1, 1.0);
  } else if (hat === 'cop') {
    b.cyl(0.128 * hs, 0.13 * hs, 0.05, 12, 0, 0.233, -0.004, shade(hcol, 0.6), -0.05, 0, 0, 0.95, 1, 1.0);
    b.cyl(0.148 * hs, 0.13 * hs, 0.05, 12, 0, 0.278, -0.006, hcol, -0.05, 0, 0, 0.95, 1, 1.0);
    b.cyl(0.149 * hs, 0.149 * hs, 0.012, 12, 0, 0.305, -0.006, shade(hcol, 1.1), -0.05, 0, 0, 0.95, 1, 1.0);
    b.box(0.13 * hs, 0.008, 0.075, 0, 0.217, R * 1.06, 0x0e0e10, 0.1);
    b.box(0.032, 0.032, 0.012, 0, 0.285, 0.142, 0xe0b73a, -0.05);
  } else if (hat === 'hardhat') {
    b.cap(R * 1.28, 1.52, 0, hy + 0.02, -0.004, hcol, 0.96, 1.05, 1.03, -0.05);
    b.cyl(0.152 * hs, 0.152 * hs, 0.012, 14, 0, 0.222, -0.004, hcol, 0, 0, 0, 0.98, 1, 1.05);
    b.box(0.15 * hs, 0.01, 0.055, 0, 0.222, R * 1.12, hcol, 0.05);
    b.box(0.032, 0.022, 0.25, 0, 0.312, -0.004, shade(hcol, 0.85), -0.0);
  } else if (hat === 'helmet') {
    b.cap(R * 1.3, 1.88, 0, hy + 0.012, -0.002, hcol, 0.97, 1.05, 1.04, -0.08);
    b.box(0.2 * hs, 0.05, 0.04, 0, 0.195, R * 1.02, 0x1b2430);
    b.box(0.22 * hs, 0.012, 0.03, 0, 0.222, R * 1.03, shade(hcol, 1.5));
    for (const s of [-1, 1]) { b.box(0.012, 0.11, 0.014, s * R * 0.92, 0.08, 0.05, 0x101012); b.box(0.03, 0.05, 0.08, s * R * 1.12, 0.17, 0.0, shade(hcol, 1.3)); }
    b.box(0.03, 0.03, 0.04, 0, 0.3, 0.06, 0x555a62);
  }
  // bandana (head band, or neckerchief when a hat is worn)
  if (a.bandana != null && hat !== 'cop' && hat !== 'helmet') {
    const bc = a.bandana;
    if (hat === 'none' || hat === 'cap' && false) {
      b.cyl(0.128 * hs, 0.131 * hs, 0.048, 12, 0, 0.222, -0.006, bc, -0.22, 0, 0, 0.95, 1, 1.0);
      b.box(0.05, 0.045, 0.03, 0, 0.19, -0.128, bc, 0.3);
      for (const s of [-1, 1]) b.box(0.022, 0.09, 0.012, s * 0.02, 0.14, -0.14, bc, 0.12, 0, s * 0.25);
    } else {
      b.cyl(0.07, 0.078, 0.05, 10, 0, -0.005, 0.0, bc);
      b.box(0.06, 0.05, 0.02, 0, -0.02, 0.07, bc, 0.3, 0, 0.78);
    }
  }
  return b.build();
}

// ------------------------------------------------------------------------------------------------ pose system
const KEYS = ['hFree', 'hY', 'hZ', 'hRX', 'hRY', 'hRZ', 'sRX', 'sRY', 'sRZ', 'nRX', 'nRY', 'nRZ',
  'lhX', 'lhZ', 'lk', 'rhX', 'rhZ', 'rk', 'laX', 'laY', 'laZ', 'le', 'raX', 'raY', 'raZ', 're', 'mW', 'mY', 'mP', 'mR'];
export function newPose() {
  const T = {}; for (const k of KEYS) T[k] = 0;
  T.laZ = 0.08; T.raZ = -0.08; T.le = -0.18; T.re = -0.18; return T;
}
function resetPose(T) { for (const k of KEYS) T[k] = 0; T.laZ = 0.08; T.raZ = -0.08; T.le = -0.18; T.re = -0.18; return T; }
function copyPose(d, s) { for (const k of KEYS) d[k] = s[k]; return d; }
function lerpPose(o, a, b, t) { for (const k of KEYS) o[k] = a[k] + (b[k] - a[k]) * t; return o; }
function mixKey(F, k, v, w) { F[k] += (v - F[k]) * w; }
function setLeg(T, s, flex, abd = 0, knee = 0) { T[s + 'hX'] = -flex; T[s + 'hZ'] = s === 'l' ? abd : -abd; T[s + 'k'] = knee; }
function setArm(T, s, flex, abd = 0, twist = 0, elbow = 0) { T[s + 'aX'] = -flex; T[s + 'aZ'] = s === 'l' ? abd : -abd; T[s + 'aY'] = s === 'l' ? twist : -twist; T[s + 'e'] = -elbow; }

function hipHeight(F) {
  const rl = (L1 * Math.cos(F.lhX) + L2 * Math.cos(F.lhX + F.lk)) * Math.cos(F.lhZ * 0.7);
  const rr = (L1 * Math.cos(F.rhX) + L2 * Math.cos(F.rhX + F.rk)) * Math.cos(F.rhZ * 0.7);
  const auto = Math.max(rl, rr);
  return auto + (F.hY - auto) * F.hFree;
}

// scratch
const _M = new THREE.Matrix4(), _Mh = new THREE.Matrix4(), _Ms = new THREE.Matrix4(), _Mi = new THREE.Matrix4(), _B = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _e1 = new THREE.Euler();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(),
      _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _t = new THREE.Vector3();

function spineMatrix(F, out) {
  _q1.setFromEuler(_e1.set(F.hRX, F.hRY, F.hRZ, 'XYZ'));
  _Mh.compose(_a.set(0, hipHeight(F), F.hZ), _q1, _one);
  _q2.setFromEuler(_e1.set(F.sRX, F.sRY, F.sRZ, 'XYZ'));
  _Ms.compose(_b.set(0, SP_Y, 0), _q2, _one);
  return out.multiplyMatrices(_Mh, _Ms);
}
function toRoot(F, x, y, z, out) { spineMatrix(F, _M); return out.set(x, y, z).applyMatrix4(_M); }

const _ikOut = { x: 0, y: 0, z: 0, e: 0 };
const HINT_R = new THREE.Vector3(-0.5, -1, -0.35), HINT_L = new THREE.Vector3(0.5, -1, -0.35);
/** two-bone IK for one arm; target in ROOT space, hint (elbow pole) in SPINE space. Writes _ikOut (raw joint rotations). */
function solveArm(F, side, tRoot, hint, sxOff) {
  spineMatrix(F, _M); _Mi.copy(_M).invert();
  _t.copy(tRoot).applyMatrix4(_Mi);
  _a.set(side * sxOff, SH_Y, 0);
  _c.subVectors(_t, _a);
  let d = _c.length();
  const maxR = (LU + EFF) * 0.997, minR = Math.abs(LU - EFF) + 0.03;
  d = clamp(d, minR, maxR);
  _c.setLength(d);
  const cosE = clamp((LU * LU + EFF * EFF - d * d) / (2 * LU * EFF), -1, 1);
  const elbow = Math.PI - Math.acos(cosE);
  const alpha = Math.acos(clamp((LU * LU + d * d - EFF * EFF) / (2 * LU * d), -1, 1));
  _d.copy(_c).divideScalar(d);                                   // dir
  _b.copy(hint).addScaledVector(_d, -hint.dot(_d));              // pole perpendicular to dir
  if (_b.lengthSq() < 1e-6) _b.set(0, -1, 0).addScaledVector(_d, _d.y);
  _b.normalize();
  _u.copy(_d).multiplyScalar(Math.cos(alpha)).addScaledVector(_b, Math.sin(alpha)); // upper arm direction
  _x.copy(_c).addScaledVector(_u, -LU).divideScalar(EFF);        // forearm direction (approx unit)
  _z.copy(_x).addScaledVector(_u, -_x.dot(_u));
  if (_z.lengthSq() < 1e-8) _z.copy(_b).negate();
  _z.normalize();
  _y.copy(_u).negate();
  _x.crossVectors(_y, _z).normalize();
  _B.makeBasis(_x, _y, _z);
  _e1.setFromRotationMatrix(_B, 'XYZ');
  _ikOut.x = _e1.x; _ikOut.y = _e1.y; _ikOut.z = _e1.z; _ikOut.e = -elbow;
  return _ikOut;
}
function ikMix(F, rig, side, target, w, hint) {
  const o = solveArm(F, side, target, hint || (side > 0 ? HINT_L : HINT_R), rig.sx);
  const p = side > 0 ? 'l' : 'r';
  mixKey(F, p + 'aX', o.x, w); mixKey(F, p + 'aY', o.y, w); mixKey(F, p + 'aZ', o.z, w); mixKey(F, p + 'e', o.e, w);
}
const _wq = new THREE.Quaternion();
function gripPoint(wt, g, out) { // weapon-local point -> root space
  _wq.setFromEuler(_e1.set(-wt.pitch, wt.yaw, wt.roll, 'YXZ'));
  return out.copy(g).applyQuaternion(_wq).add(wt.pos);
}

// weapon hold targets (offsets from mid-shoulder point O, root space)
const CARRY = { pistol: [-0.19, -0.30, 0.25, -1.0], long: [-0.14, -0.27, 0.26, -0.65], rpg: [-0.17, -0.2, 0.2, 0.35], melee: [-0.2, -0.28, 0.22, 1.15],
  throw: [-0.2, -0.32, 0.18, 0.0], tool: [-0.2, -0.30, 0.2, 0.3] };
const AIM = { pistol: [-0.14, 0.03, 0.55], long: [-0.13, -0.085, 0.31], rpg: [-0.19, -0.1, 0.22] };

function makeWeaponTarget(F, kind, id, aiming, aimPitch) {
  const O = toRoot(F, 0, SH_Y, 0, new THREE.Vector3());
  const wt = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, left: null, two: false };
  const def = WEAPON_DEFS[id];
  if (aiming && (kind === 'pistol' || kind === 'long' || kind === 'rpg')) {
    const o = AIM[kind], pitch = aimPitch || 0;
    _q3.setFromEuler(_e1.set(-pitch, 0, 0, 'YXZ'));
    wt.pos.set(o[0], o[1], o[2]).applyQuaternion(_q3).add(O);
    if (id === 'sniper') wt.pos.add(_a.set(0.02, 0.012, 0.0));
    wt.pitch = pitch; wt.two = def.twoHanded;
  } else if (aiming && id === 'bat') { wt.pos.set(-0.17, -0.02, 0.22).add(O); wt.pitch = 1.0; wt.two = true; }
  else if (aiming && id === 'knife') { wt.pos.set(-0.14, -0.1, 0.34).add(O); wt.pitch = 0.05; }
  else if (aiming) { const c = CARRY[kind] || CARRY.tool; wt.pos.set(c[0] + 0.08, c[1] + 0.25, c[2] + 0.1).add(O); wt.pitch = c[3] * 0.5; }
  else {
    const c = CARRY[kind] || CARRY.tool;
    wt.pos.set(c[0], c[1], c[2]).add(O); wt.pitch = c[3]; wt.two = !!def.twoHanded;
  }
  if (wt.two) wt.left = gripPoint(wt, def.grip2, new THREE.Vector3());
  return wt;
}
function applyWeaponTarget(F, rig, wt, w) {
  ikMix(F, rig, -1, wt.pos, w);
  if (wt.left) ikMix(F, rig, 1, wt.left, w);
  mixKey(F, 'mW', 1, w); mixKey(F, 'mY', wt.yaw, w); mixKey(F, 'mP', wt.pitch, w); mixKey(F, 'mR', wt.roll, w);
}

// ------------------------------------------------------------------------------------------------ base state poses
const LEGKEYS = ['hFree', 'hY', 'lhX', 'lhZ', 'lk', 'rhX', 'rhZ', 'rk'];
const NOMINAL = { walk: 1.5, run: 4.5, sprint: 7.0, crouch: 1.3 };
const STRIDE = { walk: 1.55, run: 2.7, sprint: 3.3, crouch: 1.3 };
const HIDE_W = new Set(['drive', 'passenger', 'swim', 'dead', 'cower', 'sit', 'bikeride', 'dance', 'phone']);

function idlePose(T, c) {
  const br = Math.sin(c.t * 1.7 + c.seed * 6), sh = Math.sin(c.t * 0.35 + c.seed * 9);
  setLeg(T, 'l', 0.02 + 0.03 * sh, 0.03, 0.04 + 0.05 * Math.max(0, sh));
  setLeg(T, 'r', 0.02 - 0.03 * sh, 0.03, 0.04 + 0.05 * Math.max(0, -sh));
  T.hRZ = 0.03 * sh; T.hRY = 0.03 * Math.sin(c.t * 0.23 + c.seed * 4);
  T.sRX = 0.02 + 0.012 * br; T.sRZ = -0.02 * sh; T.sRY = -T.hRY * 0.6;
  T.nRY = 0.28 * Math.sin(c.t * 0.27 + c.seed * 5) * Math.sin(c.t * 0.11 + 1); T.nRX = 0.03 + 0.04 * Math.sin(c.t * 0.41 + c.seed * 2); T.nRZ = 0.03 * sh;
  setArm(T, 'l', 0.04 + 0.02 * br, 0.09, 0, 0.2 + 0.03 * br);
  setArm(T, 'r', 0.04 + 0.02 * br, 0.09, 0, 0.2 + 0.03 * br);
}
// ---- locomotion: feet are planted.  Each foot follows an authored path relative to the pelvis (stance = straight line moving back at
// the ground speed, swing = Hermite arc + lift), the legs are solved with 2-bone IK, so the stance foot does not slide at the speeds the
// engine uses (walk 1.3, jog 4.1, sprint 6.6, crouch 1.9 m/s).  Cycle time (cadence) depends on the speed, step length follows from it.
const GAIT = {   // d: stance duty, H: pelvis height (ankle-less), bob, lift: swing clearance, T0/T1: cycle time = T0 - T1*speed (clamped)
  walk:   { d: 0.6,  H: 0.895, bob: 0.02, maxBob: 0.035, lift: 0.085, T0: 1.32, T1: 0.17, Tmin: 0.86, Tmax: 1.3 },
  run:    { d: 0.38, H: 0.86,  bob: 0.04, maxBob: 0.08, air: 0.05, lift: 0.17,  T0: 0.84, T1: 0.032, Tmin: 0.6, Tmax: 0.8 },
  sprint: { d: 0.33, H: 0.84,  bob: 0.045, maxBob: 0.10, air: 0.07, lift: 0.24,  T0: 0.66, T1: 0.022, Tmin: 0.46, Tmax: 0.62 },
  crouch: { d: 0.6, zk: 0.7, H: 0.62,  bob: 0.012, maxBob: 0.03, lift: 0.07,  T0: 1.15, T1: 0.2, Tmin: 0.62, Tmax: 1.1 },
};
function cycleTime(kind, sp) { const g = GAIT[kind]; return clamp(g.T0 - g.T1 * sp, g.Tmin, g.Tmax); }
const L12 = L1 + L2;
function footSolve(T, side, dz, dy) {     // foot (sole point) at (dz forward, dy up) relative to the hip pivot; writes hip flex + knee
  let d = Math.hypot(dz, dy); const maxD = L12 * 0.998; if (d > maxD) { dz *= maxD / d; dy *= maxD / d; d = maxD; }
  d = Math.max(d, 0.25);
  const beta = Math.atan2(dz, -dy), alpha = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  setLeg(T, side, beta + alpha, 0.03, knee);
}
function gaitLegs(T, c, kind) {
  const g = GAIT[kind], sp = Math.max(c.sp, 0.05), Tc = cycleTime(kind, sp);
  const Zs = sp * g.d * Tc * (g.zk || 1), hz = Zs / 2;                                      // stance travel of the pelvis (foot moves back by this much)
  const cyc = c.phase / (Math.PI * 2);
  const u0 = ((cyc - 0.25) % 1 + 1) % 1;                                      // left foot cycle (0 = front-most contact)
  const feet = [];
  for (const [side, off] of [['l', 0], ['r', 0.5]]) {
    const u = (u0 + off) % 1; let z, lift = 0, stance = u < g.d;
    if (stance) z = hz * (1 - 2 * u / g.d);
    else {
      const t = (u - g.d) / (1 - g.d), m = -2 * (1 - g.d) / g.d * 0.75;         // Hermite from back (-hz) to front (+hz), end slopes ~ stance speed
      const h00 = 2 * t * t * t - 3 * t * t + 1, h10 = t * t * t - 2 * t * t + t, h01 = -2 * t * t * t + 3 * t * t, h11 = t * t * t - t * t;
      z = hz * (h00 * -1 + h10 * m + h01 * 1 + h11 * m);
      lift = g.lift * clamp(sp / 0.6, 0, 1) * Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 0.9);
    }
    feet.push({ side, z, lift, stance });
  }
  // pelvis height: bob (lowest around contact), limited by what the planted leg can reach (inverted pendulum), bump while airborne
  let hy = g.H - g.bob * (0.5 + 0.5 * Math.cos(4 * Math.PI * u0));
  const hyMin = g.H - g.maxBob;
  for (const f of feet) if (f.stance) hy = Math.min(hy, Math.max(hyMin, Math.sqrt(Math.max(0.05, (L12 * 0.985) ** 2 - f.z * f.z))));
  if (g.d < 0.5) { const w = (u0 % 0.5); if (w > g.d) hy += (g.air || 0) * Math.sin(Math.PI * (w - g.d) / (0.5 - g.d)); }
  T.hFree = 1; T.hY = hy;
  for (const f of feet) {
    // the shoe is rigid with the shin: raise the sole point so the heel (forward-leaning shin) / toe (backward-leaning) corner is what touches
    const y = -(hy - f.lift);
    footSolve(T, f.side, f.z, y);
    const phi = -T[f.side + 'hX'] - T[f.side + 'k'];
    const dip = Math.min(0.09, phi > 0 ? 0.075 * Math.sin(phi) : 0.17 * Math.sin(Math.min(1.4, -phi)));
    if (dip > 0.002) footSolve(T, f.side, f.z, y + dip);
  }
}
function locoPose(T, c, kind) { // kind walk/run/sprint ; uses c.phase, c.amp, c.sp
  const P = { walk: [0.42, 0.45, 0.25, 0.75, 0.04, 0.0], run: [0.82, 0.95, 1.35, 1.5, 0.2, 0.05], sprint: [0.98, 1.1, 1.5, 1.75, 0.34, 0.08] }[kind];
  const [A, B, eb, K, lean, hl] = P, amp = c.amp, ph = c.phase;
  const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
  gaitLegs(T, c, kind);
  const bend = (th) => eb * amp + 0.4 * amp * Math.max(0, Math.sin(th + 1.2)) * (kind === 'walk' ? 0.6 : 0.3);
  setArm(T, 'l', -B * amp * sL + 0.04, 0.08 + 0.05 * amp * (kind === 'walk' ? 0 : 1), 0, 0.2 + bend(ph));
  setArm(T, 'r', -B * amp * sR + 0.04, 0.08 + 0.05 * amp * (kind === 'walk' ? 0 : 1), 0, 0.2 + bend(ph + Math.PI));
  T.hRY = -0.12 * amp * sL; T.sRY = 0.17 * amp * sL; T.nRY = -0.07 * amp * sL;
  T.hRZ = 0.05 * amp * Math.cos(ph) * 0.0; T.sRZ = 0.03 * amp * Math.sin(ph * 1.0 + 0.6);
  T.sRX = 0.03 + lean * amp; T.hRX = hl * amp; T.nRX = -lean * amp * 0.8 + 0.02;
}
function crouchPose(T, c) {
  const amp = c.amp * 0.45, ph = c.phase, sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
  gaitLegs(T, c, 'crouch');
  T.sRX = 0.42; T.nRX = -0.35; T.hRX = 0.05;
  setArm(T, 'l', 0.3 - 0.4 * amp * sL, 0.15, 0, 0.6); setArm(T, 'r', 0.3 - 0.4 * amp * sR, 0.15, 0, 0.6);
  T.sRY = 0.1 * amp * sL;
}
function jumpPose(T, c) {
  setLeg(T, 'l', 0.6, 0.08, 1.0); setLeg(T, 'r', 0.12, 0.12, 0.35);
  setArm(T, 'l', 2.5, 0.45, 0, 0.35); setArm(T, 'r', 2.4, 0.45, 0, 0.35);
  T.sRX = 0.0; T.nRX = -0.15; T.hRX = 0.02;
}
function fallPose(T, c) {
  const f = c.t * 9 + c.seed * 7;
  setLeg(T, 'l', 0.25 + 0.15 * Math.sin(f), 0.22, 0.45 + 0.2 * Math.sin(f + 1)); setLeg(T, 'r', 0.18 + 0.15 * Math.sin(f + 2), 0.22, 0.4 + 0.2 * Math.sin(f + 3));
  setArm(T, 'l', 0.7 + 0.35 * Math.sin(f * 1.1), 1.2 + 0.2 * Math.sin(f), 0, 0.3); setArm(T, 'r', 0.7 + 0.35 * Math.sin(f * 1.1 + 2), 1.2 + 0.2 * Math.sin(f + 2), 0, 0.3);
  T.sRX = -0.08; T.nRX = -0.2; T.sRZ = 0.06 * Math.sin(f * 0.6);
}
function swimPose(T, c) {
  const ph = c.phase;
  T.hFree = 1; T.hY = 0.0; T.hRX = 1.3; T.sRX = 0.0; T.nRX = -0.85; T.hRZ = 0.22 * Math.sin(ph); T.nRY = 0.15 * Math.sin(ph);
  const arm = (s, p) => {
    const f = Math.PI - (p % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);       // flexion sweeping a full circle
    const rec = Math.max(0, -Math.sin(f));                                          // recovery (arm above water)
    T[s + 'aX'] = -f; T[s + 'aZ'] = (s === 'l' ? 1 : -1) * (0.12 + 0.35 * rec); T[s + 'aY'] = 0; T[s + 'e'] = -(0.25 + 1.4 * rec);
  };
  arm('l', ph); arm('r', ph + Math.PI);
  setLeg(T, 'l', 0.3 * Math.sin(ph * 3), 0.05, 0.25 + 0.2 * Math.sin(ph * 3 + 1)); setLeg(T, 'r', -0.3 * Math.sin(ph * 3), 0.05, 0.25 - 0.2 * Math.sin(ph * 3 + 1));
}
function seatedLegs(T, kind) {
  if (kind === 'sit') { setLeg(T, 'l', 1.5, 0.12, 1.45); setLeg(T, 'r', 1.5, 0.12, 1.45); return; }
  setLeg(T, 'l', 1.5, 0.05, 1.3); setLeg(T, 'r', 1.45, 0.03, 1.1);
}
// ---- seat fitting.  models_vehicles.js publishes `group.userData.seatInfo = { roofAt(z), seats:[{x,y,z,hip,floor,wheel}] }` on the
// vehicle group; a seated rig looks itself up (by its position in that group) and adapts: hip height, leg extension (feet must stay above
// the floor pan), torso recline (head must stay under the roof) and the steering-wheel hand targets.  No info -> legacy pose.
function seatLookup(rig) {
  const par = rig.group.parent, si = par && par.userData && par.userData.seatInfo;
  if (!si) return null;
  const p = rig.group.position; let best = null, bd = 0.06;
  for (const s of si.seats) { const d = Math.abs(s.x - p.x) + Math.abs(s.z - p.z); if (d < bd) { bd = d; best = s; } }
  return best ? { si, s: best } : null;
}
const LEG_DEF = [1.5, 1.3], LEG_EXT = [1.5, 0.0];
const legDrop = (f, k) => L1 * Math.cos(f) + L2 * Math.cos(f - k) + 0.075 * Math.max(0, Math.sin(f - k));   // + heel dip of the rigid shoe
const _hv = new THREE.Vector3();
function fitSeat(T, c, rig, kind) {
  const fit = rig._fit || (rig._fit = { dh: 0, rec: 0, leg: 0, wheel: null, on: 0 });
  const look = seatLookup(rig);
  fit.wheel = null;
  if (!look) { fit.on = 0; return; }
  const { si, s } = look, sc = rig.group.scale.y, gy = rig.group.position.y, gz = rig.group.position.z;
  const hip = s.hip !== undefined ? s.hip : gy + SEAT_HIP_HEIGHT * sc;
  const hY0 = T.hY, dh = (hip - gy) / sc - hY0;
  let rec = 0, leg = 0;
  // legs: extend until the soles clear the floor pan
  const allow = (hip - (s.floor !== undefined ? s.floor : -9)) / sc, dd = legDrop(LEG_DEF[0], LEG_DEF[1]), de = legDrop(LEG_EXT[0], LEG_EXT[1]);
  if (dd > allow) { let lo = 0, hi = 1; for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; if (legDrop(lerp(LEG_DEF[0], LEG_EXT[0], m), lerp(LEG_DEF[1], LEG_EXT[1], m)) > allow) lo = m; else hi = m; } leg = hi; }
  // torso recline so that the head fits under the roof
  if (si.roofAt && kind !== 'sit') {
    const s0 = T.sRX, n0 = T.nRX; T.hY = hY0 + dh;
    for (let i = 0; i <= 16; i++) {
      const r = i * 0.05;
      T.sRX = s0 - r; T.nRX = n0 + 0.78 * r;
      toRoot(T, 0, NECK_Y, 0, _hv);
      const p = T.hRX + T.sRX + T.nRX, top = gy + sc * (_hv.y + 0.335 * Math.cos(p)), z = gz + sc * (_hv.z + 0.165 * Math.sin(p));
      rec = r;
      if (top <= si.roofAt(z) - 0.012) break;
    }
    T.sRX = s0; T.nRX = n0; T.hY = hY0;
  }
  // smooth the fit parameters so getting in / out does not pop
  const k = Math.min(1, (rig._fitDt || 0.016) * 14);
  if (!fit.on) { fit.dh = 0; fit.rec = 0; fit.leg = 0; fit.on = 1; }
  fit.dh += (dh - fit.dh) * k; fit.rec += (rec - fit.rec) * k; fit.leg += (leg - fit.leg) * k;
  T.hY = hY0 + fit.dh;
  if (fit.leg > 0.001) { const f = lerp(LEG_DEF[0], LEG_EXT[0], fit.leg), kn = lerp(LEG_DEF[1], LEG_EXT[1], fit.leg); setLeg(T, 'l', f, 0.05, kn); setLeg(T, 'r', f - 0.05, 0.03, kn * 0.9 + 0.02); }
  T.sRX -= fit.rec; T.nRX += 0.78 * fit.rec;
  if (s.wheel) fit.wheel = { x: (s.wheel.x - rig.group.position.x) / sc, y: (s.wheel.y - gy) / sc, z: (s.wheel.z - gz) / sc, r: (s.wheel.r || 0.175) / sc, tilt: s.wheel.tilt !== undefined ? s.wheel.tilt : 0.45 };
}
function drivePose(T, c, rig) {
  T.hFree = 1; T.hY = SEAT_HIP_HEIGHT; seatedLegs(T, 'drive');
  T.sRX = -0.08; T.nRX = 0.02; T.nRY = -0.25 * c.steer * 0.4 + 0.05 * Math.sin(c.t * 0.3 + c.seed * 3);
  T.sRY = 0.05 * c.steer; T.sRZ = 0.04 * c.steer;
  setArm(T, 'l', 0.4, 0.2, 0, 0.5); setArm(T, 'r', 0.4, 0.2, 0, 0.5);
  fitSeat(T, c, rig, 'drive');
  // hands on the wheel (IK, done after the torso is posed, see below)
  c.wheel = true;
}
function passengerPose(T, c, kind, rig) {
  T.hFree = 1; T.hY = SEAT_HIP_HEIGHT; seatedLegs(T, kind === 'sit' ? 'sit' : 'pass');
  T.sRX = kind === 'sit' ? 0.12 : -0.12; T.nRX = 0.03; T.nRY = 0.3 * Math.sin(c.t * 0.3 + c.seed * 3) * Math.sin(c.t * 0.13 + 2);
  setArm(T, 'l', 0.55, 0.12, 0, 1.0); setArm(T, 'r', 0.55, 0.12, 0, 1.0);
  if (rig) fitSeat(T, c, rig, kind);
  c.lap = true;
}
function bikePose(T, c) {
  T.hFree = 1; T.hY = 0.52; T.hZ = -0.05;
  setLeg(T, 'l', 1.25, 0.25, 1.6); setLeg(T, 'r', 1.25, 0.25, 1.6);
  T.sRX = 0.85; T.nRX = -0.75; T.hRX = 0.0; T.nRY = -c.steer * 0.3; T.sRZ = -0.06 * c.steer;
  c.bars = true;
}
function cowerPose(T, c) {
  const shake = Math.sin(c.t * 38 + c.seed * 9) * 0.012;
  T.hFree = 1; T.hY = 0.5 + shake; setLeg(T, 'l', 1.35, 0.2, 2.3); setLeg(T, 'r', 1.35, 0.2, 2.3);
  T.sRX = 0.85; T.nRX = 0.35; T.hRZ = 0.04 * Math.sin(c.t * 9 + c.seed); T.sRZ = shake * 3;
  c.cower = true; setArm(T, 'l', 2.0, 0.2, 0, 2.0); setArm(T, 'r', 2.0, 0.2, 0, 2.0);
}
function phonePose(T, c) {
  idlePose(T, c);
  T.nRZ = 0.13; T.nRY = -0.12 + 0.1 * Math.sin(c.t * 0.5 + c.seed * 3); T.sRX = 0.05;
  setArm(T, 'l', 0.9, 0.0, 0, 1.6);
  c.phone = true;
}
function dancePose(T, c) {
  const beat = c.t * Math.PI * 2 * 2.0, move = c.danceMove, s = Math.sin(beat), c1 = Math.cos(beat);
  if (move === 0) { // disco bounce, alternating point
    const b = Math.abs(Math.sin(beat * 0.5));
    setLeg(T, 'l', 0.35 + 0.3 * b, 0.12, 0.7 + 0.6 * b); setLeg(T, 'r', 0.35 + 0.3 * b, 0.12, 0.7 + 0.6 * b);
    const k = Math.sin(beat * 0.5) > 0 ? 1 : 0;
    setArm(T, 'r', 2.6 * k + 0.2 * (1 - k), 0.5 * k, 0, 0.3 + 0.3 * (1 - k)); setArm(T, 'l', 2.6 * (1 - k) + 0.2 * k, 0.5 * (1 - k), 0, 0.3 + 0.3 * k);
    T.hRZ = 0.12 * Math.sin(beat * 0.5); T.sRZ = -0.12 * Math.sin(beat * 0.5); T.sRX = 0.1; T.nRZ = 0.15 * Math.sin(beat * 0.5);
  } else if (move === 1) { // sway, arms overhead
    setLeg(T, 'l', 0.3, 0.1 + 0.12 * Math.max(0, s), 0.6 + 0.2 * c1); setLeg(T, 'r', 0.3, 0.1 + 0.12 * Math.max(0, -s), 0.6 - 0.2 * c1);
    setArm(T, 'l', 2.7, 0.25 + 0.3 * s, 0, 0.35); setArm(T, 'r', 2.7, 0.25 - 0.3 * s, 0, 0.35);
    T.hRY = 0.45 * Math.sin(beat * 0.5); T.sRY = -0.3 * Math.sin(beat * 0.5); T.hRZ = 0.1 * s; T.nRY = 0.3 * Math.sin(beat * 0.5);
  } else { // running-man / pump
    const a = Math.sin(beat * 0.5);
    setLeg(T, 'l', 0.35 + 0.55 * Math.max(0, a), 0.05, 0.6 + 0.9 * Math.max(0, a)); setLeg(T, 'r', 0.35 + 0.55 * Math.max(0, -a), 0.05, 0.6 + 0.9 * Math.max(0, -a));
    setArm(T, 'l', 0.6 + 0.8 * a, 0.1, 0, 1.5); setArm(T, 'r', 0.6 - 0.8 * a, 0.1, 0, 1.5);
    T.sRX = 0.15 + 0.05 * s; T.sRY = 0.25 * a; T.hRY = -0.15 * a; T.nRX = 0.1 * s;
  }
}
function aimStance(T, c) { // legs for stationary aim
  idlePose(T, c);
  setLeg(T, 'l', 0.12, 0.13, 0.22); setLeg(T, 'r', 0.05, 0.13, 0.18);
  T.sRX = 0.05; T.nRX = 0.02; T.hRZ = 0; T.nRY = 0; T.nRZ = 0; T.sRZ = 0; T.sRY = 0; T.hRY = 0;
}

function deadKeys(face, seed) {
  const r = mulberry((seed * 4294967296) | 0);
  const K0 = newPose(); K0.hFree = 1; K0.hY = L1 + L2;
  const K1 = newPose(); K1.hFree = 1; K1.hY = 0.6; setLeg(K1, 'l', 0.7, 0.1, 1.5); setLeg(K1, 'r', 0.4, 0.14, 1.2);
  K1.hRX = 0.25 * face; K1.sRX = 0.2 * face; K1.nRX = -0.3 * face;
  setArm(K1, 'l', 1.2, 0.6, 0, 1.0); setArm(K1, 'r', 1.0, 0.7, 0, 0.8);
  const K2 = newPose(); K2.hFree = 1; K2.hY = 0.3; setLeg(K2, 'l', 0.3, 0.2, 0.9); setLeg(K2, 'r', 0.15, 0.3, 0.6);
  K2.hRX = 1.15 * face; K2.sRX = 0.05 * face; K2.nRX = -0.2 * face;
  setArm(K2, 'l', 0.6, 1.1, 0, 0.5); setArm(K2, 'r', 0.5, 1.2, 0, 0.3);
  const K3 = newPose(); K3.hFree = 1; K3.hY = 0.15; K3.hRX = (Math.PI / 2) * face;
  setLeg(K3, 'l', 0.05 + r() * 0.12, 0.2 + r() * 0.15, 0.1 + r() * 0.3); setLeg(K3, 'r', 0.02 + r() * 0.15, 0.25 + r() * 0.15, 0.2 + r() * 0.4);
  setArm(K3, 'l', 0.15 + r() * 0.3, 0.6 + r() * 0.4, 0, 0.1 + r() * 0.3); setArm(K3, 'r', 0.1 + r() * 0.4, 0.7 + r() * 0.4, 0, 0.1 + r() * 0.3);
  K3.sRY = (r() - 0.5) * 0.4; K3.nRY = (r() - 0.5) * 0.7; K3.nRX = 0.05 * face; K3.hRZ = (r() - 0.5) * 0.15;
  return [K0, K1, K2, K3];
}
const DEAD_T = [0, 0.3, 0.72, 1];
function deadPose(F, t, keys) {
  t = clamp(t, 0, 1);
  let i = 0; while (i < 2 && t > DEAD_T[i + 1]) i++;
  const u = smooth((t - DEAD_T[i]) / (DEAD_T[i + 1] - DEAD_T[i]));
  return lerpPose(F, keys[i], keys[i + 1], u);
}
function getupKeys(face, keysDead, start) {
  const _G = [newPose(), newPose(), newPose(), newPose()];
  copyPose(_G[0], start || keysDead[3]);
  const G1 = _G[1]; resetPose(G1); G1.hFree = 1; G1.hY = 0.3; G1.hRX = 0.65 * face; setLeg(G1, 'l', 1.3, 0.15, 1.8); setLeg(G1, 'r', 1.1, 0.15, 1.7);
  G1.sRX = -0.1 * face; G1.nRX = -0.3;
  if (face < 0) { setArm(G1, 'l', -0.7, 0.3, 0, 0.3); setArm(G1, 'r', -0.7, 0.3, 0, 0.3); } else { setArm(G1, 'l', 0.3, 0.3, 0, 0.3); setArm(G1, 'r', 0.3, 0.3, 0, 0.3); }
  const G2 = _G[2]; resetPose(G2); G2.hFree = 0; setLeg(G2, 'l', 0.95, 0.1, 1.85); setLeg(G2, 'r', 0.95, 0.1, 1.85);
  G2.sRX = 0.55; G2.nRX = -0.4; setArm(G2, 'l', 0.7, 0.15, 0, 0.7); setArm(G2, 'r', 0.7, 0.15, 0, 0.7);
  const G3 = _G[3]; resetPose(G3); G3.hFree = 0; G3.nRX = 0.02; G3.sRX = 0.02;
  return _G;
}

// ------------------------------------------------------------------------------------------------ PedRig
let _uid = 1;
export class PedRig {
  constructor(appearance) {
    this.appearance = normApp(appearance);
    const a = this.appearance, dm = this.dm = dimsOf(a);
    this.id = _uid++;
    this.seed = mulberry(hashStr(JSON.stringify([a.skin, a.hair, a.shirt, a.pants, a.hairStyle, this.id])))();
    this.sx = 0.205 * dm.shW + 0.005;      // shoulder x offset
    this.height = 1.8 * a.scale;

    const G = this.group = new THREE.Group(); G.name = 'ped';
    G.scale.setScalar(a.scale);
    const mat = pedMaterial();
    this._keys = [];
    const mk = (part, key, fn) => { const k = part + '|' + key; this._keys.push(k); const m = new THREE.Mesh(acquire(k, fn), mat); m.matrixAutoUpdate = true; return m; };
    const app = JSON.stringify;
    const ck = (...v) => app(v);
    const torsoKey = ck(a.shirt, a.shirtType, a.sleeves, a.under, a.trim, a.pattern, a.accent, a.badge, a.armor, a.skin, dm.b, dm.f, dm.big, dm.bd);
    const pelvisKey = ck(a.pants, a.shirt, a.shirtType, a.skirt, a.belt, a.beltColor, a.bandana, a.role === 'cop', a.hat === 'none' || a.hat === 'cap', dm.hipW, dm.bd);
    const armKey = ck(a.skin, a.shirt, a.shirtType, a.sleeves, a.under, a.gloves, a.armor, dm.limb);
    const legKey = ck(a.skin, a.pants, a.shorts, a.skirt, a.shoes, a.boots, dm.limb);
    const headKey = ck(a.skin, a.hair, a.hairStyle, a.beard, a.glasses, a.hat, a.hatColor, a.bandana, dm.headS, dm.f);

    const P = this.p = {};
    const hips = P.hips = new THREE.Object3D(); G.add(hips);
    hips.add(mk('pelvis', pelvisKey, () => pelvisGeo(a, dm)));
    const hx = 0.092 * dm.hipW + 0.004;
    for (const [s, sgn] of [['l', 1], ['r', -1]]) {
      const hip = P[s + 'Hip'] = new THREE.Object3D(); hip.position.set(sgn * hx, 0, 0); hips.add(hip);
      hip.add(mk('thigh', legKey, () => thighGeo(a, dm)));
      const knee = P[s + 'Knee'] = new THREE.Object3D(); knee.position.set(0, -L1, 0); hip.add(knee);
      knee.add(mk('shin', legKey, () => shinGeo(a, dm)));
    }
    const spine = P.spine = new THREE.Object3D(); spine.position.set(0, SP_Y, 0); hips.add(spine);
    spine.add(mk('torso', torsoKey, () => torsoGeo(a, dm)));
    const neck = P.neck = new THREE.Object3D(); neck.position.set(0, NECK_Y, 0); spine.add(neck);
    neck.add(mk('head', headKey, () => headGeo(a, dm)));
    for (const [s, sgn] of [['l', 1], ['r', -1]]) {
      const sh = P[s + 'Sh'] = new THREE.Object3D(); sh.position.set(sgn * this.sx, SH_Y, 0); spine.add(sh);
      sh.add(mk('uarm', armKey, () => upperArmGeo(a, dm)));
      const el = P[s + 'El'] = new THREE.Object3D(); el.position.set(0, -LU, 0); sh.add(el);
      el.add(mk('farm', armKey, () => foreArmGeo(a, dm)));
      const hand = P[s + 'Hand'] = new THREE.Object3D(); hand.position.set(0, -EFF, 0); el.add(hand);
    }
    this.meshes = []; G.traverse(o => { if (o.isMesh) this.meshes.push(o); });
    const mount = P.mount = new THREE.Object3D(); P.rHand.add(mount);

    // state
    this.state = 'idle'; this.t = 0; this.phase = 0; this.speedSm = 0; this.steerSm = 0; this.danceMove = 0;
    this.weaponId = null; this.weapon = null; this.phoneItem = null;
    this.deadT = 0; this.deadFace = this.seed > 0.5 ? -1 : 1; this._deadKeys = null;
    this.F = newPose(); this.T = newPose(); this.snap = newPose(); this.last = newPose();
    this.blend = 1; this.modeKey = ''; this.act = null; this.flash = 0; this._flashMat = null; this._hideW = false;
    this._c = { t: 0, seed: this.seed, phase: 0, amp: 0, steer: 0, danceMove: 0 };
    this.update(0.0001, {});
    this.blend = 1;
  }

  setWeapon(id) {
    if (this.weapon) { this.p.mount.remove(this.weapon); this.weapon = null; }
    this.weaponId = id && WEAPON_DEFS[id] && id !== 'fist' ? id : null;
    if (this.weaponId) { this.weapon = createWeaponModel(this.weaponId); this.p.mount.add(this.weapon); }
    this.modeKey = '';
  }
  setState(s) {
    if (!PED_STATES.includes(s)) s = 'idle';
    if (s === this.state) return;
    if (s === 'dead' && this.deadT <= 0) this.deadT = 1;
    if (s !== 'dead') this.deadT = 0;
    this.state = s;
  }
  setDanceMove(n) { this.danceMove = n | 0; }
  setDeadPose(t, facing) {
    if (facing === 'front') this.deadFace = 1; else if (facing === 'back') this.deadFace = -1;
    this.deadT = clamp(t, 0, 1);
    if (t > 0) this.state = 'dead'; else if (this.state === 'dead') this.state = 'idle';
  }
  isBusy() { return !!this.act; }
  playAction(name) {
    const dur = PED_ACTIONS[name];
    if (dur === undefined) return 0;
    if (name === 'getup') { if (this.state === 'dead') { this.state = 'idle'; } this._getupKeys = getupKeys(this.deadFace, this._dead(), this._getupStart); this._getupStart = null; this.deadT = 0; }
    this.act = { name, dur, t: 0 };
    return dur;
  }
  // when a body gets up out of a ragdoll, the sequence starts from the pose the ragdoll ended in instead of the scripted dead pose
  setGetupPose(pose, face) { this._getupStart = pose; if (face === 1 || face === -1) this.deadFace = face; }
  _dead() { return this._deadKeys || (this._deadKeys = deadKeys(this.deadFace, this.seed)); }
  setHitFlash(t) {
    this.flash = clamp(t, 0, 1);
    if (this.flash > 0.001) {
      if (!this._flashMat) { this._flashMat = pedMaterial().clone(); for (const m of this.meshes) m.material = this._flashMat; }
      this._flashMat.emissive.setRGB(1.0, 0.08, 0.05).multiplyScalar(this.flash * 0.85);
    } else if (this._flashMat) { for (const m of this.meshes) m.material = pedMaterial(); this._flashMat.dispose(); this._flashMat = null; }
  }

  // ---- world queries
  getHandWorldPos(out = new THREE.Vector3()) { this.group.updateWorldMatrix(true, true); return this.p.rHand.getWorldPosition(out); }
  getMuzzleWorldPos(out = new THREE.Vector3()) {
    this.group.updateWorldMatrix(true, true);
    if (this.weapon) { out.copy(this.weapon.userData.muzzle); return this.weapon.localToWorld(out); }
    this.p.rHand.getWorldPosition(out); return out;
  }
  headWorldPos(out = new THREE.Vector3()) { this.group.updateWorldMatrix(true, true); out.set(0, 0.165 * this.dm.headS, 0); return this.p.neck.localToWorld(out); }
  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const k of this._keys) release(k);
    this._keys = [];
    if (this._flashMat) { this._flashMat.dispose(); this._flashMat = null; }
    this.meshes.length = 0;
  }

  // ---- animation
  update(dt, p) {
    p = p || {}; dt = Math.min(Math.max(dt, 0), 0.1); this._fitDt = dt;
    this.t += dt;
    const st = this.state, c = this._c;
    c.t = this.t; c.danceMove = this.danceMove;
    const F = this.F;

    // overlay timing
    let act = this.act, u = 0, w = 0;
    if (act) {
      act.t += dt; u = act.t / act.dur;
      if (u >= 1) { this.act = act = null; if (this._hideW) { this._hideW = false; } }
      else { const atk = act.name === 'getup' ? 0.0001 : 0.07; w = smooth(act.t / atk) * (1 - smooth((act.t - (act.dur - 0.14)) / 0.14)); if (act.name === 'getup') w = 1 - smooth((act.t - (act.dur - 0.25)) / 0.25); }
    }

    if (st === 'dead') {
      deadPose(F, this.deadT, this._dead());
      this.last = copyPose(this.last, F); this.modeKey = 'dead'; this.blend = 1;
    } else {
      const aiming = !!p.aiming || st === 'aim';
      const speedIn = p.speed !== undefined ? p.speed : (NOMINAL[st] || 0);
      this.speedSm += (speedIn - this.speedSm) * Math.min(1, dt * 12);
      this.steerSm += ((p.steer || 0) - this.steerSm) * Math.min(1, dt * 10);
      c.steer = this.steerSm;
      const locoKind = st === 'walk' || st === 'run' || st === 'sprint' ? st : (st === 'crouch' ? 'crouch' : null);
      // phase
      if (locoKind) this.phase += dt * Math.PI * 2 / cycleTime(locoKind, this.speedSm);
      else if (st === 'swim') this.phase += dt * Math.PI * 2 * (0.55 + 0.25 * Math.min(this.speedSm, 3));
      else if (st === 'jump' || st === 'fall') { /* none */ }
      c.phase = this.phase; c.sp = this.speedSm;
      const kind = this.weaponId ? WEAPON_DEFS[this.weaponId].kind : null;
      this._lastAiming = aiming;
      const aimVisible = aiming;
      const mk = st + (aimVisible ? 'A' : '') + (this.weaponId || '');
      if (mk !== this.modeKey) { copyPose(this.snap, this.last); this.blend = 0; this.modeKey = mk; }

      const T = resetPose(this.T);
      c.wheel = c.lap = c.bars = c.cower = c.phone = false;
      c.amp = 0;
      switch (st) {
        case 'idle': idlePose(T, c); break;
        case 'walk': case 'run': case 'sprint': {
          c.amp = clamp(this.speedSm / NOMINAL[st], 0, 1.25);
          const I = newPose(); idlePose(I, c);
          locoPose(T, c, st);
          const LG = {}; for (const k of LEGKEYS) LG[k] = T[k];
          lerpPose(T, I, T, clamp(c.amp * 1.6, 0, 1));
          for (const k of LEGKEYS) T[k] = LG[k];
          if (c.amp > 1) { /* faster than nominal: slightly longer strides already via phase */ }
          break;
        }
        case 'crouch': c.amp = clamp(this.speedSm / NOMINAL.crouch, 0, 1.2); crouchPose(T, c); break;
        case 'jump': jumpPose(T, c); break;
        case 'fall': fallPose(T, c); break;
        case 'swim': swimPose(T, c); break;
        case 'drive': drivePose(T, c, this); break;
        case 'passenger': passengerPose(T, c, 'pass', this); break;
        case 'sit': passengerPose(T, c, 'sit', this); break;
        case 'bikeride': bikePose(T, c); break;
        case 'cower': cowerPose(T, c); break;
        case 'phone': phonePose(T, c); break;
        case 'dance': dancePose(T, c); break;
        case 'aim': aimStance(T, c); break;
        default: idlePose(T, c);
      }
      if (aiming && st !== 'aim' && (st === 'walk' || st === 'run' || st === 'sprint' || st === 'crouch' || st === 'idle')) { T.sRX = Math.min(T.sRX, 0.1) * 0.6; T.sRY = 0.0; T.hRY *= 0.4; T.nRY = 0; }
      if (aiming && kind === 'pistol') T.sRY += 0.2;
      T.sRZ += -(p.lean || 0) * 0.6;
      this._finishArms(T, c, kind, aiming, p, st);
      // crossfade
      if (this.blend < 1) { this.blend = Math.min(1, this.blend + dt / 0.16); lerpPose(F, this.snap, T, smooth(this.blend)); } else copyPose(F, T);
      copyPose(this.last, F);
    }

    // overlay actions
    if (act && w > 0.001) this._overlay(F, act, u, w, p);

    this._apply(F, st);
  }

  _finishArms(T, c, kind, aiming, p, st) {
    const hint = null;
    if (c.wheel) {
      // steering wheel in root space (real wheel of the vehicle when the seat info provides it)
      const fw = this._fit && this._fit.on && this._fit.wheel;
      const tilt = fw ? fw.tilt : 0.45, r = fw ? fw.r : 0.175, steerAng = c.steer * 1.5;
      const C = fw ? new THREE.Vector3(fw.x, fw.y, fw.z) : new THREE.Vector3(0, SEAT_HIP_HEIGHT + 0.29, 0.5);
      const u = new THREE.Vector3(-1, 0, 0), v = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
      for (const [s, base] of [['l', Math.PI - 0.3], ['r', 0.3]]) {
        const ang = base + steerAng, tg = new THREE.Vector3();
        tg.copy(C).addScaledVector(u, Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r);
        ikMix(T, this, s === 'l' ? 1 : -1, tg, 1, s === 'l' ? new THREE.Vector3(0.6, -1, -0.2) : new THREE.Vector3(-0.6, -1, -0.2));
      }
    }
    if (c.lap) {
      for (const s of [1, -1]) ikMix(T, this, s, new THREE.Vector3(s * 0.17, T.hY + 0.13, 0.22), 1);
    }
    if (c.bars) {
      for (const s of [1, -1]) ikMix(T, this, s, new THREE.Vector3(s * 0.34, 0.97, 0.56 - s * c.steer * 0.07), 1);
    }
    if (c.cower) {
      const sh = Math.sin(this.t * 40) * 0.008;
      for (const s of [1, -1]) {
        const tg = toRoot(T, s * 0.11, SH_Y + 0.26, 0.14, new THREE.Vector3()); tg.x += sh; ikMix(T, this, s, tg, 1, new THREE.Vector3(s * 0.8, 0.1, 0.9));
      }
    }
    if (c.phone) {
      ikMix(T, this, -1, toRoot(T, -0.17, NECK_Y + 0.155, 0.0, new THREE.Vector3()), 1, new THREE.Vector3(-0.55, -1, -0.3));
      ikMix(T, this, 1, toRoot(T, 0.06, SH_Y - 0.38, 0.2, new THREE.Vector3()), 1, new THREE.Vector3(0.4, -1, 0.2));
      T.mW = 1; T.mY = -0.25; T.mP = Math.PI / 2; T.mR = -Math.PI / 2;
    }
    // weapon
    this._hideW = HIDE_W.has(st);
    if (this.weapon && !this._hideW) {
      if (st === 'dance') return;
      const wt = makeWeaponTarget(T, kind, this.weaponId, aiming, p.aimPitch || 0);
      applyWeaponTarget(T, this, wt, 1);
    } else if (!this.weapon && aiming && st !== 'phone' && !this._hideW) {
      // fist guard
      const O = toRoot(T, 0, SH_Y, 0, new THREE.Vector3());
      ikMix(T, this, -1, new THREE.Vector3(-0.11, 0.03, 0.3).add(O), 1, new THREE.Vector3(-0.3, -1, -0.1));
      ikMix(T, this, 1, new THREE.Vector3(0.12, 0.05, 0.32).add(O), 1, new THREE.Vector3(0.3, -1, -0.1));
      T.sRY += 0.25;
    }
  }

  _overlay(F, act, u, w, p) {
    const name = act.name, rig = this;
    const O = () => toRoot(F, 0, SH_Y, 0, new THREE.Vector3());
    const at = (x, y, z) => new THREE.Vector3(x, y, z).add(O());
    const aimK = this.weaponId ? WEAPON_DEFS[this.weaponId].kind : null;
    if (name === 'punch' || name === 'punch2') {
      const s = name === 'punch' ? -1 : 1;           // striking side (-1 = right)
      const k = seg(u, 0.12, 0.3) * (1 - seg(u, 0.5, 0.85));
      const tw = -s;                                  // twist sign
      mixKey(F, 'sRY', 0.5 * tw * k - 0.15 * tw * (1 - seg(u, 0.1, 0.3)) * seg(u, 0, 0.1), w);
      mixKey(F, 'hRY', 0.22 * tw * k, w); mixKey(F, 'sRX', 0.14 * k + 0.03, w);
      const xs = s;
      const guard = [xs * 0.11, 0.03, 0.3], wind = [xs * 0.13, -0.05, 0.2], ext = [xs * 0.05, 0.03, 0.74];
      let pos;
      if (u < 0.15) pos = lerp3(guard, wind, seg(u, 0, 0.15));
      else if (u < 0.36) pos = lerp3(wind, ext, seg(u, 0.15, 0.36));
      else if (u < 0.5) pos = ext;
      else pos = lerp3(ext, guard, seg(u, 0.5, 1));
      ikMix(F, rig, s > 0 ? 1 : -1, at(pos[0], pos[1], pos[2]), w, s > 0 ? new THREE.Vector3(0.4, -1, -0.2) : new THREE.Vector3(-0.4, -1, -0.2));
      ikMix(F, rig, s > 0 ? -1 : 1, at(-xs * 0.12, 0.05, 0.3), w * 0.9, s > 0 ? new THREE.Vector3(-0.3, -1, -0.1) : new THREE.Vector3(0.3, -1, -0.1));
      // forward step
      mixKey(F, 'lhX', -(s < 0 ? -0.35 : 0.3) * k, w * 0.5); mixKey(F, 'rhX', -(s < 0 ? 0.3 : -0.35) * k, w * 0.5);
    } else if (name === 'kick') {
      const kk = seg(u, 0.05, 0.3) * (1 - seg(u, 0.55, 0.9)), ext = seg(u, 0.28, 0.45) * (1 - seg(u, 0.5, 0.75));
      mixKey(F, 'rhX', -(0.9 + 0.62 * ext) * kk - 0.0, w); mixKey(F, 'rk', (1.8 * (1 - ext) + 0.12 * ext) * kk + F.rk * (1 - kk), w);
      mixKey(F, 'rhZ', -0.1, w * kk);
      mixKey(F, 'lhX', 0.0, w * kk); mixKey(F, 'lk', 0.28, w * kk);
      mixKey(F, 'sRX', -0.32 * kk, w); mixKey(F, 'hRX', -0.1 * kk, w); mixKey(F, 'nRX', 0.25 * kk, w);
      mixKey(F, 'laX', -0.4 * kk, w); mixKey(F, 'laZ', 1.0 * kk + F.laZ * (1 - kk), w); mixKey(F, 'le', -0.3, w * kk);
      mixKey(F, 'raX', -0.9 * kk, w); mixKey(F, 'raZ', -0.8 * kk + F.raZ * (1 - kk), w); mixKey(F, 'sRY', 0.25 * kk, w);
    } else if (name === 'bat') {
      if (!this.weapon) return;
      const def = WEAPON_DEFS[this.weaponId];
      const wind = seg(u, 0.0, 0.33), sw = seg(u, 0.33, 0.6), fol = seg(u, 0.6, 1.0);
      const yaw = lerp(lerp(0.4, -1.45, wind), 1.7, sw) + 0.0 * fol, pitch = lerp(lerp(1.0, 0.75, wind), 0.05, sw);
      mixKey(F, 'sRY', lerp(lerp(0, -0.55, wind), 0.65, sw), w); mixKey(F, 'hRY', lerp(lerp(0, -0.25, wind), 0.3, sw), w);
      mixKey(F, 'sRX', 0.1 * sw, w);
      const rad = 0.34;
      const wt = { pos: new THREE.Vector3(Math.sin(yaw - 0.15) * rad, -0.05 + 0.1 * (1 - sw), Math.cos(yaw - 0.15) * rad + 0.04), yaw, pitch, roll: 0, left: null };
      wt.pos.add(O());
      wt.left = gripPoint(wt, def.grip2, new THREE.Vector3());
      applyWeaponTarget(F, rig, wt, w);
    } else if (name === 'knife') {
      if (!this.weapon) return;
      const pull = seg(u, 0, 0.3), th = seg(u, 0.3, 0.5), back = seg(u, 0.55, 1);
      const z = lerp(lerp(0.3, 0.2, pull), 0.66, th) * (1 - back) + 0.34 * back;
      const y = lerp(lerp(-0.1, -0.12, pull), -0.03, th) * (1 - back) - 0.1 * back;
      const wt = { pos: at(-0.12, y, z), yaw: 0, pitch: 0.05, roll: 0, left: null };
      mixKey(F, 'sRY', 0.35 * th * (1 - back) - 0.2 * pull * (1 - th), w); mixKey(F, 'sRX', 0.18 * th * (1 - back), w);
      applyWeaponTarget(F, rig, wt, w);
      ikMix(F, rig, 1, at(0.14, 0.0, 0.22), w * 0.8);
    } else if (name === 'throw') {
      const wind = seg(u, 0.0, 0.4), rel = seg(u, 0.4, 0.52), fol = seg(u, 0.55, 1.0);
      const base = [-0.2, -0.32, 0.18], windP = [-0.15, 0.34, -0.3], relP = [-0.1, 0.22, 0.62], folP = [0.08, -0.25, 0.4];
      let pos = lerp3(base, windP, wind); pos = lerp3(pos, relP, rel); pos = lerp3(pos, folP, fol);
      ikMix(F, rig, -1, at(pos[0], pos[1], pos[2]), w, new THREE.Vector3(-0.3, 0.5, -0.8));
      ikMix(F, rig, 1, at(0.12, 0.05, 0.5), w * wind * (1 - rel), new THREE.Vector3(0.4, -1, 0));
      mixKey(F, 'sRY', lerp(lerp(0, -0.55, wind), 0.5, rel) * (1 - fol * 0.4), w); mixKey(F, 'sRX', lerp(lerp(0, -0.18, wind), 0.28, rel) * (1 - fol * 0.5), w);
      mixKey(F, 'lhX', -0.35 * rel, w * 0.5); mixKey(F, 'rhX', 0.25 * wind, w * 0.5); mixKey(F, 'nRX', -0.15 * wind, w);
            mixKey(F, 'mP', lerp(0.3, 1.2, wind), w);
    } else if (name === 'reload') {
      if (!this.weapon || (aimK !== 'pistol' && aimK !== 'long' && aimK !== 'rpg')) return;
      const id = this.weaponId, def = WEAPON_DEFS[id];
      const aiming = this._lastAiming;
      const up = seg(u, 0.0, 0.2) * (1 - seg(u, 0.8, 1.0));
      const base = makeWeaponTarget(F, aimK, id, !!aiming, p.aimPitch || 0);
      const wt = { pos: base.pos.clone().lerp(at(-0.13, -0.2, 0.3), up), yaw: 0, pitch: lerp(base.pitch, 0.35, up), roll: 0.35 * up, left: null };
      const magLocal = new THREE.Vector3(0, def.grip2.y - 0.12, kindMagZ(id));
      const magPos = gripPoint(wt, magLocal, new THREE.Vector3());
      const away = at(0.14, -0.42, 0.22);
      const gripPos = gripPoint(wt, def.grip2, new THREE.Vector3());
      let lp;
      if (u < 0.2) lp = gripPos.clone().lerp(magPos, seg(u, 0.05, 0.2));
      else if (u < 0.45) lp = magPos.clone().lerp(away, seg(u, 0.25, 0.45));
      else if (u < 0.65) lp = away.clone().lerp(magPos, seg(u, 0.5, 0.65));
      else lp = magPos.clone().lerp(gripPos, seg(u, 0.68, 0.85));
      wt.left = lp;
      ikMix(F, rig, -1, wt.pos, w); ikMix(F, rig, 1, wt.left, w, new THREE.Vector3(0.5, -1, -0.2));
      mixKey(F, 'mP', wt.pitch, w); mixKey(F, 'mR', wt.roll, w); mixKey(F, 'mW', 1, w); mixKey(F, 'mY', 0, w);
      mixKey(F, 'sRX', 0.12 * up, w); mixKey(F, 'nRX', 0.3 * up, w);
    } else if (name === 'hit') {
      const e = Math.sin(Math.PI * clamp(u * 1.25, 0, 1)) * (1 - u * 0.3);
      mixKey(F, 'sRX', F.sRX + 0.38 * e, w); mixKey(F, 'nRX', F.nRX - 0.45 * e, w); mixKey(F, 'sRZ', F.sRZ + 0.12 * e, w);
      mixKey(F, 'hRX', F.hRX - 0.1 * e, w);
      mixKey(F, 'laZ', F.laZ + 0.5 * e, w); mixKey(F, 'raZ', F.raZ - 0.5 * e, w); mixKey(F, 'laX', F.laX - 0.4 * e, w); mixKey(F, 'raX', F.raX - 0.4 * e, w);
      mixKey(F, 'lk', F.lk + 0.3 * e, w); mixKey(F, 'rk', F.rk + 0.3 * e, w);
    } else if (name === 'wave') {
      const k = seg(u, 0, 0.15) * (1 - seg(u, 0.85, 1));
      const sw = Math.sin(act.t * 12) * 0.11;
      ikMix(F, rig, -1, at(-0.3 + sw, 0.45, 0.14), w * k, new THREE.Vector3(-0.8, -0.6, -0.3));
      mixKey(F, 'nRZ', 0.1, w * k);
    } else if (name === 'enter') {
      const k = Math.sin(Math.PI * clamp(u, 0, 1));
      mixKey(F, 'sRX', 0.75 * k, w); mixKey(F, 'nRX', -0.3 * k, w);
      mixKey(F, 'lhX', -(0.6 + 0.2 * k) * k, w); mixKey(F, 'lk', 1.2 * k, w); mixKey(F, 'rhX', -0.3 * k, w); mixKey(F, 'rk', 0.9 * k, w);
      mixKey(F, 'laX', -0.9 * k, w); mixKey(F, 'le', -0.6 * k, w); mixKey(F, 'raX', -0.6 * k, w); mixKey(F, 're', -0.5 * k, w);
    } else if (name === 'fire') {
      const e = Math.sin(Math.PI * Math.sqrt(clamp(u, 0, 1)));
      mixKey(F, 'mP', F.mP + 0.13 * e, 1); mixKey(F, 'sRX', F.sRX - 0.04 * e, 1);
      mixKey(F, 'raX', F.raX + 0.14 * e, 1); mixKey(F, 'laX', F.laX + (this.weapon && this.weapon.userData.twoHanded ? 0.1 : 0) * e, 1);
      mixKey(F, 're', F.re - 0.1 * e, 1);
    } else if (name === 'getup') {
      const keys = this._getupKeys;
      const t = clamp(u, 0, 1);
      // piecewise 0..0.35..0.7..1
      const br = [0, 0.38, 0.72, 1];
      let i = 0; while (i < 2 && t > br[i + 1]) i++;
      const s = smooth((t - br[i]) / (br[i + 1] - br[i]));
      const G = lerpPose(_overlayTmp, keys[i], keys[i + 1], s);
      for (const k of KEYS) if (k !== 'mW' && k !== 'mY' && k !== 'mP' && k !== 'mR') F[k] += (G[k] - F[k]) * w;
    }
  }

  _apply(F, st) {
    const P = this.p;
    const hy = hipHeight(F);
    P.hips.position.set(0, hy, F.hZ);
    P.hips.rotation.set(F.hRX, F.hRY, F.hRZ);
    P.spine.rotation.set(F.sRX, F.sRY, F.sRZ);
    P.neck.rotation.set(F.nRX, F.nRY, F.nRZ);
    P.lHip.rotation.set(F.lhX, 0, F.lhZ); P.lKnee.rotation.set(F.lk, 0, 0);
    P.rHip.rotation.set(F.rhX, 0, F.rhZ); P.rKnee.rotation.set(F.rk, 0, 0);
    P.lSh.rotation.set(F.laX, F.laY, F.laZ); P.lEl.rotation.set(F.le, 0, 0);
    P.rSh.rotation.set(F.raX, F.raY, F.raZ); P.rEl.rotation.set(F.re, 0, 0);
    // held item
    const hidden = HIDE_W.has(st) && st !== 'phone';
    if (this.weapon) this.weapon.visible = !HIDE_W.has(st) && !(this.act && this.act.name === 'throw' && this.act.t / this.act.dur > 0.47);
    if (st === 'phone') {
      if (!this.phoneItem) { this.phoneItem = createWeaponModel('cellphone'); }
      if (this.phoneItem.parent !== P.mount) P.mount.add(this.phoneItem);
      this.phoneItem.visible = true;
    } else if (this.phoneItem) this.phoneItem.visible = false;
    if (F.mW > 0.001 || st === 'phone') {
      // world-aligned (root frame) orientation of the held item
      _q1.setFromEuler(_e1.set(0, 0, 0)); _q1.copy(P.hips.quaternion).multiply(P.spine.quaternion).multiply(P.rSh.quaternion).multiply(P.rEl.quaternion).invert();
      _q2.setFromEuler(_e1.set(-F.mP, F.mY, F.mR, 'YXZ'));
      P.mount.quaternion.copy(_q1).multiply(_q2);
      P.mount.quaternion.slerp(_q3.identity(), 1 - clamp(F.mW, 0, 1));
    } else P.mount.quaternion.identity();
  }
}
const _overlayTmp = newPose();
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function kindMagZ(id) { return id === 'ak47' ? 0.1 : id === 'smg' ? 0.0 : id === 'sniper' ? 0.09 : id === 'shotgun' ? 0.03 : id === 'rpg' ? 0.0 : 0.0; }

// ------------------------------------------------------------------------------------------------ random appearance
const SKINS = [0xf3cfa8, 0xe8b98c, 0xd9a77a, 0xc58c5c, 0xa8703f, 0x8a5a34, 0x6b4226, 0x4a2d1a];
const HAIRS = [0x15110e, 0x1f1712, 0x2a1c12, 0x3b2616, 0x5a3a1e, 0x8a5a2a, 0xc9a24a, 0xa8442a, 0x8c8c8c, 0xd8d8d8];
const SHIRTS = [0xd94040, 0x3b7ddd, 0xe8c030, 0x3bb36b, 0xeeeeee, 0x222226, 0xe07a30, 0xd96ab0, 0x40b8c8, 0x8a6a4a, 0x6c6c78, 0xa8d04a, 0xc0392b];
const PANTS = [0x2f4a7a, 0x23262c, 0x3a5a8c, 0x1b1b1f, 0xa89468, 0x6b5a48, 0x555a60, 0x4a5a3a];
const SHOES = [0xeeeeee, 0x1c1c1e, 0xc02a2a, 0x808590, 0x2a4a9a, 0xe8c040, 0x5a3a22];
const GANGS = {
  1: { main: [0x2e9e3a, 0x1f7a2b, 0x37b848], band: 0x22c03a, name: 'green' },
  2: { main: [0x7a3fc0, 0x5e2d9a, 0x8c4fd6], band: 0x9a55e0, name: 'purple' },
  3: { main: [0xe6b422, 0xd9a010, 0xf0c540], band: 0xffcc22, name: 'yellow' },
  4: { main: [0x2a5fd0, 0x1c46a8, 0x3a75e6], band: 0x2a7aff, name: 'blue' },
};
const pick = (rng, arr) => arr[Math.min(arr.length - 1, (rng() * arr.length) | 0)];
const chance = (rng, p) => rng() < p;

export function randomAppearance(rng, opts = {}) {
  rng = rng || Math.random;
  const role = opts.role || 'civ';
  let gang = opts.gang | 0;
  const a = Object.assign({}, DEFAULT_APP);
  a.role = role;
  a.gender = opts.gender || (chance(rng, 0.5) ? 'm' : 'f');
  a.skin = pick(rng, SKINS);
  const old = chance(rng, 0.12);
  a.hair = old ? pick(rng, [0x8c8c8c, 0xd8d8d8, 0x9a9a9a]) : pick(rng, HAIRS.slice(0, 8));
  a.scale = 0.94 + rng() * 0.12 - (a.gender === 'f' ? 0.03 : 0);
  const r = rng();
  a.build = r < 0.25 ? 'slim' : r < 0.8 ? 'normal' : 'big';
  a.shoes = pick(rng, SHOES);
  a.pants = pick(rng, PANTS);
  a.shirt = pick(rng, SHIRTS);
  const hairM = ['short', 'short', 'short', 'bald', 'afro', 'braids', 'mohawk', 'cap'], hairF = ['long', 'long', 'long', 'bun', 'short', 'afro', 'braids'];
  a.hairStyle = pick(rng, a.gender === 'f' ? hairF : hairM);
  a.glasses = chance(rng, 0.12);
  const colourHat = () => pick(rng, [0xd94040, 0x3b7ddd, 0x222226, 0xeeeeee, 0x3bb36b, 0xe8c030, 0xe07a30]);

  switch (role) {
    case 'civ': {
      const k = rng();
      if (a.gender === 'f') {
        a.shirtType = k < 0.25 ? 'dress' : k < 0.5 ? 'tank' : k < 0.75 ? 'tee' : k < 0.9 ? 'hoodie' : 'jacket';
        if (a.shirtType === 'tank' || a.shirtType === 'tee') { if (chance(rng, 0.35)) a.skirt = chance(rng, 0.5) ? 'mini' : 'knee'; }
        if (a.shirtType === 'dress') { a.shirt = pick(rng, [0xd94040, 0xe8c030, 0xd96ab0, 0x40b8c8, 0x3bb36b, 0x222226, 0xeeeeee, 0x7a3fc0]); a.skirt = chance(rng, 0.4) ? 'mini' : 'knee'; }
      } else a.shirtType = k < 0.42 ? 'tee' : k < 0.55 ? 'tank' : k < 0.72 ? 'hoodie' : k < 0.88 ? 'jacket' : 'suit';
      if (a.shirtType === 'suit') { a.shirt = pick(rng, [0x2a2d36, 0x3a3f4c, 0x4a4036]); a.pants = a.shirt; a.shoes = 0x1c1c1e; a.accent = pick(rng, [0xaa2222, 0x2a4a9a, 0xe8c030]); }
      a.shorts = !a.skirt && a.shirtType !== 'dress' && a.shirtType !== 'suit' && a.shirtType !== 'jacket' && chance(rng, 0.25);
      if (chance(rng, 0.1)) { a.hat = pick(rng, ['cap', 'beanie']); a.hatColor = colourHat(); if (a.hairStyle === 'cap') a.hairStyle = 'short'; }
      if (a.gender === 'm' && chance(rng, 0.12)) a.beard = a.hair;
      break;
    }
    case 'business':
      a.shirtType = 'suit'; a.shirt = pick(rng, [0x2a2d36, 0x3a3f4c, 0x4a4036, 0x22262e]); a.pants = a.shirt; a.shoes = 0x1c1c1e;
      a.accent = pick(rng, [0xaa2222, 0x2a4a9a, 0xe8c030, 0x1a7a4a]); a.hairStyle = a.gender === 'f' ? pick(rng, ['bun', 'long', 'short']) : pick(rng, ['short', 'short', 'bald']);
      if (a.gender === 'f') a.skirt = 'knee';
      a.glasses = chance(rng, 0.3); break;
    case 'homeless':
      a.gender = chance(rng, 0.85) ? 'm' : 'f'; a.shirtType = pick(rng, ['hoodie', 'jacket', 'tee']); a.shirt = pick(rng, [0x5a5a4a, 0x6b4b3a, 0x48505a, 0x7a6a50]);
      a.pants = pick(rng, [0x3a3a3a, 0x4a4438, 0x2f3540]); a.shoes = pick(rng, [0x3a3028, 0x555555]); a.hairStyle = pick(rng, ['long', 'short', 'bald']);
      a.hat = chance(rng, 0.6) ? 'beanie' : 'none'; a.hatColor = pick(rng, [0x333333, 0x5a3a2a, 0x2a3a4a]); a.beard = chance(rng, 0.7) && a.gender === 'm' ? shade(a.hair, 0.9) : undefined;
      a.hair = pick(rng, [0x8c8c8c, 0x5a4a3a, 0x3a3028]); a.build = pick(rng, ['slim', 'normal', 'slim']); a.skin = shade(a.skin, 0.88); break;
    case 'gangster': {
      if (!gang) gang = 1 + ((rng() * 4) | 0);
      const G = GANGS[gang]; a.gang = gang;
      a.gender = chance(rng, 0.9) ? 'm' : 'f';
      a.shirtType = pick(rng, ['tee', 'tee', 'tank', 'hoodie', 'jacket']);
      a.shirt = chance(rng, 0.75) ? pick(rng, G.main) : 0xeeeeee;
      a.bandana = chance(rng, 0.85) ? G.band : null;
      a.accent = G.band;
      if (chance(rng, 0.3)) { a.hat = 'cap'; a.hatColor = pick(rng, G.main); }
      if (a.shirt === 0xeeeeee && !a.bandana) a.bandana = G.band;
      a.pants = pick(rng, [0x2f4a7a, 0x1b1b1f, 0x3a3a42, 0xa89468, 0x23262c]); a.shorts = chance(rng, 0.2);
      a.shoes = pick(rng, [0xeeeeee, 0x1c1c1e, G.band]); a.build = pick(rng, ['normal', 'normal', 'big', 'slim']);
      a.hairStyle = a.gender === 'f' ? pick(rng, ['long', 'braids', 'bun']) : pick(rng, ['short', 'bald', 'braids', 'afro', 'short']);
      a.glasses = chance(rng, 0.2); if (a.gender === 'm' && chance(rng, 0.25)) a.beard = a.hair;
      break;
    }
    case 'cop':
      a.gender = chance(rng, 0.82) ? 'm' : 'f'; a.shirtType = 'tee'; a.sleeves = 'short'; a.shirt = 0x1c2a52; a.pants = 0x141b30; a.shoes = 0x111113; a.boots = true;
      a.hat = 'cop'; a.hatColor = 0x1a2240; a.badge = true; a.belt = true; a.beltColor = 0x0e0e10; a.hairStyle = a.gender === 'f' ? pick(rng, ['bun', 'short']) : pick(rng, ['short', 'short', 'bald']);
      a.build = pick(rng, ['normal', 'normal', 'big']); a.glasses = chance(rng, 0.35); a.role = 'cop'; break;
    case 'swat':
      a.gender = 'm'; a.shirtType = 'jacket'; a.shirt = 0x17181b; a.pants = 0x1a1b1e; a.shoes = 0x0e0e10; a.boots = true; a.gloves = 0x0d0d0f;
      a.hat = 'helmet'; a.hatColor = 0x1b1c20; a.armor = true; a.belt = true; a.beltColor = 0x101012; a.build = pick(rng, ['normal', 'big']); a.hairStyle = 'short';
      a.glasses = false; a.bandana = 0x0d0d0f; break;
    case 'medic':
      a.shirtType = 'tee'; a.shirt = 0xf4f6f6; a.pants = 0x1d6a4c; a.trim = 0x2ab070; a.shoes = 0x1c1c1e; a.hairStyle = a.gender === 'f' ? pick(rng, ['bun', 'long', 'short']) : 'short';
      if (chance(rng, 0.4)) { a.hat = 'cap'; a.hatColor = 0xf4f6f6; } a.badge = false; break;
    case 'fireman':
      a.gender = chance(rng, 0.9) ? 'm' : 'f'; a.shirtType = 'jacket'; a.shirt = 0xe3c01c; a.trim = 0xdadcdc; a.pants = 0x2a2a2e; a.shoes = 0x141414; a.boots = true; a.gloves = 0x2a2218;
      a.hat = 'hardhat'; a.hatColor = pick(rng, [0xc0282a, 0xe3c01c]); a.build = pick(rng, ['normal', 'big']); a.hairStyle = 'short'; break;
    case 'biker':
      a.gender = chance(rng, 0.88) ? 'm' : 'f'; a.shirtType = 'vest'; a.shirt = 0x1d1916; a.under = chance(rng, 0.5) ? a.skin : pick(rng, [0xdddddd, 0x444444, 0x8a1a1a]);
      a.pants = pick(rng, [0x1b1b1f, 0x2a3550]); a.shoes = 0x141414; a.boots = true; a.build = pick(rng, ['big', 'normal', 'big']);
      a.hairStyle = a.gender === 'f' ? 'long' : pick(rng, ['long', 'bald', 'short', 'mohawk']); a.bandana = chance(rng, 0.5) ? pick(rng, [0x111111, 0xaa1f1f]) : null;
      if (a.gender === 'm') a.beard = chance(rng, 0.7) ? a.hair : undefined; a.glasses = chance(rng, 0.5); a.gloves = chance(rng, 0.3) ? 0x161616 : undefined; break;
    case 'worker':
      a.gender = chance(rng, 0.85) ? 'm' : 'f'; a.shirtType = 'vest'; a.shirt = pick(rng, [0xff8a00, 0xc8e020, 0xff9a1a]); a.trim = 0xe6e6e6; a.under = pick(rng, [0xdddddd, 0x606870, 0x3a4a6a]);
      a.pants = pick(rng, [0x2f3a5a, 0x4a4438, 0x23262c]); a.shoes = 0x5a3a22; a.boots = true; a.hat = 'hardhat'; a.hatColor = pick(rng, [0xf0d020, 0xeeeeee, 0xff8a00, 0x3b7ddd]);
      a.hairStyle = a.gender === 'f' ? 'bun' : 'short'; a.glasses = chance(rng, 0.2); a.gloves = chance(rng, 0.35) ? 0xc0a060 : undefined; break;
    case 'tourist':
      a.shirtType = chance(rng, 0.85) ? 'tee' : 'tank'; a.shirt = pick(rng, [0x29b6c9, 0xf2994a, 0xe25a8a, 0x5ac86a, 0xf0d050]); a.pattern = 'hawaii'; a.accent = pick(rng, [0xffffff, 0xff4a6a, 0xffe066]);
      a.shorts = true; a.pants = pick(rng, [0xd8c8a0, 0xeeeeee, 0x7aa0c8, 0xa89468]); a.glasses = chance(rng, 0.8); a.shoes = pick(rng, [0xeeeeee, 0xd8c8a0]);
      a.skin = pick(rng, SKINS.slice(0, 3)); if (chance(rng, 0.45)) { a.hat = 'cap'; a.hatColor = pick(rng, [0xeeeeee, 0xf0d050, 0x29b6c9]); a.hairStyle = 'short'; }
      if (a.gender === 'f') { a.skirt = chance(rng, 0.4) ? 'mini' : undefined; a.shorts = !a.skirt; a.hairStyle = pick(rng, ['long', 'bun']); }
      a.build = pick(rng, ['normal', 'big', 'normal', 'slim']); break;
    case 'hooker':
      a.gender = 'f'; a.shirtType = pick(rng, ['tank', 'tank', 'tee']); a.shirt = pick(rng, [0xd9306a, 0x222226, 0xe8303a, 0xd96ab0, 0xf0d050]);
      a.skirt = 'mini'; a.pants = pick(rng, [0x111114, 0xd9306a, 0x7a3fc0, 0xe8303a]); a.shoes = pick(rng, [0xe8303a, 0x111114, 0xd9306a]); a.build = 'slim';
      a.hairStyle = pick(rng, ['long', 'bun', 'long', 'braids']); a.glasses = chance(rng, 0.1); a.hair = pick(rng, [0x15110e, 0xc9a24a, 0xa8442a, 0xd9306a]); break;
    default: break;
  }
  if (a.hairStyle === 'cap' && a.hat === 'none') { a.hat = 'cap'; a.hatColor = colourHat(); }
  if (a.hairStyle === 'cap') a.hairStyle = 'short';
  if (a.hat !== 'none' && (a.hairStyle === 'afro' || a.hairStyle === 'mohawk')) a.hairStyle = 'short';
  if (a.hat !== 'none' && a.hairStyle === 'bun') a.hairStyle = 'long';
  if (a.hat === 'helmet' || a.hat === 'hardhat') { if (a.hairStyle === 'long') a.hairStyle = 'short'; }
  return a;
}

/** Convenience: build a ped straight from a role. */
export function createPed(rng, opts = {}) { return new PedRig(randomAppearance(rng, opts)); }
