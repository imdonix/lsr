// LOS SANTOS RISING - twenty optional quest-line missions for Chapter I and Chapter II.
//
// These are deliberately built around mechanics the main story does not use: repo work,
// live bounty capture, street racing, photography, firefighting, demolition derby,
// escort driving, fragile cargo, foot chases, hacking, VIP protection, foot races,
// buried-stash searching, remote trackers, spike strips, rampages, bomb defusal and a
// social heist. They unlock in parallel chains so the campaign is not one straight line.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, dist2, pick, TAU } from './util.js';
import { GANG } from './mapdata.js';
import { D, doorOf, laneSpot, kerbSpot, walkSpot, stableSpot, gy, look, lookAt, spawnGang, hostileCar, besideDoor, squad, ally } from './storylib.js';
import { DriverAI } from './driverai.js';

const FAIL = (reason) => Object.assign(new Error('fail'), { isFail: true, reason });
const homeWhere = (side) => () => besideDoor('home', side, 1.5);
const atDoor = (id, side = 0, fwd = 0) => () => besideDoor(id, side, fwd);
const doorOrHome = (id) => doorOf(id) || doorOf('home');

// ------------------------------------------------------------------------------------------------
// small props / presentation helpers
function mat(color, emissive) { return new THREE.MeshLambertMaterial({ color, emissive: emissive || 0x000000 }); }
function box(w, h, d, color, emissive) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, emissive)); }
function cyl(rt, rb, h, color, seg = 10) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color)); }

function makeBoot() {
  const g = new THREE.Group();
  const clampBar = box(1.15, 0.12, 0.18, 0x3a3a3a); clampBar.position.y = 0.42; g.add(clampBar);
  const plate = box(0.34, 0.5, 0.56, 0xd8b020, 0x302000); plate.position.set(0, 0.24, 0); g.add(plate);
  const arm = box(0.16, 0.75, 0.16, 0x4a4a4a); arm.position.set(0.52, 0.32, 0); arm.rotation.z = -0.42; g.add(arm);
  const lock = box(0.18, 0.2, 0.1, 0xc03030, 0x300000); lock.position.set(0.63, 0.6, 0); g.add(lock);
  g.userData.own = true; return g;
}
function makeTerminal() {
  const g = new THREE.Group();
  const body = box(1.05, 1.35, 0.72, 0x3b414a); body.position.y = 0.7; g.add(body);
  const screen = box(0.72, 0.5, 0.05, 0x183a48, 0x0d4050); screen.position.set(0, 1.0, 0.39); g.add(screen);
  const keys = box(0.82, 0.07, 0.3, 0x23272d); keys.position.set(0, 0.62, 0.38); g.add(keys);
  const light = box(0.13, 0.13, 0.06, 0x30ff90, 0x20c060); light.position.set(0.4, 1.25, 0.39); g.add(light);
  g.userData.screen = screen; g.userData.light = light; g.userData.own = true; return g;
}
function makeBriefcase() {
  const g = new THREE.Group();
  const body = box(0.7, 0.48, 0.22, 0x5a3a22); g.add(body);
  const trim = box(0.72, 0.09, 0.24, 0xc8a020); trim.position.y = 0.02; g.add(trim);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12), mat(0x1a1a1a)); handle.position.y = 0.31; handle.rotation.x = Math.PI / 2; g.add(handle);
  g.userData.own = true; return g;
}
function makeStash() {
  const g = new THREE.Group();
  const dirt = new THREE.Mesh(new THREE.SphereGeometry(0.72, 10, 6, 0, TAU, 0, Math.PI / 2), mat(0x5a4632)); dirt.scale.y = 0.28; g.add(dirt);
  const caseMesh = box(0.52, 0.3, 0.18, 0x26343a); caseMesh.position.y = 0.08; caseMesh.rotation.y = 0.35; g.add(caseMesh);
  g.userData.case = caseMesh; g.userData.own = true; return g;
}
function makeBomb() {
  const g = new THREE.Group();
  const body = box(0.78, 0.5, 0.46, 0x1d1f24); body.position.y = 0.25; g.add(body);
  const panel = box(0.38, 0.18, 0.04, 0x2a2d34); panel.position.set(0, 0.34, 0.25); g.add(panel);
  const led = box(0.1, 0.1, 0.05, 0xff2a20, 0x801000); led.position.set(0.28, 0.4, 0.25); g.add(led);
  const wires = [];
  const wireCols = [0xd02020, 0x2050d0, 0xe0c020];
  for (let i = 0; i < 3; i++) { const w = cyl(0.025, 0.025, 0.55, wireCols[i], 6); w.position.set(-0.22 + i * 0.22, 0.25, 0.28); w.rotation.z = 0.7; g.add(w); wires.push(w); }
  g.userData.led = led; g.userData.wires = wires; g.userData.own = true; return g;
}
function makeSpikeStrip() {
  const g = new THREE.Group();
  const bar = box(3.6, 0.12, 0.16, 0x3a3a3a); bar.position.y = 0.08; g.add(bar);
  for (let i = 0; i < 12; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 4), mat(0xa8b0b8)); sp.position.set(-1.55 + i * 0.28, 0.25, 0); g.add(sp); }
  g.userData.own = true; return g;
}
function makePodium() {
  const g = new THREE.Group();
  const body = box(1.1, 1.05, 1.1, 0x2a1a12); body.position.y = 0.52; g.add(body);
  const top = box(1.3, 0.08, 1.3, 0xb08a40, 0x201400); top.position.y = 1.08; g.add(top);
  const cloth = box(1.15, 0.5, 1.15, 0x4a1018); cloth.position.y = 0.72; g.add(cloth);
  g.userData.own = true; return g;
}
function makeFirePit() {
  const g = new THREE.Group();
  const barrel = cyl(0.55, 0.62, 1.0, 0x4a2a18); barrel.position.y = 0.5; g.add(barrel);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a18, transparent: true, opacity: 0.55 })); glow.position.y = 1.0; g.add(glow);
  g.userData.glow = glow; g.userData.own = true; return g;
}
function photoFlash() { G.audio.play('menu_click', { volume: 0.65 }); G.fx.flash(G.cam.position.x, G.cam.position.y, G.cam.position.z, 14, 0.12, 0xffffff, 30); }
function signalBeep(volume = 0.25) { G.audio.play('ding', { volume }); }

// ------------------------------------------------------------------------------------------------
// enemy / guard helpers used by several quests
function suited(r, cx, cz, n, o = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = walkSpot(cx, cz, o.rmin ?? 3, o.rmax ?? 14);
    const p = r.ped({ x: s.x, z: s.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), weapon: pick(o.weapons || ['smg', 'ak47', 'shotgun', 'pistol']), ammo: 999, health: o.health ?? 105, blip: o.blip ? { color: '#ff3030' } : false, skill: o.skill ?? 0.35 });
    p.sightRange = o.sightRange ?? 55; p.guard = o.guard ?? true; p.home = { x: s.x, z: s.z }; p.mode = 'loiter'; p.canDrop = true;
    out.push(p);
  }
  return out;
}
// A guard that waits for the mission to decide whether it sees the player. Used for the
// repo / hacking quests, where the mission owns the detection meter.
function watchGuard(r, x, z, o = {}) {
  const g = r.ped({ x, z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: o.role || 'business' }), name: o.name || 'Guard', weapon: o.weapon || 'pistol', ammo: 999, health: o.health ?? 95 });
  g.hostile = false; g.sightRange = 0; g.guard = true; g.canDrop = true;
  g.script = { type: 'stand' }; g.mode = 'loiter';
  g._face = o.face ?? Math.random() * TAU; g._seed = Math.random() * TAU; g._sweep = o.sweep ?? 0.55;
  return g;
}
function canSee(a, b, maxD = 28, fov = 2.3) {
  if (!a || !b || a.dead) return false;
  const dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz);
  if (d > maxD) return false;
  if (d < 5) return true;
  const face = (a.faceOverride != null ? a.faceOverride : a.yaw) || 0;
  const dot = (dx / d) * Math.sin(face) + (dz / d) * Math.cos(face);
  if (dot < Math.cos(fov / 2)) return false;
  return !G.world.raycast(a.x, a.z, b.x, b.z, gy(a.x, a.z) + 1.6, gy(b.x, b.z) + 1.6);
}
function alarmGuards(list, pl) {
  for (const g of list) if (!g.dead) { g.role = 'enemy'; g.hostile = true; g.sightRange = 80; g.target = pl; g.setMode('attack', 999); g.aggroT = 999; }
}

// ------------------------------------------------------------------------------------------------
// route helpers
function roadPoint(x, z, r = 240, dir = 1) {
  const n = G.map.nearestRoad(x, z, r); return n ? laneSpot({ x: n.x, z: n.z }, dir, 12) : null;
}
function loopCourse(cx, cz, radius, count, phase = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = phase + i / count * TAU;
    const p = roadPoint(cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, 260);
    if (p) out.push({ x: p.x, z: p.z, yaw: p.yaw });
  }
  return out;
}
function routeTo(from, to, n = 3) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const x = from.x + (to.x - from.x) * t + Math.sin(t * 9) * 22;
    const z = from.z + (to.z - from.z) * t + Math.cos(t * 7) * 22;
    const p = roadPoint(x, z, 220); if (p) out.push({ x: p.x, z: p.z, yaw: p.yaw });
  }
  out.push({ x: to.x, z: to.z, yaw: to.yaw || 0 });
  return out;
}
// A nearby point with a clean line of sight to (cx,cz): used by the photo / wiretap quests.
function clearVantage(cx, cz, rmin = 9, rmax = 17) {
  const y2 = gy(cx, cz) + 1.4;
  for (let i = 0; i < 36; i++) {
    const a = i / 36 * TAU;
    const d = rmin + (i % 4) / 3 * (rmax - rmin);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (G.world.groundY(x, z) < 0.6 || !G.world.placement.propClear(x, z, 1.0)) continue;
    const y1 = gy(x, z) + 1.6;
    if (G.world.raycast(x, z, cx, cz, y1, y2)) continue;
    return { x, z };
  }
  return walkSpot(cx, cz, rmin, rmax);
}

// ================================================================================================
// CHAPTER I
// ================================================================================================
const REPO = {
  id: 'c1_repo', title: 'Repo Men', side: true, chapter: 1, needs: ['m03'], giver: 'mack', giverName: 'Mack',
  letter: 'M', color: 0x40d0ff, reward: 2400, respect: 3, density: 0.8,
  where: atDoor('motel', 3.5, 2.5),
  async run(r) {
    const pl = G.player; const motel = doorOrHome('motel'); const dock = doorOrHome('bl_dock');
    await r.dialogue([
      ['Mack', "Repo job for you. Silver sports car at the Sunset Motel, three weeks behind on payments.", 5.2],
      ['Mack', "Owner won't hand over the keys, so don't ask. There's a wheel boot on it. Cut that first, then drive it to my dock.", 5.8],
      ['Mack', "One thing: the lot guard is a light sleeper. Stay low, stay quiet, and don't let him see your face.", 5],
    ]);
    const carSpot = kerbSpot({ x: motel.x, z: motel.z }, 1, 120);
    const car = r.car('sports', carSpot.x, carSpot.z, carSpot.yaw, { color: 0xb8bcc6 }); car.name = 'Repossessed Kestrel'; car.locked = true;
    r.keepAlive(car, 'The repo car');
    const boot = r.prop(makeBoot()); boot.position.set(car.x, gy(car.x, car.z), car.z); boot.rotation.y = car.yaw + Math.PI / 2; boot.userData.car = car;
    const guardSpot = walkSpot(motel.x, motel.z, 7, 14);
    const guard = watchGuard(r, guardSpot.x, guardSpot.z, { face: Math.atan2(car.x - guardSpot.x, car.z - guardSpot.z), sweep: 0.7, name: 'Lot guard', health: 90 });
    guard.invincible = true;
    guard.script.look = { x: car.x, z: car.z };
    let detect = 0, alerted = false, warned = false, cutting = false;
    r.tick(dt => {
      if (alerted) return;
      // The guard slowly sweeps the lot facing the car, so the stealth beat is actually real.
      const ang = guard._face + Math.sin(G.time * 0.35 + guard._seed) * guard._sweep;
      guard.faceOverride = ang;
      const look = guard.script && guard.script.look;
      if (look) { look.x = guard.x + Math.sin(ang) * 10; look.z = guard.z + Math.cos(ang) * 10; }
      const gd = Math.hypot(guard.x - pl.x, guard.z - pl.z);
      const hidden = pl.crouch && gd > 9;
      if (canSee(guard, pl, hidden ? 8 : 20, 2.1)) detect = Math.min(1, detect + dt / 1.4);
      else detect = Math.max(0, detect - dt * 0.5);
      if (!cutting) { if (detect > 0.02) G.hud.progress('Detection', detect); else G.hud.progress('', null); }
      if (detect > 0.25 && !warned) { warned = true; signalBeep(0.18); G.hud.notify('The lot guard is watching — crouch (C) or break his line of sight.'); }
      if (detect >= 1) {
        alerted = true; G.hud.progress('', null); guard.invincible = false; guard.role = 'enemy'; guard.hostile = true; guard.target = pl; guard.setMode('attack', 999); guard.aggroT = 999; guard.sightRange = 70;
        G.police.setStars(1); G.hud.notify('The lot guard spotted you!'); G.audio.play('wanted_up');
      }
    });
    G.hud.notify('Crouch with C to stay out of the guard\'s sight while you reach the car.');
    await r.goto(car, { mode: 'foot', radius: 5.5, text: 'Get to the <b>repo car</b> at the motel', label: 'Repo car', color: 0x40d0ff, blipColor: '#40d0ff', arrow: false });
    await r.interact(car.x, car.z, { label: 'Cut the wheel boot', text: 'Cut the <b>wheel boot</b> off the car', color: 0x40d0ff, blipColor: '#40d0ff' });
    cutting = true;
    let cutT = 0;
    r.tick(dt => { if (cutT < 1) { cutT += dt / 3.2; G.hud.progress('Cutting the boot…', cutT); } if (cutT >= 1) G.hud.progress('', null); });
    await r.wait(() => cutT >= 1);
    cutting = false; r.clearTimer();
    if (boot.parent) boot.parent.remove(boot);
    car.locked = false; G.audio.play('door_open');
    r.objective('Get in the <b>repo car</b>');
    await r.enterVehicle(car, { text: 'Get in the <b>repo car</b> (F)', label: 'Repo car' });
    if (alerted) { r.speak('Mack', "Cops are already rolling. Lose them and bring the car in.", 3.4); await r.loseWanted('Lose the <b>cops</b>'); }
    else r.speak('Mack', "Clean. Now bring her to the dock, and don't scratch the paint.", 3.4);
    r.failIf(() => car.wrecked, 'You wrecked the repo car.');
    await r.goto(dock, { mode: 'vehicle', radius: 10, slow: 12, needVehicle: car, text: 'Deliver the <b>repo car</b> to the dock', label: 'Docks', color: 0x40d0ff, blipColor: '#40d0ff' });
    await r.dialogue([['Mack', "Good as new. The bank gets their car, I get my fee, you get paid. Everybody wins except the guy who missed three payments.", 6]]);
    car.mission = false; car.owner = 'player';
    r.reward(2400, 3);
  }
};

