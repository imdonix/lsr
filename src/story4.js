// LOS SANTOS RISING - Chapter II: "THE HOLLOW CROWN" (story missions 15-24).
// A continuation of the main story: with Calloway and Harlan gone, the money behind them
// surfaces - the Halcyon Group and its owner, Vivian Wexler. Each mission is built around a
// gameplay idea the base story did not use: civilian defence, a checkpoint advance, stealth and
// alarms, an amphibious retrieval, an anti-air stand-off, convoy interception, a tail chain,
// a multi-stage heist, a timed territory run and a helicopter finale.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, dist2, pick, TAU, sleep } from './util.js';
import { GANG } from './mapdata.js';
import { L, D, doorOf, laneSpot, kerbSpot, walkSpot, aroundSpots, gy, look, shot, twoShot, lookAt, spawnGang, hostileCar, besideDoor, squad, ally } from './storylib.js';
import { DriverAI } from './driverai.js';

const homeWhere = (side) => () => besideDoor('home', side, 1.5);
const FAIL = (reason) => Object.assign(new Error('fail'), { isFail: true, reason });

// Halcyon Group private security: suited operatives with serious hardware.
function suits(r, cx, cz, n, o = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = walkSpot(cx, cz, o.rmin ?? 3, o.rmax ?? 14);
    const p = r.ped({ x: s.x, z: s.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), weapon: pick(o.weapons || ['smg', 'ak47', 'shotgun', 'pistol']), ammo: 999, health: o.health ?? 110, blip: o.blip ? { color: '#ff3030' } : false, skill: o.skill ?? 0.38 });
    p.sightRange = o.sightRange ?? 50; p.guard = o.guard ?? true; p.home = { x: s.x, z: s.z }; p.mode = 'loiter'; p.canDrop = true; p.gang = 0;
    out.push(p);
  }
  return out;
}
// A patrolling guard that does not yet know the player is there: used by the stealth mission.
// It is a plain 'script' ped (so it never auto-aggros) and the mission drives its facing + the
// detection meter itself, then flips the guard to a real enemy when the alarm goes up.
function watchGuard(r, x, z, o = {}) {
  const g = r.ped({ x, z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), name: o.name || 'Guard', weapon: o.weapon || 'smg', ammo: 999, health: o.health ?? 100 });
  g.hostile = false; g.gang = 0; g.sightRange = 0; g.guard = true; g.canDrop = true;
  g.script = { type: 'stand' }; g.mode = 'loiter';
  g._face = o.face ?? Math.random() * TAU; g._seed = Math.random() * TAU; g._sweep = o.sweep ?? 0.6; g._patrol = o.patrol ?? 0.3;
  return g;
}
// can `a` see `b`? distance + a wide facing cone + clear line of sight.
function canSee(a, b, maxD = 28, fov = 2.3) {
  if (!a || !b || a.dead) return false;
  const dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz);
  if (d > maxD) return false;
  if (d < 6) return true;
  const face = (a.faceOverride != null ? a.faceOverride : a.yaw) || 0;
  const dot = (dx / d) * Math.sin(face) + (dz / d) * Math.cos(face);
  if (dot < Math.cos(fov / 2)) return false;
  const ay = gy(a.x, a.z) + 1.6, by = gy(b.x, b.z) + 1.6;
  return !G.world.raycast(a.x, a.z, b.x, b.z, ay, by);
}

// find a point of genuinely deep water for the amphibious mission
function deepWater(cx, cz, rmin = 20, rmax = 90) {
  for (let i = 0; i < 400; i++) {
    const a = Math.random() * TAU, r = rmin + Math.random() * (rmax - rmin);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (G.world.groundY(x, z) < -2) return { x, z };
  }
  return { x: cx, z: cz };
}

// A scripted enemy helicopter: the player cannot fly the engine's helis, so the mission moves one
// itself (patrol / hover / flee) and fires its door gun straight from the combat system.
function pilotHeli(r, v, o = {}) {
  let t = 0, shootT = 0;
  r.tick(dt => {
    if (v.exploded) return;
    t += dt;
    let tx, tz;
    if (o.fleeFrom) {
      const f = typeof o.fleeFrom === 'function' ? o.fleeFrom() : o.fleeFrom;
      const dx = v.x - f.x, dz = v.z - f.z, d = Math.hypot(dx, dz) || 1;
      tx = v.x + dx / d * 36; tz = v.z + dz / d * 36;
    } else if (o.to) {
      tx = o.to.x + Math.cos(t * 0.4) * (o.orbit || 0); tz = o.to.z + Math.sin(t * 0.4) * (o.orbit || 0);
    } else { tx = v.x; tz = v.z; }
    const sp = o.speed ?? 14;
    const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz) || 1;
    const want = Math.min(sp, d * 1.2);
    v.vx = dx / d * want; v.vz = dz / d * want;
    v.x += v.vx * dt; v.z += v.vz * dt;
    const wantY = (o.height ?? 40) + (o.rise ?? 0) * t;
    v.y += (wantY - v.y) * Math.min(1, dt * (o.climb ?? 1.4));
    v.yaw = Math.atan2(dx, dz); v.pitch = 0; v.roll = 0;
    if (o.target && o.shoot !== false) {
      shootT -= dt;
      if (shootT <= 0) {
        shootT = o.fireRate ?? 0.2;
        const q = o.target;
        let ddx = q.x - v.x, ddy = (q.y + 1) - (v.y - 2), ddz = q.z - v.z;
        const l = Math.hypot(ddx, ddy, ddz) || 1;
        G.combat.fire({ isHeli: true }, o.weapon || 'smg', v.x, v.y - 2, v.z, ddx / l, ddy / l, ddz / l, { dmgMul: o.dmgMul ?? 0.35, spreadMul: 1.3 });
      }
    }
  });
}

// Spawn a parked surveillance target near a district. It is `ahead` metres down the lane so it
// never lands on top of the player's car. Called before the cutscene so the camera can film it.
function spawnTailTarget(r, from, name, o = {}) {
  const fn = G.map.nearestRoad(from.x, from.z, 300); const fp = fn ? { x: fn.x, z: fn.z } : from;
  const sp = laneSpot(fp, 1, 240);
  const ahead = o.ahead || 0;
  const x = sp.x + Math.sin(sp.yaw) * ahead, z = sp.z + Math.cos(sp.yaw) * ahead;
  const car = r.car(o.type || 'coupe', x, z, sp.yaw, { color: o.color ?? 0x26262e }); car.name = name;
  const drv = r.ped({ x, z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), name, health: 150 });
  drv.enterVehicle(car, 0, true);
  const b = r.blip({ entity: car, color: '#ff5090', label: name, flash: true, priority: 5 }); car.blipObj = b;
  return { car, drv, sp, b };
}

// One leg of the surveillance network: the target pulls away and drives to `to` while the player
// keeps it in a comfortable band (16-140 m). A short grace at the start lets the player react.
async function tailSegment(r, from, to, name, o = {}) {
  const pl = G.player;
  const tgt = o.target || spawnTailTarget(r, from, name, o);
  const tn = G.map.nearestRoad(to.x, to.z, 300); const tp = tn ? { x: tn.x, z: tn.z } : to;
  const ai = new DriverAI(tgt.car, 'idle', {});
  let started = false, waitT = o.waitT ?? 0;
  // the target has somewhere to be: it runs the lights and drives a little quicker than traffic
  const startAi = () => { if (started) return; started = true; ai.setMode('goto', { dest: { x: tp.x, z: tp.z }, cruise: o.cruise ?? 20, stopDist: 14, ignoreLights: true, speedFactor: 1.05 }); };
  ai.ignoreLights = true; ai.speedFactor = 1.05;
  if (waitT <= 0) startAi();
  let done = false, lost = 0, close = 0;
  const tw = { fn: () => tgt.drv.dead || tgt.car.wrecked, reason: name + ' was taken out.' };
  r.watchers.push(tw);
  r.tick(dt => {
    if (done) return;
    if (!started) {
      waitT -= dt; G.hud.counter(`Keeping an eye on ${name}…`);
      if (waitT <= 0) startAi();
      return;
    }
    const pv = pl.vehicle || pl; const d = Math.hypot(pv.x - tgt.car.x, pv.z - tgt.car.z);
    G.hud.counter(`Tailing ${name} — ${Math.round(d)} m (keep 16–140)`);
    if (d > 140) lost += dt; else lost = Math.max(0, lost - dt * 2);
    if (d < 11 && tgt.car.totalSpeed > 3) close += dt; else close = Math.max(0, close - dt);
    if (lost > 10) r.abortAll(FAIL('You lost ' + name + '.'));
    if (close > 5) r.abortAll(FAIL(name + ' made you.'));
    if (ai.arrived || (tgt.car.totalSpeed < 0.6 && dist2(tgt.car.x, tgt.car.z, tp.x, tp.z) < 45 * 45)) done = true;
  });
  await r.wait(() => done);
  r.watchers = r.watchers.filter(w => w !== tw);
  r.removeBlip(tgt.b); tgt.car.blipObj = null; ai.setMode('idle'); G.hud.counter(null);
  return { car: tgt.car, drv: tgt.drv };
}

