// Ragdoll: verlet particle simulation of a PedRig (~16 joints, distance constraints, ground + static-world collision).
// Bodies flop, tumble and settle instead of playing a canned animation.  Triggers live in peds.js: run over by a
// vehicle (always), heavy combat / blasts (chance) and death (always).
//
// The simulation lives in world space and drives the rig's joint quaternions directly (the existing meshes are the
// render side; no extra objects are created).  While a ragdoll is active the owner must NOT call rig.update().
// capture() turns the settled configuration back into an animation Pose so the normal get-up action can take over.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, circleVsObb } from './util.js';
import { RIG_DIMS, newPose } from './models_peds.js';

const GRAV = 19;                 // m/s^2 (a touch heavier than real gravity, matches the game's arcade feel)
const FIXED = 1 / 60;            // physics substep
const ITER = 6;                  // constraint iterations per substep
const DRAG = 0.994;              // velocity damping per substep (air + joint softness)
const FRICTION = 0.5;            // fraction of the horizontal slip lost while touching the ground
const SLEEP_V = 0.5;             // m/s: below this the body counts as still
const SLEEP_T = 0.7;             // seconds of stillness before the simulation sleeps
const MAX_SUB = 3;               // substeps per update (protects against long frames)

// ---- particles ---------------------------------------------------------------------------------
const HIPS = 0, SPINE = 1, CHEST = 2, HEAD = 3, SHL = 4, SHR = 5, ELL = 6, ELR = 7, HDL = 8, HDR = 9,
  HJL = 10, HJR = 11, KNL = 12, KNR = 13, FTL = 14, FTR = 15;
const NP = 16;
const RADII = [0.15, 0.14, 0.16, 0.13, 0.12, 0.12, 0.095, 0.095, 0.085, 0.085, 0.12, 0.12, 0.1, 0.1, 0.1, 0.1];
const INVM = [0.7, 0.8, 0.8, 1.0, 0.95, 0.95, 1.1, 1.1, 1.25, 1.25, 1.0, 1.0, 1.1, 1.1, 1.3, 1.3];

// ---- scratch -----------------------------------------------------------------------------------
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _bm = new THREE.Matrix4(), _e = new THREE.Euler();
const _qh = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qn = new THREE.Quaternion();
const _qshL = new THREE.Quaternion(), _qshR = new THREE.Quaternion(), _qelL = new THREE.Quaternion(), _qelR = new THREE.Quaternion();
const _qhjL = new THREE.Quaternion(), _qhjR = new THREE.Quaternion(), _qknL = new THREE.Quaternion(), _qknR = new THREE.Quaternion();
const _ql = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _pos = { x: 0, z: 0 };

/** orthonormal quaternion from a bone direction (local -Y) and a roll reference (local +X). */
function basisQ(out, ux, uy, uz, rx, ry, rz) {
  _by.set(ux, uy, uz);
  if (_by.lengthSq() < 1e-10) _by.set(0, 1, 0); else _by.normalize();
  _bx.set(rx, ry, rz);
  _bx.addScaledVector(_by, -_bx.dot(_by));
  if (_bx.lengthSq() < 1e-8) { _bx.set(1, 0, 0).addScaledVector(_by, -_by.x); if (_bx.lengthSq() < 1e-8) _bx.set(0, 0, 1); }
  _bx.normalize();
  _bz.crossVectors(_bx, _by);
  _bm.makeBasis(_bx, _by, _bz);
  return out.setFromRotationMatrix(_bm);
}
function localQ(out, parent, world) { return out.copy(parent).invert().multiply(world); }
function groundAt(x, z) { const gy = G.world.groundY(x, z); return gy < -0.45 ? -0.45 : gy; }   // sea: bodies float just under the surface

export class Ragdoll {
  constructor(ped) {
    this.ped = ped;
    this.rig = ped.rig;
    this.state = 'off';                          // off | awake | asleep
    this.px = new Float64Array(NP); this.py = new Float64Array(NP); this.pz = new Float64Array(NP);
    this.ox = new Float64Array(NP); this.oy = new Float64Array(NP); this.oz = new Float64Array(NP);
    this.ca = new Uint8Array(28); this.cb = new Uint8Array(28); this.cr = new Float64Array(28); this.ck = new Float32Array(28); this.cn = 0;
    this.acc = 0; this.settleT = 0; this.qH = new THREE.Quaternion(); this._q = [];
    this._build();
  }