const DEBTS = {
  id: 'c1_debts', title: 'Bad Debts', side: true, chapter: 1, needs: ['m02'], giver: 'pak', giverName: 'Mr. Pak',
  letter: 'P', color: 0xffa040, reward: 2100, respect: 4, density: 0.6,
  where: atDoor('gas_a', -4.5, 2),
  async run(r) {
    const pl = G.player; const spots = [
      { id: 'chicken_a', name: 'Leon', tab: 340, line: 'I... I don\'t have it this week, man.' },
      { id: 'pizza_a', name: 'Rosa', tab: 290, line: 'You can\'t just walk in here and—' },
      { id: 'burger_a', name: 'Dee', tab: 410, line: 'Tell Pak I\'ll have it by Friday. I swear.' }
    ];
    await r.dialogue([
      ['Mr. Pak', "Jay, three people owe me money and my suppliers don't take excuses. I need you to collect.", 5.2],
      ['Mr. Pak', "No blood. No bodies. Just make them understand that the tab is due. Get close and don't blink.", 5.2],
    ]);
    r.supply({ ammo: { pistol: 40 }, equip: 'pistol', hp: 100, armor: 20 });
    G.hud.notify('Keep your gun drawn and stay close: pressure fills the meter. No killing.');
    let paid = 0;
    for (let i = 0; i < spots.length; i++) {
      const S = spots[i]; const d = doorOrHome(S.id);
      const p = r.ped({ x: d.x + 2.0, z: d.z + 1.0, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: i === 1 ? 'business' : 'civ' }), name: S.name, health: 120 });
      p.invincible = true; p.script = { type: 'stand', look: pl }; p.speedTarget = 0;
      const b = r.blip({ entity: p, color: '#ffa040', label: S.name, priority: 4 });
      // blip:false — the blip above already tracks the debtor, so goto must not stack a second one on the radar
      await r.goto(p, { mode: 'foot', radius: 4.5, blip: false, text: `Lean on <b>${S.name}</b> (${i + 1}/3)`, label: S.name, color: 0xffa040, follow: false });
      r.speak(S.name, S.line, 2.6);
      let fear = 0; let active = true; let gunWarned = false;
      r.tick(dt => {
        if (!active) return; const d2 = Math.hypot(pl.x - p.x, pl.z - p.z);
        const armed = pl.hasGunDrawn();
        if (d2 < 6.0 && armed) { fear = Math.min(1, fear + dt * 0.34); p.faceOverride = Math.atan2(pl.x - p.x, pl.z - p.z); }
        else fear = Math.max(0, fear - dt * 0.18);
        // The bar names what is missing, so a holstered gun or walking out of range never reads as a stuck meter.
        if (!armed) {
          G.hud.progress(`Draw a gun on ${S.name}`, fear);
          if (!gunWarned) { gunWarned = true; G.hud.notify(`${S.name} won't crack bare-handed — draw your pistol (2).`); }
        } else if (d2 >= 6.0) G.hud.progress(`Get closer to ${S.name}`, fear);
        else G.hud.progress(`Pressure on ${S.name}`, fear);
      });
      r.objective(`Hold <b>${S.name}</b> at gunpoint (${i + 1}/3)`);
      await r.wait(() => fear >= 1 || p.dead);
      active = false; G.hud.progress('', null);
      if (p.dead) r.fail('You killed a debtor. Pak wanted his money, not a funeral.');
      p.script = { type: 'flee', from: pl }; p.speedTarget = 4.5; p.invincible = false;
      pl.addMoney(S.tab); G.audio.play('cash'); paid++;
      r.removeBlip(b); G.hud.notify(`${S.name} paid $${S.tab} (${paid}/3)`, 'cash');
      await r.sleep(0.7);
    }
    await r.goto(doorOrHome('gas_a'), { mode: 'foot', radius: 4.5, text: 'Return to <b>Mr. Pak</b>', label: 'Mr. Pak', color: 0xffa040, blipColor: '#ffa040', arrow: true });
    await r.dialogue([['Mr. Pak', "No shots, no bodies, and every dollar accounted for. You have a future in this neighbourhood.", 5.2]]);
    r.reward(2100, 4);
  }
};

const SCHOOL = {
  id: 'c1_school', title: 'Crash Course', side: true, chapter: 1, needs: ['m03'], giver: 'sal', giverName: 'Sal',
  letter: 'S', color: 0xff7a9a, reward: 1800, respect: 2, density: 0.4,
  where: atDoor('gym', -4, 3),
  async run(r) {
    const pl = G.player; const gym = doorOrHome('gym');
    await r.dialogue([
      ['Sal', "You can shoot, I'll give you that. But can you drive? Real driving, not bumper cars.", 4.8],
      ['Sal', "Three tests. The slalom, the parallel park, and the brake box. Pass them and the school pays you.", 5.2],
    ]);
    const ks = kerbSpot({ x: gym.x, z: gym.z }, 1, 100);
    const car = r.car('hatch', ks.x, ks.z, ks.yaw, { color: 0xd0a020 }); car.name = 'School car'; car.locked = false;
    r.keepAlive(car, 'The school car');
    await r.enterVehicle(car, { text: 'Get in the <b>school car</b> (F)', label: 'School car' });
    r.supply({ hp: 100, armor: 20 });
    let passed = 0;

    // ---- 1. slalom: five tight gates, no speed requirement, just don't stop being smooth
    const base = roadPoint(gym.x + 70, gym.z + 40, 260) || { x: gym.x + 70, z: gym.z + 40 };
    const slalom = [];
    for (let i = 0; i < 5; i++) {
      const x = base.x + Math.sin(i * 1.1) * (26 + i * 5);
      const z = base.z + Math.cos(i * 1.3) * (30 + i * 5);
      const p = roadPoint(x, z, 180) || { x, z };
      slalom.push(p);
    }
    r.objective('Drive the <b>slalom</b> (0/5)');
    for (let i = 0; i < slalom.length; i++) {
      const p = slalom[i];
      await r.goto(p, { mode: 'vehicle', radius: 5.5, text: `Drive the <b>slalom</b> (${i + 1}/${slalom.length})`, label: 'Gate', color: 0xff7a9a, blipColor: '#ff7a9a', arrow: true });
      G.audio.play('ding', { volume: 0.3 });
    }
    passed++; r.speak('Sal', "Not bad. Now park it. Kerb, mirrors, the whole thing.", 3.4);

    // ---- 2. parallel park: get inside the box and stop
    const parkSpot = kerbSpot({ x: gym.x + 55, z: gym.z - 30 }, -1, 180);
    const parkMk = r.marker(parkSpot.x, parkSpot.z, { radius: 3.2, color: 0xff7a9a, once: false, arrow: true, vehicleOnly: true });
    r.objective('Parallel park inside the <b>box</b> and stop');
    let parked = 0;
    r.tick(dt => {
      const v = pl.vehicle; if (!v) return;
      const d = Math.hypot(v.x - parkSpot.x, v.z - parkSpot.z);
      if (d < 3.2 && v.totalSpeed < 1.2) parked += dt; else parked = Math.max(0, parked - dt * 2);
      G.hud.progress('Parking…', parked / 2.2);
    });
    await r.wait(() => parked >= 2.2, { timeout: 90 }).catch(() => { });
    r.removeMarker(parkMk); G.hud.progress('', null);
    if (parked < 2.2) r.fail('You could not parallel park in time.');
    passed++; G.audio.play('ding', { volume: 0.3 }); r.speak('Sal', "Clean. Last one: brake box. Get some speed, then stop dead in it.", 3.8);

    // ---- 3. brake box: stop dead inside the marker. The 60 km/h run-up is graded feedback,
    //      not a hidden gate: a cautious stop still counts, and a roll-through re-arms the box.
    const brake = roadPoint(gym.x - 160, gym.z - 90, 260) || { x: gym.x - 160, z: gym.z - 90 };
    const boxMk = r.marker(brake.x, brake.z, { radius: 5.0, color: 0xff7a9a, once: false, arrow: true, vehicleOnly: true });
    r.objective('Stop dead inside the <b>brake box</b>');
    let fast = false; let stopped = 0;
    r.tick(dt => {
      const v = pl.vehicle; if (!v) return;
      if (v.totalSpeed * 3.6 >= 60) fast = true;
      const d = Math.hypot(v.x - brake.x, v.z - brake.z);
      if (d < 5 && v.totalSpeed < 1) stopped += dt; else stopped = Math.max(0, stopped - dt);
      G.hud.counter(`Speed: ${Math.round(v.totalSpeed * 3.6)} km/h · ${fast ? 'hard stop!' : 'target 60'}`);
    });
    for (let attempt = 0; attempt < 2 && stopped < 1.8; attempt++) {
      if (attempt) r.speak('Sal', "You rolled straight through. Come around and stop dead in the box this time.", 3.6);
      await r.goto({ x: brake.x, z: brake.z }, { mode: 'vehicle', radius: 5, text: 'Stop inside the <b>brake box</b>', label: 'Brake box', color: 0xff7a9a, blipColor: '#ff7a9a', arrow: true });
      await r.wait(() => stopped >= 1.8, { timeout: 30 }).catch(() => { });
    }
    G.hud.counter(null); r.removeMarker(boxMk);
    if (stopped < 1.8) r.fail('You never came to a stop inside the brake box.');
    r.speak('Sal', fast ? "Stopped dead from sixty. That is a real brake test." : "You parked it in the box. Next time carry more speed in.", 3.8);
    car.mission = false; car.owner = 'player';
    r.reward(1800, 2);
  }
};