// ---- small scripted props for the bank heist (removed with the mission)
function mMat(color, emissive) { return new THREE.MeshLambertMaterial({ color, emissive: emissive || 0x000000 }); }
function makeBreakerBox() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.35, 0.42), mMat(0x3c434c)); body.position.y = 0.68; g.add(body);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.95, 0.05), mMat(0x555c66)); panel.position.set(0, 0.72, 0.24); g.add(panel);
  const hazard = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.14, 0.06), mMat(0xe6c220)); hazard.position.set(0, 1.2, 0.25); g.add(hazard);
  const pilot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3b2f })); pilot.position.set(0.27, 0.95, 0.26); g.add(pilot);
  g.userData.pilot = pilot; g.userData.own = true; return g;
}
function makeKeycard() {
  const g = new THREE.Group();
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.22), mMat(0xe8e8ea)); card.position.y = 0.02; g.add(card);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.006, 0.05), mMat(0x20242c)); stripe.position.set(0, 0.034, -0.05); g.add(stripe);
  g.userData.own = true; return g;
}
function makeDrill() {
  const g = new THREE.Group();
  const cart = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 2.0), mMat(0x5a6068)); cart.position.y = 0.4; g.add(cart);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.15, 0.5), mMat(0x44484e)); leg.position.set(0, 1.05, -0.55); g.add(leg);
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.9), mMat(0x2a5ab8)); motor.position.set(0, 1.35, -0.35); g.add(motor);
  const bit = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.7, 8), mMat(0xa8b0b8)); shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.85; bit.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), mMat(0xd0d6dc)); tip.rotation.x = Math.PI / 2; tip.position.z = 1.85; bit.add(tip);
  bit.position.set(0, 1.05, 0.35); g.add(bit);
  g.userData.bit = bit; g.userData.own = true; return g;
}
function makeVaultDoor() {
  const pivot = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 4.4, 0.45), mMat(0x656b73)); slab.position.set(1.8, 2.2, 0); pivot.add(slab);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.1, 8, 18), mMat(0x9aa0a8)); wheel.position.set(1.8, 2.2, 0.3); pivot.add(wheel);
  for (let i = 0; i < 3; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.09), mMat(0x9aa0a8)); sp.position.set(1.8, 2.2, 0.3); sp.rotation.z = i * Math.PI / 3; pivot.add(sp); }
  const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.24), mMat(0x8a9098)); bolt.position.set(3.3, 2.2, 0.25); pivot.add(bolt);
  pivot.userData.own = true; return pivot;
}
function makeBuoy() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.1, 10), mMat(0xd23a2a)); body.position.y = 0.5; g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.22, 10), mMat(0xf0f0f0)); band.position.y = 0.9; g.add(band);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), mMat(0x8a9098)); pole.position.y = 2.2; g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.04), mMat(0xffb020)); flag.position.set(0.4, 3.1, 0); g.add(flag);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), new THREE.MeshBasicMaterial({ color: 0xffd040 })); lamp.position.y = 3.5; g.add(lamp);
  g.userData.lamp = lamp; g.userData.own = true; return g;
}
function makeWreck() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 5.0), mMat(0x2a3038)); hull.position.y = -0.3; hull.rotation.z = 0.26; g.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.8), mMat(0x3a424c)); cabin.position.set(0.2, 0.25, -1.2); cabin.rotation.z = 0.26; g.add(cabin);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), mMat(0x6a7078)); mast.position.set(0.5, 1.2, -0.6); mast.rotation.z = 0.26; g.add(mast);
  g.userData.own = true; return g;
}
function makeWaterCase() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.2), mMat(0xd8b020)); g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.22), mMat(0xc8a020)); lid.position.y = 0.22; g.add(lid);
  g.userData.own = true; return g;
}
function makeLedgerCase() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.24), mMat(0x3a2a1a)); g.add(body);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.1, 0.26), mMat(0xc8a020)); band.position.y = 0.05; g.add(band);
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.07), mMat(0x1a1a1a)); clip.position.y = 0.28; g.add(clip);
  g.userData.own = true; return g;
}