  // ---------------------------------------------------------------- rest skeleton
  _build() {
    const rig = this.rig, s = rig.group.scale.x || 1, dm = rig.dm, D = RIG_DIMS;
    const sx = rig.sx * s, hx = Math.abs(rig.p.lHip.position.x) * s;
    const hipSp = D.SP_Y * s, spChest = D.SH_Y * s;
    const chestHead = (D.NECK_Y - D.SH_Y + D.HEAD * dm.headS) * s;
    const L1 = D.L1 * s, LU = D.LU * s, EFF = D.EFF * s, foot = D.FOOT * s;
    let n = 0;
    const add = (a, b, rest, k = 1) => { this.ca[n] = a; this.cb[n] = b; this.cr[n] = rest; this.ck[n] = k; n++; };
    add(HIPS, SPINE, hipSp * 0.97);
    add(SPINE, CHEST, spChest);
    add(CHEST, HEAD, chestHead);
    add(SPINE, SHL, Math.hypot(spChest, sx)); add(SPINE, SHR, Math.hypot(spChest, sx));
    add(SHL, SHR, sx * 2);
    add(SHL, ELL, LU); add(SHR, ELR, LU); add(ELL, HDL, EFF); add(ELR, HDR, EFF);
    add(HIPS, HJL, hx); add(HIPS, HJR, hx); add(HJL, HJR, hx * 2);
    add(SPINE, HJL, Math.hypot(hipSp, hx)); add(SPINE, HJR, Math.hypot(hipSp, hx));
    add(HJL, KNL, L1); add(HJR, KNR, L1); add(KNL, FTL, foot); add(KNR, FTR, foot);
    // soft limits: keep the head above the shoulders and the chest off the pelvis
    add(HEAD, SHL, Math.hypot(chestHead, sx) * 1.06, 0.45); add(HEAD, SHR, Math.hypot(chestHead, sx) * 1.06, 0.45);
    add(CHEST, HJL, Math.hypot(hipSp + spChest, hx) * 1.04, 0.3); add(CHEST, HJR, Math.hypot(hipSp + spChest, hx) * 1.04, 0.3);
    this.cn = n;
  }

  // ---------------------------------------------------------------- lifecycle
  /** Start (or re-hit) the ragdoll.  o: {vx, vy, vz, spin, axis:{x,y,z}, dur}. vel is added to the body velocity. */
  start(o = {}) {
    const ped = this.ped;
    if (this.state === 'off') {
      this.snapshot();
      this.state = 'awake'; Ragdoll.count++;
    } else if (this.state === 'asleep') this.state = 'awake';
    this.acc = 0; this.settleT = 0;
    this.addVel((ped.vx || 0) + (o.vx || 0), o.vy || 0, (ped.vz || 0) + (o.vz || 0), o.spin || 0, o.axis);
    this.writeBack();
  }
  stop() { if (this.state !== 'off') { this.state = 'off'; Ragdoll.count--; } }
  get active() { return this.state !== 'off'; }

  /** add velocity to every particle (verlet: shift the previous positions); spin tumbles the body around `axis`. */
  addVel(vx, vy, vz, spin, axis) {
    const hx = this.px[HIPS], hy = this.py[HIPS], hz = this.pz[HIPS];
    let ax = 0, ay = 0, az = 0;
    if (axis) { ax = axis.x; ay = axis.y; az = axis.z; }
    else { ax = Math.random() - 0.5; ay = Math.random() - 0.5; az = Math.random() - 0.5; const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l; }
    for (let i = 0; i < NP; i++) {
      const rx = this.px[i] - hx, ry = this.py[i] - hy, rz = this.pz[i] - hz;
      const w = spin * (1.1 + Math.random() * 0.9);
      const dvx = vx + (ay * rz - az * ry) * w + (Math.random() - 0.5) * 0.7;
      const dvy = vy + (az * rx - ax * rz) * w + (Math.random() - 0.5) * 0.45;
      const dvz = vz + (ax * ry - ay * rx) * w + (Math.random() - 0.5) * 0.7;
      this.ox[i] -= dvx * FIXED; this.oy[i] -= dvy * FIXED; this.oz[i] -= dvz * FIXED;
    }
  }
  impulse(vx, vy, vz, spin, axis) { if (this.state === 'off') return; if (this.state === 'asleep') this.state = 'awake'; this.settleT = 0; this.addVel(vx, vy, vz, spin, axis); }