const RACE = {
  id: 'c1_race', title: 'Wrong Side of the Tracks', side: true, chapter: 1, needs: ['c1_school'], giver: 'sal', giverName: 'Sal',
  letter: 'S', color: 0xff7a9a, reward: 3200, respect: 5, density: 0.7,
  where: atDoor('stadium', 3, 4),
  async run(r) {
    const pl = G.player; const stadium = doorOrHome('stadium');
    await r.dialogue([
      ['Sal', "You passed the school. Now do it with three other maniacs trying to put you in a wall.", 4.8],
      ['Sal', "Six checkpoints around the city. First across wins. No cops, no excuses.", 4.4],
    ]);
    const course = loopCourse(0, 0, 430, 6, 0.4);
    if (course.length < 4) { r.fail('The race route could not be built.'); return; }
    // Pick the lane direction that points at checkpoint 1, so the countdown does not drop the
    // player facing away from the route (the old dir=+1 start faced the far end of the street).
    const spotA = laneSpot({ x: stadium.x + 40, z: stadium.z + 20 }, 1, 160);
    const spotB = laneSpot({ x: stadium.x + 40, z: stadium.z + 20 }, -1, 160);
    const facing = s => Math.sin(s.yaw) * (course[0].x - s.x) + Math.cos(s.yaw) * (course[0].z - s.z);
    const start = facing(spotB) > facing(spotA) ? spotB : spotA;
    const startDir = start === spotB ? -1 : 1;
    const car = r.car('sports', start.x, start.z, start.yaw, { color: 0xe04a2a }); car.name = 'Race car'; car.locked = false;
    r.keepAlive(car, 'The race car');
    await r.enterVehicle(car, { text: 'Get in the <b>race car</b> (F)', label: 'Race car' });
    r.supply({ hp: 100, armor: 30 });
    const rivals = [];
    // Grid: the player starts on pole, rivals stagger well back down the same lane. The old 8 m
    // gaps let the three AI cars rear-end each other before the first corner (they would wreck
    // themselves within a minute), so give them a clean run-up and a distinct pace instead.
    for (let i = 0; i < 3; i++) {
      const p = laneSpot({ x: start.x - Math.sin(start.yaw) * (18 + i * 18), z: start.z - Math.cos(start.yaw) * (18 + i * 18) }, startDir, 120);
      const rv = r.car(i === 0 ? 'muscle' : 'sports', p.x, p.z, p.yaw, { color: [0x243a8a, 0x7a2a9a, 0x2a7a4a][i] }); rv.name = ['Blue Racer', 'Purple Racer', 'Green Racer'][i]; rv.health = rv.maxHealth = 900;
      const dp = r.ped({ x: p.x, z: p.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'gangster' }), name: rv.name, health: 200 }); dp.enterVehicle(rv, 0, true);
      const ai = new DriverAI(rv, 'idle', {}); ai.speedFactor = 0.9; rv.ai = ai;
      rivals.push({ v: rv, ai, cp: 0, name: rv.name, pace: 26.5 - i * 1.4 });
    }
    r.objective('Get ready for the <b>race</b>');
    G.hud.big('3', '', 'Wrong Side of the Tracks', 1.1); await r.sleep(1.1);
    G.hud.big('2', '', '', 1.1); await r.sleep(1.1);
    G.hud.big('1', '', '', 1.1); await r.sleep(1.1);
    G.hud.hideBig(); G.audio.play('mission_pass', { volume: 0.4 });
    for (const q of rivals) q.ai.setMode('goto', { dest: course[0], cruise: q.pace, aggressive: true, ignoreLights: true, stopDist: 5 });
    let finished = false; let playerCp = 0;
    // Traffic on these one-lane streets can box a racer in or send it round the same block.
    // If a rival makes no ground for a few seconds, put it back on the road before the
    // checkpoint it already had to reach. The first recovery keeps the run-up; a second one
    // skips the last few metres, so the field always keeps racing instead of quietly dying out.
    const rescue = q => {
      q.rescues = (q.rescues || 0) + 1; q.progT = 0; q.bestD = Infinity;
      const p = course[Math.min(q.cp, course.length - 1)];
      const n = G.map.nearestRoad(p.x, p.z, 80); if (!n) return;
      const back = q.rescues > 1 ? 0 : 18;
      const k = back ? (G.map.nearestRoad(p.x - n.tx * back, p.z - n.tz * back, 30) || p) : p;
      const rv = q.v; rv.x = k.x; rv.z = k.z; rv.vx = rv.vz = 0; rv.yaw = p.yaw;
      rv.input.throttle = 0; rv.input.brake = 0; rv.input.handbrake = false; rv.input.steer = 0;
      rv.ghost = Math.max(rv.ghost || 0, 2);   // clear of whatever boxed it in
      q.ai.setMode('goto', { dest: p, cruise: q.pace + q.cp * 0.9, aggressive: true, ignoreLights: true, stopDist: 5 });
    };
    r.tick(dt => {
      if (finished) return;
      for (const q of rivals) {
        if (q.v.wrecked) continue;
        const d = Math.hypot(q.v.x - course[Math.min(q.cp, course.length - 1)].x, q.v.z - course[Math.min(q.cp, course.length - 1)].z);
        if (d < (q.bestD ?? Infinity) - 2) { q.bestD = d; q.progT = 0; } else q.progT = (q.progT || 0) + dt;
        if (q.cp < course.length && q.progT > 8) { rescue(q); continue; }
        // Same 8 m finish line the player gets (the marker radius), so nobody wins from further out.
        if (q.cp < course.length && d < 8) {
          q.cp++; q.rescues = 0; q.bestD = Infinity; q.progT = 0;
          if (q.cp >= course.length) { finished = true; r.abortAll(FAIL(q.name + ' won the race.')); return; }
          q.ai.setMode('goto', { dest: course[q.cp], cruise: q.pace + q.cp * 0.9, aggressive: true, ignoreLights: true, stopDist: 5 });
        }
      }
      const place = 1 + rivals.filter(q => q.cp > playerCp).length;
      G.hud.counter(`Position ${place}/4 · checkpoint ${Math.min(playerCp + 1, course.length)}/${course.length}`);
    });
    for (let i = 0; i < course.length; i++) {
      const p = course[i];
      if (i > 0) playerCp = i;
      await r.goto(p, { mode: 'vehicle', radius: 8, text: `Race checkpoint <b>${i + 1}/${course.length}</b>`, label: 'Checkpoint', color: 0xff7a9a, blipColor: '#ff7a9a', arrow: true });
      G.audio.play('ding', { volume: 0.35 });
      if (finished) return;
    }
    playerCp = course.length; finished = true; G.hud.counter(null);
    r.speak('Sal', "First across! I knew that school was worth something.", 3.6);
    for (const q of rivals) if (q.v.ai) q.v.ai.setMode('idle');
    car.mission = false; car.owner = 'player';
    r.reward(3200, 5);
  }
};

const PHOTO = {
  id: 'c1_photo', title: 'Front Page', side: true, chapter: 1, needs: ['m06'], giver: 'tee', giverName: 'Tee',
  letter: 'T', color: 0xff5090, reward: 2600, respect: 3, density: 0.5,
  where: atDoor('pier_shop', -3, 3),
  async run(r) {
    const pl = G.player; const shop = doorOrHome('pier_shop');
    await r.dialogue([
      ['Tee', "I have a source inside Harlan's old network. He meets his handler three times tonight, and I need pictures.", 5.6],
      ['Tee', "Follow the car, but stay back. Get close enough for a clean shot and press E when the lens is lined up.", 5.2],
      ['Tee', "Three photographs. Faces, the briefcase, the handshake. That is the story.", 4.6],
    ]);
    const route = [shop, doorOrHome('club'), doorOrHome('bank')];
    const carSpot = kerbSpot({ x: shop.x, z: shop.z }, 1, 140);
    const car = r.car('coupe', carSpot.x, carSpot.z, carSpot.yaw, { color: 0x22242c, locked: true }); car.name = 'Source car'; car.health = car.maxHealth = 1500;
    const driver = r.ped({ x: carSpot.x, z: carSpot.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), name: 'Source', health: 150 });
    driver.enterVehicle(car, 0, true);
    const handler = r.ped({ x: carSpot.x, z: carSpot.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), name: 'Handler', health: 150 });
    handler.enterVehicle(car, 1, true);
    const ai = new DriverAI(car, 'idle', {}); car.ai = ai;
    r.failIf(() => car.wrecked || driver.dead, 'The source was taken out.');
    // The source car is the target, never the player's ride: lock it so nobody can climb
    // in and soft-lock the on-foot photo stop.
    let cb = r.blip({ entity: car, color: '#ff5090', label: 'Source car', flash: true, priority: 5 });
    const pressSpot = kerbSpot({ x: shop.x, z: shop.z }, -1, 120);
    const press = r.car('coupe', pressSpot.x, pressSpot.z, pressSpot.yaw, { color: 0x3a4a5a }); press.name = 'Press car'; press.locked = false;
    let pb = r.blip({ entity: press, color: '#ff5090', label: 'Press car', priority: 4 });
    let lost = 0;
    r.tick(dt => { const pv = pl.vehicle || pl; const d = Math.hypot(pv.x - car.x, pv.z - car.z); if (d > 320) lost += dt; else lost = Math.max(0, lost - dt * 2); if (lost > 20 && !car.wrecked) r.abortAll(FAIL('You lost the source car.')); });
    // One persistent tail marker keeps a visible "follow" cue on the source during every
    // leg instead of only the opening blip. It trails the car so the player never has to
    // drive into it, and updates in place (no per-frame allocation).
    let tailMk = null;
    r.tick(() => {
      if (!tailMk) return;
      const bx = car.x - Math.sin(car.yaw) * 20, bz = car.z - Math.cos(car.yaw) * 20;
      tailMk.x = bx; tailMk.z = bz; tailMk.group.position.set(bx, tailMk.y, bz);
    });
    let shots = 0;
    for (let i = 0; i < route.length; i++) {
      const stop = route[i];
      const lp = laneSpot({ x: stop.x, z: stop.z }, 1, 160);
      const tbx = car.x - Math.sin(car.yaw) * 20, tbz = car.z - Math.cos(car.yaw) * 20;
      tailMk = r.marker(tbx, tbz, { radius: 8, color: 0xff5090, arrow: false, once: false });
      r.objective(i ? 'Follow the <b>source car</b> to the next meet' : 'Follow the <b>source car</b>');
      ai.setMode('goto', { dest: { x: lp.x, z: lp.z }, cruise: 18, stopDist: 12, ignoreLights: true });
      await r.wait(() => ai.arrived || dist2(car.x, car.z, lp.x, lp.z) < 35 * 35);
      r.removeMarker(tailMk); tailMk = null;
      ai.setMode('idle'); car.input.handbrake = true;
      // Drop the vehicle blips while the source is parked: the vantage is the only active
      // objective, and neither an empty target car nor the player's ride should read as
      // "get in" during the on-foot photo stop.
      r.removeBlip(cb); cb = null;
      r.removeBlip(pb); pb = null;
      await r.sleep(1.2);
      if (driver.vehicle) driver.exitVehicle(false); if (handler.vehicle) handler.exitVehicle(false);
      const meet = walkSpot(lp.x, lp.z, 3, 7);
      driver.script = { type: 'goto', x: meet.x, z: meet.z, radius: 1, speed: 2.2 };
      handler.script = { type: 'goto', x: meet.x + 1.1, z: meet.z + 0.5, radius: 1, speed: 2.2 };
      await r.wait(() => dist2(driver.x, driver.z, meet.x, meet.z) < 3 * 3 && dist2(handler.x, handler.z, meet.x + 1.1, meet.z + 0.5) < 3 * 3, { timeout: 10 }).catch(() => { });
      lookAt(driver, handler); lookAt(handler, driver);
      driver.script = { type: 'stand', look: handler }; handler.script = { type: 'stand', look: driver };
      r.speak('Tee', i === 0 ? "There they are. Get close and press E — give me a clean frame." : i === 1 ? "The briefcase. Get the handoff." : "Last one. The handshake, then get out of there.", 3.2);
      if (pl.vehicle) G.hud.notify('Get out on foot for a clean photo');
      const vantage = clearVantage(meet.x, meet.z, 10, 18);
      await r.goto(vantage, { mode: 'foot', radius: 4, text: `Get a clear angle for <b>photo ${i + 1}/3</b>`, label: 'Vantage', color: 0xff5090, blipColor: '#ff5090', arrow: true });
      // custom interactable: only takes the picture when the line of sight is clear
      await new Promise((resolve, reject) => {
        const it = G.interactions.add({ x: meet.x, z: meet.z, radius: 30, label: 'Take photo', mission: true, footOnly: true, onInteract: () => {
          const d = Math.hypot(pl.x - meet.x, pl.z - meet.z);
          const clear = !G.world.raycast(pl.x, pl.z, meet.x, meet.z, gy(pl.x, pl.z) + 1.6, gy(meet.x, meet.z) + 1.4);
          if (d < 7) { G.hud.notify('Get further back for the frame'); return; }
          if (!clear) { G.hud.notify('No clear shot from here'); return; }
          G.interactions.remove(it); photoFlash(); shots++; G.hud.notify(`Photo ${shots}/3 captured`, 'cash'); resolve(true);
        } });
        r.onCleanup(() => G.interactions.remove(it));
        r.abortP.catch((e) => reject(e));
      });
      await r.sleep(0.8);
      if (i < route.length - 1) {
        // Mark the way back to the press car now that the shot is in the can.
        pb = r.blip({ entity: press, color: '#ff5090', label: 'Press car', priority: 4 });
        driver.script = { type: 'goto', x: car.x, z: car.z, radius: 2, speed: 3.2 };
        handler.script = { type: 'goto', x: car.x, z: car.z, radius: 2, speed: 3.2 };
        await r.sleep(2.5);
        if (!driver.vehicle) driver.enterVehicle(car, 0, true); if (!handler.vehicle) handler.enterVehicle(car, 1, true);
        // Only re-blip the target once its occupants are back aboard and it is pulling away.
        r.objective('Follow the <b>source car</b> to the next meet');
        cb = r.blip({ entity: car, color: '#ff5090', label: 'Source car', flash: true, priority: 5 });
      }
    }
    r.removeBlip(cb);
    r.removeBlip(pb);
    await r.dialogue([['Tee', "These are perfect. Faces, the case, the payoff. This is the story that puts Harlan's friends in a cell.", 5.6]]);
    r.reward(2600, 3);
  }
};

