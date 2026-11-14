// Random world events: one at a time, every couple of minutes of free roam, near the player but out of sight.
// accident, police pull-over, mugging, drive-by, runaway chase, armoured truck, street race, burning car (+ fire engine).
// Each event carries a radar blip while it runs, pays a modest reward when the player helps, and cleans up completely afterwards.
import { G } from './state.js';
import { Ped } from './peds.js';
import { DriverAI } from './driverai.js';
import { spawnDriven } from './ambient.js';
import { endLife } from './lifebrain.js';
import { clamp, dist2, rrange, pick, pickWeighted, TAU } from './util.js';
import { ZONE, CLS, GANG } from './mapdata.js';

const CIV_CARS = ['sedan', 'hatch', 'suv', 'pickup', 'coupe', 'van', 'muscle', 'lowrider'];
const GANG_COL = { 2: 0x7a3fc0, 3: 0xe8c030, 4: 0x2a5adf };

class Ev {
  constructor(kind, x, z, o = {}) {
    this.kind = kind; this.x = x; this.z = z; this.t = 0; this.maxT = o.maxT ?? 120; this.label = o.label || kind; this.color = o.color || '#ffa020';
    this.peds = []; this.vehs = []; this.objs = []; this.jobs = []; this.timers = []; this.blip = null; this.ready = false; this.announced = false; this.done = false; this.log = [];
    this.hint = o.hint || '';
  }
  tag(p) { p.evt = this; p.noDespawn = true; this.peds.push(p); return p; }
  tagV(v) { v.evt = this; this.vehs.push(v); return v; }
  ped(o) {
    const app = o.app || G.models.peds.randomAppearance(Math.random, { role: o.look || 'civ', gang: o.gang || 0 });
    if (o.mod) o.mod(app);
    const p = new Ped({ x: o.x, z: o.z, role: o.role || 'civ', gang: o.gang || 0, appearance: app, yaw: o.yaw || 0 });
    if (o.weapon) p.give(o.weapon, o.ammo ?? 80);
    if (o.cash !== undefined) p.cash = o.cash;
    G.peds.add(p); return this.tag(p);
  }
  later(t, fn) { this.timers.push({ t: this.t + t, fn }); }
  alive(p) { return p && !p.dead && !p.removeMe && G.peds.list.includes(p); }
  vok(v) { return v && G.vehicles.list.includes(v) && !v.wrecked; }
  say(p, text, dur) { if (G.ambient && p) G.ambient.say(p, text, dur || 2.4, true); }
  step(dt) { return false; }
}

// ----------------------------------------------------------------------------------------------------------- helpers
const _nl = {};
function laneSpot(nr, dir, lane, back = 0) {   // point on the lane of nr's edge, `back` metres behind nr along travel
  const e = nr.edge, nav = G.nav; const s0 = dir > 0 ? nr.s : e.len - nr.s; const ag = { edge: e, dir, s: clamp(s0 - back, 1, e.len - 1), lane };
  nav.lanePoint(ag, ag.s, _nl); return { x: _nl.x, z: _nl.z, tx: _nl.tx, tz: _nl.tz, s: ag.s };
}
function laneClear(nr, dir, lane = 0, back = 0, spacing = 12) {
  const e = nr.edge; if (G.map.nodes[e.a].deg < 2 && G.map.nodes[e.b].deg < 2) return false;
  const sp = laneSpot(nr, dir, Math.min(lane, G.nav.laneCount(e) - 1), back);
  for (const v of G.vehicles.list) if (dist2(v.x, v.z, sp.x, sp.z) < spacing * spacing) return false;
  return true;
}
function farNodeFrom(x, z, rmin, rmax) {
  const c = []; for (const n of G.map.nodes) { if (n.deg < 3) continue; const d = Math.hypot(n.x - x, n.z - z); if (d > rmin && d < rmax) c.push(n); }
  return c.length ? c[(Math.random() * c.length) | 0] : null;
}
function carAt(E, type, x, z, yaw, opts = {}) {
  const v = G.vehicles.spawn(type, x, z, yaw, { owner: 'event', color: opts.color });
  E.tagV(v); return v;
}
function damageCar(v, frac = 0.7) { v.health = v.maxHealth * (1 - frac); v.model.setDamage(frac); }
function money(n, msg, resp = 0) { const pl = G.player; pl.addMoney(n); pl.respect += resp; G.audio && G.audio.play('cash'); G.hud.notify(msg + ' +$' + n, 'cash'); }
function aiOf(v, mode, o) { const ai = new DriverAI(v, mode, o); return ai; }
function isPlayerSrc(s) { return !!s && (s.isPlayer || (s.vehicle && s.vehicle.driver && s.vehicle.driver.isPlayer) || (s.driver && s.driver.isPlayer)); }
function downPed(p, hp = 30) { p.health = hp; p.downT = 1e6; p.downElapsed = 0; p.vx = p.vz = 0; p.cash = 0; p.canDrop = false; }
function pedCar(E, v, role, seat = 0, o = {}) {
  const app = G.models.peds.randomAppearance(Math.random, { role: o.look || (role === 'cop' ? 'cop' : role === 'medic' ? 'medic' : role === 'fireman' ? 'fireman' : role === 'gang' ? 'gangster' : 'civ'), gang: o.gang || 0 });
  if (o.mod) o.mod(app);
  const p = new Ped({ x: v.x, z: v.z, role, gang: o.gang || 0, appearance: app }); G.peds.add(p); E.tag(p);
  if (o.weapon) p.give(o.weapon, 120);
  p.enterVehicle(v, seat, true); return p;
}
// Preset the traffic AI's route so that the vehicle ends up driving along the edge of (x,z) towards it; returns the edge info or null.
function routeVia(v, x, z) {
  const nav = G.nav, nr = G.map.nearestRoad(x, z, 60); if (!nr || !v.ai) return null;
  const e = nr.edge, ai = v.ai; if (!ai.ensureAgent()) return null;
  const a = ai.agent; const endNode = a.dir > 0 ? a.edge.b : a.edge.a;
  let best = null;
  for (const [entry, dirE] of [[e.a, 1], [e.b, -1]]) {
    let r = []; if (entry !== endNode) { r = nav.route(endNode, entry); if (r === null) continue; }
    if (a.edge === e && a.dir === dirE) { r = []; }
    let len = 0; for (const st of r) len += st.edge.len;
    if (!best || len < best.len) best = { r, dirE, len };
  }
  if (!best) return null;
  a.route = best.r.concat(a.edge === e && a.dir === best.dirE ? [] : [{ edge: e, dir: best.dirE }]); ai.next = null;
  const sScene = best.dirE > 0 ? nr.s : e.len - nr.s;
  return { edge: e, dir: best.dirE, s: sScene };
}
function arrivedAt(v, info, x, z) {
  const d = Math.hypot(v.x - x, v.z - z);
  if (d < 12) return true;
  const a = v.ai && v.ai.agent;
  if (a && a.edge === info.edge && a.dir === info.dir) { const rem = info.s - a.s; if (rem < 18) return true; if (rem < 70) v.ai.speedFactor = 0.42; }
  else if (d < 60) v.ai.speedFactor = 0.6;
  return false;
}
// drive a service vehicle to the scene (pickRoadSpot ring around the scene, preferably out of the player's sight)
function responder(E, W, type, role, n, o = {}) {
  const R = { v: null, peds: [], state: 'drive', t: 0, type, role };
  E.jobs.push(() => {
    let nr = null;
    for (let k = 0; k < 8 && !nr; k++) { const q = G.population.pickRoadSpot(E.x, E.z, o.rmin ?? 150, o.rmax ?? 260, 10, 0); if (!q) continue; if (W.force || W.hiddenFrom(q.x, q.z, 70) || k >= 5) nr = q; }
    if (!nr) { R.state = 'none'; return; }
    const dest = E.dest || { x: E.x, z: E.z }; R.dest = dest;
    const v = spawnDriven(nr, type, { owner: 'event', color: o.color, role, noDespawn: true, speed: 14, lane: 0, speedFactor: 1.5 });
    if (!v) { R.state = 'none'; return; }
    v.ai.ignoreLights = true; v.ai.aggressive = true;
    R.info = routeVia(v, dest.x, dest.z);
    if (!R.info) { G.vehicles.remove(v); R.state = 'none'; return; }
    E.tagV(v); R.v = v; R.peds.push(v.driver); E.tag(v.driver); v.setSiren(true);
    if (o.armed && v.driver) v.driver.give('pistol', 60);
  });
  for (let i = 1; i < n; i++) E.jobs.push(() => { if (!R.v || !G.vehicles.list.includes(R.v)) return; const p = pedCar(E, R.v, role, i); R.peds.push(p); });
  return R;
}
function releaseLeave(E, R) {   // service vehicle drives off as ordinary traffic
  const v = R.v; if (!v || !G.vehicles.list.includes(v)) return;
  if (v.ai) { v.ai.setMode('traffic'); v.ai.agent = null; v.ai.ignoreLights = false; v.ai.speedFactor = 1.2; }
  v.owner = 'traffic'; v.amb = true; v.evt = null; v.input.handbrake = false;
}