  // ---------------------------------------------------------------- rig <-> particles
  /** read the live rig pose into the particles (seamless hand-off, limbs keep their current posture). */
  snapshot() {
    const rig = this.rig, P = rig.p;
    rig.group.updateWorldMatrix(true, true);
    const grab = (obj, i) => { obj.getWorldPosition(_v); this.px[i] = _v.x; this.py[i] = _v.y; this.pz[i] = _v.z; this.ox[i] = _v.x; this.oy[i] = _v.y; this.oz[i] = _v.z; };
    grab(P.hips, HIPS); grab(P.spine, SPINE);
    P.lSh.getWorldPosition(_v); P.rSh.getWorldPosition(_v2);
    this.px[CHEST] = (_v.x + _v2.x) / 2; this.py[CHEST] = (_v.y + _v2.y) / 2; this.pz[CHEST] = (_v.z + _v2.z) / 2;
    this.ox[CHEST] = this.px[CHEST]; this.oy[CHEST] = this.py[CHEST]; this.oz[CHEST] = this.pz[CHEST];
    rig.headWorldPos(_v); this.px[HEAD] = _v.x; this.py[HEAD] = _v.y; this.pz[HEAD] = _v.z; this.ox[HEAD] = _v.x; this.oy[HEAD] = _v.y; this.oz[HEAD] = _v.z;
    grab(P.lSh, SHL); grab(P.rSh, SHR); grab(P.lEl, ELL); grab(P.rEl, ELR); grab(P.lHand, HDL); grab(P.rHand, HDR);
    grab(P.lHip, HJL); grab(P.rHip, HJR); grab(P.lKnee, KNL); grab(P.rKnee, KNR);
    const foot = (knee, i) => { _v.set(0, -RIG_DIMS.FOOT, 0); knee.localToWorld(_v); this.px[i] = _v.x; this.py[i] = _v.y; this.pz[i] = _v.z; this.ox[i] = _v.x; this.oy[i] = _v.y; this.oz[i] = _v.z; };
    foot(P.lKnee, FTL); foot(P.rKnee, FTR);
    this.qH.copy(rig.group.quaternion);
  }

  /** drive the rig joints from the particles. */
  writeBack() {
    const rig = this.rig, P = rig.p, { px, py, pz } = this;
    basisQ(_qh, px[SPINE] - px[HIPS], py[SPINE] - py[HIPS], pz[SPINE] - pz[HIPS], px[HJL] - px[HJR], py[HJL] - py[HJR], pz[HJL] - pz[HJR]);
    basisQ(_qs, px[CHEST] - px[SPINE], py[CHEST] - py[SPINE], pz[CHEST] - pz[SPINE], px[SHL] - px[SHR], py[SHL] - py[SHR], pz[SHL] - pz[SHR]);
    basisQ(_qn, px[HEAD] - px[CHEST], py[HEAD] - py[CHEST], pz[HEAD] - pz[CHEST], px[SHL] - px[SHR], py[SHL] - py[SHR], pz[SHL] - pz[SHR]);
    basisQ(_qshL, px[SHL] - px[ELL], py[SHL] - py[ELL], pz[SHL] - pz[ELL], px[SHL] - px[SHR], py[SHL] - py[SHR], pz[SHL] - pz[SHR]);
    basisQ(_qshR, px[SHR] - px[ELR], py[SHR] - py[ELR], pz[SHR] - pz[ELR], px[SHL] - px[SHR], py[SHL] - py[SHR], pz[SHL] - pz[SHR]);
    basisQ(_qelL, px[ELL] - px[HDL], py[ELL] - py[HDL], pz[ELL] - pz[HDL], px[SHL] - px[SHR], py[SHL] - py[SHR], pz[SHL] - pz[SHR]);
    basisQ(_qelR, px[ELR] - px[HDR], py[ELR] - py[HDR], pz[ELR] - pz[HDR], px[SHL] - px[SHR], py[SHL] - py[SHR], pz[SHL] - pz[SHR]);
    basisQ(_qhjL, px[HJL] - px[KNL], py[HJL] - py[KNL], pz[HJL] - pz[KNL], px[HJL] - px[HJR], py[HJL] - py[HJR], pz[HJL] - pz[HJR]);
    basisQ(_qhjR, px[HJR] - px[KNR], py[HJR] - py[KNR], pz[HJR] - pz[KNR], px[HJL] - px[HJR], py[HJL] - py[HJR], pz[HJL] - pz[HJR]);
    basisQ(_qknL, px[KNL] - px[FTL], py[KNL] - py[FTL], pz[KNL] - pz[FTL], px[HJL] - px[HJR], py[HJL] - py[HJR], pz[HJL] - pz[HJR]);
    basisQ(_qknR, px[KNR] - px[FTR], py[KNR] - py[FTR], pz[KNR] - pz[FTR], px[HJL] - px[HJR], py[HJL] - py[HJR], pz[HJL] - pz[HJR]);
    const g = rig.group;
    g.position.set(px[HIPS], py[HIPS], pz[HIPS]);
    g.quaternion.copy(_qh);
    this.qH.copy(_qh);
    P.hips.position.set(0, 0, 0); P.hips.quaternion.identity();
    P.spine.quaternion.copy(localQ(_ql, _qh, _qs));
    P.neck.quaternion.copy(localQ(_ql, _qs, _qn));
    P.lSh.quaternion.copy(localQ(_ql, _qs, _qshL)); P.rSh.quaternion.copy(localQ(_ql, _qs, _qshR));
    P.lEl.quaternion.copy(localQ(_ql, _qshL, _qelL)); P.rEl.quaternion.copy(localQ(_ql, _qshR, _qelR));
    P.lHip.quaternion.copy(localQ(_ql, _qh, _qhjL)); P.rHip.quaternion.copy(localQ(_ql, _qh, _qhjR));
    P.lKnee.quaternion.copy(localQ(_ql, _qhjL, _qknL)); P.rKnee.quaternion.copy(localQ(_ql, _qhjR, _qknR));
  }