const FIRE = {
  id: 'c1_fire', title: 'Fire Drill', side: true, chapter: 1, needs: ['m05'], giver: 'cody', giverName: 'Cody',
  letter: 'C', color: 0xff6020, reward: 2900, respect: 4, density: 0.5,
  where: atDoor('gas_b', 3.5, 2.5),
  async run(r) {
    const pl = G.player; const gas = doorOrHome('gas_b');
    await r.dialogue([
      ['Cody', "Somebody torched three buildings on the east side. Fire crew is stuck on the freeway and people are still inside.", 5.4],
      ['Cody', "Take the truck. At each fire, get out and spray until the flames are out. Keep your distance — the spray has reach, the heat doesn't.", 5.8],
    ]);
    const ks = kerbSpot({ x: gas.x, z: gas.z }, 1, 100);
    const truck = r.car('truck', ks.x, ks.z, ks.yaw, { color: 0xc02018 }); truck.name = 'Fire truck'; truck.health = truck.maxHealth = 1800; truck.locked = false;
    r.keepAlive(truck, 'The fire truck');
    await r.enterVehicle(truck, { text: 'Take the <b>fire truck</b> (F)', label: 'Fire truck' });
    r.supply({ hp: 100, armor: 30 });
    const targets = [
      { id: 'chicken_a', name: 'Clucky\'s' },
      { id: 'pizza_a', name: 'Pizza Stack' },
      { id: 'burger_a', name: 'Burger Bonanza' }
    ];
    const fires = [];
    const T = r.timer(210, 'Fires', () => { });
    r.failIf(() => T.expired, 'The fires spread out of control.');
    for (let i = 0; i < targets.length; i++) {
      const d = doorOrHome(targets[i].id);
      const s = walkSpot(d.x, d.z, 4, 9);
      const pit = r.prop(makeFirePit()); pit.position.set(s.x, gy(s.x, s.z), s.z);
      const f = { x: s.x, z: s.z, pit, out: false, name: targets[i].name };
      fires.push(f);
      r.tick(dt => {
        if (f.out) return;
        for (let k = 0; k < 2; k++) G.fx.fire(f.x + (Math.random() - 0.5) * 2.2, gy(f.x, f.z) + 0.7, f.z + (Math.random() - 0.5) * 2.2, 1.5);
        if (pit.userData.glow) pit.userData.glow.material.opacity = 0.35 + Math.sin(G.time * 7) * 0.18;
        const dd = Math.hypot(pl.x - f.x, pl.z - f.z);
        if (dd < 3.2 && !pl.vehicle && pl.health > 5) pl.damage(7 * dt, { fire: true, source: null });
      });
    }
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      await r.goto(f, { mode: 'any', radius: 15, text: `Get to the fire at <b>${f.name}</b> (${i + 1}/3)`, label: f.name, color: 0xff6020, blipColor: '#ff6020', arrow: false });
      if (pl.vehicle) await r.leaveVehicle({ text: 'Get out and <b>spray the fire</b> — keep back from the flames' });
      await r.goto(f, { mode: 'foot', radius: 4.2, text: `Spray the fire at <b>${f.name}</b> (stay outside the flames)`, label: 'Fire', color: 0xff6020, blipColor: '#ff6020', arrow: true });
      // Stand-off reach: the interaction starts outside the 3.2 m heat ring, so a careful
      // player can hose the fire without eating unavoidable burn damage.
      await r.interact(f.x, f.z, { radius: 5.5, label: 'Spray water', color: 0xff6020, blipColor: '#ff6020', text: `Spray the fire at <b>${f.name}</b>` });
      let wt = 0;
      r.tick(dt => { wt += dt / 2.6; G.hud.progress('Spraying…', wt); for (let k = 0; k < 3; k++) G.fx.splash(f.x + (Math.random() - 0.5) * 2, f.z + (Math.random() - 0.5) * 2, 2, 0.5); });
      await r.wait(() => wt >= 1);
      G.hud.progress('', null);
      f.out = true; f.pit.visible = false; G.audio.play('fire_whoosh', { volume: 0.5 }); G.hud.notify(`${f.name} fire is out (${i + 1}/3)`, 'cash');
      await r.sleep(0.6);
    }
    r.clearTimer();
    await r.dialogue([['Cody', "Three buildings still standing and nobody dead. That's a good night, Jay.", 4.6]]);
    truck.mission = false; truck.owner = 'player';
    r.reward(2900, 4);
  }
};

const DERBY = {
  id: 'c1_derby', title: 'Demolition Derby', side: true, chapter: 1, needs: ['c1_fire'], giver: 'sal', giverName: 'Sal',
  letter: 'S', color: 0xff7a9a, reward: 3500, respect: 5, density: 0.4,
  where: atDoor('stadium', -3, 5),
  async run(r) {
    const pl = G.player; const stadium = doorOrHome('stadium');
    await r.dialogue([
      ['Sal', "Saturday night at the stadium lot. Four cars, one survivor, no guns. Just steel and bad decisions.", 5.2],
      ['Sal', "Your car is the green one. Wreck the other four. If you leave the lot, you forfeit.", 4.4],
    ]);
    const arena = walkSpot(stadium.x, stadium.z, 18, 30);
    const carSpot = laneSpot({ x: stadium.x + 30, z: stadium.z + 18 }, 1, 160);
    // The green car is the toughest in the lot. Four rivals that are each nearly as durable as it
    // turn the derby into a losing war of attrition once they swarm, so they wreck after 2-3 solid
    // rams and the player's car can absorb the return hits.
    const car = r.car('muscle', carSpot.x, carSpot.z, carSpot.yaw, { color: 0x2a6a3a }); car.name = 'Derby car'; car.health = car.maxHealth = 3400; car.locked = false;
    r.keepAlive(car, 'Your derby car');
    // no firearms in the ring
    const stash = pl.weapons; const had = pl.weaponId;
    pl.weapons = { fist: stash.fist || { ammo: 0, clip: 0 }, bat: { ammo: 0, clip: 0 } }; pl.equip('bat'); G.hud.weaponChanged();
    r.onCleanup(() => { pl.weapons = stash; pl.equip(stash[had] ? had : 'fist'); G.hud.weaponChanged(); });
    await r.enterVehicle(car, { text: 'Get in the <b>derby car</b> (F)', label: 'Derby car' });
    const rivals = []; const rivalBlips = [];
    const cols = [0x8a1a1a, 0x1a2a6a, 0x6a2a6a, 0x6a5a1a];
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU; const x = carSpot.x + Math.cos(a) * 26, z = carSpot.z + Math.sin(a) * 26;
      const rv = r.car('sedan', x, z, Math.atan2(carSpot.x - x, carSpot.z - z), { color: cols[i] }); rv.name = 'Derby rival'; rv.health = rv.maxHealth = 320;
      // Target blips: the objective says "wreck all four", but a scattered rival in the lot had no
      // marker at all. Red target blips match every other destroy-the-target objective in the game.
      rv.blipObj = r.blip({ entity: rv, color: '#ff3030', icon: 'dot', label: 'Derby rival', priority: 3 }); rivalBlips.push(rv.blipObj);
      const dp = r.ped({ x, z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'gangster' }), name: 'Derby driver', health: 200 });
      dp.enterVehicle(rv, 0, true);
      // 26 m/s instead of 34: a slightly lower top speed gives the player room to break away and
      // line up a charge instead of being shadowed bumper-to-bumper by all four cars.
      const ai = new DriverAI(rv, 'chase', { target: car, aggressive: true, ignoreLights: true, stopDist: 7 }); ai.ramTarget = true; ai.pursuitSpeed = 26; rv.ai = ai;
      rivals.push(rv);
    }
    const ring = r.marker(arena.x, arena.z, { radius: 95, color: 0xff7a9a, once: false, arrow: false });
    r.objective('Wreck all <b>four rivals</b>');
    let away = 0;
    r.tick(dt => {
      const alive = rivals.filter(v => !v.wrecked && !v.exploded).length;
      G.hud.counter(`Rivals remaining: ${alive}/4`);
      const d = Math.hypot((pl.vehicle || pl).x - arena.x, (pl.vehicle || pl).z - arena.z);
      if (d > 110) away += dt; else away = Math.max(0, away - dt);
      if (away > 9) r.abortAll(FAIL('You left the derby lot.'));
      if (pl.vehicle !== car && !car.wrecked) r.abortAll(FAIL('You left your derby car.'));
    });
    await r.wait(() => rivals.every(v => v.wrecked || v.exploded));
    G.hud.counter(null); r.removeMarker(ring); for (const b of rivalBlips) r.removeBlip(b);
    for (const v of rivals) v.blipObj = null;
    // the last driver crawls out
    const last = rivals.find(v => v.driver && !v.driver.dead);
    if (last && last.driver) { last.driver.exitVehicle(true); }
    r.speak('Sal', "That's how you do it! Last car rolling takes the purse.", 3.4);
    await r.sleep(1.5);
    car.mission = false; car.owner = 'player';
    r.reward(3500, 5);
  }
};

const GETAWAY = {
  id: 'c1_getaway', title: 'The Getaway', side: true, chapter: 1, needs: ['c1_derby'], giver: 'cody', giverName: 'Cody',
  letter: 'C', color: 0x40ff80, reward: 3800, respect: 5, density: 0.5,
  where: atDoor('home', -7, 2),
  async run(r) {
    const pl = G.player; const home = doorOrHome('home'); const safe = doorOrHome('pier_shop');
    await r.dialogue([
      ['Cody', "The boys hit a card game across town and somebody called it in. I need a wheelman, and I need one who doesn't stop.", 5.6],
      ['Cody', "I'll handle the shooters. You keep this car moving. If we stop for more than a few seconds, they box us in.", 5.2],
    ]);
    const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100);
    const car = r.car('muscle', ks.x, ks.z, ks.yaw, { color: 0x171a20 }); car.name = 'Getaway car'; car.health = car.maxHealth = 1700; car.locked = false;
    const cody = ally(r, 'cody', ks.x + 2, ks.z, { weapon: 'smg', health: 180, follow: false }); cody.followPlayer = false; cody.script = null; cody.mode = 'loiter';
    r.keepAlive(car, 'The getaway car'); r.keepAlive(cody, 'Cody');
    await r.enterVehicle(car, { text: 'Get in the <b>getaway car</b> (F)', label: 'Getaway car' });
    cody.enterVehicle(car, 1, true);
    r.supply({ ammo: { smg: 260, pistol: 80 }, equip: 'smg', hp: 100, armor: 60 });
    let started = false, stopT = 0, arrived = false;
    r.failIf(() => started && !arrived && !pl.vehicle, 'You left the getaway car.');
    r.tick(dt => {
      if (arrived || !pl.vehicle) return; started = true;
      if (pl.vehicle.totalSpeed < 2.2) stopT += dt; else stopT = Math.max(0, stopT - dt * 1.4);
      G.hud.counter(stopT > 2 ? `KEEP MOVING! ${Math.max(0, 12 - stopT).toFixed(1)}s` : 'Keep the car moving');
      if (stopT > 12) r.abortAll(FAIL('You stopped and the car got boxed in.'));
    });
    // The pier marker goes up before the scripted waves so the player is driving (and the
    // stop timer is fair) from the first second, instead of waiting 21 s with no objective.
    const route = r.goto(safe, { mode: 'vehicle', radius: 12, text: 'Get to the <b>pier</b> without stopping', label: 'Pier', color: 0x40ff80, blipColor: '#40ff80' })
      .then(() => { arrived = true; G.hud.counter(null); });
    route.catch(() => { });
    const waves = [2, 2, 3];
    for (let w = 0; w < waves.length; w++) {
      const ahead = laneSpot({ x: (pl.vehicle || pl).x + Math.sin((pl.vehicle || pl).yaw || 0) * 160 + 40, z: (pl.vehicle || pl).z + Math.cos((pl.vehicle || pl).yaw || 0) * 160 + 20 }, 1, 260);
      const back = laneSpot({ x: (pl.vehicle || pl).x - Math.sin((pl.vehicle || pl).yaw || 0) * 130, z: (pl.vehicle || pl).z - Math.cos((pl.vehicle || pl).yaw || 0) * 130 }, 1, 260);
      const chasers = [
        hostileCar(r, 'sedan', ahead.x, ahead.z, ahead.yaw, { n: 2, gang: 0, weapon: 'pistol', speed: 31, blip: true, color: 0x101018, health: 75, noBail: true }),
        hostileCar(r, 'coupe', back.x, back.z, back.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 31, blip: true, color: 0x101018, health: 75, noBail: true })
      ];
      if (w === 2) chasers.push(hostileCar(r, 'suv', ahead.x + 25, ahead.z - 20, ahead.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 29, blip: true, color: 0x101018, health: 85, noBail: true }));
      r.speak('Cody', w === 0 ? 'Two cars on us! Drive!' : w === 1 ? 'More of them! Keep moving!' : 'They brought the heavy car! Don\'t stop!', 3);
      // stop early if the pier is already reached, so arriving cannot leave the player waiting
      await Promise.race([r.sleep(w === 0 ? 1 : 10), route]);
      if (arrived) break;
      if (!pl.vehicle) return;
    }
    await route;
    await r.dialogue([['Cody', "That was some driving. Any slower and we would have been a headline.", 4.4], ['Cody', "The boys will remember this. So will I.", 3.2]]);
    car.mission = false; car.owner = 'player';
    r.reward(3800, 5);
  }
};