export const STORY4 = [
  // ============================================================================================ 15
  {
    id: 'm15', title: 'Aftermath', needs: ['m14'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 5000, respect: 8, density: 0.3,
    where: homeWhere(4.5),
    async run(r) {
      const ray = r.giver, pl = G.player; const home = doorOf('home');
      const hfx = Math.sin(home.yaw), hfz = Math.cos(home.yaw), hrx = Math.cos(home.yaw), hrz = -Math.sin(home.yaw);
      G.sky.hour = 18.4; G.sky.setWeather('smog'); G.sky.lockWeather = true;
      const nia = r.ped({ x: home.x + 2.6, z: home.z + 1.4, role: 'script', appearance: look('nia'), name: 'Nia', health: 140 });
      const tee = r.ped({ x: home.x + 1.1, z: home.z + 2.6, role: 'script', appearance: look('tee'), name: 'Tee', health: 140 });
      const cody = r.ped({ x: home.x + 3.8, z: home.z + 0.2, role: 'script', appearance: look('cody'), name: 'Cody', weapon: 'pistol', health: 200 });
      for (const p of [nia, tee, cody]) if (p.script) p.script = { type: 'stand' };
      lookAt(ray, pl); lookAt(nia, ray); lookAt(tee, ray); lookAt(cody, ray);
      const saveIcon = G.places && G.places.shops && (G.places.shops.find(s => s.id === 'home') || {}).iconGroup;
      if (saveIcon) { saveIcon.visible = false; r.onCleanup(() => { saveIcon.visible = true; }); }
      const mx = (ray.x + nia.x) / 2, mz = (ray.z + nia.z) / 2;
      await r.cutscene([
        shot({ x: home.x + hfx * 17 + hrx * 5, z: home.z + hfz * 17 + hrz * 5, h: 5 }, { x: home.x + hfx * 3, z: home.z + hfz * 3, h: 1.8 }, 13, { to: { x: home.x + hfx * 12 + hrx * 8, z: home.z + hfz * 12 + hrz * 8, h: 3 }, fov: 46 }),
        shot({ x: mx + 0.8, z: mz + 7.5, h: 2.2 }, { x: mx, z: mz, h: 1.4 }, 14, { fov: 42, to: { x: mx - 0.6, z: mz + 6.0, h: 2.0 } })
      ], [
        ['Ray', "Marcus is in the ground. We gave him the send-off he earned.", 4.6],
        ['Jay', "Then it isn't over. Somebody paid Calloway. Somebody bigger.", 4.8],
        ['Tee', "Hollow Kings was a shell. The money behind it came from a holding company: the Halcyon Group. Vivian Wexler.", 6.4],
        ['Nia', "She owns half this city on paper and the rest through men like Calloway.", 5],
        ['Ray', "She'll want her money back. And she'll want the evidence gone. We're both problems now.", 5.2]
      ], { fadeIn: false });
      if (saveIcon) saveIcon.visible = true;
      // get the family inside
      nia.invincible = true; tee.invincible = true;
      nia.script = { type: 'goto', x: home.x, z: home.z, radius: 2.2, speed: 4.8 };
      tee.script = { type: 'goto', x: home.x - 1.4, z: home.z, radius: 2.2, speed: 4.8 };
      cody.role = 'ally'; cody.followPlayer = true; cody.skillAcc = 0.6; cody.brave = true; cody.canDrop = false; cody.script = null;
      r.supply({ ammo: { pistol: 90, smg: 180, ak47: 120 }, equip: pl.hasGun() ? undefined : 'pistol', hp: 100, armor: 60 });
      r.cache(home.x + 5, home.z + 4, { health: 1, armor: 1, r: 6 });
      r.speak('Cody', "Cars! Coming up the street — get them inside!", 3.2);
      const wave1 = suits(r, home.x, home.z, 5, { rmin: 34, rmax: 52, weapons: ['pistol', 'smg', 'pistol', 'ak47', 'smg'], sightRange: 80, health: 95 });
      for (const p of wave1) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
      await r.killAll(wave1, { text: "Drive off Wexler's <b>hit squad</b>", label: 'Hitmen' });
      // reinforcements in cars
      r.speak('Ray', 'More of them — two cars!', 2.8);
      const a = laneSpot({ x: home.x + 150, z: home.z + 50 }, 1, 240);
      const b = laneSpot({ x: home.x - 140, z: home.z - 60 }, 1, 240);
      const cars = [hostileCar(r, 'suv', a.x, a.z, a.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 26, blip: true, color: 0x101018, health: 80 }),
                    hostileCar(r, 'suv', b.x, b.z, b.yaw, { n: 2, gang: 0, weapon: 'pistol', speed: 26, blip: true, color: 0x101018, health: 80 })];
      await r.killAll(cars.flatMap(c => c.peds), { text: 'Stop the <b>reinforcements</b>', label: 'Halcyon' });
      // the lieutenant runs: chase him for the phone
      r.speak('Tee', "One got clear! Follow him — he'll lead us to Wexler!", 3.4);
      const ls = laneSpot({ x: home.x + 80, z: home.z - 40 }, 1, 240);
      const lcar = r.car('suv', ls.x, ls.z, ls.yaw, { color: 0x0a0a10 }); lcar.health = lcar.maxHealth = 900; lcar.name = 'Halcyon SUV';
      const lt = r.ped({ x: ls.x, z: ls.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), name: 'Halcyon lieutenant', weapon: 'smg', ammo: 999, health: 130 });
      lt.enterVehicle(lcar, 0, true);
      const dest = doorOf('ls_warehouse') || home;
      const lai = new DriverAI(lcar, 'goto', { dest: { x: dest.x, z: dest.z }, cruise: 30, aggressive: true, ignoreLights: true, stopDist: 15 });
      const lb = r.blip({ entity: lcar, color: '#ff3030', label: 'Lieutenant', flash: true, priority: 5 }); lcar.blipObj = lb;
      r.objective('Chase the <b>lieutenant</b> and take him out');
      let bailed = false;
      r.tick(dt => {
        if (!bailed && (lcar.health < lcar.maxHealth * 0.55 || lcar.wrecked)) {
          bailed = true; lai.setMode('idle'); lcar.input.handbrake = true;
          lt.exitVehicle(false); lb.entity = lt; lcar.blipObj = null; lt.blipObj = lb; lt.role = 'enemy'; lt.hostile = true; lt.target = pl; lt.setMode('attack', 90); lt.aggroT = 90; lt.sightRange = 90;
        }
        const d = Math.hypot(lcar.x - (pl.vehicle || pl).x, lcar.z - (pl.vehicle || pl).z);
        r._ld = (d > 430 && !lt.dead && !bailed ? (r._ld || 0) + dt : 0); if (r._ld > 14) r.abortAll(FAIL('The lieutenant got away.'));
      });
      await r.wait(() => lt.dead);
      r.removeBlip(lb);
      const px = lt.x, pz = lt.z;
      await new Promise(res => { r.pickupItem('tag', px, pz, { radius: 2.4, onCollect: () => res(true) }, { color: '#ff4fe0', label: 'Phone', flash: true, priority: 5 }); r.objective("Grab the lieutenant's <b>phone</b>"); });
      await r.dialogue([
        ['Tee', "His last calls all go to one number. A fixer. The account name: Marsh — Wexler's head of security.", 5.8],
        ['Ray', "Then Marsh is the door to Wexler. Rest up. Tomorrow we start pulling it open.", 5]
      ]);
      r.reward(5000, 8);
    }
  },
  // ============================================================================================ 16
  {
    id: 'm16', title: 'The Source', needs: ['m15'], giver: 'tee', letter: 'T', color: 0xff5090, reward: 6000, respect: 8, density: 0.4,
    where: () => besideDoor('label', 6, 4) || besideDoor('club', 6, 4),
    async run(r) {
      const tee = r.giver, pl = G.player; const hq = doorOf('label') || doorOf('bank') || doorOf('home'); const home = doorOf('home');
      const fx = Math.sin(hq.yaw), fz = Math.cos(hq.yaw);
      await r.cutscene([
        twoShot(tee, pl, 13.6, { dist: 4, side: 1, drift: 0.4 })
      ], [
        ['Tee', "Halcyon has an accountant named Ellis. Eight years of ledgers, every account Wexler ever touched.", 5.8],
        ['Tee', "He called me an hour ago, then security sealed the building. He's still inside.", 5],
        ['Jay', "I'll go get him. Keep your phone on.", 2.6]
      ], { fadeIn: false });
      r.supply({ ammo: { ak47: 160, smg: 180, pistol: 80 }, equip: 'ak47', hp: 100, armor: 60 });
      const ks = kerbSpot({ x: tee.x, z: tee.z }, 1, 100);
      const car = r.car('muscle', ks.x, ks.z, ks.yaw, { color: 0x1a1a24 }); car.name = 'Stinger';
      await r.enterVehicle(car, { text: 'Get in the <b>Stinger</b> (F)', label: 'Car' });
      // checkpoint 1: the street perimeter (keep it car-reachable, on the kerb)
      const c1 = kerbSpot({ x: hq.x + fx * 34, z: hq.z + fz * 34 }, 1, 160);
      await r.goto(c1, { mode: 'any', radius: 10, text: 'Reach the <b>Halcyon building</b>', label: 'Halcyon', blipColor: '#9a4fd0', color: 0x9a4fd0, arrow: false });
      r.speak('Tee', 'Outer guards. Clear a path!', 3);
      const g1 = suits(r, c1.x, c1.z, 4, { rmin: 4, rmax: 16, weapons: ['smg', 'pistol', 'pistol', 'ak47'], sightRange: 60 });
      for (const p of g1) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
      await r.killAll(g1, { text: 'Clear the <b>outer guards</b>', label: 'Security' });
      // checkpoint 2: the lobby doors
      await r.goto({ x: hq.x, z: hq.z }, { mode: 'any', radius: 12, text: 'Advance to the <b>lobby doors</b>', label: 'Lobby', blipColor: '#9a4fd0', color: 0x9a4fd0, arrow: false });
      const g2 = suits(r, hq.x, hq.z, 4, { rmin: 3, rmax: 12, weapons: ['ak47', 'shotgun', 'smg', 'pistol'], sightRange: 70 });
      for (const p of g2) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
      r.cache(hq.x + fx * 8, hq.z + fz * 8, { health: 2, armor: 1, r: 6 });
      await r.killAll(g2, { text: 'Fight into the <b>lobby</b>', label: 'Security' });
      // Ellis
      const es = besideDoor('label', 0, 3) || { x: hq.x, z: hq.z };
      const ellis = r.ped({ x: es.x, z: es.z, role: 'script', appearance: look('ellis'), name: 'Ellis', health: 160 });
      ellis.invincible = true; ellis.script = { type: 'stand', look: pl };
      await r.sleep(0.3);
      await r.dialogue([
        ['Ellis', "You're the Mercer kid? Thank god. Eight years of Halcyon ledgers, right here on this drive.", 5.4],
        ['Jay', "Then let's get you out. Stay behind me.", 2.6]
      ]);
      ellis.role = 'ally'; ellis.followPlayer = true; ellis.brave = false; ellis.skillAcc = 0.2; ellis.script = null; ellis.give('pistol', 30, false);
      squad(r, [ellis]); r.keepAlive(ellis, 'Ellis');
      // Never release the escort as an invincible civilian riding in the player's car.
      r.onCleanup(() => { if (ellis.vehicle) ellis.exitVehicle(false); ellis.invincible = false; });
      // escape under fire
      G.police.setStars(2);
      const e1 = laneSpot({ x: hq.x + 90, z: hq.z + 50 }, 1, 240);
      const e2 = laneSpot({ x: hq.x - 90, z: hq.z - 40 }, 1, 240);
      const escorts = [
        hostileCar(r, 'suv', e1.x, e1.z, e1.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 28, blip: true, color: 0x101018, health: 80, noBail: true }),
        hostileCar(r, 'suv', e2.x, e2.z, e2.yaw, { n: 2, gang: 0, weapon: 'pistol', speed: 28, blip: true, color: 0x101018, health: 80, noBail: true })
      ];
      r.speak('Tee', "Company's coming. Get Ellis to Grove Street!", 3.2);
      await r.goto(home, { mode: 'vehicle', radius: 8, text: 'Get Ellis to <b>Grove Street</b> in a car', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.loseWanted('Lose the <b>cops</b>');
      // The chase is over once the heat drops: stand the Halcyon cars down before the
      // epilogue so leftover gunfire cannot fail a mission whose objectives are complete.
      for (const e of escorts) {
        if (e.v.ai) e.v.ai.setMode('idle');
        e.v.input.handbrake = true;
        if (e.v.blipObj) { r.removeBlip(e.v.blipObj); e.v.blipObj = null; }
        for (const p of e.peds) {
          if (p.dead) continue;
          p.hostile = false; p.aggroT = 0; p.target = null; p.sightRange = 0; p.aiming = false;
          p.setMode('loiter');
        }
      }
      await r.dialogue([
        ['Ellis', "Wexler keeps a private impound in Rodeo. Cars, art, and a wall of evidence she buys from dirty cops.", 5.8],
        ['Tee', "Then that's where the black ledger is. Birdie can get us inside.", 4.2]
      ]);
      car.mission = false; car.owner = 'player';
      r.reward(6000, 8);
    }
  },
  // ============================================================================================ 17
  {
    id: 'm17', title: 'Ghost Protocol', needs: ['m16'], giver: 'birdie', letter: 'B', color: 0x40ffd0, reward: 6500, respect: 8, density: 0.2,
    where: () => besideDoor('garage_harlan', 4, 4) || besideDoor('ammu_a', 3, 3),
    async run(r) {
      const birdie = r.giver, pl = G.player; const lot = doorOf('dealer') || doorOf('pns_a') || doorOf('home'); const home = doorOf('home');
      G.sky.hour = 1.4; G.sky.setWeather('clear'); G.sky.lockWeather = true;
      await r.cutscene([
        twoShot(birdie, pl, 17.6, { dist: 3.8, side: -1, drift: 0.35 })
      ], [
        ['Birdie', "Ellis gave me the layout of Wexler's impound. Cameras, dogs, the lot. I can blind the cameras from here.", 6],
        ['Birdie', "What I can't blind is eyes. Six guards walk that yard. If one sees you and sounds the alarm, the whole place wakes up.", 6.4],
        ['Birdie', "Take the knife. Quiet is the whole game. The black ledger's in the office.", 5]
      ], { fadeIn: false });
      r.give('knife', 0, true); r.give('bat', 0, false);
      r.supply({ ammo: { pistol: 40 }, hp: 100, armor: 40 });
      G.hud.notify('Detection fills while guards can see you. Melee is silent.');
      // the yard
      const spots = aroundSpots(lot.x, lot.z, 6, 8, 24);
      const guards = [];
      for (let i = 0; i < 6; i++) { const s = spots[i] || walkSpot(lot.x, lot.z, 8, 22); guards.push(watchGuard(r, s.x, s.z, { face: Math.random() * TAU, sweep: 0.7, patrol: 0.25, name: 'Halcyon guard', health: 95 })); }
      const ledgers = aroundSpots(lot.x, lot.z, 2, 4, 12);
      let alarm = false, detect = 0, done = false;
      r.tick(dt => {
        if (alarm || done) return;
        let seeing = false;
        for (const g of guards) { if (g.dead) continue; g.faceOverride = (g._face || 0) + Math.sin(G.time * 0.35 + (g._seed || 0)) * (g._patrol ? 0.9 : 0.5); if (canSee(g, pl, 26, 2.3)) seeing = true; }
        detect = clamp(detect + (seeing ? dt * 0.85 : -dt * 0.7), 0, 1);
        G.hud.progress('Detection', detect);
        if (detect >= 1) {
          alarm = true; G.hud.progress('', null); G.audio.play('wanted_up'); G.hud.notify('ALARM! The yard is awake!'); G.police.setStars(1);
          for (const g of guards) if (!g.dead) { g.hostile = true; g.role = 'enemy'; g.sightRange = 70; g.target = pl; g.setMode('attack', 999); g.aggroT = 999; }
          const wave = suits(r, lot.x, lot.z, 4, { rmin: 12, rmax: 28, weapons: ['smg', 'pistol', 'ak47', 'pistol'], sightRange: 70, health: 100 });
          for (const p of wave) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; guards.push(p); }
        }
      });
      // two ledgers to lift
      for (let i = 0; i < ledgers.length; i++) {
        const s = ledgers[i];
        await r.goto(s, { mode: 'foot', radius: 2.6, text: `Grab the <b>ledger</b> (${i + 1}/2)`, label: 'Ledger', color: 0x40ffd0, blipColor: '#40ffd0' });
        G.audio.play('pickup'); G.hud.notify(`Ledger ${i + 1}/2 secured`);
        await r.sleep(0.4);
      }
      done = true; G.hud.progress('', null);
      r.speak('Birdie', "That's both. Now get out before they box you in!", 3.2);
      if (!alarm) await r.sleep(1.2);
      const gs = kerbSpot({ x: lot.x, z: lot.z }, 1, 60);
      const get = r.car('sedan', gs.x, gs.z, gs.yaw, { color: 0x2a2a34 }); get.name = 'Getaway'; get.locked = false;
      // The escape objective used to be replaced in the same frame it was set, so the getaway car
      // was just a flashing blip with no role. Make getting in it a real, visible step.
      await r.enterVehicle(get, { text: 'Escape in the <b>getaway car</b> (F)', label: 'Getaway car' });
      await r.goto(home, { mode: 'vehicle', radius: 8, text: 'Bring the ledgers to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      if (G.police.stars > 0) await r.loseWanted('Lose the <b>alarm response</b>');
      await r.dialogue([
        ['Birdie', "Two more pieces of the picture. Wexler's fingerprints on every page.", 4.6],
        ['Birdie', "But the originals are still out there. On the water, if my intercepts are right.", 4.6]
      ]);
      r.reward(6500, 8);
    }
  },
  // ============================================================================================ 18
  {
    id: 'm18', title: 'Low Tide', needs: ['m17'], giver: 'hollis', letter: 'H', color: 0x39c4d8, reward: 7000, respect: 8, density: 0.5,
    where: () => besideDoor('pier_shop', 2, 4) || besideDoor('pier_shop', -2, 4),
    async run(r) {
      const hollis = r.giver, pl = G.player; const shop = doorOf('pier_shop') || doorOf('home'); const home = doorOf('home');
      const pier = L('pier');
      const px = pier ? pier.x : shop.x, pz = pier ? pier.z : shop.z;
      const wp = deepWater(px, pz, 18, 55);
      const shore = walkSpot(px, pz, 6, 40);   // land at the dock, near the water
      G.sky.hour = 6.6; G.sky.setWeather('clear'); G.sky.lockWeather = true;
      await r.cutscene([
        twoShot(hollis, pl, 6.6, { dist: 4, side: -1, drift: 0.4 }),
        twoShot(hollis, pl, 6.0, { dist: 3.2, side: -1, drift: -0.25, fov: 50 }),
        twoShot(hollis, pl, 6.4, { dist: 5.2, side: -1, drift: 0.3, fov: 42 })
      ], [
        ['Hollis', "Word on the water: Wexler's courier scuttled his boat off the Santa Maria pier last night. The black ledger went down with it.", 6.4],
        ['Hollis', "I marked the wreck with a buoy. It's a swim. Get to the marker and the case comes up with you.", 5.8],
        ['Jay', "And her people?", 1.6],
        ['Hollis', "They watch the marina. The moment you have it, they'll know.", 4.4]
      ], { fadeIn: false });
      r.supply({ ammo: { pistol: 60, smg: 120 }, hp: 100, armor: 40 });
      // ---- the wreck: a buoy, a half-sunken hull and the case bobbing in the water
      const buoy = r.prop(makeBuoy()); buoy.position.set(wp.x + 2.6, 0.1, wp.z + 1.6);
      const wreck = r.prop(makeWreck()); wreck.position.set(wp.x + 6.5, -0.35, wp.z + 4.5); wreck.rotation.y = Math.random() * TAU;
      const caseMesh = r.prop(makeWaterCase()); caseMesh.position.set(wp.x, 0.15, wp.z);
      r.tick(dt => {
        const t = G.time;
        caseMesh.position.y = 0.15 + Math.sin(t * 1.7) * 0.1; caseMesh.rotation.y += dt * 0.7;
        buoy.rotation.z = Math.sin(t * 1.1) * 0.09;
        if (buoy.userData.lamp) buoy.userData.lamp.visible = Math.sin(t * 3) > -0.3;
      });
      // ---- dock crowd + guards (they are on the dock when you arrive)
      for (let i = 0; i < 5; i++) {
        const s = walkSpot(shore.x, shore.z, 3, 20);
        const app = G.models.peds.randomAppearance(Math.random, { role: Math.random() < 0.5 ? 'worker' : 'tourist' });
        const p = r.ped({ x: s.x, z: s.z, role: 'civ', appearance: app });
        p.mode = 'walk'; p.path = null; p.walkSpeed = 1.15 + Math.random() * 0.4;
      }
      const guards = suits(r, shore.x, shore.z, 4, { rmin: 4, rmax: 18, weapons: ['smg', 'pistol', 'pistol', 'ak47'], sightRange: 85, health: 95 });
      for (const g of guards) { g.hostile = false; g.role = 'script'; g.script = { type: 'stand' }; g.aggroT = 0; g.sightRange = 0; }
      // ---- drive/walk to the dock
      await r.goto(shore, { mode: 'any', radius: 12, text: 'Go to the <b>dock</b> by the Santa Maria pier', label: 'Dock', color: 0x39c4d8, blipColor: '#39c4d8', arrow: false });
      // arrival cutscene: this is what you have to swim out for
      const inl = { x: shore.x - wp.x, z: shore.z - wp.z }; const il = Math.hypot(inl.x, inl.z) || 1;
      const perp = { x: -inl.z / il, z: inl.x / il };
      await r.cutscene([
        shot({ x: shore.x + inl.x / il * 4, z: shore.z + inl.z / il * 4, h: 3.2 }, { x: wp.x, z: wp.z, h: 0.7 }, 6.5, { fov: 52 }),
        shot({ x: shore.x + perp.x * 12 + inl.x / il * 3, z: shore.z + perp.z * 12 + inl.z / il * 3, h: 3 }, { x: shore.x, z: shore.z, h: 1.4 }, 6.5, { to: { x: shore.x + perp.x * 8, z: shore.z + perp.z * 8, h: 2.4 }, fov: 50 })
      ], [
        ['Hollis', "There she is. The buoy marks the wreck — and the case is still floating beside it.", 5.2],
        ['Jay', "Wexler's people are already on the dock.", 3],
        ['Hollis', "Then give them something to look at. Go.", 3.4]
      ], { fadeIn: false });
      // the guards notice you and the marina wakes up
      for (const g of guards) { if (g.dead) continue; g.role = 'enemy'; g.hostile = true; g.script = null; g.sightRange = 85; g.target = pl; g.setMode('attack', 999); g.aggroT = 999; }
      const wreckBlip = r.blip({ x: wp.x, z: wp.z, color: '#39c4d8', label: 'Case', flash: true, priority: 5 });
      G.hud.notify('Water ahead — hold forward to swim.');
      await r.goto(wp, { mode: 'any', radius: 3, text: 'Swim out to the <b>case</b> at the buoy', label: 'Case', color: 0x39c4d8, blipColor: '#39c4d8' });
      if (caseMesh.parent) caseMesh.parent.remove(caseMesh);
      r.removeBlip(wreckBlip); G.audio.play('pickup');
      r.speak('Hollis', "Got it? Now swim — they saw you!", 3.2);
      // ---- escape: back to shore, into the SUV, lose the heat
      G.police.setStars(2);
      const gs = kerbSpot({ x: shop.x, z: shop.z }, 1, 80);
      const car = r.car('suv', gs.x, gs.z, gs.yaw, { color: 0x22404a }); car.name = 'Shore runner'; car.locked = false;
      r.blip({ entity: car, color: '#39c4d8', label: 'Shore car', flash: true, priority: 4 });
      r.objective('Get back to shore and escape in the <b>SUV</b>');
      const c1 = laneSpot({ x: shop.x + 100, z: shop.z + 60 }, 1, 260);
      const c2 = laneSpot({ x: shop.x - 90, z: shop.z - 50 }, 1, 260);
      hostileCar(r, 'suv', c1.x, c1.z, c1.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 28, blip: true, color: 0x101018, health: 80 });
      hostileCar(r, 'coupe', c2.x, c2.z, c2.yaw, { n: 2, gang: 0, weapon: 'pistol', speed: 30, blip: true, color: 0x101018, health: 75 });
      await r.goto(home, { mode: 'vehicle', radius: 8, text: 'Deliver the case to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.loseWanted('Lose the <b>cops</b>');
      await r.dialogue([
        ['Hollis', "The black ledger. Wexler's whole empire in one book.", 4.4],
        ['Tee', "Not the whole empire. The book names where the money sleeps: the vault under her own bank.", 5.2]
      ]);
      car.mission = false; car.owner = 'player';
      r.reward(7000, 8);
    }
  },
  // ============================================================================================ 19
  {
    id: 'm19', title: 'Grounded', needs: ['m18'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 7500, respect: 10, density: 0.2,
    where: homeWhere(4.5),
    async run(r) {
      const ray = r.giver, pl = G.player; const home = doorOf('home');
      G.sky.hour = 15.5; G.sky.setWeather('smog'); G.sky.lockWeather = true;
      await r.cutscene([
        twoShot(ray, pl, 13.6, { dist: 4.2, side: 1, drift: 0.4 })
      ], [
        ['Ray', "Wexler sent a message. Not paper — rotor blades. A gunship and a crew are on their way to Grove.", 5.8],
        ['Ray', "Take the launcher off the porch. When that chopper dips, put a rocket in it.", 5],
        ['Jay', "Everybody inside. I'll handle it.", 2.6]
      ], { fadeIn: false });
      r.supply({ ammo: { rpg: 8, ak47: 200, smg: 150, pistol: 80 }, equip: 'rpg', hp: 100, armor: 100 });
      G.hud.notify('RPG: hold RIGHT MOUSE to aim, LEFT MOUSE to fire.');
      r.objective('Bring down the <b>gunship</b> with the <b>RPG</b>');
      const hs = laneSpot({ x: home.x - 220, z: home.z + 60 }, 1, 280);
      const heli = r.car('policeheli', hs.x, hs.z, 0, { color: 0x14202c }); heli.y = gy(home.x, home.z) + 40; heli.health = heli.maxHealth = 1000; heli.name = 'Halcyon gunship'; heli.sleeping = false;
      const hb = r.blip({ entity: heli, color: '#ff3030', label: 'Gunship', flash: true, priority: 5 }); heli.blipObj = hb;
      pilotHeli(r, heli, { to: { x: home.x, z: home.z }, orbit: 26, height: gy(home.x, home.z) + 34, speed: 12, target: pl, weapon: 'smg', dmgMul: 0.3, fireRate: 0.2, climb: 2 });
      r.cache(home.x + 6, home.z + 6, { health: 2, armor: 2, r: 6, ammo: { rpg: 4 } });
      const ground = [];
      let wt = 6, waves = 0;
      r.tick(dt => {
        if (heli.exploded || waves >= 4) return;
        wt -= dt;
        if (wt <= 0) {
          wt = 17; waves++;
          const w = suits(r, home.x, home.z, 3 + (waves > 2 ? 1 : 0), { rmin: 30, rmax: 55, weapons: ['smg', 'ak47', 'pistol', 'shotgun'], sightRange: 80, health: 95 });
          for (const p of w) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; } ground.push(...w);
          G.hud.subtitle(waves === 1 ? 'Ground crew moving in!' : 'More of them!', 2.4, 'Ray');
        }
      });
      await r.wait(() => heli.exploded);
      r.removeBlip(hb);
      G.fx.explosion(heli.x, heli.y, heli.z, 18); G.audio.play('explosion');
      r.speak('Ray', "Chopper's down! Clean the yard!", 3);
      for (const p of ground) if (!p.dead && !p.blipObj) p.blipObj = r.blip({ entity: p, color: '#ff3030', label: 'Halcyon', priority: 3 });
      r.objective('Clear the <b>ground crew</b>');
      await r.wait(() => ground.filter(p => !p.dead).length <= 1, { timeout: 30 }).catch(() => { });
      await r.dialogue([
        ['Ray', "She knows we won't fold. Good. Now we take the fight to her.", 4.6],
        ['Ray', "Tee says the ledger points at a courier run across town. Cody's got the route.", 4.8]
      ]);
      r.reward(7500, 10);
    }
  },
  // ============================================================================================ 20
  {
    id: 'm20', title: 'Dead Reckoning', needs: ['m19'], giver: 'cody', letter: 'C', color: 0x40ff80, reward: 8000, respect: 8, density: 0.6,
    where: () => besideDoor('home', -4.5, 1.5),
    async run(r) {
      const cody0 = r.giver, pl = G.player; const bank = doorOf('bank') || doorOf('home'); const term = doorOf('terminal') || doorOf('home'); const home = doorOf('home');
      const cody = ally(r, 'cody', cody0.x, cody0.z, { weapon: 'smg', health: 200 }); G.peds.remove(cody0); r.giver = null; cody.name = 'Cody';
      await r.cutscene([
        twoShot(cody, pl, 13.6, { dist: 4, side: -1, drift: 0.4 })
      ], [
        ['Cody', "The ledger says Wexler's fixer moves the original books across town in a three-car convoy, every Thursday.", 5.8],
        ['Cody', "From the bank to the airport. She thinks nobody's watching. We take the middle car, we take the truth.", 5.4],
        ['Jay', "Then let's introduce ourselves.", 2.2]
      ], { fadeIn: false });
      r.supply({ ammo: { ak47: 200, smg: 180, pistol: 80 }, equip: 'ak47', hp: 100, armor: 80 });
      squad(r, [cody]); r.keepAlive(cody, 'Cody');
      const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const car = r.car('muscle', ks.x, ks.z, ks.yaw, { color: 0x1c1c26 }); car.name = 'Stinger';
      await r.enterVehicle(car, { text: 'Get in the <b>Stinger</b> (F)', label: 'Car' });
      // build the convoy at the bank (it only rolls once the player arrives)
      const bs = laneSpot({ x: bank.x, z: bank.z }, 1, 140);
      const lead = r.car('suv', bs.x, bs.z, bs.yaw, { color: 0x0a0a10 }); lead.health = lead.maxHealth = 1100; lead.name = 'Halcyon courier';
      const ld = r.ped({ x: bs.x, z: bs.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), weapon: 'smg', ammo: 999, health: 120, skill: 0.35 }); ld.enterVehicle(lead, 0, true); ld.sightRange = 0;
      const lg = r.ped({ x: bs.x, z: bs.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), weapon: 'pistol', ammo: 999, health: 110, skill: 0.35 }); lg.enterVehicle(lead, 1, true); lg.sightRange = 0;
      const f1 = hostileCar(r, 'suv', bs.x - 14 * Math.sin(bs.yaw), bs.z - 14 * Math.cos(bs.yaw), bs.yaw, { n: 2, gang: 0, weapon: 'smg', mode: 'follow', speed: 25, color: 0x0a0a10, health: 80, noBail: true });
      f1.v.ai.setMode('follow', { leader: lead, gap: 12 }); f1.v.ai.aggressive = true;
      const f2 = hostileCar(r, 'suv', bs.x + 15 * Math.sin(bs.yaw), bs.z + 15 * Math.cos(bs.yaw), bs.yaw, { n: 2, gang: 0, weapon: 'pistol', mode: 'follow', speed: 25, color: 0x0a0a10, health: 80, noBail: true });
      f2.v.ai.setMode('follow', { leader: lead, gap: 12 }); f2.v.ai.aggressive = true;
      const lb = r.blip({ entity: lead, color: '#ff3030', label: 'Courier', flash: true, priority: 5 }); lead.blipObj = lb;
      await r.goto({ x: bank.x, z: bank.z }, { mode: 'vehicle', radius: 70, text: 'Intercept the <b>convoy</b>', label: 'Bank', color: 0xff3030, blipColor: '#ff3030', arrow: false });
      const lai = new DriverAI(lead, 'goto', { dest: { x: term.x, z: term.z }, cruise: 23, aggressive: true, ignoreLights: true, stopDist: 16 });
      r.speak('Cody', 'There they are! Stop the middle car — take out the escorts!', 3.8);
      let stopped = false;
      r.tick(dt => {
        if (stopped) return;
        if (lead.health < lead.maxHealth * 0.5 || lead.wrecked || !lead.driver || lead.driver.dead) {
          stopped = true; lai.setMode('idle'); lead.input.handbrake = true;
          for (const p of lead.occupants()) { p.exitVehicle(false); p.role = 'enemy'; p.hostile = true; p.target = pl; p.setMode('attack', 90); p.aggroT = 90; p.sightRange = 80; }
        }
        const d = Math.hypot(lead.x - (pl.vehicle || pl).x, lead.z - (pl.vehicle || pl).z);
        r._cd = (d > 420 && !stopped ? (r._cd || 0) + dt : 0); if (r._cd > 16) r.abortAll(FAIL('The convoy reached the airport.'));
      });
      await r.wait(() => stopped);
      r.removeBlip(lb);
      r.cache(lead.x, lead.z, { health: 1, armor: 1, r: 7 });
      const foes = [ld, lg, ...f1.peds, ...f2.peds].filter(p => !p.dead);
      if (foes.length) await r.killAll(foes, { text: 'Eliminate the <b>escorts</b>', label: 'Escorts' });
      r.speak('Cody', 'The books are in the back. Grab them!', 2.8);
      await new Promise(res => { r.pickupItem('tag', lead.x + 1, lead.z, { radius: 3.2, onCollect: () => res(true) }, { color: '#40ff80', label: 'Ledger', flash: true, priority: 5 }); r.objective('Grab the <b>ledger</b>'); });
      G.police.setStars(3);
      r.speak('Cody', 'Airport security called it in! Get us home!', 3.2);
      await r.goto(home, { mode: 'vehicle', radius: 8, text: 'Bring the ledger to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.loseWanted('Lose the <b>cops</b>');
      await r.dialogue([
        ['Cody', "Original books. Every dollar, every name.", 3.6],
        ['Cody', "Last page is a vault schedule. Wexler keeps the crown jewels in her own bank, Pershing Square.", 5.2]
      ]);
      car.mission = false; car.owner = 'player';
      r.reward(8000, 8);
    }
  },
  // ============================================================================================ 21
  {
    id: 'm21', title: 'Wiretap', needs: ['m20'], giver: 'tee', letter: 'T', color: 0xff5090, reward: 8500, respect: 8, density: 0.5,
    where: () => besideDoor('label', 6, 4) || besideDoor('club', 6, 4),
    async run(r) {
      const tee = r.giver, pl = G.player;
      await r.dialogue([
        ['Tee', "The convoy was a decoy. The real names never leave the bank — but the people who move them do.", 5.8],
        ['Tee', "Three of Wexler's people make the rounds tonight. Follow each one to the next. Don't get made.", 5.4],
        ['Jay', "Give me the first address.", 2.2]
      ]);
      r.supply({ ammo: { pistol: 60, smg: 120 }, hp: 100, armor: 40 });
      const segs = [
        { from: D('Ganton') || D('Jefferson'), to: D('Idlewood') || D('Willowfield'), name: 'Fisk', area: 'Ganton' },
        { from: D('Idlewood') || D('Willowfield'), to: D('Market') || D('Commerce'), name: 'Dandy', area: 'Idlewood' },
        { from: D('Market') || D('Commerce'), to: D('Pershing Square') || D('Downtown Financial'), name: 'Marsh', area: 'Market' }
      ];
      const ks = kerbSpot({ x: tee.x, z: tee.z }, 1, 100);
      const car = r.car('sports', ks.x, ks.z, ks.yaw, { color: 0x2a2a34 }); car.name = 'Ghost'; car.locked = false;
      r.blip({ entity: car, color: '#40ff80', label: 'Ghost', flash: true, priority: 4 });
      await r.enterVehicle(car, { text: 'Get in the <b>Ghost</b> (F)', label: 'Ghost' });
      // drive to the first stakeout, then the tail begins (so it can't start while you are still across town)
      const first = segs[0];
      const fRoad = G.map.nearestRoad(first.from.x, first.from.z, 300) || first.from;
      const stakeout = laneSpot(fRoad, 1, 240);
      await r.goto(stakeout, { mode: 'vehicle', radius: 16, text: `Drive to the <b>stakeout</b> in ${first.area}`, label: 'Stakeout', color: 0xff5090, blipColor: '#ff5090', arrow: false });
      const tgt0 = spawnTailTarget(r, first.from, first.name, { ahead: 12 });
      await r.cutscene([
        shot({ x: tgt0.car.x + 10, z: tgt0.car.z + 8, h: 3 }, { x: tgt0.car.x, z: tgt0.car.z, h: 1.1 }, 5, { fov: 42 }),
        shot({ x: car.x + 8, z: car.z + 6, h: 2.2 }, { x: tgt0.car.x, z: tgt0.car.z, h: 1.1 }, 4, { fov: 46 })
      ], [
        ['Tee', "There's Fisk — our first one. Keep your distance and keep him on screen.", 4.8]
      ], { fadeIn: false });
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]; if (!s.from || !s.to) { r.speak('Tee', 'I lost the feed on that one.', 2.6); continue; }
        if (i > 0) r.speak('Tee', `Next one: ${s.name}. Watch for the pickup.`, 3.4);
        await tailSegment(r, s.from, s.to, s.name, { cruise: 20 + i * 2, target: i === 0 ? tgt0 : null, waitT: i === 0 ? 0.5 : 0, ahead: 10 });
        await r.sleep(0.8);
        r.speak(s.name, i === 0 ? '...tell the boss the books are clean.' : i === 1 ? '...move it to the vault tonight.' : "...the vault's ready. No names on the door.", 3.2);
        await r.sleep(1.2);
      }
      await r.dialogue([
        ['Tee', "Every one of them went to the same place: Los Santos Savings and Trust. The vault's under the bank.", 6],
        ['Tee', "Wexler keeps the crown ledger there. If we want her, we take it out of the ground.", 5.2],
        ['Jay', "Then we break in.", 2]
      ]);
      car.mission = false; car.owner = 'player';
      r.reward(8500, 8);
    }
  },
  // ============================================================================================ 22
  {
    id: 'm22', title: 'Break In', needs: ['m21'], giver: 'birdie', letter: 'B', color: 0x40ffd0, reward: 12000, respect: 12, density: 0.4,
    where: () => besideDoor('garage_harlan', 4, 4) || besideDoor('ammu_a', 3, 3),
    async run(r) {
      const birdie0 = r.giver, pl = G.player; const bank = doorOf('bank') || doorOf('home'); const home = doorOf('home');
      const bl = bank.l; const cs = Math.cos(bank.yaw), sn = Math.sin(bank.yaw);
      const lp = (lx, lz) => ({ x: bl.x + lx * cs + lz * sn, z: bl.z - lx * sn + lz * cs });
      // camera helpers: bf points out to the street (open), rt is the bank's right
      const bf = { x: Math.sin(bank.yaw), z: Math.cos(bank.yaw) }, rt = { x: Math.cos(bank.yaw), z: -Math.sin(bank.yaw) };
      const cam = (d, s, h) => ({ x: bank.x + bf.x * d + rt.x * s, z: bank.z + bf.z * d + rt.z * s, h });
      G.sky.hour = 1.3; G.sky.setWeather('clear'); G.sky.lockWeather = true;
      const bir = ally(r, 'birdie', birdie0.x, birdie0.z, { weapon: 'pistol', health: 200 }); G.peds.remove(birdie0); r.giver = null;
      bir.invincible = true;   // Birdie runs the job with unlimited health: she cannot be killed during the heist
      const c1 = walkSpot(birdie0.x + 1.8, birdie0.z + 1.0, 1.2, 3), c2 = walkSpot(birdie0.x - 1.8, birdie0.z + 1.0, 1.2, 3);
      const cody = ally(r, 'cody', c1.x, c1.z, { weapon: 'smg', health: 220 });
      const dre = ally(r, 'dre', c2.x, c2.z, { weapon: 'ak47', health: 240 });
      await r.cutscene([
        twoShot(bir, pl, 8, { dist: 4.2, side: -1, drift: 0.4 }),
        shot(cam(17, 7, 8), { x: bl.x, z: bl.z, h: 4 }, 11.5, { to: cam(15, 4, 6), fov: 46 })
      ], [
        ['Birdie', "Los Santos Savings and Trust. One vault door, three cameras, a floor sensor, and a manager who hates his job.", 6.6],
        ['Birdie', "Kill the power, take his keycard, then hold the alley while my drill eats the side door.", 5.4],
        ['Jay', "How long on the drill?", 2.2],
        ['Birdie', "Forty-five seconds. That's why I'm coming with you — Cody and Dre are on the guns.", 4.6]
      ], { fadeIn: false });
      r.supply({ ammo: { ak47: 220, shotgun: 50, smg: 180, pistol: 80 }, equip: 'ak47', hp: 100, armor: 80 });
      // the crew's ride waits at the meet — it never sits parked on the bank's doorstep
      const ks = kerbSpot({ x: birdie0.x, z: birdie0.z }, 1, 140);
      const car = r.car('suv', ks.x, ks.z, ks.yaw, { color: 0x1c2436 }); car.name = 'Getaway SUV'; car.locked = false;
      squad(r, [bir, cody, dre]);
      await r.enterVehicle(car, { text: 'Take the <b>getaway SUV</b> (F)', label: 'SUV' });
      await r.goto({ x: bank.x, z: bank.z }, { mode: 'vehicle', radius: 60, text: 'Drive to the <b>Los Santos Savings &amp; Trust</b>', label: 'Bank', color: 0x40ffd0, blipColor: '#40ffd0', arrow: false });
      await r.cutscene([
        shot(cam(22, 11, 9), { x: bl.x, z: bl.z, h: 4.5 }, 6, { to: cam(17, 6, 6), fov: 47 }),
        shot(cam(12, -5, 3), { x: bank.x, z: bank.z, h: 2.6 }, 5, { fov: 42 })
      ], [
        ['Birdie', "Cameras sweep the front. Park us down the side street — we walk in round the corner.", 5.2]
      ], { fadeOut: true });
      // ---- park the getaway car out of sight: kerb on the avenue beside the bank's side alley
      const parkRef = lp(-20, 18.5);
      const kA = kerbSpot(parkRef, 1, 80), kB = kerbSpot(parkRef, -1, 80);
      const pk = kA.x >= kB.x ? kA : kB;
      await r.goto({ x: pk.x, z: pk.z }, { mode: 'vehicle', radius: 9, slow: 3, stop: true, text: 'Park the <b>getaway SUV</b> down the side street', label: 'Park', color: 0x40ffd0, blipColor: '#40ffd0', arrow: false });
      r.speak('Birdie', "Good. Out of the cameras' line. Everyone out.", 3);
      // ---- stage 1: cut the power at a real breaker box round the side — it is guarded
      const bp = lp(-11.15, 2.5);
      const breaker = r.prop(makeBreakerBox()); breaker.position.set(bp.x, gy(bp.x, bp.z), bp.z); breaker.rotation.y = bank.yaw - Math.PI / 2;
      const bg = suits(r, bp.x + 1, bp.z - 2, 3, { rmin: 1.5, rmax: 5, weapons: ['smg', 'pistol', 'shotgun'], sightRange: 70, health: 110 });
      for (const p of bg) p.blipObj = r.blip({ entity: p, color: '#ff3030', label: 'Guard', priority: 3 });
      await r.interact(bp.x, bp.z, {
        text: 'Kill the <b>power</b> at the breaker box (guarded)', label: 'Breaker box', color: 0x40ffd0, blipColor: '#40ffd0', radius: 2.8,
        onInteract: () => {
          G.fx.sparks(bp.x, gy(bp.x, bp.z) + 1.25, bp.z, 20);
          G.audio.play('explosion_small', { pos: { x: bp.x, y: 1, z: bp.z } });
          if (breaker.userData.pilot) breaker.userData.pilot.material.color.setHex(0x2a3a2a);
          r.speak('Birdie', 'Power down. Cameras are blind — move.', 3);
        }
      });
      const bpCam = lp(-13.6, 5.5);
      await r.cutscene([
        shot({ x: bpCam.x, z: bpCam.z, h: 2.4 }, { x: bp.x, z: bp.z, h: 1.1 }, 4, { fov: 40 })
      ], [['Birdie', "Lights out. Nobody sees us now.", 3]], { fadeIn: false });
      // ---- stage 2: the manager's keycard at the front door
      const dp0 = walkSpot(bank.x + bf.x * 3, bank.z + bf.z * 3, 1.5, 4);
      const mgr = suits(r, dp0.x, dp0.z, 1, { rmin: 1, rmax: 3, weapons: ['pistol'], sightRange: 60, health: 150 })[0];
      mgr.name = 'Vault manager'; mgr.armor = 40; mgr.blipObj = r.blip({ entity: mgr, color: '#ff3030', label: 'Manager', flash: true, priority: 5 });
      const mg = suits(r, dp0.x, dp0.z, 4, { rmin: 4, rmax: 12, weapons: ['smg', 'pistol', 'shotgun', 'pistol'], sightRange: 70, health: 100 });
      for (const p of mg) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
      await r.killAll([mgr, ...mg], { text: "Take out the <b>manager</b> and his guards", label: 'Security' });
      const kc = { x: mgr.x, z: mgr.z };
      const card = r.prop(makeKeycard()); card.position.set(kc.x, gy(kc.x, kc.z) + 0.06, kc.z); card.rotation.y = Math.random() * TAU;
      await r.interact(kc.x, kc.z, { text: "Grab the <b>keycard</b>", label: 'Keycard', color: 0xffd040, blipColor: '#ffd040', radius: 2.6, onInteract: () => { if (card.parent) card.parent.remove(card); } });
      // ---- stage 3: drill the vault door set into the bank's side wall (south wall, in the side yard)
      const vp = lp(-11.15, -6);
      const vault = r.prop(makeVaultDoor()); vault.position.set(vp.x, gy(vp.x, vp.z), vp.z); vault.rotation.y = bank.yaw - Math.PI / 2;
      const dp = lp(-13.5, -6);
      const drill = r.prop(makeDrill()); drill.position.set(dp.x, gy(dp.x, dp.z), dp.z); drill.rotation.y = Math.atan2(vp.x - dp.x, vp.z - dp.z);
      await r.interact(dp.x, dp.z, {
        text: 'Start the <b>drill</b>', label: 'Drill', color: 0x40ffd0, blipColor: '#40ffd0', radius: 3,
        onInteract: () => { G.audio.play('door_open', { pos: { x: dp.x, y: gy(dp.x, dp.z) + 1, z: dp.z } }); r.speak('Birdie', "Drill's running! Keep them off me for forty-five seconds!", 3.4); }
      });
      r.cache(dp.x + 4, dp.z - 4, { health: 2, armor: 2, r: 5 });
      await r.cutscene([
        shot({ x: dp.x + 3.5, z: dp.z - 5.5, h: 3 }, { x: dp.x, z: dp.z, h: 1.2 }, 4.5, { to: { x: dp.x - 3.5, z: dp.z - 5.5, h: 3.2 }, fov: 42 })
      ], [['Birdie', "Vault door, meet forty-five seconds of bad news.", 3.6]], { fadeIn: false });
      const T = r.timer(45, 'Drilling the vault', () => { });
      r.objective('Defend <b>Birdie</b> while the drill runs');
      let drilling = true;
      r.tick(dt => {
        if (!drilling) return;
        drill.userData.bit.rotation.z += dt * 16;
        if (Math.random() < dt * 10) G.fx.sparks(vp.x, gy(vp.x, vp.z) + 1.4, vp.z, 3);
        G.hud.progress('Drilling the vault', 1 - Math.max(0, T.left) / 45);
      });
      const waves = [];
      let wt = 4, n = 0;
      r.tick(dt => {
        if (T.expired) return; wt -= dt; if (wt > 0) return; wt = 11; n++;
        const w = suits(r, dp.x, dp.z, 2 + Math.min(2, n), { rmin: 10, rmax: 24, weapons: ['smg', 'ak47', 'pistol', 'shotgun'], sightRange: 80, health: 100 });
        for (const p of w) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
        waves.push(...w);
        if (n === 1) r.speak('Birdie', 'Company! Keep them off the drill!', 3);
      });
      await r.wait(() => T.expired);
      drilling = false; G.hud.progress('', null); r.clearTimer();
      // the drill backs off and the vault swings open into the yard
      let openT = 0;
      r.tick(dt => {
        if (openT >= 1) return;
        openT = Math.min(1, openT + dt / 1.5);
        const e = openT * openT * (3 - 2 * openT);
        vault.rotation.y = (bank.yaw - Math.PI / 2) - 2.1 * e;
        drill.position.z = dp.z - 2.6 * e;
        if (Math.random() < dt * 16) G.fx.sparks(vp.x, gy(vp.x, vp.z) + 1.4, vp.z, 3);
      });
      await r.cutscene([
        shot({ x: dp.x + 4, z: dp.z - 6, h: 3.4 }, { x: vp.x, z: vp.z, h: 2.1 }, 5.5, { to: { x: dp.x - 2, z: dp.z - 6.5, h: 3.6 }, fov: 44 })
      ], [['Birdie', "We're in. There's the crown ledger.", 3.4]], { fadeIn: false });
      for (const p of waves) if (!p.dead && !p.blipObj) p.blipObj = r.blip({ entity: p, color: '#ff3030', label: 'Security', priority: 3 });
      await r.wait(() => waves.filter(p => !p.dead).length <= 1, { timeout: 25 }).catch(() => { });
      // ---- stage 4: grab the ledger, then run
      const lzp = lp(-14, -6);
      const ledger = r.prop(makeLedgerCase()); ledger.position.set(lzp.x, gy(lzp.x, lzp.z) + 0.45, lzp.z); ledger.rotation.y = bank.yaw - Math.PI / 2;
      await r.interact(lzp.x, lzp.z, { text: 'Grab the <b>crown ledger</b>', label: 'Ledger', color: 0x40ffd0, blipColor: '#40ffd0', radius: 3, onInteract: () => { if (ledger.parent) ledger.parent.remove(ledger); } });
      G.police.setStars(3);
      r.speak('Birdie', "Alarm's tripped — every cop in the city! Go, go!", 3.4);
      r.blip({ entity: car, color: '#ffd040', label: 'Getaway SUV', flash: true, priority: 4 });
      await r.cutscene([
        shot({ x: dp.x + 6, z: dp.z - 7, h: 3.6 }, { x: vp.x, z: vp.z, h: 2.2 }, 4.5, { fov: 48 })
      ], [['Birdie', 'Get us to Grove Street. I\'ll keep the ledger dry.', 3.6]]);
      await r.goto(home, { mode: 'vehicle', radius: 8, slow: 12, text: 'Get the <b>ledger</b> to Grove Street', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.loseWanted('Lose the <b>cops</b>');
      await r.dialogue([
        ['Birdie', "We did it. Every page. Wexler's whole empire, in the back of the SUV.", 4.8],
        ['Ray', "Then tonight we finish it. She'll be at her tower when the news breaks. We go in before she can run.", 5.8]
      ]);
      car.mission = false; car.owner = 'player';
      r.reward(12000, 12);
    }
  },
  // ============================================================================================ 23
  {
    id: 'm23', title: 'Kingmaker', needs: ['m22'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 13000, respect: 12, density: 0.4,
    where: homeWhere(4.5),
    afterDone() { for (const n of ['idlewood', 'jefferson', 'eastls']) G.game.territories.add(n); },
    async run(r) {
      const ray = r.giver, pl = G.player; const home = doorOf('home');
      await r.cutscene([
        twoShot(ray, pl, 13.9, { dist: 4.2, side: 1, drift: 0.4 })
      ], [
        ['Ray', "One night, three corners. Wexler pays crews in Jefferson, Idlewood and East Los Santos to keep our people indoors.", 5.8],
        ['Ray', "Take all three before sunrise and the whole east side belongs to the set. Fail, and they'll think we're soft.", 5.4],
        ['Jay', "Three corners. One night. Let's move.", 2.6]
      ], { fadeIn: false });
      r.supply({ ammo: { ak47: 260, smg: 240, shotgun: 60, pistol: 100, grenade: 4 }, equip: 'ak47', hp: 100, armor: 80 });
      const cody = ally(r, 'cody', ray.x + 2, ray.z, { weapon: 'smg', health: 200 });
      const dre = ally(r, 'dre', ray.x - 2, ray.z, { weapon: 'ak47', health: 220 });
      squad(r, [cody, dre]); r.keepAlive(cody, 'Cody');
      const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const van = r.car('van', ks.x, ks.z, ks.yaw, { color: 0x1c2a22 }); van.name = 'Workhorse'; van.health = van.maxHealth = 1800;
      await r.enterVehicle(van, { text: 'Take the wheel of the <b>van</b> (F)', label: 'Van' });
      const T = r.timer(720, 'Before sunrise', () => { });
      r.failIf(() => T.expired, 'Sunrise came before you took all three corners.');
      const spots = [D('Jefferson'), D('Idlewood'), D('East Los Santos')];
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i]; if (!s) continue;
        await r.goto({ x: s.x, z: s.z }, { mode: 'vehicle', radius: 90, text: `Drive to <b>corner ${i + 1}/3</b>`, label: `Corner ${i + 1}`, color: 0xff3030, blipColor: '#ff3030', arrow: false });
        const foes = spawnGang(r, s.x, s.z, 4, { gang: GANG.BLUELINE, weapons: ['smg', 'pistol', 'pistol', 'smg'], rmin: 8, rmax: 24, sightRange: 70, health: 95, skill: 0.35 });
        const cap = spawnGang(r, s.x, s.z, 1, { gang: GANG.BLUELINE, weapons: ['ak47'], rmin: 6, rmax: 12, sightRange: 80, health: 190, blip: true, skill: 0.4 })[0];
        cap.armor = 40; cap.name = 'Corner boss';
        r.cache(s.x + 6, s.z + 4, { health: 1, armor: 1, r: 6 });
        r.speak('Cody', i === 0 ? "Blue Line colours in Jefferson. Light them up!" : i === 1 ? 'Idlewood next. Move!' : 'Last corner. East side!', 3);
        await r.killAll([...foes, cap], { text: `Take <b>corner ${i + 1}/3</b>`, label: 'Blue Line' });
        G.game.paintTerritory(s.x, s.z, 120, GANG.EMERALD);
        G.hud.notify(`Corner ${i + 1}/3 flipped to Emerald Row`, 'cash');
      }
      r.clearTimer();
      await r.goto(home, { mode: 'vehicle', radius: 8, slow: 12, text: 'Return to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.dialogue([
        ['Ray', "The whole east side, green by dawn. That's how a legend is built.", 4.6],
        ['Ray', "Now the tower. Get some shells. We go at noon.", 4]
      ]);
      for (const a of [cody, dre]) a.followPlayer = false;
      van.mission = false; van.owner = 'player';
      r.reward(13000, 12);
    }
  },
  // ============================================================================================ 24
  {
    id: 'm24', title: 'The Hollow Crown', needs: ['m23'], giver: 'ray', letter: 'W', color: 0xffd040, reward: 30000, respect: 30, density: 0.2, keepWanted: false,
    where: homeWhere(4.5), blocksShops: true,
    afterDone() { G.hud.notify('Chapter II complete. Los Santos is yours.', 'cash'); },
    async run(r) {
      const ray = r.giver, pl = G.player; const home = doorOf('home'); const hq = doorOf('label') || doorOf('bank') || home; const term = doorOf('terminal') || home;
      const hfx = Math.sin(home.yaw), hfz = Math.cos(home.yaw), hrx = Math.cos(home.yaw), hrz = -Math.sin(home.yaw);
      G.sky.hour = 11.4; G.sky.setWeather('clear'); G.sky.lockWeather = true;
      r.supply({ ammo: { ak47: 420, shotgun: 60, smg: 260, pistol: 120, rpg: 10, grenade: 6 }, equip: 'ak47', hp: 100, armor: 100 });
      const cody = ally(r, 'cody', home.x + 2, home.z + 1, { weapon: 'smg', health: 220 });
      const dre = ally(r, 'dre', home.x - 2, home.z + 1, { weapon: 'ak47', health: 240 });
      await r.cutscene([
        shot({ x: home.x + hfx * 16 + hrx * 4, z: home.z + hfz * 16 + hrz * 4, h: 4 }, { x: home.x + hfx * 3, z: home.z + hfz * 3, h: 1.8 }, 15, { to: { x: home.x + hfx * 11 + hrx * 7, z: home.z + hfz * 11 + hrz * 7, h: 2.6 }, fov: 48 })
      ], [
        ['Ray', "The ledger is out. Wexler's buyers are already running. She's cornered in her own tower.", 5.8],
        ['Ray', "Cody and Dre ride with you. Go up there and end it — for Marcus, for Nia, for every corner she bought.", 6.2],
        ['Jay', "This is the last one. Let's finish it.", 2.8]
      ], { fadeIn: false });
      squad(r, [cody, dre]); r.keepAlive(cody, 'Cody');
      const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const van = r.car('van', ks.x, ks.z, ks.yaw, { color: 0x1c2a22 }); van.name = 'Workhorse'; van.health = van.maxHealth = 2200;
      await r.enterVehicle(van, { text: 'Take the wheel of the <b>van</b> (F)', label: 'Van' });
      G.audio.radio.set(2);
      await r.goto({ x: hq.x, z: hq.z }, { mode: 'any', radius: 90, text: 'Drive to the <b>Halcyon tower</b>', label: 'Halcyon tower', color: 0xff3030, blipColor: '#ff3030', arrow: false });
      const g1 = suits(r, hq.x, hq.z, 6, { rmin: 10, rmax: 30, weapons: ['smg', 'pistol', 'ak47', 'shotgun'], sightRange: 70 });
      for (const p of g1) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
      r.speak('Cody', 'Lobby security! Take them!', 3);
      await r.killAll(g1, { text: 'Break the <b>tower security</b>', label: 'Security' });
      r.cache(hq.x + 6, hq.z + 6, { health: 2, armor: 2, r: 7 });
      const g2 = suits(r, hq.x, hq.z, 6, { rmin: 8, rmax: 24, weapons: ['ak47', 'shotgun', 'smg', 'pistol'], sightRange: 80 });
      const sv = laneSpot({ x: hq.x + 70, z: hq.z + 30 }, 1, 240);
      const sv2 = hostileCar(r, 'suv', sv.x, sv.z, sv.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 28, blip: true, color: 0x101018 });
      for (const p of g2) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
      r.speak('Dre', 'Roof team coming down! Hold!', 3);
      await r.killAll([...g2, ...sv2.peds], { text: 'Hold against the <b>roof team</b>', label: 'Security' });
      // Wexler
      const wx = besideDoor('label', 0, 4) || { x: hq.x, z: hq.z };
      const wxr = r.ped({ x: wx.x, z: wx.z, role: 'script', appearance: look('wexler'), name: 'Vivian Wexler', weapon: 'pistol', ammo: 300, health: 260 });
      wxr.armor = 60; wxr.invincible = true; wxr.script = { type: 'stand', look: pl };
      const marsh = r.ped({ x: wx.x + 1.4, z: wx.z + 0.6, role: 'script', appearance: look('marsh'), name: 'Marsh', weapon: 'ak47', ammo: 999, health: 300 });
      marsh.armor = 60; marsh.script = { type: 'stand', look: pl };
      await r.cutscene([
        twoShot(wxr, marsh, 5.5, { dist: 5.2, side: 1, drift: 0.3 }),
        shot({ x: pl.x + 2, z: pl.z + 2, h: 1.6 }, { x: wx.x, z: wx.z, h: 1.6 }, 6, { fov: 42 })
      ], [
        ['Wexler', "The Mercer boy. You've cost me a great deal of money tonight.", 5],
        ['Jay', "You took my sister. You burned my block. It's over.", 4],
        ['Wexler', "Marsh, please.", 2]
      ]);
      marsh.role = 'enemy'; marsh.hostile = true; marsh.target = pl; marsh.setMode('attack', 999); marsh.aggroT = 999; marsh.sightRange = 90;
      const guards = suits(r, hq.x, hq.z, 3, { rmin: 8, rmax: 20, weapons: ['smg', 'pistol', 'shotgun'], sightRange: 90 });
      for (const p of guards) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
      // she runs for her armoured car and a convoy forms up around her
      const esc = laneSpot({ x: hq.x + 30, z: hq.z + 20 }, 1, 220);
      const limo = r.car('limo', esc.x, esc.z, esc.yaw, { color: 0x0a0a0e }); limo.name = "Wexler's limo";
      limo.health = limo.maxHealth = 6000; limo.locked = true;
      const ldrv = r.ped({ x: esc.x, z: esc.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), weapon: 'pistol', ammo: 999, health: 120 }); ldrv.sightRange = 0; ldrv.enterVehicle(limo, 0, true);
      wxr.script = { type: 'goto', x: limo.x, z: limo.z, radius: 2.6, speed: 5.6, onArrive: () => { wxr.enterVehicle(limo, 1, true); } };
      G.hud.subtitle('Wexler is running for her car!', 2.6, 'Ray');
      await r.sleep(1.6);
      if (!wxr.vehicle) wxr.enterVehicle(limo, 1, true);
      const lai = new DriverAI(limo, 'goto', { dest: { x: term.x, z: term.z }, cruise: 34, aggressive: true, ignoreLights: true, stopDist: 18 });
      const lb = r.blip({ entity: limo, color: '#ff3030', label: "Wexler's limo", flash: true, priority: 5 }); limo.blipObj = lb;
      G.police.setStars(2);
      r.objective("Chase <b>Wexler's convoy</b> — wreck her limo");
      let lbail = false;
      // her security rides shotgun, and more cars keep joining the chase
      const convoy = [];
      const spawnEscort = () => {
        const s = laneSpot({ x: limo.x + (Math.random() - 0.5) * 70, z: limo.z + (Math.random() - 0.5) * 70 }, 1, 220);
        const hc = hostileCar(r, pick(['suv', 'muscle', 'coupe', 'sedan']), s.x, s.z, s.yaw, { n: 2, gang: 0, weapon: pick(['smg', 'pistol', 'ak47']), mode: 'follow', speed: 32, blip: false, color: 0x101018, health: 90, noBail: true });
        hc.v.ai.setMode('follow', { leader: limo, gap: 13 }); hc.v.ai.aggressive = true; hc.v.ai.ramTarget = true;
        convoy.push(hc);
      };
      spawnEscort(); spawnEscort();
      let escT = 7;
      r.tick(dt => {
        if (lbail) return;
        escT -= dt; if (escT <= 0 && convoy.length < 8) { escT = 9; spawnEscort(); G.hud.subtitle('More of her security!', 2.2, 'Cody'); }
        G.hud.counter(`Convoy: ${convoy.filter(c => !c.v.wrecked).length} cars`);
      });
      r.tick(dt => {
        if (lbail) return;
        if (limo.health < limo.maxHealth * 0.3 || limo.wrecked || lai.arrived || !limo.driver || limo.driver.dead) {
          lbail = true; lai.setMode('idle'); limo.input.handbrake = true; limo.locked = false;
          for (const p of limo.occupants()) p.exitVehicle(false);
        }
        const d = Math.hypot(limo.x - (pl.vehicle || pl).x, limo.z - (pl.vehicle || pl).z);
        r._wd = (d > 500 && !lbail ? (r._wd || 0) + dt : 0); if (r._wd > 22) r.abortAll(FAIL("Wexler's convoy got away."));
      });
      await r.wait(() => lbail);
      r.removeBlip(lb); G.hud.counter(null);
      r.cache(limo.x + 6, limo.z + 6, { health: 2, armor: 2, r: 7 });
      // final stand: Wexler, Marsh and the surviving convoy crew
      wxr.invincible = false; wxr.health = wxr.maxHealth = 900; wxr.armor = 80; wxr.role = 'enemy'; wxr.hostile = true; wxr.script = null; wxr.target = pl; wxr.setMode('attack', 999); wxr.aggroT = 999; wxr.sightRange = 95; wxr.give('smg', 400, true);
      marsh.health = marsh.maxHealth = 500; marsh.armor = 80; marsh.role = 'enemy'; marsh.hostile = true; marsh.target = pl; marsh.setMode('attack', 999); marsh.aggroT = 999; marsh.sightRange = 95;
      const bodyguards = suits(r, limo.x, limo.z, 5, { rmin: 6, rmax: 22, weapons: ['smg', 'ak47', 'pistol', 'shotgun'], sightRange: 95, health: 120 });
      for (const p of bodyguards) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
      r.speak('Wexler', "You want the crown, Mercer? Come and take it.", 4);
      await r.killAll([wxr, marsh, ldrv, ...bodyguards], { text: 'End it: take down <b>Wexler</b> and her crew', label: 'Targets' });
      // stand down whatever is left of the convoy before the epilogue
      for (const c of convoy) { if (c.v.ai) c.v.ai.setMode('idle'); c.v.input.handbrake = true; for (const p of c.peds) { if (!p.dead) { p.hostile = false; p.aggroT = 0; p.role = 'civ'; p.setMode('walk'); p.path = null; } } }
      G.police.clear();
      // epilogue
      await r.sleep(1.6);
      G.audio.radio.set(-1);
      G.hud.fade(1, 900); await sleep(1000);
      G.game.teleport(home.x + Math.sin(home.yaw) * 6, home.z + Math.cos(home.yaw) * 6, home.yaw + Math.PI);
      G.sky.hour = 17.4; G.sky.setWeather('clear'); G.sky.lockWeather = false;
      const rayE = r.ped({ x: home.x + 3, z: home.z + 4, role: 'script', appearance: look('ray'), name: 'Ray' });
      const niaE = r.ped({ x: home.x + 4.5, z: home.z + 3, role: 'script', appearance: look('nia'), name: 'Nia' });
      rayE.script = { type: 'stand', look: G.player }; niaE.script = { type: 'stand', look: G.player };
      G.world.update(0, home.x, home.z, 60);
      await r.cutscene([
        shot({ x: home.x + hfx * 15 + hrx * 4, z: home.z + hfz * 15 + hrz * 4, h: 4 }, { x: home.x + hfx * 3.5, z: home.z + hfz * 3.5, h: 1.6 }, 11, { to: { x: home.x + hfx * 10 + hrx * 7, z: home.z + hfz * 10 + hrz * 7, h: 2.6 }, fov: 45 }),
        shot({ x: home.x + hfx * 9 - hrx * 6, z: home.z + hfz * 9 - hrz * 6, h: 2 }, { x: home.x + hfx * 3.5, z: home.z + hfz * 3.5, h: 1.6 }, 11, { fov: 38 })
      ], [
        ['Nia', "You keep coming back for this city.", 3],
        ['Jay', "Somebody has to. This one's ours again.", 3.6],
        ['Ray', "Wexler's money is frozen. Her tower is a crime scene. And the set owns the east side, end to end.", 6.2],
        ['Nia', "Marcus would've loved this. All of it green.", 3.6],
        ['Jay', "Los Santos doesn't change. But it remembers who stood up for it.", 5]
      ], { fadeIn: false });
      G.hud.big('THE HOLLOW CROWN', '', 'Chapter II complete · The city is yours', 9);
      await r.sleep(6);
      r.reward(30000, 30);
    }
  }
];