// =========================================================================================================== events
const EVENTS = {
  // ------------------------------------------------------------------------------------------ car accident
  accident: {
    weight: (c) => 3.0,
    make(W) {
      const nr = W.spot(); if (!nr) return null;
      const E = new Ev('accident', nr.x, nr.z, { label: 'Car accident', color: '#ff8a20', maxT: 130 });
      const hx = nr.tx, hz = nr.tz, rx = hz, rz = -hx;    // heading and its right-hand perpendicular
      const yaw0 = Math.atan2(hx, hz); const side = Math.random() < 0.5 ? 1 : -1;
      const tA = pick(CIV_CARS), tB = pick(CIV_CARS);
      const aPos = { x: nr.x + rx * 0.9, z: nr.z + rz * 0.9 }, bPos = { x: nr.x + hx * 2.6 + rx * 2.9 * side, z: nr.z + hz * 2.6 + rz * 2.9 * side };
      let A = null, B = null; const inj = [];
      E.jobs.push(() => { A = carAt(E, tA, aPos.x, aPos.z, yaw0 + rrange(-0.3, 0.3)); damageCar(A, 0.72); });
      E.jobs.push(() => { B = carAt(E, tB, bPos.x, bPos.z, yaw0 + side * rrange(1.0, 1.35)); damageCar(B, 0.75); });
      // injured drivers lie in the road, a third person is on the phone
      for (let i = 0; i < 2; i++) E.jobs.push(() => {
        const v = i ? B : A; if (!v) return; const off = (i ? 1 : -1) * (v.def.width / 2 + 1.3);
        const x = v.x + Math.cos(v.yaw) * off + Math.sin(v.yaw) * rrange(-1.5, 1.5), z = v.z - Math.sin(v.yaw) * off + Math.cos(v.yaw) * rrange(-1.5, 1.5);
        const p = E.ped({ x, z, yaw: Math.random() * TAU }); downPed(p, 35); inj.push(p);
      });
      E.jobs.push(() => {
        const v = A; if (!v) return; const x = v.x + hx * -3.5 + rx * 2.4, z = v.z + hz * -3.5 + rz * 2.4;
        const p = E.ped({ x, z, yaw: Math.atan2(v.x - x, v.z - z) }); p.life = { type: 'stand', state: Math.random() < 0.5 ? 'phone' : 'cower', face: { x: v.x, z: v.z }, t: 1e9, say: ['Oh god, oh god...', 'Hello? An accident!', 'Are they alive?!'] };
        E.shocked = p;
      });
      E.jobs.push(() => { G.ambient.addPOI({ x: nr.x + rx * 1.4, z: nr.z + rz * 1.4, r: 9, until: G.time + 90, kind: 'crash', max: 8 }); });
      // emergency services arrive
      E.dest = { x: nr.x - hx * 8 + rx * 1.5, z: nr.z - hz * 8 + rz * 1.5 };
      let pol = null, amb = null;
      E.later(14, () => { pol = responder(E, W, 'police', 'cop', 2, { armed: true, cruise: 28, rmin: 110, rmax: 190 }); E.pol = pol; });
      E.later(26, () => { amb = responder(E, W, 'ambulance', 'medic', 2, { cruise: 26, stopDist: 10, rmin: 110, rmax: 190 }); E.amb = amb; });
      E.inj = inj;
      E.step = (dt) => {
        if (!E.ready) return false;
        for (const p of inj) if (E.alive(p) && !p.life) { if (p.downT < 5 && !p.treated) p.downT = 1e6; }
        // smoke from the wrecks
        E.smokeT = (E.smokeT || 0) - dt;
        if (E.smokeT <= 0) { E.smokeT = 0.25; for (const v of [A, B]) if (v && G.vehicles.list.includes(v) && v.health < 500) { const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw); G.fx.smokePuff(v.x + fx * 1.5, v.y + 1.0, v.z + fz * 1.5, 0.9, 1.6, 0.3); } }
        for (const R of [pol, amb]) if (R && R.v) serviceStep(E, R, dt, inj);
        // finished when the ambulance has left (or never came) and time is up
        const ambGone = !amb || amb.state === 'none' || amb.state === 'left';
        if (E.t > 70 && ambGone && (!pol || pol.state === 'none' || pol.state === 'left' || E.t > 95)) return true;
        return false;
      };
      return E;
    }
  },

  // ------------------------------------------------------------------------------------------ speeder pulled over
  pullover: {
    weight: (c) => 2.4,
    make(W) {
      const nr = W.spot(); if (!nr || nr.edge.cls === CLS.FREEWAY) return null;
      const E = new Ev('pullover', nr.x, nr.z, { label: 'Police pull-over', color: '#4a90ff', maxT: 100 });
      const dir = Math.random() < 0.5 ? 1 : -1; if (!laneClear(nr, dir, 0, 0, 10) || !laneClear(nr, dir, 0, 28, 8)) return null;
      let civ = null, pv = null, driver = null, cop = null, cop2 = null; let phase = 'chase';
      E.jobs.push(() => {
        const sp = laneSpot(nr, dir, 0, 0);
        civ = spawnDriven(nr, pick(['sedan', 'coupe', 'muscle', 'sports', 'hatch']), { owner: 'event', dir, lane: 0, speedFactor: 1.5, speed: 16, noDespawn: true, spacing: 8 }); if (!civ) { E.dead = true; return; }
        E.tagV(civ); driver = civ.driver; E.tag(driver);
      });
      E.jobs.push(() => {
        if (!civ) return;
        pv = spawnDriven(nr, 'police', { owner: 'event', dir, lane: 0, s: civ.ai && civ.ai.agent ? civ.ai.agent.s - 26 : undefined, role: 'cop', noDespawn: true, mode: 'chase', ai: { target: civ, aggressive: true, ignoreLights: true, stopDist: 8 }, speed: 18, spacing: 6 });
        if (!pv) { E.dead = true; return; }
        pv.ai.pursuitSpeed = 34; E.tagV(pv); cop = pv.driver; E.tag(cop); cop.give('pistol', 60); pv.setSiren(true);
      });
      E.jobs.push(() => { if (pv) { cop2 = pedCar(E, pv, 'cop', 1); cop2.give('pistol', 40); } });
      E.step = (dt) => {
        if (E.dead) return true;
        if (!E.ready || !civ || !pv) return false;
        E.phase = phase;
        if (!G.vehicles.list.includes(civ) || !G.vehicles.list.includes(pv) || !E.alive(driver) || !E.alive(cop)) { E.phase = 'lost:' + [G.vehicles.list.includes(civ), G.vehicles.list.includes(pv), E.alive(driver), E.alive(cop)].join(); return true; }
        E.x = civ.x; E.z = civ.z; if (E.blip) { E.blip.x = E.x; E.blip.z = E.z; }
        const d = Math.hypot(civ.x - pv.x, civ.z - pv.z);
        if (phase === 'chase') {
          if ((d < 20 && E.t > 4) || E.t > 34) {   // the speeder gives up and pulls over
            phase = 'stop'; E.pt = 0; civ.ai.setMode('idle'); civ.input.handbrake = true; civ.input.throttle = 0;
            E.say(driver, pick(['Aw, come on!', 'Not again...', 'I wasn\'t speeding!']), 2.5);
          }
        } else if (phase === 'stop') {
          E.pt += dt; civ.input.handbrake = true;
          if (pv.totalSpeed < 1.5 || E.pt > 6) {
            pv.ai.setMode('idle'); pv.input.handbrake = true;
            for (const p of pv.occupants()) { p.exitVehicle(false); p.noDespawn = true; }
            const dw = civ.doorWorldPos(0);
            cop.life = { type: 'goto', x: dw.x + 0.3, z: dw.z + 0.3, speed: 2.4, radius: 1.3, t: 10, next: { type: 'stand', state: 'idle', face: { x: civ.x, z: civ.z }, t: 14, say: ['License and registration.', 'Do you know how fast you were going?'] } };
            if (cop2) cop2.life = { type: 'goto', x: civ.x - Math.sin(civ.yaw) * 4, z: civ.z - Math.cos(civ.yaw) * 4 - 1.2, speed: 2.2, radius: 1.3, t: 8, next: { type: 'stand', state: 'idle', face: { x: civ.x, z: civ.z }, t: 14 } };
            phase = 'talk'; E.pt = 0;
          }
        } else if (phase === 'talk') {
          E.pt += dt;
          if (E.pt > 7 && driver.vehicle) { driver.exitVehicle(false); driver.noDespawn = true; driver.life = { type: 'stand', state: 'cower', face: { x: cop.x, z: cop.z }, t: 12 }; E.say(driver, 'Okay okay, I\'m out!', 2.4); }
          if (E.pt > 16) { phase = 'arrest'; E.pt = 0; driver.life = null; driver.setMode('walk'); driver.enterVehicle(pv, 2, false); for (const p of [cop, cop2]) if (p && E.alive(p)) { p.life = null; p.enterVehicle(pv, p === cop ? 0 : 1, false); } }
        } else if (phase === 'arrest') {
          E.pt += dt;
          if ((pv.driver === cop && driver.vehicle === pv) || E.pt > 14) { phase = 'leave'; E.pt = 0; pv.ai.setMode('traffic'); pv.ai.agent = null; pv.ai.ignoreLights = false; pv.ai.speedFactor = 1.1; pv.input.handbrake = false; if (pv.siren) pv.setSiren(false); pv.owner = 'traffic'; pv.amb = true; civ.owner = 'parked'; civ.evt = null; }
        } else if (phase === 'leave') { E.pt += dt; if (E.pt > 6) return true; }
        return false;
      };
      return E;
    }
  },

  // ------------------------------------------------------------------------------------------ mugging
  mugging: {
    weight: (c) => 2.2 + c.night * 1.5,
    make(W) {
      const sp = W.sideSpot(85, 165); if (!sp) return null;
      const E = new Ev('mugging', sp.x, sp.z, { label: 'Mugging', color: '#ff4040', maxT: 80 });
      let vic = null, thug = null; let phase = 'threat'; E.pt = 0;
      const bx = sp.x + sp.tx * 1.45, bz = sp.z + sp.tz * 1.45;
      E.jobs.push(() => { vic = E.ped({ x: sp.x, z: sp.z, yaw: Math.atan2(bx - sp.x, bz - sp.z), look: Math.random() < 0.5 ? 'business' : 'civ', cash: 120 + ((Math.random() * 200) | 0) }); vic.setMode('cower', 1e9); vic.faceOverride = Math.atan2(bx - sp.x, bz - sp.z); });
      E.jobs.push(() => {
        thug = E.ped({ x: bx, z: bz, yaw: Math.atan2(sp.x - bx, sp.z - bz), role: 'gang', gang: 0, weapon: 'knife', cash: 40, mod: (a) => { a.shirtType = 'hoodie'; a.shirt = pick([0x1c1c22, 0x2a2a30, 0x3a1c1c]); a.pants = 0x1b1b1f; a.hat = 'beanie'; a.hatColor = 0x16161a; if (a.hairStyle === 'afro' || a.hairStyle === 'mohawk' || a.hairStyle === 'bun') a.hairStyle = 'short'; a.gender = 'm'; } });
        thug.life = { type: 'stand', state: 'idle', face: { x: sp.x, z: sp.z }, t: 1e9 }; thug.name = 'Mugger';
      });
      E.jobs.push(() => { G.ambient.addPOI({ x: (sp.x + bx) / 2, z: (sp.z + bz) / 2, r: 11, until: G.time + 40, kind: 'mug', max: 3, say: ['He\'s got a knife!', 'Somebody help!', 'Call the cops!'] }); });
      E.step = (dt) => {
        if (!E.ready || !vic || !thug) return false;
        E.pt += dt; const pl = G.player; const px = pl.vehicle ? pl.vehicle.x : pl.x, pz = pl.vehicle ? pl.vehicle.z : pl.z;
        if (phase === 'threat') {
          E.tk = (E.tk || 0) - dt;
          if (E.alive(thug) && thug.life && (E.tk <= 0)) { E.tk = rrange(2, 4); thug.rig.playAction('knife'); if (Math.random() < 0.6) E.say(thug, pick(['Give me your wallet!', 'Hand it over!', 'Empty your pockets!']), 2.2); else E.say(vic, pick(['Please, don\'t!', 'Take it, take it!', 'Help!']), 2.2); }
          if (!E.alive(thug) || !E.alive(vic)) { phase = 'over'; E.pt = 0; return false; }
          const dp = Math.hypot(px - thug.x, pz - thug.z);
          if (dp < 11 && E.pt > 4 || thug.health < thug.maxHealth) {   // somebody interferes: the mugger turns on them
            phase = 'fight'; E.pt = 0; endLife(thug, null); thug.aggroT = 40; thug.target = pl; thug.setMode('attack', 40); E.say(thug, 'Mind your own business!', 2.4);
            vic.setMode('flee', 8); vic.fearPos = { x: thug.x, z: thug.z };
          } else if (E.pt > 32) {   // robbery done: the thug takes the cash and runs
            phase = 'robbed'; E.pt = 0; endLife(thug, null); const c = vic.cash; vic.cash = 0; G.pickups.spawn('cash', vic.x + 0.6, vic.z, { amount: Math.max(30, c), life: 45 }); E.say(vic, 'My wallet!', 2.5);
            const a = Math.random() * TAU; thug.life = { type: 'goto', x: thug.x + Math.cos(a) * 80, z: thug.z + Math.sin(a) * 80, speed: 5.4, radius: 2, t: 20 }; vic.setMode('flee', 6);
          }
        } else if (phase === 'fight') {
          if (!E.alive(thug)) {
            if (isPlayerSrc(thug.killedBy) || isPlayerSrc(thug.lastAttacker)) { money(200, 'Mugger stopped', 2); if (E.alive(vic)) { E.say(vic, 'Thank you so much!', 3); vic.setMode('walk'); } }
            phase = 'over'; E.pt = 0;
          } else if (Math.hypot(px - thug.x, pz - thug.z) > 60) { phase = 'over'; E.pt = 0; thug.setMode('walk'); }
        } else if (phase === 'robbed' || phase === 'over') { if (E.pt > 9) return true; }
        return false;
      };
      return E;
    }
  },

  // ------------------------------------------------------------------------------------------ drive-by shooting
  driveby: {
    weight: (c) => 1.0 + c.night * 1.2,
    make(W) {
      const sp = W.sideSpot(95, 165); if (!sp) return null;
      const e = sp.nr.edge; if (e.cls === CLS.FREEWAY) return null;
      const s0f = sp.nr.s, run = Math.max(s0f, e.len - s0f); const dir = s0f >= e.len - s0f ? 1 : -1;   // travel towards the victims from the longer side
      if (run < 55) return null;
      { const tS = dir > 0 ? s0f : e.len - s0f; const back = Math.min(run, 120); const nr2 = sp.nr; if (!laneClear(nr2, dir, 0, back, 9)) return null; }
      const gang = G.map.gangAt(sp.x, sp.z) > 1 ? G.map.gangAt(sp.x, sp.z) : 2 + ((Math.random() * 3) | 0);
      const E = new Ev('driveby', sp.x, sp.z, { label: 'Drive-by', color: '#ff3030', maxT: 80 });
      const vics = []; let car = null; const shooters = [];
      for (let i = 0; i < 2; i++) E.jobs.push(() => { const x = sp.x + sp.tx * i * 1.5, z = sp.z + sp.tz * i * 1.5; if (!W.spotOK(x, z)) return; const p = E.ped({ x, z, yaw: Math.random() * TAU }); p.life = { type: 'stand', state: i ? 'phone' : 'idle', t: 1e9, partner: null }; vics.push(p); });
      E.jobs.push(() => {
        const travelS = dir > 0 ? s0f : e.len - s0f;
        car = spawnDriven(sp.nr, 'lowrider', { owner: 'event', dir, lane: 0, s: Math.max(3, travelS - Math.min(run, 120)), role: 'gang', gang, color: GANG_COL[gang], noDespawn: true, speed: 13, speedFactor: 1.15, spacing: 7 });
        if (!car) { E.dead = true; return; }
        E.tagV(car); E.tag(car.driver); car.driver.name = 'Driver';
      });
      for (let i = 1; i <= 2; i++) E.jobs.push(() => { if (!car) return; const p = pedCar(E, car, 'gang', i, { gang, weapon: i === 1 ? 'smg' : 'pistol' }); p.name = 'Shooter'; p.skillAcc = 0.12; shooters.push(p); });
      let passed = false; E.pt = 0; E.rewarded = 0;
      E.step = (dt) => {
        if (E.dead) return true;
        if (!E.ready || !car) return false;
        if (!G.vehicles.list.includes(car)) { E.phase = 'carlost'; return true; }
        E.x = car.x; E.z = car.z; if (E.blip) { E.blip.x = E.x; E.blip.z = E.z; }
        const tgt = vics.find(p => E.alive(p));
        const d = tgt ? Math.hypot(car.x - tgt.x, car.z - tgt.z) : 1e9;
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        const ahead = tgt ? ((tgt.x - car.x) * fx + (tgt.z - car.z) * fz) : -1;
        for (const s of shooters) {
          if (!E.alive(s) || !s.vehicle) continue;
          if (tgt && d < 34 && ahead > -24 && !passed) { s.target = tgt; s.aggroT = 4; } else { if (s.target === tgt) { s.target = null; } if (s.aggroT < 5 && !s.hostile && s.mode !== 'attack') s.aggroT = 0; }
        }
        if (tgt && ahead < -26) passed = true;
        if (!tgt) passed = true;
        // reward for taking the gunmen out
        for (const s of shooters) if (!s.rewarded && s.dead && (isPlayerSrc(s.killedBy) || isPlayerSrc(s.lastAttacker))) { s.rewarded = true; E.rewarded++; money(120, 'Drive-by shooter down', 1); }
        E.phase = passed ? 'passed' : 'approach'; E.dd = Math.round(d);
        if (passed) { E.pt += dt; if (E.pt > 14 || d > 130) { return true; } }
        return false;
      };
      return E;
    }
  },

  // ------------------------------------------------------------------------------------------ runaway car chase
  chase: {
    weight: (c) => 2.0 + c.night * 0.5,
    make(W) {
      const nr = W.spot(); if (!nr || nr.edge.cls === CLS.FREEWAY) return null;
      const E = new Ev('chase', nr.x, nr.z, { label: 'Police chase', color: '#ff6a30', maxT: 105 });
      const dir = Math.random() < 0.5 ? 1 : -1; const dn = farNodeFrom(nr.x, nr.z, 380, 760); if (!dn || !laneClear(nr, dir, 0, 0, 10) || !laneClear(nr, dir, 0, 26, 8)) return null;
      let th = null, thief = null; const pcs = []; let phase = 'run'; E.pt = 0; let still = 0;
      E.jobs.push(() => {
        th = spawnDriven(nr, pick(['sports', 'muscle', 'coupe', 'sedan']), { owner: 'event', dir, lane: 0, noDespawn: true, speed: 15, mode: 'goto', ai: { dest: { x: dn.x, z: dn.z }, cruise: 34, stopDist: 14, ignoreLights: true, aggressive: true }, spacing: 8,
          app: G.models.peds.randomAppearance(Math.random, { role: 'civ' }) });
        if (!th) { E.dead = true; return; }
        E.tagV(th); thief = th.driver; thief.name = 'Thief'; E.tag(thief);
        thief.appearance && 0;
      });
      for (let i = 0; i < 2; i++) E.jobs.push(() => {
        if (!th) return;
        const pv = spawnDriven(nr, 'police', { owner: 'event', dir, lane: 0, s: th.ai.agent ? th.ai.agent.s - 24 - i * 20 : undefined, role: 'cop', noDespawn: true, mode: 'chase', ai: { target: th, aggressive: true, ignoreLights: true, stopDist: 8 }, speed: 18, spacing: 7 });
        if (!pv) return; pv.ai.pursuitSpeed = 36; E.tagV(pv); pv.driver.give('pistol', 60); pv.setSiren(true); pcs.push(pv);
      });
      E.step = (dt) => {
        if (E.dead) return true;
        if (!E.ready || !th) return false;
        if (!G.vehicles.list.includes(th)) return true;
        E.x = th.x; E.z = th.z; if (E.blip) { E.blip.x = E.x; E.blip.z = E.z; }
        if (phase === 'run') {
          if (th.totalSpeed < 1.8) still += dt; else still = Math.max(0, still - dt);
          const byPlayer = isPlayerSrc(th.lastHitBy);
          const wreck = th.wrecked || th.exploded || !E.alive(thief) || !thief.vehicle;
          const dPol = pcs.length ? Math.min(...pcs.map(p => Math.hypot(p.x - th.x, p.z - th.z))) : 99;
          if (wreck || still > 2.2 && (dPol < 18 || byPlayer) || (th.ai && th.ai.arrived)) {
            phase = 'caught'; E.pt = 0;
            if (byPlayer || isPlayerSrc(thief.lastAttacker) || isPlayerSrc(thief.killedBy)) money(250, 'Thief stopped', 1);
            if (th.ai) th.ai.setMode('idle'); th.input.handbrake = true;
            if (E.alive(thief) && thief.vehicle) { thief.exitVehicle(false); thief.life = { type: 'stand', state: 'cower', t: 14 }; E.say(thief, 'Okay, okay! Don\'t shoot!', 2.5); }
            for (const pv of pcs) if (G.vehicles.list.includes(pv) && pv.ai) { pv.ai.setMode('idle'); pv.input.handbrake = true; for (const p of pv.occupants()) { p.exitVehicle(false); p.noDespawn = true; p.life = { type: 'goto', x: th.x + rrange(-2, 2), z: th.z + rrange(-2, 2), speed: 3.4, radius: 2.4, t: 8, next: { type: 'stand', state: 'idle', face: { x: th.x, z: th.z }, t: 12 } }; } }
          }
        } else if (phase === 'caught') { E.pt += dt; if (E.pt > 13) return true; }
        return false;
      };
      return E;
    }
  },

  // ------------------------------------------------------------------------------------------ armoured truck
  armoured: {
    weight: (c) => 1.1 * c.day,
    make(W) {
      const nr = W.spot(); if (!nr || nr.edge.cls === CLS.FREEWAY) return null;
      const E = new Ev('armoured', nr.x, nr.z, { label: 'Armoured truck', color: '#ffd030', maxT: 100 });
      const e = nr.edge; const hx = nr.tx, hz = nr.tz, rx = hz, rz = -hx; const yaw = Math.atan2(hx, hz);
      let truck = null, guard = null, drv = null; let burst = false;
      E.jobs.push(() => {
        const x = nr.x + rx * (e.w / 2 - 1.6), z = nr.z + rz * (e.w / 2 - 1.6);
        truck = carAt(E, 'swatvan', x, z, yaw, { color: 0x4a5058 }); truck.name = 'Armoured truck'; truck.locked = true;
        drv = pedCar(E, truck, 'gang', 0, { gang: 0, weapon: 'pistol', look: 'civ' }); drv.name = 'Guard';
      });
      E.jobs.push(() => {
        if (!truck) return; const bx = truck.x - Math.sin(truck.yaw) * (truck.def.length / 2 + 1.0), bz = truck.z - Math.cos(truck.yaw) * (truck.def.length / 2 + 1.0);
        guard = E.ped({ x: bx, z: bz, yaw: truck.yaw + Math.PI, role: 'gang', gang: 0, weapon: 'pistol', look: 'civ', cash: 0, mod: (a) => { a.shirtType = 'jacket'; a.shirt = 0x2a3a52; a.pants = 0x1b2232; a.hat = 'cap'; a.hatColor = 0x1b2232; if (a.hairStyle === 'afro' || a.hairStyle === 'mohawk' || a.hairStyle === 'bun') a.hairStyle = 'short'; a.build = 'big'; } });
        guard.life = { type: 'stand', state: 'idle', yaw: truck.yaw + Math.PI, t: 1e9 }; guard.name = 'Guard';
      });
      let firstPick = true;
      const dropCash = () => {
        burst = true; const bx = truck.x - Math.sin(truck.yaw) * (truck.def.length / 2 + 1.2), bz = truck.z - Math.cos(truck.yaw) * (truck.def.length / 2 + 1.2);
        G.audio && G.audio.play('glass_break', { pos: truck, volume: 0.6 }); G.audio && G.audio.play('door_open', { pos: truck, volume: 0.8 });
        const n = 6 + ((Math.random() * 3) | 0);
        for (let i = 0; i < n; i++) { const a = Math.random() * TAU, r = rrange(0.8, 4.5); const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r; if (!W.spotOK(x, z, 0.3)) continue;
          G.pickups.spawn('cash', x, z, { amount: 80 + ((Math.random() * 6) | 0) * 40, life: 55, onCollect: () => { if (firstPick) { firstPick = false; if (G.police) G.police.raise(1, 'armoured robbery', 1); } } }); }
        G.hud.notify('The armoured truck burst open: cash everywhere!');
        for (const g of [guard, drv]) if (E.alive(g)) { g.aggroT = 40; g.target = G.player; if (g.vehicle) g.exitVehicle(false); endLife(g, null); g.setMode('attack', 45); g.hostile = true; }
      };
      E.step = (dt) => {
        if (!E.ready || !truck) return false;
        if (!G.vehicles.list.includes(truck)) return true;
        if (!burst && (truck.health < truck.maxHealth * 0.93 || truck.exploded || (E.alive(guard) && guard.health < guard.maxHealth) || (E.alive(drv) && drv.health < drv.maxHealth))) dropCash();
        if (!burst && E.t > 70 && E.alive(drv)) {   // nobody touched it: it drives off
          truck.locked = false; if (!truck.ai) { const ai = new DriverAI(truck, 'traffic', {}); ai.speedFactor = 1.0; } if (E.alive(guard)) { endLife(guard, null); guard.enterVehicle(truck, 1, false); } E.leaving = true; E.leaveT = E.t;
        }
        if (burst && E.t > 75) return true;
        if (E.leaving && E.t - E.leaveT > 28) return true;
        return false;
      };
      return E;
    }
  },

  // ------------------------------------------------------------------------------------------ street race
  race: {
    weight: (c) => 1.3 + c.night * 1.4,
    make(W) {
      const nr = W.spot(); if (!nr || nr.edge.cls === CLS.FREEWAY || nr.edge.len < 90) return null;
      const dn = farNodeFrom(nr.x, nr.z, 450, 800); if (!dn) return null;
      const E = new Ev('race', nr.x, nr.z, { label: 'Street race', color: '#ff40ff', maxT: 75 });
      const dir = Math.random() < 0.5 ? 1 : -1; if (!laneClear(nr, dir, 0, 0, 7) || !laneClear(nr, dir, 1, 0, 7) || !laneClear(nr, dir, 0, 6, 7)) return null;
      const cars = []; let started = false, winner = null; E.pt = 0;
      const lanes = G.nav.laneCount(nr.edge) > 1 ? [0, 1] : [0, 0];
      for (let i = 0; i < 2; i++) E.jobs.push(() => {
        const v = spawnDriven(nr, pick(['sports', 'muscle', 'coupe']), { owner: 'event', dir, lane: lanes[i], s: lanes[0] === lanes[1] && i === 1 ? (dir > 0 ? nr.s : nr.edge.len - nr.s) - 6 : undefined, noDespawn: true, mode: 'idle', spacing: 4, speed: 0, color: pick([0xe03030, 0x3060e0, 0xf0c020, 0x20c060, 0xff6a20, 0xe8e8ee]) });
        if (!v) return; v.vx = v.vz = 0; v.speed = 0; E.tagV(v); E.tag(v.driver); cars.push(v);
      });
      for (let i = 0; i < 2; i++) E.jobs.push(() => {
        const sideK = i ? 1 : -1; const x = nr.x + nr.tz * sideK * (nr.edge.w / 2 + 2.3) + nr.tx * 7, z = nr.z - nr.tx * sideK * (nr.edge.w / 2 + 2.3) + nr.tz * 7; if (!W.spotOK(x, z)) return;
        const p = E.ped({ x, z, yaw: Math.atan2(nr.x - x, nr.z - z) }); p.life = { type: 'stand', state: Math.random() < 0.5 ? 'dance' : 'idle', face: { x: nr.x, z: nr.z }, t: 1e9, gesture: true, say: ['Go go go!', 'Who\'s gonna win?!'] };
      });
      E.step = (dt) => {
        if (!E.ready || cars.length < 2) return false;
        for (const v of cars) if (!G.vehicles.list.includes(v)) return true;
        E.x = (cars[0].x + cars[1].x) / 2; E.z = (cars[0].z + cars[1].z) / 2; if (E.blip) { E.blip.x = E.x; E.blip.z = E.z; }
        if (!started) {
          E.pt += dt;
          for (const v of cars) { v.input.handbrake = true; v.input.throttle = 0; if (E.pt > 3 && Math.random() < dt * 4) G.fx.smokePuff(v.x - Math.sin(v.yaw) * 2.2, v.y + 0.3, v.z - Math.cos(v.yaw) * 2.2, 0.6, 0.8, 0.5); }
          if (E.pt > 6 && W.nearPlayer(E, 260) || E.pt > 14) {
            started = true; E.pt = 0; cars.forEach((v, i) => { v.ai.setMode('goto', { dest: { x: dn.x, z: dn.z }, cruise: 38 - i * 1.5, stopDist: 18, ignoreLights: true, aggressive: true }); v.ai.ignoreLights = true; v.ai.aggressive = true; v.ai.cruise = 38 - i; v.input.handbrake = false; G.audio && v.honk(); });
          }
        } else {
          E.pt += dt;
          for (const v of cars) if (!winner && (v.ai && v.ai.arrived || Math.hypot(v.x - dn.x, v.z - dn.z) < 26)) winner = v;
          if (winner || E.pt > 60) { for (const v of cars) if (v.ai) { v.ai.setMode('traffic'); v.ai.agent = null; v.ai.ignoreLights = false; v.ai.aggressive = false; v.ai.speedFactor = 1.0; } if (winner) winner.honk(); return true; }
        }
        return false;
      };
      return E;
    }
  },

  // ------------------------------------------------------------------------------------------ burning car + fire engine
  carfire: {
    weight: (c) => 1.8,
    make(W) {
      const nr = W.spot(); if (!nr || nr.edge.cls === CLS.FREEWAY) return null;
      if (!laneClear(nr, 1, 0, 0, 12) && !laneClear(nr, -1, 0, 0, 12)) return null;
      const E = new Ev('carfire', nr.x, nr.z, { label: 'Car fire', color: '#ff5020', maxT: 120 });
      let car = null, dr = null; E.extinguished = false; E.stage = 'burn'; let fire = null;
      E.dest = { x: nr.x - nr.tx * 9, z: nr.z - nr.tz * 9 };
      E.jobs.push(() => {
        car = spawnDriven(nr, pick(CIV_CARS), { owner: 'event', dir: laneClear(nr, 1, 0, 0, 12) ? 1 : -1, lane: 0, noDespawn: true, speed: 6, spacing: 8 }); if (!car) { E.dead = true; return; }
        E.tagV(car); dr = car.driver; E.tag(dr);
        car.ai.setMode('idle'); car.input.handbrake = true; car.vx *= 0.3; car.vz *= 0.3; car.health = 420; car.ignite(); car.fireT = 8;
      });
      E.jobs.push(() => { if (!car) return; dr.exitVehicle(false); dr.life = null; const a = Math.atan2(dr.x - car.x, dr.z - car.z); dr.life = { type: 'goto', x: dr.x + Math.sin(a) * 8, z: dr.z + Math.cos(a) * 8, speed: 3.6, radius: 1.5, t: 8, next: { type: 'stand', state: 'phone', face: { x: car.x, z: car.z }, t: 1e9, say: ['My car!', 'Fire! Somebody call the fire department!', 'Stay back!'] } }; E.say(dr, 'My car is on fire!', 3); });
      E.jobs.push(() => { G.ambient.addPOI({ x: nr.x, z: nr.z, r: 14, until: G.time + 75, kind: 'fire', key: car, max: 6 }); });
      let fd = null, hoseT = 0, sprayT = 0;
      E.later(16, () => { fd = responder(E, W, 'truck', 'fireman', 2, { color: 0xc41e1e, cruise: 24, stopDist: 11, rmin: 110, rmax: 190 }); E.fd = fd; });
      E.step = (dt) => {
        if (E.dead) return true;
        if (!E.ready || !car) return false;
        if (!G.vehicles.list.includes(car)) return true;
        E.x = car.x; E.z = car.z; if (E.blip) { E.blip.x = E.x; E.blip.z = E.z; }
        if (car.onFire && !car.wrecked && !E.extinguished && !car.lastHitBy) { car.fireT = Math.max(car.fireT, 3); car.health = Math.max(car.health, 150); }   // it keeps burning until the fire engine (or the player) deals with it
        // fire engine
        if (fd && fd.v) {
          const v = fd.v; if (!G.vehicles.list.includes(v)) { fd.state = 'none'; }
          else if (fd.state === 'drive') {
            if (v.ai && v.ai.blockedStopT > 2.5) { v.ai.blockedStopT = 0; v.ai.ignoreVehiclesT = 4; v.ghost = 4; }
            if (fd.info && arrivedAt(v, fd.info, fd.dest.x, fd.dest.z)) {
              fd.state = 'spray'; fd.t = 0; if (v.ai) v.ai.setMode('idle'); v.input.handbrake = true;
              for (const p of v.occupants()) { p.exitVehicle(false); p.noDespawn = true; const a = Math.random() * 1.2 - 0.6 + Math.atan2(v.x - car.x, v.z - car.z); p.life = { type: 'goto', x: car.x + Math.sin(a) * 6.5, z: car.z + Math.cos(a) * 6.5, speed: 3.2, radius: 1.2, t: 8, next: { type: 'stand', state: 'idle', face: { x: car.x, z: car.z }, t: 1e9, nozzle: true } }; }
            } else if (fd.t > 70) fd.state = 'none';
            fd.t += dt;
          } else if (fd.state === 'spray') {
            fd.t += dt; hoseT -= dt;
            for (const p of fd.peds) if (E.alive(p) && p.life && p.life.nozzle && hoseT <= 0) {
              const dx = car.x - p.x, dz = car.z - p.z, d = Math.hypot(dx, dz) || 1;
              for (let k = 0; k < 3; k++) G.fx.smoke.emit({ x: p.x + dx / d * 0.6, y: p.y + 1.25, z: p.z + dz / d * 0.6, vx: dx / d * (5.5 + Math.random()) + (Math.random() - 0.5) * 0.8, vy: 3.2 + Math.random(), vz: dz / d * (5.5 + Math.random()) + (Math.random() - 0.5) * 0.8, life: 0.9, s0: 0.22, s1: 0.4, c0: [0.75, 0.88, 1, 0.65], c1: [0.8, 0.9, 1, 0], grav: 7 });
            }
            if (hoseT <= 0) hoseT = 0.05;
            if (fd.t > 9 && !E.extinguished) {
              E.extinguished = true; car.onFire = false; if (car.wrecked) car.wreckT = Math.max(car.wreckT, 41); else { car.health = Math.max(car.health, 260); car.model.setBurnt && car.model.setBurnt(true); car.model.setDamage(0.9); }
              G.hud.notify('The fire has been put out');
            }
            if (fd.t > 26) {   // firemen pack up and leave
              fd.state = 'board'; fd.t = 0;
              for (const p of fd.peds) if (E.alive(p)) { p.life = null; p.setMode('walk'); p.enterVehicle(fd.v, p === fd.v.driver || !fd.v.driver || fd.peds.indexOf(p) === 0 ? 0 : 1, false); }
            }
          } else if (fd.state === 'board') {
            fd.t += dt; if ((fd.v.driver && fd.v.occupants().length >= 2) || fd.t > 16) { fd.state = 'left'; releaseLeave(E, fd); fd.v.setSiren(false); }
          }
        }
        // smouldering wreck
        if (E.extinguished) { sprayT -= dt; if (sprayT <= 0) { sprayT = 0.35; G.fx.smokePuff(car.x, car.y + 1.0, car.z, 1.1, 2, 0.15); } }
        const fdDone = !fd || fd.state === 'none' || fd.state === 'left';
        if (E.t > 60 && fdDone) return true;
        return false;
      };
      return E;
    }
  }
};