const GLASS = {
  id: 'c1_glass', title: 'Glass Run', side: true, chapter: 1, needs: ['c1_repo'], giver: 'mack', giverName: 'Mack',
  letter: 'M', color: 0x40d0ff, reward: 3000, respect: 4, density: 0.4,
  where: atDoor('bl_dock', -5, 4),
  async run(r) {
    const pl = G.player; const dock = doorOrHome('bl_dock'); const drop = doorOrHome('ammu_b');
    await r.dialogue([
      ['Mack', "This van is full of laboratory glass. One hard pothole and the whole order turns into sand.", 5.2],
      ['Mack', "Drive smooth. Brake early, take corners slow. The meter on your screen is the cargo, not the van.", 5.2],
    ]);
    const ks = kerbSpot({ x: dock.x, z: dock.z }, 1, 100);
    const van = r.car('van', ks.x, ks.z, ks.yaw, { color: 0x2a3a4a }); van.name = 'Glass van'; van.health = van.maxHealth = 1300; van.locked = false;
    r.keepAlive(van, 'The van');
    await r.enterVehicle(van, { text: 'Get in the <b>glass van</b> (F)', label: 'Glass van' });
    r.supply({ hp: 100, armor: 25 });
    // The cargo meter is the whole mechanic, so every loss says what caused it: a hit, a hard
    // corner, or the low-integrity warning. Lessons are throttled instead of spammed.
    let integrity = 100, lastHealth = -1, delivered = false;
    let crashCd = 0, slideCd = 0, warned = false;
    r.tick(dt => {
      if (delivered || pl.vehicle !== van) return;
      // ignore damage taken before the player was driving (traffic nudges while parked)
      if (lastHealth < 0) lastHealth = van.health;
      const lost = Math.max(0, lastHealth - van.health); lastHealth = van.health;
      crashCd = Math.max(0, crashCd - dt); slideCd = Math.max(0, slideCd - dt);
      if (lost > 0) {
        integrity -= lost * 0.075;
        if (lost > 8 && crashCd <= 0) {
          crashCd = 3; G.audio.play('car_hit_heavy', { volume: 0.35 });
          G.hud.notify('That impact cracked the load. Brake early — the glass feels every bump.');
        }
      }
      // hard cornering shifts the load
      const lat = Math.abs(van.latSpeed);
      if (lat > 6.5) {
        integrity -= (lat - 6.5) * dt * 2.2;
        if (lat > 9 && slideCd <= 0) {
          slideCd = 3; G.audio.play('screech', { volume: 0.28 });
          G.hud.notify('Hard cornering — the load is sliding! Take corners slower.');
        }
      }
      integrity = clamp(integrity, 0, 100);
      const pct = Math.round(integrity);
      G.hud.counter(pct <= 35 ? `Cargo integrity: <b style="color:#ff5a3c">${pct}%</b>` : `Cargo integrity: ${pct}%`);
      if (!warned && integrity <= 35) { warned = true; G.audio.play('glass_break', { volume: 0.3 }); G.hud.notify('The glass is starting to crack — ease off and nurse it home.'); }
      if (integrity <= 0) r.abortAll(FAIL('The cargo shattered.'));
    });
    await r.goto(drop, { mode: 'vehicle', radius: 9, slow: 7, needVehicle: van, text: 'Deliver the glass to <b>Ammu-Nation</b> — pull in slow', label: 'Ammu-Nation', color: 0x40d0ff, blipColor: '#40d0ff' });
    delivered = true; G.hud.counter(null);
    await r.dialogue([['Mack', `${Math.round(integrity)} percent intact. That is better than most of my employees.`, 4.4]]);
    van.mission = false; van.owner = 'player';
    r.reward(3000, 4);
  }
};

const RUNNER = {
  id: 'c1_runner', title: 'The Runner', side: true, chapter: 1, needs: ['c1_photo'], giver: 'tee', giverName: 'Tee',
  letter: 'T', color: 0xff5090, reward: 1700, respect: 2, density: 0.6,
  where: atDoor('pier_shop', -4, 5),
  async run(r) {
    const pl = G.player; const shop = doorOrHome('pier_shop');
    await r.dialogue([
      ['Tee', "The source's runner saw me taking pictures. He grabbed my notebook and ran.", 4.4],
      ['Tee', "He's fast, but he's scared. Chase him down and get it back. Don't let him reach a car.", 4.8],
    ]);
    const start = walkSpot(shop.x, shop.z, 8, 14);
    const p = r.ped({ x: start.x, z: start.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'civ' }), name: 'Runner', health: 110 });
    p.invincible = true;
    const b = r.blip({ entity: p, color: '#ff5090', label: 'Runner', flash: true, priority: 5 });
    // Follow marker on the runner: a fleeing ped is otherwise impossible to keep track of on foot.
    const mk = r.marker(p.x, p.z, { entity: p, radius: 2.4, color: 0xff5090, footOnly: true, arrow: true });
    // The quest's mechanic: close the gap and press E to tackle him. The tackle window is a
    // little longer than arm's reach so a late sprint actually reads as a lunge.
    let caught = false; let tackled = false; let lost = 0;
    const tackle = G.interactions && G.interactions.add({ x: p.x, z: p.z, radius: 5.0, footOnly: true, label: 'Tackle', mission: true, onInteract: () => { tackled = true; } });
    if (tackle) r.onCleanup(() => G.interactions.remove(tackle));
    const pdx = p.x - pl.x, pdz = p.z - pl.z, pd = Math.hypot(pdx, pdz) || 1;
    const fleeTo = { type: 'goto', x: p.x + pdx / pd * 30, z: p.z + pdz / pd * 30, radius: 1.2, speed: 4.9 }; p.script = fleeTo;
    r.objective('Chase down the <b>runner</b>');
    r.tick(dt => {
      if (caught) return;
      if (p.script !== fleeTo) p.script = fleeTo;
      // run away from the player at 4.9 m/s: slower than a sprint, faster than a jog, so the
      // chase is won by managing stamina instead of being a coin flip on the spawn angle
      const dx = p.x - pl.x, dz = p.z - pl.z, dd = Math.hypot(dx, dz) || 1;
      fleeTo.x = p.x + dx / dd * 30; fleeTo.z = p.z + dz / dd * 30;
      const d = Math.hypot(pl.x - p.x, pl.z - p.z);
      if (tackle) { tackle.x = p.x; tackle.z = p.z; }
      if (d < 1.6) tackled = true;
      G.hud.counter(`Runner: ${Math.round(d)} m`);
      if (d > 130) lost += dt; else lost = Math.max(0, lost - dt);
      if (lost > 12) r.abortAll(FAIL('You lost the runner.'));
    });
    const T = r.timer(75, 'Catch him', () => { });
    await r.wait(() => tackled || p.dead || T.expired);
    if (p.dead) { r.fail('The runner was killed.'); return; }
    if (T.expired) { r.fail('The runner got away.'); return; }
    caught = true; r.clearTimer(); G.hud.counter(null); if (tackle) tackle.enabled = false;
    r.removeMarker(mk); r.removeBlip(b);
    p.script = { type: 'stand', look: pl }; p.speedTarget = 0; p.invincible = false;
    // Tackle feedback: he goes down, then picks himself up before the interrogation.
    p.knockdown(1.2); G.audio.play('hit_body_fall', { pos: p, volume: 0.7 }); G.camera.shake(1.4, 0.3);
    await r.wait(() => !p.ragdollActive() && p.downT <= 0, { timeout: 3 }).catch(() => { });
    await r.interact(p.x, p.z, { label: 'Grab the notebook', text: 'Search the <b>runner</b>', color: 0xff5090, blipColor: '#ff5090' });
    await r.dialogue([['Runner', "Okay, okay! Take it! I was just paid to grab the bag, I don't know anything!", 4.6], ['Tee', "A paid runner. Which means somebody knew I was coming.", 4.4]]);
    r.reward(1700, 2);
  }
};

// ================================================================================================
// CHAPTER II
// ================================================================================================
const PAPER = {
  id: 'c2_paper', title: 'Paper Trail', side: true, chapter: 2, needs: ['m15'], giver: 'tee', giverName: 'Tee',
  letter: 'T', color: 0xff5090, reward: 4500, respect: 5, density: 0.3,
  where: atDoor('city_hall', -5, 4),
  async run(r) {
    const pl = G.player; const hall = doorOrHome('city_hall'); const home = doorOrHome('home');
    await r.dialogue([
      ['Tee', "The city sold Halcyon a zoning waiver the same week Calloway disappeared. The paper trail is in the records annex.", 5.8],
      ['Tee', "No alarms inside, but guards walk the annex. Hack the three terminals, download the files, and don't get seen.", 5.6],
    ]);
    const annex = walkSpot(hall.x - 35, hall.z + 18, 2, 10);
    const terms = [];
    for (let i = 0; i < 3; i++) { const s = walkSpot(annex.x + (i - 1) * 7, annex.z + (i % 2 ? 5 : -4), 2, 6); const t = r.prop(makeTerminal()); t.position.set(s.x, gy(s.x, s.z), s.z); t.rotation.y = Math.atan2(hall.x - s.x, hall.z - s.z); terms.push({ x: s.x, z: s.z, mesh: t, hacked: false }); }
    const guards = [];
    for (let i = 0; i < 5; i++) { const s = walkSpot(annex.x, annex.z, 6, 22); guards.push(watchGuard(r, s.x, s.z, { face: Math.random() * TAU, sweep: 0.8, name: 'Records guard', health: 90 })); }
    let alarm = false, detect = 0, downloading = false;
    r.tick(dt => {
      if (alarm) return;
      let seeing = false;
      for (const g of guards) { if (g.dead) continue; g.faceOverride = (g._face || 0) + Math.sin(G.time * 0.3 + (g._seed || 0)) * 0.9; if (canSee(g, pl, 24, 2.1)) seeing = true; }
      detect = clamp(detect + (seeing ? dt * (downloading ? 1.1 : 0.75) : -dt * 0.8), 0, 1);
      // Keep the detection meter on screen for the whole heist, especially while a download is
      // running: it is the mechanic the player must watch. The download itself reports through
      // the counter line below so the two never overwrite each other.
      G.hud.progress(seeing ? 'Detection — guard has eyes on you' : 'Detection', detect);
      if (detect >= 1) {
        alarm = true; G.hud.progress('', null); G.audio.play('wanted_up'); G.hud.notify('ALARM! Records security is moving!');
        alarmGuards(guards, pl);
        for (const p of suited(r, annex.x, annex.z, 4, { rmin: 8, rmax: 20, weapons: ['pistol', 'smg', 'ak47', 'shotgun'], sightRange: 70, health: 95 })) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; guards.push(p); }
      }
    });
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i];
      await r.goto(t, { mode: 'foot', radius: 3.2, text: `Reach <b>terminal ${i + 1}/3</b>`, label: 'Terminal', color: 0xff5090, blipColor: '#ff5090', arrow: true });
      await r.interact(t.x, t.z, { label: 'Hack terminal', color: 0xff5090, blipColor: '#ff5090', text: `Hack <b>terminal ${i + 1}/3</b>` });
      downloading = true;
      let dT = 0;
      // The ticker lives for the rest of the mission, so stop writing once this download is done;
      // otherwise its last 100% frame would overwrite the detection meter for the next terminal.
      r.tick(dt => { if (dT >= 1) return; dT = Math.min(1, dT + dt / 4.5); G.hud.counter(`Downloading files… ${Math.round(dT * 100)}%`); });
      await r.wait(() => dT >= 1);
      downloading = false; G.hud.counter(null); t.hacked = true;
      if (t.mesh.userData.screen) t.mesh.userData.screen.material.color.setHex(0x20c060);
      if (t.mesh.userData.light) t.mesh.userData.light.material.color.setHex(0x20ff80);
      G.audio.play('pickup'); G.hud.notify(`Files ${i + 1}/3 downloaded`, 'cash');
      await r.sleep(0.5);
    }
    if (!alarm) { await r.sleep(1.0); G.hud.notify('Security never saw you. Walk out quietly.'); }
    const gs = kerbSpot({ x: hall.x, z: hall.z }, 1, 90);
    const get = r.car('sedan', gs.x, gs.z, gs.yaw, { color: 0x2a2a34 }); get.name = 'Getaway'; get.locked = false;
    r.blip({ entity: get, color: '#ff5090', label: 'Getaway car', flash: true, priority: 4 });
    await r.goto(home, { mode: 'any', radius: 8, text: 'Bring the files to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
    if (G.police.stars > 0) await r.loseWanted('Lose the <b>security response</b>');
    await r.dialogue([['Tee', "Every waiver, every payment, every shell company. Wexler bought this city one permit at a time.", 5.6]]);
    r.reward(4500, 5);
  }
};