  /** keep the owner's gameplay position in sync with the pelvis (pickups, AI, radar, traces... all use ped.x/y/z). */
  syncPed() {
    const p = this.ped;
    p.x = this.px[HIPS]; p.z = this.pz[HIPS];
    p.y = groundAt(p.x, p.z);
    p.vx = p.vz = p.vy = 0;
    p.grounded = false; p.airborneT = 1;
  }

  /** the settled body as an animation pose, so the ped can get up with a normal action from where the ragdoll left it. */
  capture() {
    const rig = this.rig, P = rig.p, s = rig.group.scale.x || 1;
    let lx = this.px[HJL] - this.px[HJR], lz = this.pz[HJL] - this.pz[HJR];
    if (Math.hypot(lx, lz) < 0.1) { lx = this.px[SHL] - this.px[SHR]; lz = this.pz[SHL] - this.pz[SHR]; }
    const yaw = Math.hypot(lx, lz) > 0.05 ? Math.atan2(-lz, lx) : this.ped.yaw;
    const floor = groundAt(this.px[HIPS], this.pz[HIPS]);
    const F = newPose();
    _e.set(0, yaw, 0); _q2.setFromEuler(_e);
    _q2.invert().multiply(this.qH);
    _e.setFromQuaternion(_q2, 'XYZ');
    F.hRX = _e.x; F.hRY = _e.y; F.hRZ = _e.z;
    F.hFree = 1; F.hY = (this.py[HIPS] - floor) / s; F.hZ = 0;
    _e.setFromQuaternion(P.spine.quaternion, 'XYZ'); F.sRX = _e.x; F.sRY = _e.y; F.sRZ = _e.z;
    _e.setFromQuaternion(P.neck.quaternion, 'XYZ'); F.nRX = _e.x; F.nRY = _e.y; F.nRZ = _e.z;
    _e.setFromQuaternion(P.lSh.quaternion, 'XYZ'); F.laX = _e.x; F.laY = _e.y; F.laZ = _e.z;
    _e.setFromQuaternion(P.rSh.quaternion, 'XYZ'); F.raX = _e.x; F.raY = _e.y; F.raZ = _e.z;
    F.le = P.lEl.rotation.x; F.re = P.rEl.rotation.x;
    legPose(F, 'l', P.lHip, P.lKnee); legPose(F, 'r', P.rHip, P.rKnee);
    return { pose: F, yaw, x: this.px[HIPS], z: this.pz[HIPS], y: floor, face: F.hRX >= 0 ? 1 : -1 };
  }