// emergency-service state machine (ambulance / police at an accident)
function serviceStep(E, R, dt, inj) {
  const v = R.v; R.t += dt;
  if (!G.vehicles.list.includes(v)) { R.state = 'none'; return; }
  if (R.state === 'drive') {
    if (v.ai && v.ai.blockedStopT > 2.5) { v.ai.blockedStopT = 0; v.ai.ignoreVehiclesT = 4; v.ghost = 4; }   // sirens: the traffic jam parts
    if (R.info && arrivedAt(v, R.info, R.dest.x, R.dest.z) || R.t > 80) {
      R.state = 'scene'; R.t = 0; if (v.ai) { v.ai.setMode('idle'); } v.input.handbrake = true;
      for (const p of v.occupants().slice()) { if (!E.alive(p)) continue; p.exitVehicle(false); p.noDespawn = true; }
      if (R.role === 'medic') {
        R.peds.filter(p => E.alive(p)).forEach((p, i) => { const pat = inj[i % Math.max(1, inj.length)]; if (!pat) return; p.life = { type: 'goto', x: pat.x + 0.9, z: pat.z + 0.2, speed: 3.4, radius: 1.1, t: 10, next: { type: 'stand', state: 'crouch', face: { x: pat.x, z: pat.z }, t: 1e9 } }; });
      } else {
        R.peds.filter(p => E.alive(p)).forEach((p, i) => { const a = i * 1.4 + 0.6; p.life = { type: 'goto', x: E.x + Math.cos(a) * 6.5, z: E.z + Math.sin(a) * 6.5, speed: 2.8, radius: 1.3, t: 9, next: { type: 'stand', state: i ? 'phone' : 'idle', face: { x: E.x, z: E.z }, t: 1e9, say: i ? null : ['Step back, please.', 'Move along, folks.', 'Is anyone else hurt?'] } }; });
      }
    }
  } else if (R.state === 'scene') {
    if (R.role === 'medic' && R.t > 18 && !R.loaded) {
      R.loaded = true; const door = { x: v.x - Math.cos(v.yaw) * (v.def.width / 2 + 0.9), z: v.z + Math.sin(v.yaw) * (v.def.width / 2 + 0.9) };
      for (const p of inj) if (E.alive(p)) { p.treated = true; p.downT = 0.01; p.health = Math.max(p.health, 50); p.life = { type: 'goto', x: door.x, z: door.z, speed: 1.6, radius: 1.0, t: 12, vanish: true }; }
      E.later(2.5, () => { for (const p of R.peds) if (E.alive(p)) { p.life = { type: 'goto', x: v.x + Math.cos(v.yaw) * (v.def.width / 2 + 0.8), z: v.z - Math.sin(v.yaw) * (v.def.width / 2 + 0.8), speed: 2.6, radius: 1.3, t: 9, onArrive: (q) => { q.life = null; } }; } });
    }
    const leaveAt = R.role === 'medic' ? 24 : 38;
    if (R.t > leaveAt) {
      R.state = 'board'; R.t = 0;
      R.peds.forEach((p, i) => { if (!E.alive(p)) return; endLife(p, null); p.setMode('walk'); p.enterVehicle(v, i === 0 ? 0 : 1, false); });
    }
  } else if (R.state === 'board') {
    if ((v.driver && v.occupants().length >= Math.min(2, R.peds.filter(p => E.alive(p)).length)) || R.t > 16) { R.state = 'left'; releaseLeave(E, R); v.setSiren(false); }
  }
}