const BODYGUARD = {
  id: 'c2_bodyguard', title: 'The Bodyguard', side: true, chapter: 2, needs: ['m15'], giver: 'ellis', giverName: 'Ellis',
  letter: 'E', color: 0x8ad0ff, reward: 4700, respect: 5, density: 0.4,
  where: atDoor('city_hall', 6, 4),
  async run(r) {
    const pl = G.player; const hall = doorOrHome('city_hall'); const home = doorOrHome('home');
    await r.dialogue([
      ['Ellis', "I'm testifying at city hall tomorrow. Halcyon knows. They have already tried my house twice.", 5.4],
      ['Ellis', "I ride in the armoured SUV. You run interference. If they get through you, they get to me.", 5.2],
    ]);
    const ks = kerbSpot({ x: hall.x, z: hall.z }, -1, 130);
    const vip = r.car('suv', ks.x, ks.z, ks.yaw, { color: 0x1a2438 }); vip.name = 'Ellis escort'; vip.health = vip.maxHealth = 1800; vip.locked = false;
    const ellis = r.ped({ x: ks.x, z: ks.z, role: 'script', appearance: look('ellis'), name: 'Ellis', health: 180 }); ellis.enterVehicle(vip, 0, true);
    const driver = r.ped({ x: ks.x, z: ks.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'worker' }), name: 'Driver', health: 160 }); driver.enterVehicle(vip, 1, true);
    const via = new DriverAI(vip, 'idle', {}); vip.ai = via;
    // the player's escort car
    const pks = kerbSpot({ x: hall.x + 8, z: hall.z + 6 }, 1, 120);
    const car = r.car('muscle', pks.x, pks.z, pks.yaw, { color: 0x141820 }); car.name = 'Escort car'; car.locked = false;
    await r.enterVehicle(car, { text: 'Get in the <b>escort car</b> (F)', label: 'Escort car' });
    r.supply({ ammo: { smg: 220, ak47: 120, pistol: 80 }, equip: 'smg', hp: 100, armor: 80 });
    r.keepAlive(vip, 'Ellis\'s SUV'); r.keepAlive(ellis, 'Ellis');
    // The escort is the objective, so it needs its own blip: an ambush or a traffic jam can push
    // the SUV out of view, and without a marker the only feedback was the 130 m abandon timer.
    r.blip({ entity: vip, color: '#8ad0ff', label: 'Ellis\'s SUV', flash: true, priority: 5 });
    via.setMode('goto', { dest: home, cruise: 20, ignoreLights: true, stopDist: 16 });
    // Three ambush waves. The counter carries the SUV's hull percentage so the player can see
    // the armoured car taking damage instead of only learning about it from a sudden failure.
    const WAVES = 3;
    let away = 0, warned = false, lastReadout = '';
    r.tick(dt => {
      const d = Math.hypot((pl.vehicle || pl).x - vip.x, (pl.vehicle || pl).z - vip.z);
      if (d > 130) away += dt; else away = Math.max(0, away - dt);
      if (away > 11) { r.abortAll(FAIL('You left Ellis behind.')); return; }
      const hull = Math.max(0, Math.round(vip.health / vip.maxHealth * 100));
      if (hull > 0 && hull <= 35 && !warned) {
        warned = true;
        G.audio.play('car_hit_heavy', { volume: 0.3 });
        G.hud.notify('Ellis\'s SUV is falling apart — break off and cover it!');
      }
      // only touch the DOM when the readout actually changes; this tick runs every frame
      const readout = `${hull}|${Math.round(d / 5)}`;
      if (readout !== lastReadout) {
        lastReadout = readout;
        G.hud.counter(`Ellis's SUV <b>${hull}%</b> · ${Math.round(d / 5) * 5} m`);
      }
    });
    r.objective('Escort <b>Ellis</b> across town');
    for (let w = 0; w < WAVES; w++) {
      await r.wait(() => { const total = Math.hypot(vip.x - ks.x, vip.z - ks.z); return total > 90 + w * 160 || via.arrived; }, { timeout: 50 }).catch(() => { });
      const p = laneSpot({ x: vip.x + 70, z: vip.z + 40 }, 1, 250);
      hostileCar(r, 'suv', p.x, p.z, p.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 29, blip: true, color: 0x0a0a10, health: 85, target: vip, mode: 'chase', noBail: true });
      const foot = suited(r, vip.x + 30, vip.z + 20, 3, { rmin: 8, rmax: 20, weapons: ['smg', 'ak47', 'pistol'], sightRange: 80, health: 95 });
      for (const q of foot) { q.target = Math.random() < 0.5 ? vip : pl; q.setMode('attack', 999); q.aggroT = 999; }
      r.speak('Ellis', w === 0 ? "Contact left!" : w === 1 ? "They're trying to box us in!" : "Last push! Get me to Grove Street!", 3);
      await r.sleep(8 + w * 2);
    }
    r.objective('Get Ellis to <b>Grove Street</b>');
    await r.wait(() => via.arrived || dist2(vip.x, vip.z, home.x, home.z) < 60 * 60, { timeout: 90 }).catch(() => { });
    G.hud.counter(null);
    if (vip.wrecked) r.fail('Ellis\'s SUV was destroyed.');
    await r.dialogue([['Ellis', "I've never been so glad to see a beat-up muscle car. The hearing is still on.", 4.6], ['Ellis', "When this is over, I'll remember who drove.", 3.4]]);
    car.mission = false; car.owner = 'player'; vip.mission = false; vip.owner = 'player';
    r.reward(4700, 5);
  }
};

const ALLEY = {
  id: 'c2_alley', title: 'Alley Run', side: true, chapter: 2, needs: ['c2_paper'], giver: 'birdie', giverName: 'Birdie',
  letter: 'B', color: 0x40ffd0, reward: 3600, respect: 4, density: 0.4,
  where: atDoor('club', -5, 4),
  async run(r) {
    const pl = G.player; const club = doorOrHome('club'); const center = D('Vinewood') || club;
    await r.dialogue([
      ['Birdie', "You can shoot, but can you run? I know a courier who moves packages through Vinewood on foot.", 4.8],
      ['Birdie', "Eight checkpoints, on foot — no wheels. Beat him there and the package is ours; cut the alleys, not the roads.", 6.2],
    ]);
    const cps = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.3;
      const p = stableSpot('c2_alley_' + i, center.x + Math.cos(a) * (60 + (i % 3) * 34), center.z + Math.sin(a) * (60 + (i % 2) * 42), 2, 10);
      cps.push(p);
    }
    const start = walkSpot(center.x, center.z, 4, 12);
    const runner = r.ped({ x: start.x + 3, z: start.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'civ' }), name: 'Courier', health: 120 });
    runner.invincible = true; runner.script = { type: 'goto', x: cps[0].x, z: cps[0].z, radius: 1.8, speed: 5.1 };
    // the opponent is a real, visible racer: a radar blip keeps him findable even when the
    // alleys swallow him, so "courier 3/8" on the HUD has a place to point at
    r.blip({ entity: runner, color: '#ff5090', icon: 'dot', label: 'Courier', priority: 3 });
    let ri = 0, pi = 0, done = false, warnedCar = false;
    // The clock is a backstop, not the race: the course is ~540 m of footwork, so a 150 s
    // window punished a clean jog while the courier was still on the far side of Vinewood.
    const T = r.timer(240, 'Time left', () => { });
    // The HUD used to print the courier's counter twice (the "Checkpoint n/8" half was his
    // index, not the player's), so progress looked like it fell backwards as he ran. Track
    // both racers, say who is ahead, and explain the one dead end: a foot checkpoint cannot
    // trigger from inside a car, so a driving player must be told to get out.
    let lastPi = -1, lastRi = -1, lastCar = false;
    r.tick(dt => {
      if (done) return;
      if (ri < cps.length && Math.hypot(runner.x - cps[ri].x, runner.z - cps[ri].z) < 3.2) {
        ri++;
        if (ri >= cps.length) { done = true; r.abortAll(FAIL('The courier beat you to the finish.')); return; }
        runner.script = { type: 'goto', x: cps[ri].x, z: cps[ri].z, radius: 1.8, speed: 5.1 };
      }
      const car = !!pl.vehicle;
      if (car === lastCar && pi === lastPi && ri === lastRi) return; // no per-frame DOM write
      lastCar = car; lastPi = pi; lastRi = ri;
      if (car) {
        G.hud.counter('Alley Run is on foot — <b>get out of the vehicle</b>');
        if (!warnedCar) { warnedCar = true; G.hud.notify('Alley Run is a foot race — leave the vehicle to reach the checkpoint'); }
        return;
      }
      const ahead = pi - ri;
      const tag = ahead > 0 ? `<b>${ahead} ahead</b>` : ahead < 0 ? `${-ahead} behind` : 'neck and neck';
      G.hud.counter(`Checkpoint ${Math.min(pi + 1, cps.length)}/${cps.length} · courier ${Math.min(ri + 1, cps.length)}/${cps.length} · ${tag}`);
    });
    r.failIf(() => T.expired, 'You ran out of time — the courier slipped away.');
    G.hud.big('GO!', '', 'Alley Run', 1.2);
    for (let i = 0; i < cps.length; i++) {
      await r.goto(cps[i], { mode: 'foot', radius: 3.0, text: `Foot checkpoint <b>${i + 1}/${cps.length}</b>`, label: 'Checkpoint', color: 0x40ffd0, blipColor: '#40ffd0', arrow: true });
      G.audio.play('ding', { volume: 0.3 });
      if (done) return;
      pi = i + 1;
    }
    done = true; r.clearTimer(); G.hud.counter(null); runner.script = { type: 'stand', look: pl };
    await r.dialogue([['Birdie', "Not bad for a man who drives everywhere. The package is yours.", 4.2]]);
    r.reward(3600, 4);
  }
};

const COLLECTOR = {
  id: 'c2_collector', title: 'Buried Truth', side: true, chapter: 2, needs: ['m15'], giver: 'nia', giverName: 'Nia',
  letter: 'N', color: 0xffd040, reward: 4200, respect: 4, density: 0.4,
  where: atDoor('home', 7.5, 2),
  async run(r) {
    const pl = G.player; const home = doorOrHome('home'); const center = D('El Corona') || D('Willowfield') || home;
    await r.dialogue([
      ['Nia', "Tee found a map in Calloway's ledger. Three stashes buried around the old rail yards. Cash, documents, maybe worse.", 5.6],
      ['Nia', "No markers, no neon. I borrowed a metal detector. Follow the signal until it screams.", 5.2],
    ]);
    const spots = [];
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.7; const s = stableSpot('c2_collect_' + i, center.x + Math.cos(a) * (95 + i * 35), center.z + Math.sin(a) * (80 + i * 30), 3, 22); spots.push({ ...s, dug: false }); }
    let found = 0; let nearest = null;
    // detector readout state: the raw percentage alone does not say whether a sweep is closing
    // in, so it is banded in plain language and paired with a slow warmer / colder trend.
    let lastNearest = null, lastBest = 1e9, trend = 0, trendT = 0;
    const T = r.timer(300, 'Daylight', () => { });
    r.failIf(() => T.expired, 'You ran out of daylight.');
    r.tick(dt => {
      nearest = null; let best = 1e9;
      for (const s of spots) { if (s.dug) continue; const d = Math.hypot(pl.x - s.x, pl.z - s.z); if (d < best) { best = d; nearest = s; } }
      if (!nearest) { G.hud.counter(null); return; }
      if (nearest !== lastNearest) { lastNearest = nearest; lastBest = best; trend = 0; trendT = 0; }
      // sample the trend on a slow clock so a single sidestep does not flip the arrow
      trendT += dt;
      if (trendT >= 0.4) { trend = best < lastBest - 0.7 ? 1 : best > lastBest + 0.7 ? -1 : 0; lastBest = best; trendT = 0; }
      // beyond detector range there is nothing to read; leave the HUD to the drive objective
      if (best > 67) { G.hud.counter(null); return; }
      const sig = Math.round(clamp(100 - best * 1.5, 0, 100));
      const band = sig >= 96 ? 'PEAK — dig here' : sig >= 75 ? 'hot' : sig >= 45 ? 'warm' : 'cold';
      const cue = trend > 0 ? ` · <b style="color:#8fe36b">warmer</b>` : trend < 0 ? ' · colder' : '';
      G.hud.counter(`Detector: ${sig}% · ${band}${cue}`);
      if (Math.random() < dt * (sig / 100) * 2.5) signalBeep(0.1 + sig / 300);
    });
    // each stash gets a wide search marker; the detector is the real guide
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const mk = r.marker(s.x, s.z, { radius: 34, color: 0xffd040, once: false, arrow: false, height: 20 });
      const sblip = r.blip({ x: s.x + Math.cos(i * 2.1) * 24, z: s.z + Math.sin(i * 2.1) * 24, color: '#ffd040', icon: 'dot', label: 'Search area', priority: 3 });
      await r.goto({ x: s.x, z: s.z }, { mode: 'any', radius: 34, text: `Search the area for <b>stash ${i + 1}/3</b>`, label: 'Search area', color: 0xffd040, blipColor: '#ffd040', arrow: false, blip: false });
      if (i === 0) G.hud.notify('Detector: the tone rises as you close in — sweep until it peaks, then press E to dig.');
      // inside the area, the exact marker is hidden: use the detector signal
      r.objective(`Follow the detector to <b>stash ${i + 1}/3</b>`);
      await r.wait(() => Math.hypot(pl.x - s.x, pl.z - s.z) < 2.8);
      s.dug = true; found++;
      const stash = r.prop(makeStash()); stash.position.set(s.x, gy(s.x, s.z), s.z);
      await r.sleep(0.3);
      if (pl.vehicle) await r.leaveVehicle({ text: 'Get out and <b>dig up the stash</b>' });
      await r.interact(s.x, s.z, { label: 'Dig up the stash', color: 0xffd040, blipColor: '#ffd040', text: `Dig up <b>stash ${i + 1}/3</b>` });
      if (stash.userData.case) stash.userData.case.visible = false;
      G.audio.play('cash'); G.hud.notify(`Stash ${found}/3 recovered`, 'cash');
      r.removeMarker(mk); r.removeBlip(sblip);
      await r.sleep(0.5);
    }
    r.clearTimer(); G.hud.counter(null);
    await r.dialogue([['Nia', "Three stashes. These are the names of every cop and clerk who ever took Halcyon money.", 5.4], ['Nia', "We can use this. We can actually use this.", 3.2]]);
    r.reward(4200, 4);
  }
};