  // ---------------------------------------------------------------- simulation
  step(dt) {
    if (this.state !== 'awake') return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED && n < MAX_SUB) { this.substep(); this.acc -= FIXED; n++; }
    if (this.acc > FIXED * MAX_SUB) this.acc = 0;
    if (!n) return;
    this.writeBack();
    this._settle(dt);
  }
  substep() {
    const { px, py, pz, ox, oy, oz } = this, g = GRAV * FIXED * FIXED;
    for (let i = 0; i < NP; i++) {
      let vx = (px[i] - ox[i]) * DRAG, vy = (py[i] - oy[i]) * DRAG, vz = (pz[i] - oz[i]) * DRAG;
      const l2 = vx * vx + vy * vy + vz * vz;
      if (l2 > 2.25) { const k = 1.5 / Math.sqrt(l2); vx *= k; vy *= k; vz *= k; }   // clamp: no supersonic corpses
      ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
      px[i] += vx; py[i] += vy - g; pz[i] += vz;
    }
    this.collide(false);
    this.solve();
    this.collide(true);
  }
  solve() {
    const { px, py, pz, ca, cb, cr, ck } = this;
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < this.cn; i++) {
        const a = ca[i], b = cb[i];
        const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-10) continue;
        const d = Math.sqrt(d2), diff = (d - cr[i]) / d * ck[i];
        const wa = INVM[a], wb = INVM[b], ws = wa + wb;
        const ka = wa / ws * diff, kb = wb / ws * diff;
        px[a] += dx * ka; py[a] += dy * ka; pz[a] += dz * ka;
        px[b] -= dx * kb; py[b] -= dy * kb; pz[b] -= dz * kb;
      }
    }
  }
  collide(staticToo) {
    const { px, py, pz, ox, oy, oz } = this;
    for (let i = 0; i < NP; i++) {
      const r = RADII[i];
      const gy = groundAt(px[i], pz[i]);
      if (py[i] < gy + r) {
        const dy = py[i] - oy[i];
        py[i] = gy + r;
        oy[i] = dy < -0.05 ? py[i] + dy * 0.4 : py[i];                 // a little bounce on hard landings, otherwise dead stop
        ox[i] = px[i] - (px[i] - ox[i]) * (1 - FRICTION);               // ground friction
        oz[i] = pz[i] - (pz[i] - oz[i]) * (1 - FRICTION);
      }
      if (!staticToo) continue;
      const list = G.world.colHash.queryRadius(px[i], pz[i], r + 0.5, this._q);
      for (let k = 0; k < list.length; k++) {
        const c = list[k]; if (c.dead) continue;
        const cgy = G.world.groundY(c.x, c.z);
        if (py[i] > cgy + (c.h ?? 3) + 0.25) continue;                  // flying over a fence / low prop
        if (c.hw !== undefined) {
          const hit = circleVsObb(c, px[i], pz[i], r);
          if (hit) {
            px[i] += hit.nx * hit.depth; pz[i] += hit.nz * hit.depth;
            ox[i] = px[i] - (px[i] - ox[i]) * 0.65; oz[i] = pz[i] - (pz[i] - oz[i]) * 0.65;
          }
        } else {
          const dx = px[i] - c.x, dz = pz[i] - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-4, dep = rr - d;
            px[i] += dx / d * dep; pz[i] += dz / d * dep;
            ox[i] = px[i] - (px[i] - ox[i]) * 0.65; oz[i] = pz[i] - (pz[i] - oz[i]) * 0.65;
          }
        }
      }
    }
  }
  _settle(dt) {
    let mv = 0;
    for (let i = 0; i < NP; i++) {
      const v = Math.hypot(this.px[i] - this.ox[i], this.py[i] - this.oy[i], this.pz[i] - this.oz[i]) / FIXED;
      if (v > mv) mv = v;
    }
    if (mv < SLEEP_V) { this.settleT += dt; if (this.settleT > SLEEP_T) this.state = 'asleep'; }
    else this.settleT = 0;
  }
}
Ragdoll.count = 0;       // live ragdolls (awake + asleep): a budget keeps a full-blown massacre cheap
Ragdoll.MAX = 13;

// leg joints store only flex + abduction, so match the bone direction instead of the full quaternion
function legPose(F, s, hip, knee) {
  _v.set(0, -1, 0).applyQuaternion(hip.quaternion);
  F[s + 'hX'] = Math.atan2(-_v.z, -_v.y);
  F[s + 'hZ'] = Math.asin(clamp(_v.x, -1, 1));
  _v.set(0, -1, 0).applyQuaternion(knee.quaternion);
  F[s + 'k'] = Math.atan2(-_v.z, -_v.y);
}