// =========================================================================================================== manager
export class WorldEvents {
  constructor() {
    this.active = null; this.timer = rrange(70, 130); this.enabled = true; this.force = false; this.count = 0; this.history = []; this.cost = { sum: 0, n: 0, max: 0 };
    this.lastKind = null; this.blockedT = 0;
  }
  playerPos() { const pl = G.player; return pl.vehicle || pl; }
  nearPlayer(E, r) { const p = this.playerPos(); return dist2(E.x, E.z, p.x, p.z) < r * r; }
  hiddenFrom(x, z, r = 70) { const p = this.playerPos(); return dist2(x, z, p.x, p.z) > r * r && !G.population.visible(x, 0, z, 140); }
  spotOK(x, z, r = 0.6) { if (!G.map.inBounds(x, z, 25) || G.world.groundY(x, z) < 0.45) return false; const q = { x, z }; return !G.world.pushCircle(q, r); }
  // a road spot near the player, out of sight (or simply 60-110 m away when forced)
  spot() {
    const p = this.playerPos();
    for (let k = 0; k < 6; k++) {
      const nr = this.force ? G.population.pickRoadSpot(p.x, p.z, 55, 110, 14, 0) : G.population.pickRoadSpot(p.x, p.z, 105, 190, 14, 140);
      if (!nr || nr.edge.len < 45) continue; const zone = G.map.zoneAt(nr.x, nr.z); if (zone === ZONE.WILD || zone === ZONE.NONE || zone === ZONE.AIRPORT) continue;
      return nr;
    }
    return null;
  }
  sideSpot(rmin, rmax) { return G.ambient.sideSpot(this.force ? 50 : rmin, this.force ? 100 : rmax, this.force ? 0 : 130); }