const MARKER = {
  id: 'c2_marker', title: 'The Marker', side: true, chapter: 2, needs: ['c2_paper'], giver: 'tee', giverName: 'Tee',
  letter: 'T', color: 0xff5090, reward: 4300, respect: 4, density: 0.4,
  where: atDoor('label', -5, 4),
  async run(r) {
    const pl = G.player; const label = doorOrHome('label'); const dest = doorOrHome('mansion');
    const carSpot = kerbSpot({ x: label.x, z: label.z }, 1, 120);
    const car = r.car('sedan', carSpot.x, carSpot.z, carSpot.yaw, { color: 0x222630 }); car.name = 'Fixer car'; car.health = car.maxHealth = 1600;
    const driver = r.ped({ x: carSpot.x, z: carSpot.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), name: 'Fixer', health: 160 });
    driver.enterVehicle(car, 0, true);
    // The parked fixer car is scenery once he gets out: only the drive to the meeting
    // depends on it staying intact, so a passer-by clipping the empty car can't fail us.
    let parked = false;
    r.failIf(() => driver.dead || (!parked && car.wrecked), () => parked ? 'The fixer was taken out.' : 'The fixer was taken out before the meeting.');
    await r.dialogue([
      ['Tee', "The fixer who paid Ellis's security is parked at the label. I need eyes on where he goes.", 4.8],
      ['Tee', "Plant a tracker under his bumper. Then you can hang back — the beacon does the following for you.", 5.2],
    ]);
    await r.goto(car, { mode: 'foot', radius: 5, text: 'Reach the <b>fixer car</b>', label: 'Fixer car', color: 0xff5090, blipColor: '#ff5090', arrow: false });
    await r.interact(car.x, car.z, { label: 'Plant tracker', color: 0xff5090, blipColor: '#ff5090', text: 'Plant the <b>tracker</b> under the car' });
    const tracker = r.blip({ entity: car, color: '#40ffd0', label: 'Tracker signal', flash: true, priority: 5 });
    await r.sleep(1.5);
    const ai = new DriverAI(car, 'goto', { dest, cruise: 22, ignoreLights: true, stopDist: 15 }); car.ai = ai;
    r.objective('Follow the <b>tracker signal</b> at your own pace');
    await r.goto(car, { mode: 'any', radius: 18, follow: true, text: 'Follow the <b>tracker signal</b>', label: 'Tracker', color: 0x40ffd0, blipColor: '#40ffd0', arrow: false });
    await r.wait(() => ai.arrived || dist2(car.x, car.z, dest.x, dest.z) < 55 * 55, { timeout: 120 }).catch(() => { });
    ai.setMode('idle'); car.input.handbrake = true; r.removeBlip(tracker);
    await r.sleep(1.2);
    driver.exitVehicle(false);
    parked = true;
    const meet = walkSpot(dest.x, dest.z, 4, 10);
    const guest = r.ped({ x: meet.x + 1.3, z: meet.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), name: 'Buyer', health: 140 });
    driver.script = { type: 'goto', x: meet.x, z: meet.z, radius: 1.2, speed: 2.4 }; guest.script = { type: 'stand' };
    await r.wait(() => dist2(driver.x, driver.z, meet.x, meet.z) < 3 * 3, { timeout: 10 }).catch(() => { });
    driver.script = { type: 'stand', look: guest }; lookAt(driver, guest); lookAt(guest, driver);
    r.speak('Tee', "That's the buyer. Hang back out of sight with a clean line on them, then press E to record.", 4.6);
    const vantage = clearVantage(meet.x, meet.z, 9, 17);
    // A player who tails the fixer by car can park on the vantage and never see the
    // foot-only marker complete; nudge them out of the vehicle when they get there.
    let footWarned = false;
    r.tick(() => {
      if (footWarned || !pl.vehicle) return;
      if (dist2(pl.vehicle.x, pl.vehicle.z, vantage.x, vantage.z) < 14 * 14) { footWarned = true; G.hud.notify('Get out on foot for a clean recording'); }
    });
    await r.goto(vantage, { mode: 'foot', radius: 4, text: 'Record the meeting from a <b>clean vantage</b>', label: 'Vantage', color: 0x40ffd0, blipColor: '#40ffd0', arrow: true });
    await new Promise((resolve, reject) => {
      const it = G.interactions.add({ x: meet.x, z: meet.z, radius: 30, label: 'Record meeting', mission: true, footOnly: true, onInteract: () => {
        const d = Math.hypot(pl.x - meet.x, pl.z - meet.z);
        if (d < 6) { G.hud.notify('Too close — back off or they will spot you'); return; }
        if (G.world.raycast(pl.x, pl.z, meet.x, meet.z, gy(pl.x, pl.z) + 1.6, gy(meet.x, meet.z) + 1.4)) { G.hud.notify('No clear line of sight — find a clean angle'); return; }
        G.interactions.remove(it); G.audio.play('pickup'); G.hud.notify('Meeting recorded'); resolve(true);
      } });
      r.onCleanup(() => G.interactions.remove(it)); r.abortP.catch(reject);
    });
    await r.dialogue([['Tee', "Got it. The fixer names Marsh, and Marsh names Wexler. This is the first time the chain points at her directly.", 5.8]]);
    r.reward(4300, 4);
  }
};

const SPIKE = {
  id: 'c2_spike', title: 'Spike Strip', side: true, chapter: 2, needs: ['m16'], giver: 'hollis', giverName: 'Hollis',
  letter: 'H', color: 0x39c4d8, reward: 4600, respect: 5, density: 0.4,
  where: atDoor('pier_shop', 4, 4),
  async run(r) {
    const pl = G.player; const shop = doorOrHome('pier_shop'); const home = doorOrHome('home');
    await r.dialogue([
      ['Hollis', "They're moving an informant through the city in a prison bus. He knows where Wexler keeps her originals.", 5.6],
      ['Hollis', "I can't stop a bus with a car. But I can give you a spike strip. Pick the spot, lay it down, and wait.", 5.4],
    ]);
    const ambushSpot = laneSpot({ x: shop.x + 210, z: shop.z + 80 }, 1, 260);
    const pks = kerbSpot({ x: shop.x, z: shop.z }, 1, 100);
    const car = r.car('muscle', pks.x, pks.z, pks.yaw, { color: 0x1c2230 }); car.name = 'Pursuit car'; car.locked = false;
    r.keepAlive(car, 'The pursuit car');
    await r.enterVehicle(car, { text: 'Get in the <b>pursuit car</b> (F)', label: 'Pursuit car' });
    r.supply({ ammo: { smg: 200, pistol: 80, shotgun: 30 }, equip: 'smg', hp: 100, armor: 70 });
    await r.goto(ambushSpot, { mode: 'vehicle', radius: 16, text: 'Drive to the <b>ambush point</b>', label: 'Ambush point', color: 0x39c4d8, blipColor: '#39c4d8', arrow: false });
    if (pl.vehicle) await r.leaveVehicle({ text: 'Get out and <b>deploy the spike strip</b>' });
    await r.goto(ambushSpot, { mode: 'foot', radius: 5, text: 'Deploy the <b>spike strip</b>', label: 'Spike strip', color: 0x39c4d8, blipColor: '#39c4d8', arrow: true });
    const strip = r.prop(makeSpikeStrip()); strip.position.set(ambushSpot.x, gy(ambushSpot.x, ambushSpot.z), ambushSpot.z); strip.rotation.y = ambushSpot.yaw; strip.visible = false;
    await r.interact(ambushSpot.x, ambushSpot.z, { label: 'Deploy spike strip', color: 0x39c4d8, blipColor: '#39c4d8', text: 'Deploy the <b>spike strip</b>' });
    strip.visible = true; G.audio.play('door_close');
    // the strip is armed, not an objective any more: say so and clear the road before the bus arrives
    r.objective('Spike strip armed — wait for the <b>transport</b>');
    G.hud.notify('Spike strip armed — stay off the road');
    // bus comes down the lane after a short wait
    const busStart = laneSpot({ x: ambushSpot.x - Math.sin(ambushSpot.yaw) * 105, z: ambushSpot.z - Math.cos(ambushSpot.yaw) * 105 }, 1, 220);
    const bus = r.car('bus', busStart.x, busStart.z, busStart.yaw, { color: 0x2a2e36 }); bus.name = 'Prison transport'; bus.health = bus.maxHealth = 2600; bus.ghost = 45;
    const bd = r.ped({ x: busStart.x, z: busStart.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'cop' }), name: 'Transport driver', health: 150 }); bd.enterVehicle(bus, 0, true);
    const guards = [];
    for (let i = 0; i < 2; i++) { const g = r.ped({ x: busStart.x, z: busStart.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'cop' }), weapon: i ? 'smg' : 'shotgun', ammo: 999, health: 100, skill: 0.35 }); g.enterVehicle(bus, i + 1, true); g.sightRange = 0; guards.push(g); }
    const bai = new DriverAI(bus, 'goto', { dest: ambushSpot, cruise: 24, ignoreLights: true, stopDist: 0 }); bus.ai = bai;
    const bb = r.blip({ entity: bus, color: '#ff3030', label: 'Prison transport', flash: true, priority: 5 });
    r.speak('Hollis', "Here it comes. Stay off the road!", 3);
    r.failIf(() => bus.wrecked, 'The transport was destroyed. The informant is dead.');
    // let the bus reach the strip: 14 m short put the trap behind the front bumper, so the
    // "tires are gone" line played while the transport had never touched it. 3 m leaves the
    // front axle right on the spikes.
    const HIT = 3;
    await r.wait(() => dist2(bus.x, bus.z, ambushSpot.x, ambushSpot.z) < HIT * HIT, { timeout: 75 }).catch(() => { });
    // a stuck traffic bus must not soft-lock the ambush: bring it in on the lane, front axle over the spikes
    if (dist2(bus.x, bus.z, ambushSpot.x, ambushSpot.z) > HIT * HIT) {
      const dx = ambushSpot.x - bus.x, dz = ambushSpot.z - bus.z, dd = Math.hypot(dx, dz) || 1;
      bus.x = ambushSpot.x - dx / dd * 3; bus.z = ambushSpot.z - dz / dd * 3; bus.yaw = Math.atan2(dx, dz); bus.vx = bus.vz = 0;
    }
    bus.ghost = 0;
    bai.setMode('idle'); bus.input.handbrake = true; bus.health = Math.max(120, bus.health); G.police.setStars(1);
    // sell the blowout at the wheels the strip was laid across
    const hx = bus.x + Math.sin(bus.yaw) * 3.0, hz = bus.z + Math.cos(bus.yaw) * 3.0, hy = gy(hx, hz) + 0.4;
    G.audio.play('screech', { volume: 0.5, pos: { x: hx, y: hy, z: hz } });
    G.audio.play('car_hit_light', { volume: 0.4, pos: { x: hx, y: hy, z: hz } });
    for (let i = 0; i < 3; i++) G.fx.tireSmoke(hx + (i - 1) * 1.1, hy, hz, 0, 0);
    G.fx.sparks(hx, hy - 0.1, hz, 8);
    r.speak('Hollis', "Tires are gone! Get the informant out of there!", 3.4);
    for (const g of guards) { g.hostile = true; g.role = 'enemy'; g.exitVehicle(false); g.target = pl; g.setMode('attack', 999); g.aggroT = 999; g.sightRange = 80; }
    bd.script = { type: 'flee', from: pl }; bd.role = 'script'; bd.hostile = false;
    r.removeBlip(bb);
    await r.killAll(guards, { text: 'Clear the <b>transport guards</b>', label: 'Guards' });
    const informant = r.ped({ x: bus.x, z: bus.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'civ' }), name: 'Informant', health: 110 });
    informant.invincible = true; informant.script = { type: 'stand' };
    await r.goto(informant, { mode: 'foot', radius: 4, text: 'Reach the <b>informant</b>', label: 'Informant', color: 0x39c4d8, blipColor: '#39c4d8', arrow: true });
    await r.interact(informant.x, informant.z, { label: 'Free the informant', color: 0x39c4d8, blipColor: '#39c4d8', text: 'Free the <b>informant</b>' });
    informant.invincible = false; informant.role = 'ally'; informant.followPlayer = true; informant.script = null; squad(r, [informant]);
    await r.dialogue([['Informant', "They were moving me because I saw the vault. The originals are under the bank, in Wexler's private lockup.", 5.4]]);
    await r.goto(home, { mode: 'any', radius: 9, text: 'Get the <b>informant</b> to Grove Street', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
    if (G.police.stars > 0) await r.loseWanted('Lose the <b>cops</b>');
    await r.dialogue([['Hollis', "He talks. That is more than most of them do.", 4.2]]);
    car.mission = false; car.owner = 'player';
    r.reward(4600, 5);
  }
};