  get eligible() {
    const g = G.game; if (!g || g.state !== 'play' || G.paused || g.inCutscene) return false;
    const pl = G.player; if (!pl || pl.dead) return false;
    if (G.missions && G.missions.active) return false;
    if (G.police.stars > 0 || (G.missionDensity ?? 1) < 0.9) return false;
    if (G.activities && G.activities.mode) return false;
    if (G.population && !G.population.enabled) return false;
    return true;
  }

  start(kind, force = false) {
    if (this.active) this.finish(this.active, 'replaced');
    this.force = force;
    let E = null;
    try { E = EVENTS[kind].make(this); } catch (e) { console.error('world event', kind, e); }
    this.force = false;
    if (!E) return null;
    this.active = E; this.count++; this.lastKind = kind; this.forced = force;
    E.blip = G.blips.add({ x: E.x, z: E.z, color: E.color, icon: 'square', label: E.label, priority: 1 });
    this.history.push(kind + '@' + Math.round(G.time));
    return E;
  }
  startRandom() {
    const pl = this.playerPos(); const night = G.sky ? G.sky.night : 0;
    const ctx = { night, day: 1 - night, hour: G.sky ? G.sky.hour : 12 };
    const names = Object.keys(EVENTS).filter(k => k !== this.lastKind);
    for (let tries = 0; tries < 3; tries++) {
      const ws = names.map(n => EVENTS[n].weight(ctx)); let tot = 0; for (const w of ws) tot += w; let r = Math.random() * tot, k = 0; for (; k < ws.length - 1; k++) { r -= ws[k]; if (r <= 0) break; }
      if (this.start(names[k])) return true;
    }
    return false;
  }
  abort() { if (this.active) this.finish(this.active, 'abort'); }

  update(dt) {
    if (!this.enabled) return;
    const t0 = performance.now();
    const E = this.active;
    if (E) {
      let done = false;
      try {
        if (!this.eligibleForActive()) { this.finish(E, 'abort'); return; }
        // build the scene one entity per step
        if (E.jobs.length) { const job = E.jobs.shift(); job(); if (!E.jobs.length) { E.ready = true; this.onReady(E); } }
        E.t += dt;
        for (let i = E.timers.length - 1; i >= 0; i--) if (E.t >= E.timers[i].t) { const f = E.timers[i].fn; E.timers.splice(i, 1); f(); }
        if (E.jobs.length === 0 && !E.ready) { E.ready = true; this.onReady(E); }
        done = E.step(dt);
        // the player is far away / we took too long
        const p = this.playerPos(); const d2 = dist2(E.x, E.z, p.x, p.z);
        if (!done && d2 > 260 * 260) { this.finish(E, 'far'); return; }
        if (!done && E.ready && !E.announced && d2 < 75 * 75) { E.announced = true; G.hud.notify(E.label + ' nearby', ''); }
        if (!done && E.t > E.maxT + 40) done = true;
        else if (!done && E.t > E.maxT && !G.population.visible(E.x, 0, E.z, 120) && d2 > 70 * 70) done = true;
      } catch (err) { console.error('world event step', E.kind, err); done = true; }
      if (done) this.finish(E, 'done');
    } else {
      if (this.eligible) { this.timer -= dt; if (this.timer <= 0) { this.timer = rrange(120, 240); if (!this.startRandom()) this.timer = 15; } }
    }
    const ms = performance.now() - t0; const c = this.cost; c.sum += ms; c.n++; if (ms > c.max) c.max = ms;
  }
  eligibleForActive() {
    const g = G.game; if (!g || g.state !== 'play') return false;
    if (G.player.dead) return false;
    if (G.missions && G.missions.active) return false;
    if (G.police.stars > 0 && this.active && !this.active.keepWanted) return false;
    return true;
  }
  onReady(E) { }