const BOUNTY = {
  id: 'c2_bounty', title: 'The Bounty', side: true, chapter: 2, needs: ['m16'], giver: 'mack', giverName: 'Mack',
  letter: 'M', color: 0x40d0ff, reward: 5000, respect: 5, density: 0.4,
  where: atDoor('police_hq', 5, 3),
  async run(r) {
    const pl = G.player; const hq = doorOrHome('police_hq');
    await r.dialogue([
      ['Mack', "Bail bonds is a dirty business, but it pays. Three skips on the board, all wanted alive.", 4.8],
      ['Mack', "Rico runs when he sees a car. Lena carries a piece. Tiny thinks he is a one-man army. Bring them in any order.", 5.8],
    ]);
    const carSpot = kerbSpot({ x: hq.x, z: hq.z }, 1, 100);
    const car = r.car('sedan', carSpot.x, carSpot.z, carSpot.yaw, { color: 0x343a44 }); car.name = 'Bounty car'; car.locked = false;
    r.blip({ entity: car, color: '#40d0ff', label: 'Bounty car', priority: 4 });
    const targets = [
      { id: 'gas_c', name: 'Rico', tag: 'Rico', weapon: null, health: 120, speed: 5.2 },
      { id: 'motel', name: 'Lena', tag: 'Lena', weapon: 'pistol', health: 150, speed: 4.6 },
      { id: 'gym', name: 'Tiny', tag: 'Tiny', weapon: 'bat', health: 200, speed: 4.0 }
    ];
    const peds = [];
    for (let i = 0; i < targets.length; i++) {
      const T = targets[i]; const d = doorOrHome(T.id); const s = walkSpot(d.x, d.z, 5, 12);
      const p = r.ped({ x: s.x, z: s.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: T.name === 'Lena' ? 'business' : 'gangster', gender: T.name === 'Lena' ? 'f' : 'm' }), name: T.name, weapon: T.weapon || undefined, ammo: T.weapon ? 100 : 0, health: T.health });
      p.invincible = true; p.canDrop = false; p.script = { type: 'stand' }; p.bounty = T; p.captured = false;
      const b = r.blip({ entity: p, color: '#ffd040', label: T.name, priority: 4 }); p.bountyBlip = b;
      peds.push(p);
    }
    let delivered = 0; const captured = [];
    r.objective('Bring in <b>three bounties</b> — any order');
    while (captured.length < peds.length) {
      const remaining = peds.filter(p => !p.captured);
      G.hud.counter(`Bounties secured: ${captured.length}/3`);
      // wait for the player to get near one, then make that one run / fight
      await r.wait(() => remaining.some(p => !p.dead && Math.hypot(pl.x - p.x, pl.z - p.z) < 26));
      const p = remaining.find(q => !q.dead && Math.hypot(pl.x - q.x, pl.z - q.z) < 26);
      if (!p) break;
      const T = p.bounty;
      if (!p.started) {
        p.started = true; p.script = { type: 'flee', from: pl }; p.speedTarget = T.speed;
        if (T.weapon) { p.hasGun && p.hasGun() ? null : p.give(T.weapon, 100, true); p.role = 'enemy'; p.hostile = true; p.target = pl; p.setMode('attack', 999); p.aggroT = 999; p.sightRange = 60; }
      }
      // chase and subdue with E
      await r.goto(p, { mode: 'foot', radius: 4.6, follow: true, text: `Catch <b>${T.name}</b>`, label: T.name, color: 0xffd040, blipColor: '#ffd040', arrow: true });
      p.script = { type: 'stand', look: pl }; if (p.hostile) { p.hostile = false; p.role = 'script'; p.target = null; }
      p.speedTarget = 0;
      await r.interact(p.x, p.z, { label: `Subdue ${T.name}`, radius: 4.2, color: 0xffd040, blipColor: '#ffd040', text: `Subdue <b>${T.name}</b>` });
      p.captured = true; captured.push(p); p.invincible = false; p.script = { type: 'follow', target: pl, dist: 3 }; p.role = 'ally'; p.followPlayer = true; p.brave = false; p.give('fist', 0, true);
      r.removeBlip(p.bountyBlip); delivered++;
      G.hud.notify(`${T.name} secured (${delivered}/3)`, 'cash'); await r.sleep(0.6);
    }
    G.hud.counter(null);
    await r.goto(hq, { mode: 'foot', radius: 5, text: 'Deliver the bounties to <b>Mack</b>', label: 'Mack', color: 0x40d0ff, blipColor: '#40d0ff', arrow: true });
    await r.dialogue([['Mack', "Three for three, all breathing. You are either very good or very lucky.", 4.4]]);
    r.reward(5000, 5);
  }
};

const RAMPAGE = {
  id: 'c2_rampage', title: 'Rampage', side: true, chapter: 2, needs: ['m17'], giver: 'sol', giverName: 'Sol',
  letter: 'S', color: 0xf0d030, reward: 4800, respect: 6, density: 0.3,
  where: atDoor('ls_warehouse', 5, 3),
  async run(r) {
    const pl = G.player; const wh = doorOrHome('ls_warehouse');
    await r.dialogue([
      ['Sol', "Wexler's people think they can buy the Soles. I want them to remember what this city was before her money.", 5.2],
      ['Sol', "Fifteen of her new crew are meeting at the warehouse. You have ninety seconds. Make it loud.", 5.0],
    ]);
    r.supply({ ammo: { smg: 500, pistol: 100 }, equip: 'smg', hp: 100, armor: 80 });
    const T = r.timer(90, 'Rampage', () => { });
    let killed = 0, spawned = 0, waveT = 0;
    const all = [];
    const spawnWave = () => {
      const n = Math.min(5, 15 - spawned);
      const w = spawnGang(r, wh.x + (Math.random() - 0.5) * 40, wh.z + (Math.random() - 0.5) * 40, n, { gang: GANG.SOLES, weapons: ['pistol', 'smg', 'bat', 'shotgun', 'pistol'], rmin: 3, rmax: 16, sightRange: 90, health: 65, skill: 0.25 });
      for (const p of w) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; all.push(p); }
      spawned += n; waveT = 0; G.hud.subtitle(n === 5 ? 'More Soles! Keep going!' : 'Last of them!', 2.2, 'Sol');
    };
    spawnWave();
    r.tick(dt => {
      const alive = all.filter(p => !p.dead && !p.removeMe).length;
      killed = all.filter(p => p.dead || p.removeMe).length;
      G.hud.counter(`Kills: ${Math.min(killed, 15)}/15 · ${Math.max(0, Math.ceil(T.left))}s`);
      if (spawned < 15) { waveT += dt; if (waveT > 8 || alive === 0) spawnWave(); }
    });
    await r.wait(() => all.filter(p => p.dead || p.removeMe).length >= 15 || T.expired);
    G.hud.counter(null); r.clearTimer();
    if (killed < 15) { r.fail('The rampage ended before the crew was wiped out.'); return; }
    await r.dialogue([['Sol', "That is how you send a message. The Soles remember, and so will Wexler.", 4.6]]);
    r.reward(4800, 6);
  }
};

const FUSE = {
  id: 'c2_fuse', title: 'Short Fuse', side: true, chapter: 2, needs: ['m17'], giver: 'birdie', giverName: 'Birdie',
  letter: 'B', color: 0x40ffd0, reward: 5200, respect: 5, density: 0.3,
  where: atDoor('club', 6, 4),
  async run(r) {
    const pl = G.player; const club = doorOrHome('club');
    await r.dialogue([
      ['Birdie', "Wexler's welcome gift is under a car at the club. Bomb squad is forty minutes out. You have three.", 5.2],
      ['Birdie', "I can walk you through it. Blue wire is a decoy. Cut the red one. Do not touch anything else.", 5.4],
    ]);
    const spot = kerbSpot({ x: club.x, z: club.z }, 1, 100);
    const car = r.car('sedan', spot.x, spot.z, spot.yaw, { color: 0x2a2a30 }); car.name = 'Booby-trapped car'; car.locked = true;
    const bomb = r.prop(makeBomb()); bomb.position.set(car.x + 1.1, gy(car.x + 1.1, car.z), car.z + 0.3); bomb.rotation.y = car.yaw;
    const T = r.timer(150, 'Bomb', () => { });
    r.failIf(() => T.expired, 'The bomb exploded. You were too slow.');
    r.objective('Find the bomb under the <b>car</b>');
    await r.goto(car, { mode: 'foot', radius: 6, text: 'Get to the <b>booby-trapped car</b>', label: 'Bomb', color: 0x40ffd0, blipColor: '#40ffd0', arrow: false });
    await r.interact(bomb.position.x, bomb.position.z, { label: 'Inspect the bomb', color: 0x40ffd0, blipColor: '#40ffd0', text: 'Inspect the <b>bomb</b>' });
    r.objective('Cut the <b>red wire</b>');
    r.speak('Birdie', "Red, blue, yellow. Blue is a decoy. Cut the red wire.", 4.2);
    // three wire interactables, only the red one is safe
    const idx = [[-0.42, 0xd02020, 'red'], [0, 0x2050d0, 'blue'], [0.42, 0xe0c020, 'yellow']];
    const result = await new Promise((resolve, reject) => {
      const its = [];
      const done = (safe) => { for (const it of its) G.interactions.remove(it); resolve(safe); };
      for (const [off, , name] of idx) {
        const it = G.interactions.add({ x: bomb.position.x + Math.cos(bomb.rotation.y) * off, z: bomb.position.z - Math.sin(bomb.rotation.y) * off, radius: 2.4, label: `Cut the ${name} wire`, mission: true, footOnly: true, onInteract: () => done(name === 'red') });
        its.push(it);
      }
      r.onCleanup(() => { for (const it of its) G.interactions.remove(it); });
      r.abortP.catch(reject);
    });
    if (!result) { r.fail('You cut the wrong wire. The bomb detonated.'); return; }
    r.clearTimer(); G.audio.play('pickup'); G.hud.notify('Bomb defused. Everyone goes home.', 'cash');
    bomb.visible = false;
    await r.dialogue([['Birdie', "I heard the click from here. Good hands, Mercer.", 4.2]]);
    r.reward(5200, 5);
  }
};

const AUCTION = {
  id: 'c2_auction', title: 'The Auction', side: true, chapter: 2, needs: ['c2_bodyguard', 'm16'], giver: 'nia', giverName: 'Nia',
  letter: 'N', color: 0xffd040, reward: 6500, respect: 7, density: 0.3,
  where: atDoor('label', 6, 4),
  async run(r) {
    const pl = G.player; const label = doorOrHome('label'); const home = doorOrHome('home');
    await r.dialogue([
      ['Nia', "Halcyon is auctioning the originals tonight at the label. Rich buyers, private security, one briefcase with everything.", 5.8],
      ['Nia', "No guns until the case is in your hand. Once it is, every guard in the building will know.", 5.0],
    ]);
    const back = besideDoor('label', 0, 12) || walkSpot(label.x, label.z, 4, 10);
    const podium = r.prop(makePodium()); podium.position.set(back.x, gy(back.x, back.z), back.z); podium.rotation.y = label.yaw;
    const brief = r.prop(makeBriefcase()); brief.position.set(back.x, gy(back.x, back.z) + 1.16, back.z);
    r.tick(dt => { brief.position.y = gy(back.x, back.z) + 1.16 + Math.sin(G.time * 2) * 0.03; brief.rotation.y += dt * 0.5; });
    const guests = [];
    for (let i = 0; i < 8; i++) { const s = walkSpot(back.x, back.z, 6, 16); const g = r.ped({ x: s.x, z: s.z, role: 'civ', appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }) }); g.mode = 'loiter'; guests.push(g); }
    const guards = suited(r, back.x, back.z, 4, { rmin: 8, rmax: 20, weapons: ['pistol', 'smg', 'shotgun', 'pistol'], sightRange: 55, health: 100 });
    for (const g of guards) { g.hostile = false; g.role = 'script'; g.script = { type: 'stand' }; g.aggroT = 0; g.sightRange = 0; }
    await r.goto(back, { mode: 'foot', radius: 18, text: 'Reach the <b>auction</b> at Club Zenith', label: 'Auction', color: 0xffd040, blipColor: '#ffd040', arrow: false });
    r.speak('Nia', "Wait for the bidding to peak. Then take the case and run.", 3.4);
    const T = r.timer(35, 'Auction', () => { });
    r.objective('Wait for the <b>auction</b> to start');
    await r.sleep(6);
    r.speak('Auctioneer', "Lot twelve. The Halcyon archive. Bidding opens at fifty thousand.", 4);
    await r.sleep(3);
    r.clearTimer();
    r.objective('Grab the <b>briefcase</b>');
    await r.goto(back, { mode: 'foot', radius: 4, text: 'Grab the <b>briefcase</b>', label: 'Case', color: 0xffd040, blipColor: '#ffd040', arrow: true });
    await r.interact(back.x, back.z, { label: 'Take the briefcase', color: 0xffd040, blipColor: '#ffd040', text: 'Take the <b>briefcase</b>' });
    brief.visible = false; r.supply({ ammo: { smg: 220, ak47: 120, pistol: 80 }, equip: 'smg', hp: 100, armor: 80 });
    G.audio.play('wanted_up'); G.hud.notify('ALARM! Halcyon security is locking down the building!');
    for (const g of guards) { g.role = 'enemy'; g.hostile = true; g.target = pl; g.setMode('attack', 999); g.aggroT = 999; g.sightRange = 85; }
    for (const p of suited(r, back.x, back.z, 5, { rmin: 10, rmax: 24, weapons: ['smg', 'ak47', 'shotgun', 'pistol'], sightRange: 80, health: 95 })) { p.target = pl; p.setMode('attack', 999); p.aggroT = 999; }
    G.police.setStars(2);
    r.objective('Escape with the <b>briefcase</b>');
    const gs = kerbSpot({ x: label.x, z: label.z }, 1, 120);
    const get = r.car('sports', gs.x, gs.z, gs.yaw, { color: 0xf0f0f4 }); get.name = 'Getaway sports car'; get.locked = false;
    r.blip({ entity: get, color: '#ffd040', label: 'Getaway car', flash: true, priority: 4 });
    await r.goto(home, { mode: 'vehicle', radius: 8, text: 'Get the case to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
    if (G.police.stars > 0) await r.loseWanted('Lose the <b>cops</b>');
    await r.dialogue([['Nia', "The originals. Every account, every name, every body. We can end this.", 5.2], ['Nia', "I'm proud of you, Jay.", 3.2]]);
    r.reward(6500, 7);
  }
};

export const SIDE_EXTRA = [REPO, DEBTS, SCHOOL, RACE, PHOTO, FIRE, DERBY, GETAWAY, GLASS, RUNNER, PAPER, BODYGUARD, ALLEY, COLLECTOR, MARKER, SPIKE, BOUNTY, RAMPAGE, FUSE, AUCTION];