  finish(E, reason) {
    if (this.active !== E) return;
    this.active = null; this.history.push(E.kind + ':' + reason + '@' + E.t.toFixed(0));
    const p = this.playerPos(); const far = reason === 'far' || dist2(E.x, E.z, p.x, p.z) > 260 * 260 || reason === 'replaced';
    const wanted = G.police.stars > 0;
    for (const o of E.peds) this.releasePed(E, o, far);
    for (const v of E.vehs) this.releaseVeh(E, v, far, wanted);
    if (E.blip) G.blips.remove(E.blip);
    for (const o of E.objs) G.scene.remove(o);
    if (E.cleanup) E.cleanup();
    E.done = true;
  }
  releasePed(E, p, far) {
    if (!G.peds.list.includes(p)) return;
    p.evt = null;
    if (p.vehicle) { p.noDespawn = false; return; }
    if (far || (!p.dead && !G.population.visible(p.x, 0, p.z, 100) && dist2(p.x, p.z, G.player.x, G.player.z) > 55 * 55)) { G.peds.remove(p); return; }
    p.noDespawn = false;
    if (p.downT > 100) { p.downT = 0.01; }
    if (!p.dead) {
      if (p.life) endLife(p, null);
      if (p.mode === 'cower' && p.modeT > 1e6) p.setMode('walk');
      p.path = null; if (p.role === 'gang' && p.gang === 0 && !p.vehicle) { p.aggroT = Math.min(p.aggroT, 0); }
    }
  }
  releaseVeh(E, v, far, wanted) {
    if (!G.vehicles.list.includes(v)) return; v.evt = null;
    if (v.isPlayerDriven || v === G.lastPlayerVehicle) return;
    if (far && !v.mission) { if (!v.occupants().some(p => p.isPlayer)) G.vehicles.remove(v); return; }
    if (v.siren && !v.driver) v.setSiren(false);
    if (v.driver && v.ai) { const keepPolice = wanted && (v.type === 'police' || v.type === 'swatvan'); if (!keepPolice && v.siren) v.setSiren(false); if (v.ai.mode !== 'traffic') { v.ai.setMode('traffic'); v.ai.agent = null; } v.ai.ignoreLights = false; v.ai.aggressive = false; v.input.handbrake = false; v.owner = keepPolice ? 'police' : 'traffic'; v.amb = true; }
    else if (v.driver && !v.ai) { v.owner = 'traffic'; v.amb = true; }
    else { v.owner = v.wrecked ? 'parked' : 'parked'; v.siren && v.setSiren(false); }
    v.noAI = false;
  }
}
