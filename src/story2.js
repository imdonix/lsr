// LOS SANTOS RISING - story missions 8-14
import { G } from './state.js';
import { clamp, dist2, rrange, pick, TAU, sleep } from './util.js';
import { CLS, GANG } from './mapdata.js';
import { L, D, doorOf, dist, laneSpot, kerbSpot, walkSpot, aroundSpots, gy, look, shot, orbit, twoShot, faceEachOther, lookAt, spawnGang, spawnCops, hostileCar, besideDoor, chatter, squad, ally } from './storylib.js';
import { DriverAI } from './driverai.js';
import { Ped } from './peds.js';

const homeWhere = (side) => () => besideDoor('home', side, 1.5);
const FAIL = (reason) => Object.assign(new Error('fail'), { isFail: true, reason });

function suits(r, cx, cz, n, o = {}) { // Calloway's security: suited men with serious guns
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = walkSpot(cx, cz, o.rmin ?? 3, o.rmax ?? 14);
    const p = r.ped({ x: s.x, z: s.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), weapon: pick(o.weapons || ['smg', 'ak47', 'shotgun', 'pistol']), ammo: 999, health: o.health ?? 110, blip: o.blip ? { color: '#ff3030' } : false, skill: o.skill ?? 0.38 });
    p.sightRange = o.sightRange ?? 50; p.guard = true; p.home = { x: s.x, z: s.z }; p.mode = 'loiter'; p.canDrop = true;
    out.push(p);
  }
  return out;
}
function enemyWave(r, cx, cz, n, o = {}) { return spawnGang(r, cx, cz, n, { gang: o.gang ?? GANG.BLUELINE, weapons: o.weapons || ['smg', 'pistol', 'shotgun'], rmin: o.rmin ?? 18, rmax: o.rmax ?? 30, sightRange: 90, blip: false, health: o.health, skill: o.skill }); }

export const STORY2 = [
  // ============================================================================================ 8
  {
    id: 'm08', title: 'Vinewood Nights', needs: ['m07'], giver: 'tee', letter: 'T', color: 0xff5090, reward: 3000, respect: 6, density: 0.4,
    where: () => besideDoor('label', 6, 4) || besideDoor('club', 6, 4),
    async run(r) {
      const tee0 = r.giver, pl = G.player; const club = doorOf('club') || doorOf('label'); const cl = club.l;
      const fx = Math.sin(club.yaw), fz = Math.cos(club.yaw);
      const lotC = walkSpot(cl.x - fx * (cl.d / 2 + 9), cl.z - fz * (cl.d / 2 + 9), 0, 6);
      await r.cutscene([
        twoShot(tee0, pl, 7.0, { dist: 4, side: 1, drift: 0.45 }),
        twoShot(tee0, pl, 5.8, { dist: 3.2, side: 1, drift: -0.25, fov: 50 }),
        twoShot(tee0, pl, 5.2, { dist: 5.2, side: 1, drift: 0.3, fov: 42 })
      ], [
        ['Tee', "Nia's phone is full of ledger photos. I can prove Calloway launders for Blue Line, but not without the source books.", 5.6],
        ['Tee', "They live on a server above Club Zenith. The service door on the back lot is unwatched until midnight. I need ten minutes inside.", 5.6],
        ['Jay', "And I hold the lot.", 2],
        ['Tee', "You hold the lot. Whatever shows up, keep them off the stairs.", 3.6]
      ], { fadeIn: false });
      const tee = ally(r, 'tee', tee0.x, tee0.z, { weapon: 'pistol', follow: true, health: 120 }); G.peds.remove(tee0); r.giver = null;
      r.keepAlive(tee, 'Tee');
      const ks = kerbSpot({ x: tee.x, z: tee.z }, 1, 100);
      const car = r.car('coupe', ks.x, ks.z, ks.yaw, { color: 0xc04a7a }); car.name = 'Bandit';
      squad(r, [tee]);
      G.sky.hour = 22.5;
      r.objective('Get in the <b>car</b> with Tee');
      await r.enterVehicle(car, { text: 'Get in the <b>car</b> (F). Tee will follow.', label: 'Car' });
      await r.goto(lotC, { mode: 'vehicle', radius: 16, text: 'Drive to the <b>back lot of Club Zenith</b>', label: 'Back lot', color: 0xff5090, blipColor: '#ff5090', stop: true });
      await r.leaveVehicle({ text: 'Get out. <b>Tee</b> is going in.' });
      tee.followPlayer = false; tee.role = 'script'; tee.script = { type: 'goto', x: club.x - fx * 2, z: club.z - fz * 2, radius: 1.5, speed: 2.8 };
      await r.say('Tee', "Service door's open. Ten minutes. Don't let anyone up the stairs.", 3.6);
      await r.sleep(1.2);
      tee.group.visible = false; tee.x = lotC.x; tee.z = lotC.z; tee.script = { type: 'stand' }; tee.invincible = true;
      r.supply({ ammo: { smg: 220, pistol: 60 }, equip: 'smg', hp: 100, armor: 60 });
      r.cache(lotC.x, lotC.z, { health: 2, armor: 1, r: 6 });
      const tm = r.timer(70, 'Tee needs', () => { });
      r.objective('Defend the <b>back lot</b> until Tee finishes');
      const lotBlip = r.blip({ x: lotC.x, z: lotC.z, color: '#ff5090', label: 'Back lot', priority: 4 });
      const lotMark = r.marker(lotC.x, lotC.z, { radius: 26, color: 0xff5090, once: false, arrow: false, height: 30 });
      // the lot must be held only while Tee is inside (timer running); once it expires the
      // guard cleanup / limo escape legitimately leave the lot and must not fail the mission
      let awayT = 0; r.tick(dt => { if (tm.expired) return; const d = Math.hypot((pl.vehicle || pl).x - lotC.x, (pl.vehicle || pl).z - lotC.z); awayT = d > 90 ? awayT + dt : 0; if (awayT > 16) r.abortAll(FAIL('You abandoned Tee.')); else if (awayT > 4 && awayT < 4.05) G.hud.notify('Get back to the lot!'); });
      let waveT = 0, waves = 0; const all = [];
      r.tick(dt => {
        waveT -= dt; if (tm.expired || waves > 5) return;
        if (waveT <= 0) {
          waveT = 14; waves++;
          const a = Math.random() * TAU; const n = 2 + (waves > 2 ? 1 : 0);
          const w = enemyWave(r, lotC.x + Math.cos(a) * 30, lotC.z + Math.sin(a) * 30, n, { gang: 0, weapons: ['pistol', 'pistol', 'bat', 'smg'], rmin: 0, rmax: 6, health: 70, skill: 0.3 });
          for (const p of w) { p.role = 'enemy'; p.appearance && 0; p.target = pl; p.setMode('attack', 90); p.aggroT = 90; p.hostile = true; all.push(p); }
          if (waves === 3) G.hud.subtitle('Security is swarming the lot!', 2.4, 'Tee');
        }
      });
      await r.wait(() => tm.expired);
      r.clearTimer(); r.removeMarker(lotMark); r.removeBlip(lotBlip); r.objective('Finish off the last <b>guards</b>');
      for (const p of all) if (!p.dead && !p.blipObj) p.blipObj = r.blip({ entity: p, color: '#ff3030', label: 'Guard', priority: 3 });
      await r.wait(() => all.filter(p => !p.dead).length <= 1, { timeout: 25 }).catch(() => { });
      tee.group.visible = true; tee.role = 'ally'; tee.followPlayer = true; tee.script = null;
      r.speak('Tee', "Got it! Every payment, every account! Now let's get out of here!", 3.6);
      const ls = kerbSpot({ x: lotC.x, z: lotC.z }, 1, 60);
      const limo = r.car('limo', ls.x, ls.z, ls.yaw, { color: 0x0f0f14 }); limo.name = "Calloway's limo"; r.keepAlive(limo, 'The limo');
      r.objective("Steal <b>Calloway's limo</b>");
      await r.enterVehicle(limo, { text: "Steal <b>Calloway's limo</b> (F)", label: 'Limo' });
      const fs = laneSpot({ x: club.x + fx * 30, z: club.z + fz * 30 }, 1, 120);
      const chasers = [hostileCar(r, 'suv', fs.x, fs.z, fs.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 30, blip: true, color: 0x101018, health: 70 }), hostileCar(r, 'suv', fs.x - 20, fs.z - 20, fs.yaw, { n: 2, gang: 0, weapon: 'pistol', speed: 30, blip: true, color: 0x101018, health: 70 })];
      G.police.setStars(1);
      const safe = doorOf('pier_shop') || doorOf('home');
      r.speak('Tee', "Two SUVs! Drive, drive! Get us to the pier!", 3);
      await r.goto(safe, { mode: 'vehicle', radius: 14, text: 'Escape to the <b>Santa Maria pier</b>', label: 'Pier', color: 0xff5090, blipColor: '#ff5090', needVehicle: limo });
      await r.dialogue([['Tee', 'We did it. I can take this to the DA... to anyone who is not already paid for.', 4.2], ['Tee', "Calloway isn't the only head of this snake. A cop named Harlan is on every page.", 4.2]]);
      limo.mission = false; limo.owner = 'player'; G.police.clear();
      r.reward(3000, 6);
    }
  },
  // ============================================================================================ 9
  {
    id: 'm09', title: 'Hit List', needs: ['m07'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 3500, respect: 8, density: 0.4,
    where: homeWhere(4.5),
    afterDone() { const b = doorOf('vk_hq'); if (b) { G.game.paintTerritory(b.x, b.z, 150, GANG.EMERALD); G.game.territories.add('jefferson'); } },
    async run(r) {
      const ray = r.giver, pl = G.player; const hq = doorOf('vk_hq') || doorOf('vk_base') || doorOf('home'); const m = G.map, w = G.world; const home = doorOf('home');
      await r.dialogue([
        ['Ray', "Duke Price runs the Kings. This afternoon his lieutenants meet outside the Jefferson headquarters.", 5.2],
        ['Ray', "You're not walking up to that door. Take the rifle, get across the street, and end the chain of command from a distance.", 6],
        ['Ray', "When the last lieutenant drops, Duke runs. Don't let him reach the highway.", 4.6]
      ]);
      r.supply({ ammo: { sniper: 30, pistol: 80 }, hp: 100, armor: 50 }); r.give('sniper', 0, true);
      G.hud.notify('Sniper: hold RIGHT MOUSE to scope, LEFT MOUSE to fire. Headshots are fatal.');
      const hc = doorOf('vk_hq');
      const yard = []; for (let i = 0; i < 4; i++) yard.push(walkSpot(hc.x + Math.sin(hc.yaw) * 10, hc.z + Math.cos(hc.yaw) * 10, 3, 12));
      // find a vantage point with clear sight lines
      let best = null, bs = -1;
      for (let a = 0; a < TAU; a += 0.2) for (const rr of [80, 100, 120]) {
        const px = hc.x + Math.cos(a) * rr, pz = hc.z + Math.sin(a) * rr;
        if (m.roadDistAt(px, pz) < 2.5 || m.classAt(px, pz) === CLS.WATER || w.groundY(px, pz) < 0.6 || !w.placement.propClear(px, pz, 1.2)) continue;
        let sc = 0; for (const y of yard) if (!w.raycast(px, pz, y.x, y.z, w.groundY(px, pz) + 1.6, w.groundY(y.x, y.z) + 1.5)) sc++;
        // prefer spots that are close to the road (short walk from the car) when the sight score ties
        sc += Math.max(0, 1 - m.roadDistAt(px, pz) / 40) * 0.5;
        if (sc > bs) { bs = sc; best = { x: px, z: pz }; }
      }
      best = best || walkSpot(hc.x, hc.z, 80, 120);
      const lts = [];
      for (let i = 0; i < 4; i++) { const p = r.ped({ x: yard[i].x, z: yard[i].z, role: 'enemy', gang: GANG.VIOLET, hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { gang: 2, role: 'gangster' }), weapon: i % 2 ? 'smg' : 'pistol', ammo: 999, health: 100, name: 'Lieutenant', skill: 0.3 }); p.sightRange = 40; p.guard = true; p.home = { x: yard[i].x, z: yard[i].z }; p.mode = 'loiter'; p.canDrop = true; lts.push(p); }
      const sk = kerbSpot({ x: hc.x + 25, z: hc.z + 10 }, 1, 100);
      const suv = r.car('suv', sk.x, sk.z, sk.yaw, { color: 0x3a1a4a }); suv.health = suv.maxHealth = 1000; suv.name = "Duke's Bulldog";
      const duke = r.ped({ x: hc.x, z: hc.z - 4, role: 'script', appearance: look('duke'), name: 'Duke Price', weapon: 'smg', ammo: 500, health: 130, skill: 0.3, blip: { color: '#9a4fd0', label: 'Duke' } });
      duke.script = { type: 'stand' };
      // the car waits for you at Grove Street (the nest is a short drive away)
      const hk = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const car = r.car('sports', hk.x, hk.z, hk.yaw, { color: 0x4a4a52 }); car.name = 'Kestrel'; car.locked = false;
      await r.enterVehicle(car, { text: 'Take the <b>Kestrel</b> parked outside (F)', label: 'Kestrel' });
      await r.goto(best, { mode: 'any', radius: 6, text: 'Get to the <b>sniping position</b>', label: 'Sniper nest', color: 0xffd040, blipColor: '#ffd040', arrow: true });
      if (pl.vehicle) { r.objective('Get out of the car and scope the yard'); await r.wait(() => !pl.vehicle || dist2(pl.x, pl.z, best.x, best.z) > 60 * 60, { timeout: 40 }).catch(() => { }); }
      pl.equip('sniper');
      r.cache(best.x, best.z, { health: 1, armor: 0, r: 3 });
      r.speak('Ray', 'That is the yard. Four lieutenants. Take your time, take your shots.', 4);
      let dukeGo = false; let dukeDone = false; let bailed = false;
      const driveOff = () => { duke.enterVehicle(suv, 0, true); const ai = new DriverAI(suv, 'goto', { dest: doorOf('ls_warehouse') || doorOf('home'), cruise: 27, aggressive: false, ignoreLights: true, stopDist: 15 }); suv.ai = ai; dukeDone = true; };
      r.tick(dt => { if (!dukeGo && lts.some(p => p.dead)) { dukeGo = true; duke.script = { type: 'goto', x: suv.x, z: suv.z, radius: 2.4, speed: 5, onArrive: driveOff }; duke.role = 'script'; G.hud.subtitle('Duke is running for his car!', 2.4, 'Ray'); } });
      await r.killAll(lts, { text: 'Snipe the <b>four lieutenants</b>', label: 'Lieutenants' });
      r.speak('Ray', "Duke's in his SUV! Stop him!", 2.6);
      await r.wait(() => dukeDone || duke.dead);
      if (!duke.dead && !duke.vehicle) driveOff();
      const b = r.blip({ entity: suv, color: '#9a4fd0', label: 'Duke', flash: true, priority: 5 });
      r.objective('Stop <b>Duke Price</b>. Snipe him, or chase him down');
      // a beaten-up SUV gives up: Duke bails out and fights on foot. Only once the escape is under way,
      // so shooting the parked Bulldog cannot flip him hostile (and lie) before the chase starts.
      r.tick(dt => {
        if (bailed || duke.dead || !dukeDone) return;
        if (suv.health < suv.maxHealth * 0.6 || suv.wrecked) { bailed = true; if (suv.ai) suv.ai.setMode('idle'); suv.input.handbrake = true; duke.exitVehicle(false); duke.role = 'enemy'; duke.hostile = true; duke.target = pl; duke.setMode('attack', 90); duke.aggroT = 90; duke.sightRange = 90; r.removeBlip(b); r.objective('Finish <b>Duke Price</b> on foot'); G.hud.subtitle('He is out of the car! Finish him!', 2.6, 'Ray'); }
      });
      r.tick(dt => { const d = Math.hypot(suv.x - (pl.vehicle || pl).x, suv.z - (pl.vehicle || pl).z); r._dl = (d > 420 && !duke.dead && !bailed ? (r._dl || 0) + dt : 0); if (r._dl > 14) r.abortAll(FAIL('Duke got away.')); });
      await r.wait(() => duke.dead);
      r.removeBlip(b);
      await r.say('Ray', "The Kings have no head now. Jefferson is open. Good work.", 3.6);
      r.reward(3500, 8);
    }
  },
  // ============================================================================================ 10
  {
    id: 'm10', title: 'Fire Sale', needs: ['m08', 'm09'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 1800, respect: 5, density: 0.8,
    where: homeWhere(4.5), keepWanted: false,
    async run(r) {
      const ray = r.giver, pl = G.player; const home = doorOf('home');
      await r.cutscene([twoShot(ray, pl, 7, { dist: 4.5, side: -1, drift: 0.3 })], [
        ['Ray', "Channel 7 is running Harlan's story. 'Gang warlord Jay Mercer.' Nice picture of you from the Turf War.", 5.4],
        ['Ray', "He's coming with half the department. They will say it's a raid. It's a hit.", 4.6],
        ['Ray', "Jay! Sirens! Get out! Find a Pay 'n' Spray and lose them!", 4]
      ], { fadeIn: false });
      const spawnCop = (x, z) => { const s = laneSpot({ x, z }, 1, 200); if (!s.nr) return; const v = G.vehicles.spawn('police', s.x, s.z, s.yaw + Math.PI, { owner: 'police', color: 0xeeeeee }); v.setSiren(true); const d = new Ped({ x: s.x, z: s.z, role: 'cop', appearance: G.models.peds.randomAppearance(Math.random, { role: 'cop' }) }); d.give('pistol', 200); G.peds.add(d); d.enterVehicle(v, 0, true); new DriverAI(v, 'chase', { target: pl, aggressive: true, ignoreLights: true, stopDist: 7 }); };
      G.police.setStars(2);
      if (pl.money < 150) { pl.addMoney(150 - pl.money); G.hud.notify('Ray tossed you some cash for the Pay n Spray'); }
      r.supply({ hp: 100, armor: 40 });
      for (const o of [[210, 90], [-230, 60]]) spawnCop(home.x + o[0], home.z + o[1]);
      let reinf = 0; r.tick(dt => { reinf += dt; if (reinf > 14 && reinf < 14.2 && G.police.stars > 0) { reinf = 20; for (const o of [[60, -250], [-90, 230]]) spawnCop(pl.x + o[0], pl.z + o[1]); } });
      const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const car = r.car('sedan', ks.x, ks.z, ks.yaw, { color: 0x3a3a48 }); car.name = 'Getaway sedan';
      r.blip({ entity: car, color: '#ffd040', label: 'Car', flash: true, priority: 5 });
      // nearest Pay 'n' Spray
      let pns = null, bd = 1e18; for (const id of ['pns_a', 'pns_b', 'pns_c']) { const d = doorOf(id); if (!d) continue; const dd = dist2(d.x, d.z, pl.x, pl.z); if (dd < bd) { bd = dd; pns = d; } }
      if (pns) r.blip({ x: pns.x, z: pns.z, color: '#39c4d8', label: "Pay 'n' Spray", flash: true, priority: 5 });
      r.objective("Take the <b>car</b> and escape the <b>police</b>. Use the Pay 'n' Spray or break line of sight");
      await r.wait(() => G.police.stars === 0);
      await r.sleep(1);
      await r.dialogue([
        ['Marcus', "Jay, it's me. Don't hang up. I know I burned you.", 3.6],
        ['Marcus', "Harlan fed me a story about Nia. I believed it. They never planned to let her go. She is in Calloway's hands.", 6],
        ['Marcus', "Blue Line runs Calloway's guns through a dock warehouse in Ocean Docks. Meet me there. Let me fix this.", 5.6]
      ]);
      r.reward(1800, 5);
    }
  },
  // ============================================================================================ 11
  {
    id: 'm11', title: 'Harbor Heist', needs: ['m10'], giver: 'marcus', letter: 'M', color: 0x40ff80, reward: 4500, respect: 8, density: 0.3,
    where: () => { const b = doorOf('bl_dock'); if (!b) return null; const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw); const s = walkSpot(b.x + fx * 60, b.z + fz * 60, 0, 10); return s; },
    async run(r) {
      const marcus0 = r.giver, pl = G.player; const dock = doorOf('bl_dock') || doorOf('home'); const home = doorOf('home');
      await r.cutscene([twoShot(marcus0, pl, 9, { dist: 4.5, side: 1, drift: 0.4 })], [
        ['Marcus', "I've got no excuse, Jay. I sold out the set for a promise from a crooked cop.", 4.4],
        ['Jay', "We'll talk about it after we get my sister back.", 3],
        ['Marcus', "Fair. Blue Line's warehouse is full of Calloway's guns. One truck leaves at dawn for the Estate.", 5.2],
        ['Marcus', "We take the warehouse, take the truck, and Ray's crew gets armed. Then we pull the ledger trail to the top.", 5.4]
      ], { fadeIn: false });
      const marcus = ally(r, 'marcus', marcus0.x, marcus0.z, { weapon: 'ak47', health: 220 }); G.peds.remove(marcus0); r.giver = null; r.keepAlive(marcus, 'Marcus');
      r.supply({ ammo: { ak47: 200, shotgun: 40, pistol: 60 }, equip: 'ak47', hp: 100, armor: 70 });
      const guards = spawnGang(r, dock.x, dock.z, 7, { gang: GANG.BLUELINE, weapons: ['smg', 'pistol', 'pistol', 'ak47', 'pistol', 'smg', 'shotgun'], rmin: 6, rmax: 26, sightRange: 42, blip: false, health: 85, skill: 0.33 });
      r.cache(dock.x + Math.sin(dock.yaw) * 45, dock.z + Math.cos(dock.yaw) * 45, { health: 2, armor: 1, r: 7 });
      const ts = kerbSpot({ x: dock.x, z: dock.z }, 1, 120);
      const truck = r.car('truck', ts.x, ts.z, ts.yaw, { color: 0x1a2438 }); truck.name = 'Cargo truck'; truck.health = truck.maxHealth = 2200; truck.locked = false;
      r.keepAlive(truck, 'The truck');
      const hint = G.game.state === 'play' ? G.hud.notify('Take cover behind containers. Tap C to crouch.') : 0;
      await r.goto({ x: dock.x, z: dock.z }, { mode: 'any', radius: 70, text: 'Go to the <b>Blue Line warehouse</b> at Ocean Docks', label: 'Blue Line dock', color: 0x3a7be0, blipColor: '#3a7be0', arrow: false });
      await r.killAll(guards, { text: 'Clear the <b>dock guards</b>', label: 'Guards' });
      r.speak('Marcus', 'Clear! The truck is loaded! Take it, I will cover the rear!', 3.4);
      marcus.followPlayer = true;
      await r.enterVehicle(truck, { text: 'Steal the <b>cargo truck</b> (F)', label: 'Truck' });
      squad(r, [marcus]);
      const back = laneSpot({ x: dock.x - 60, z: dock.z + 20 }, 1, 200); const p2 = laneSpot({ x: dock.x + 70, z: dock.z - 40 }, 1, 200);
      const chasers = [hostileCar(r, 'suv', back.x, back.z, back.yaw, { n: 2, gang: GANG.BLUELINE, weapon: 'smg', speed: 27, blip: true, color: 0x1a2a5a }), hostileCar(r, 'suv', p2.x, p2.z, p2.yaw, { n: 2, gang: GANG.BLUELINE, weapon: 'pistol', speed: 27, blip: true, color: 0x1a2a5a })];
      G.police.setStars(2);
      r.speak('Marcus', 'Blue Line reinforcements and cops! Hit the gas!', 3.2);
      r.failIf(() => truck.health < 330, 'The truck is wrecked.');
      await r.goto(home, { mode: 'vehicle', radius: 8, slow: 14, needVehicle: truck, text: 'Deliver the <b>truck</b> to Grove Street', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.dialogue([['Ray', 'A truck full of rifles. Jay, these people will follow you anywhere after this.', 4.4], ['Marcus', "She's at the Estate, Jay. Calloway's place on the hills. No more lies from me.", 4.6], ['Ray', "Marcus told me everything on the way in. A man can fall and still get back up. He rides with us.", 5]]);
      truck.mission = false; truck.owner = 'player'; G.police.clear();
      r.reward(4500, 8);
    }
  },
  // ============================================================================================ 12
  {
    id: 'm12', title: 'Cash in Transit', needs: ['m11'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 8000, respect: 8, density: 0.6,
    where: homeWhere(4.5),
    async run(r) {
      const ray = r.giver, pl = G.player; const bank = doorOf('bank') || doorOf('home'); const est = doorOf('mansion') || doorOf('label') || doorOf('home'); const home = doorOf('home');
      await r.cutscene([twoShot(ray, pl, 7, { dist: 4.5, side: 1, drift: 0.4 })], [
        ['Ray', "Calloway washes his money through Los Santos Savings and Trust. Every Friday an armored truck carries the cash up to the Estate.", 6],
        ['Ray', "We need it. More than that, every dollar missing makes his buyers nervous. Nervous men make mistakes.", 5],
        ['Ray', "Marcus rides with you. Stop the truck, take it, and don't stop for a siren.", 4.4]
      ], { fadeIn: false });
      const marcus = ally(r, 'marcus', ray.x + 2, ray.z, { weapon: 'smg', health: 220 }); r.keepAlive(marcus, 'Marcus');
      const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const car = r.car('muscle', ks.x, ks.z, ks.yaw, { color: 0x12161e }); car.name = 'Stinger';
      r.supply({ ammo: { smg: 240, shotgun: 40, pistol: 60 }, equip: 'smg', hp: 100, armor: 70 });
      squad(r, [marcus]);
      await r.enterVehicle(car, { text: 'Get in the <b>Stinger</b> (F)', label: 'Car' });
      await r.goto({ x: bank.x, z: bank.z }, { mode: 'vehicle', radius: 60, text: 'Drive to the <b>Los Santos Savings &amp; Trust</b>', label: 'Bank', color: 0xffd040, blipColor: '#ffd040', arrow: false });
      // convoy
      const bs = laneSpot({ x: bank.x, z: bank.z }, 1, 120);
      const truck = r.car('swatvan', bs.x, bs.z, bs.yaw, { color: 0x1c1c22 }); truck.name = 'Armored truck'; truck.health = truck.maxHealth = 1500;
      const td = r.ped({ x: bs.x, z: bs.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'swat' }), weapon: 'pistol', ammo: 999, health: 80, skill: 0.3 }); td.enterVehicle(truck, 0, true); td.sightRange = 0;
      const tg = r.ped({ x: bs.x, z: bs.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'swat' }), weapon: 'smg', ammo: 999, health: 80, skill: 0.3 }); tg.enterVehicle(truck, 1, true);
      const tai = new DriverAI(truck, 'goto', { dest: { x: est.x, z: est.z }, cruise: 21, stopDist: 20 });
      const esc1 = hostileCar(r, 'sedan', bs.x - 12 * Math.sin(bs.yaw), bs.z - 12 * Math.cos(bs.yaw), bs.yaw, { n: 2, gang: 0, weapon: 'smg', mode: 'follow', speed: 24, color: 0x101018, health: 70 });
      esc1.v.ai.setMode('follow', { leader: truck, gap: 11 }); esc1.v.ai.aggressive = true;
      const esc2 = hostileCar(r, 'sedan', bs.x + 14 * Math.sin(bs.yaw), bs.z + 14 * Math.cos(bs.yaw), bs.yaw, { n: 2, gang: 0, weapon: 'pistol', mode: 'follow', speed: 24, color: 0x101018, health: 70 });
      esc2.v.ai.setMode('follow', { leader: truck, gap: 11 }); esc2.v.ai.aggressive = true;
      // escorts do not fire until the heist is noticed
      const tb = r.blip({ entity: truck, color: '#ff3030', label: 'Armored truck', flash: true, priority: 5 });
      r.speak('Marcus', "There's the truck! Two escorts. Hit it before it reaches the highway!", 3.6);
      r.objective('Stop the <b>armored truck</b>. Ram it or shoot it until it gives');
      let bailed = false;
      r.tick(dt => {
        if (!bailed && (truck.health < truck.maxHealth * 0.42 || truck.wrecked || td.dead)) { bailed = true; tai.setMode('idle'); truck.input.handbrake = true; for (const p of truck.occupants()) { p.exitVehicle(true); p.role = 'enemy'; p.hostile = true; p.target = pl; p.setMode('attack', 60); p.aggroT = 60; p.sightRange = 70; } }
        if (!bailed && dist2(truck.x, truck.z, (pl.vehicle || pl).x, (pl.vehicle || pl).z) > 340 * 340) r.abortAll(FAIL('The armored truck got away.'));
      });
      await r.wait(() => bailed);
      r.removeBlip(tb);
      const foes = [td, tg, ...esc1.peds, ...esc2.peds];
      r.cache(truck.x, truck.z, { health: 1, armor: 1, r: 8 });
      await r.killAll(foes, { text: 'Take out the <b>guards</b>', label: 'Guards' });
      truck.health = Math.max(truck.health, 700); truck.onFire = false; truck.input.handbrake = false; truck.locked = false;
      r.keepAlive(truck, 'The truck');
      await r.enterVehicle(truck, { text: 'Take the <b>armored truck</b> (F)', label: 'Truck' });
      G.police.setStars(3); squad(r, [marcus]);
      r.speak('Marcus', 'Alarm is tripped! Cops incoming! Get it to Grove Street!', 3.4);
      r.failIf(() => truck.health < 200, 'The truck is wrecked.');
      await r.goto(home, { mode: 'vehicle', radius: 8, slow: 14, needVehicle: truck, text: 'Take the truck to <b>Grove Street</b>. Lose the cops!', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.loseWanted('Lose the <b>cops</b>');
      await r.dialogue([['Ray', "Count it, Marcus. Count it twice. It's... all of it. Jay, this is how we win.", 4.6], ['Ray', 'Harlan is next. Marcus knows where he works on his off hours.', 4]]);
      truck.mission = false; truck.owner = 'player';
      r.reward(8000, 8);
    }
  },
  // ============================================================================================ 13
  {
    id: 'm13', title: 'Broken Badge', needs: ['m12'], giver: 'marcus', letter: 'M', color: 0x40ff80, reward: 4000, respect: 10, density: 0.4,
    where: homeWhere(-4.5),
    async run(r) {
      const marcus0 = r.giver, pl = G.player; const gar = doorOf('garage_harlan') || doorOf('bl_dock') || doorOf('home'); const home = doorOf('home');
      await r.dialogue([
        ['Marcus', "Harlan runs his real business from a chop shop in Ocean Flats. His cars, his cops, his evidence locker.", 5.4],
        ['Marcus', "He's the one who handed Nia to Calloway. I want him alive long enough to talk.", 4.4],
        ['Jay', "I want him to answer for it. Let's go.", 3]
      ]);
      const marcus = ally(r, 'marcus', marcus0.x, marcus0.z, { weapon: 'ak47', health: 220 }); G.peds.remove(marcus0); r.giver = null; r.keepAlive(marcus, 'Marcus');
      r.supply({ ammo: { shotgun: 60, ak47: 240, pistol: 60 }, equip: 'ak47', hp: 100, armor: 100 });
      const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100); const car = r.car('muscle', ks.x, ks.z, ks.yaw, { color: 0x2a2a30 }); car.name = 'Stinger';
      squad(r, [marcus]);
      await r.enterVehicle(car, { text: 'Get in the <b>Stinger</b> (F)', label: 'Car' });
      const cops = spawnCops(r, gar.x, gar.z, 5, { rmin: 6, rmax: 22, weapons: ['shotgun', 'smg', 'pistol', 'pistol', 'smg'], sightRange: 50, health: 90 });
      r.cache(gar.x + 28 * Math.sin(gar.yaw), gar.z + 28 * Math.cos(gar.yaw), { health: 2, armor: 1, r: 7 });
      const harlan = r.ped({ x: gar.x, z: gar.z, role: 'enemy', hostile: true, appearance: look('harlan'), weapon: 'shotgun', ammo: 999, health: 210, name: 'Lt. Harlan', blip: { color: '#ff3030', label: 'Harlan' } });
      harlan.armor = 60; harlan.sightRange = 55; harlan.guard = true; harlan.home = { x: gar.x, z: gar.z }; harlan.mode = 'loiter';
      const hs = kerbSpot({ x: gar.x, z: gar.z }, 1, 100);
      const pcar = r.car('police', hs.x, hs.z, hs.yaw, { color: 0xeeeeee }); pcar.name = "Harlan's cruiser"; pcar.health = pcar.maxHealth = 1600;
      await r.goto({ x: gar.x, z: gar.z }, { mode: 'any', radius: 70, text: "Go to <b>Harlan's chop shop</b> in Ocean Flats", label: "Harlan's chop shop", color: 0xff3030, blipColor: '#ff3030', arrow: false });
      r.speak('Marcus', 'Crooked uniforms everywhere. Keep moving and use cover!', 3.2);
      r.objective("Clear out <b>Harlan's cops</b>");
      for (const c of cops) if (!c.blipObj) c.blipObj = r.blip({ entity: c, color: '#ff3030', label: 'Cop', priority: 3 });
      let fled = false;
      r.tick(dt => {
        if (!fled && (cops.filter(c => !c.dead).length <= 2 || harlan.health < 130)) {
          fled = true; harlan.role = 'script'; harlan.script = { type: 'goto', x: pcar.x, z: pcar.z, radius: 2.5, speed: 6, onArrive: () => { harlan.enterVehicle(pcar, 0, true); const ai = new DriverAI(pcar, 'goto', { dest: doorOf('hospital_a') ? { x: doorOf('hospital_a').x, z: doorOf('hospital_a').z } : { x: home.x, z: home.z }, cruise: 40, aggressive: true, ignoreLights: true }); pcar.ai = ai; ai.cruise = 40; const fl = new DriverAI(pcar, 'flee', {}); fl.fleeFrom = { x: pl.x, z: pl.z }; fl.panicT = 999; pcar.ai = fl; pcar.setSiren(true); G.hud.subtitle("He's bolting in his cruiser!", 2.4, 'Marcus'); } };
          harlan.hostile = false; harlan.target = null;
        }
      });
      await r.wait(() => fled);
      await r.killAll(cops, { text: "Finish off Harlan's <b>cops</b>", label: 'Cops' }).catch(e => { throw e; });
      const bl = r.blip({ entity: harlan, color: '#ff3030', label: 'Harlan', flash: true, priority: 5 }); const bl2 = r.blip({ entity: pcar, color: '#ff3030', label: 'Harlan', priority: 5 });
      r.objective('Chase down <b>Harlan</b>. Wreck his cruiser');
      let away = 0;
      r.tick(dt => { const p = pl.vehicle || pl; const d = Math.hypot((pcar.vehicle !== undefined && harlan.vehicle ? pcar : harlan).x - p.x, (harlan.vehicle ? pcar : harlan).z - p.z); away = d > 420 ? away + dt : 0; if (away > 10) r.abortAll(FAIL('Harlan escaped.')); });
      await r.wait(() => harlan.dead || (!harlan.vehicle && fled && pcar.wrecked) || pcar.wrecked);
      r.removeBlip(bl); r.removeBlip(bl2);
      if (!harlan.dead) {
        // Harlan survived the crash: he crawls out and talks
        harlan.role = 'script'; harlan.health = 30; harlan.script = { type: 'stand' };
        await r.goto({ x: harlan.x, z: harlan.z }, { mode: 'foot', radius: 6, text: 'Confront <b>Harlan</b>', label: 'Harlan', follow: false });
        await r.dialogue([['Harlan', "Okay. Okay! Calloway has the girl at his Estate in the Vinewood hills. He flies out at noon tomorrow.", 5.2], ['Jay', "You sold my sister for an envelope.", 2.8], ['Harlan', "Everybody sells someone, Mercer.", 2.6]]);
        harlan.role = 'enemy'; harlan.hostile = true; harlan.target = pl; harlan.setMode('attack', 20); harlan.aggroT = 20; harlan.give('pistol', 20, true);
        await r.killAll([harlan], { text: 'Put <b>Harlan</b> down', label: 'Harlan' });
      } else {
        await r.dialogue([['Marcus', "He's done. And now we know where Calloway has her: the Estate. Dawn. We hit it together.", 4.6]]);
      }
      r.speak('Marcus', "Calloway's Estate. Tomorrow at dawn. Get some rest, Jay.", 3.4);
      await r.sleep(2.2);
      r.reward(4000, 10);
    }
  },
  // ============================================================================================ 14
  {
    id: 'm14', title: 'Blood & Concrete', needs: ['m13'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 25000, respect: 25, density: 0.2, keepWanted: false,
    where: homeWhere(4.5), blocksShops: true,
    afterDone() { G.hud.notify('Chapter I complete! Return to Ray at Grove Street — Chapter II is waiting.', 'cash'); },
    async run(r) {
      const ray0 = r.giver, pl = G.player; const home = doorOf('home'); const est = doorOf('mansion') || doorOf('label') || doorOf('home'); const dock = doorOf('bl_dock') || doorOf('home');
      G.sky.hour = 5.2; G.sky.setWeather('smog'); G.sky.lockWeather = true;
      r.supply({ ammo: { rpg: 4, ak47: 300, shotgun: 60, pistol: 100, grenade: 6, smg: 200 }, equip: 'ak47', hp: 100, armor: 100 });
      const ray = ray0;
      const marcus = ally(r, 'marcus', home.x + 2, home.z + 1, { weapon: 'ak47', health: 240 }); const cody = ally(r, 'Cody', home.x - 2, home.z + 1, { weapon: 'smg' }); const dre = ally(r, 'Dre', home.x - 3, home.z - 1, { weapon: 'shotgun' });
      await r.cutscene([
        shot({ x: home.x + 10, z: home.z + 8, h: 1.8 }, { x: home.x, z: home.z, h: 1.6 }, 6.4, { to: { x: home.x + 7, z: home.z + 10, h: 2.2 }, fov: 48 }),
        shot({ x: home.x - 6, z: home.z + 8, h: 1.6 }, { x: home.x, z: home.z, h: 1.7 }, 7.2, { fov: 40 })
      ], [
        ['Ray', "Dawn, boys. Calloway runs on a schedule. He leaves the country on the noon flight, with your sister as insurance.", 5.6],
        ['Ray', "The Estate is a fortress. You'll take the gate by force. Marcus, Cody and Dre ride with Jay.", 5],
        ['Marcus', "I've got your back, brother. Until the end of the road.", 3.4],
        ['Jay', "Then let's bring Nia home.", 2.4]
      ], { fadeIn: false });
      r.keepAlive(marcus, 'Marcus');
      const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const van = r.car('van', ks.x, ks.z, ks.yaw, { color: 0x1c2a22 }); van.name = 'Workhorse'; van.health = van.maxHealth = 2000;
      squad(r, [marcus, cody, dre]);
      await r.enterVehicle(van, { text: 'Take the wheel of the <b>van</b> (F)', label: 'Van' });
      G.audio.radio.set(2);
      const gate = laneSpot({ x: est.x, z: est.z }, 1, 200);
      const guardsA = suits(r, est.x, est.z, 8, { rmin: 10, rmax: 34, weapons: ['smg', 'pistol', 'shotgun', 'pistol', 'ak47'], sightRange: 60 });
      await r.goto({ x: est.x, z: est.z }, { mode: 'any', radius: 90, text: "Drive to <b>Calloway's Estate</b> in the Vinewood Hills", label: "Calloway's Estate", color: 0xff3030, blipColor: '#ff3030', arrow: false });
      r.speak('Marcus', 'Security everywhere! Fan out and use the walls!', 3);
      await r.killAll(guardsA, { text: "Break through <b>Calloway's security</b>", label: 'Guards' });
      r.cache(est.x + 6, est.z + 6, { health: 2, armor: 1, r: 8 });
      r.speak('Cody', 'Second team out of the garage! Heavy guns!', 3);
      const guardsB = suits(r, est.x, est.z, 6, { rmin: 14, rmax: 30, weapons: ['ak47', 'shotgun', 'smg', 'pistol'], sightRange: 80 });
      const sv = laneSpot({ x: est.x + 70, z: est.z + 30 }, 1, 200);
      const suvc = hostileCar(r, 'suv', sv.x, sv.z, sv.yaw, { n: 2, gang: 0, weapon: 'smg', speed: 28, blip: true, color: 0x101018 });
      await r.killAll([...guardsB, ...suvc.peds], { text: 'Hold the lawn: stop the <b>second wave</b>', label: 'Guards' });
      // house scene
      const fx = Math.sin(est.yaw), fz = Math.cos(est.yaw);
      const dd = doorOf('mansion') || est;
      await r.goto({ x: dd.x, z: dd.z }, { mode: 'foot', radius: 6, text: 'Go to the <b>mansion entrance</b>', label: 'Entrance', color: 0xff3030, blipColor: '#ff3030' });
      pl.controlEnabled = false;
      // stage calloway and nia
      const cs = walkSpot(dd.x + fx * 6, dd.z + fz * 6, 0, 2); const ns = { x: cs.x + 1.0, z: cs.z + 0.6 };
      const cal = r.ped({ x: cs.x, z: cs.z, role: 'script', appearance: look('calloway'), name: 'Dean Calloway', weapon: 'pistol', ammo: 200, health: 260 }); cal.armor = 60;
      const nia = r.ped({ x: ns.x, z: ns.z, role: 'script', appearance: look('nia'), name: 'Nia', health: 100 });
      const ls = kerbSpot({ x: cs.x + fx * 14, z: cs.z + fz * 14 }, 1, 100);
      const limo = r.car('limo', ls.x, ls.z, ls.yaw, { color: 0x0a0a0e }); limo.name = "Calloway's limo"; limo.maxHealth = limo.health = 3600; limo.locked = true;
      const esc = hostileCar(r, 'suv', ls.x - 8 * Math.sin(ls.yaw), ls.z - 8 * Math.cos(ls.yaw), ls.yaw, { n: 2, gang: 0, weapon: 'smg', mode: 'follow', speed: 28, blip: false, color: 0x101018, noBail: true });
      esc.v.ai.setMode('idle'); esc.v.ai.ramTarget = false;
      for (const p of esc.peds) p.aggroT = 0;
      lookAt(cal, pl); lookAt(nia, pl);
      marcus.script = null;
      await r.cutscene([
        shot({ x: pl.x + 2, z: pl.z + 2, h: 1.6 }, { x: cs.x, z: cs.z, h: 1.6 }, 6.6, { to: { x: cs.x - 4 * fx, z: cs.z - 4 * fz, h: 1.9 }, fov: 42 }),
        twoShot(cal, marcus, 6, { dist: 5, side: 1, drift: 0.3 })
      ], [
        ['Calloway', "Mercer. The little brother, at last. You really are as tiresome as your sister.", 4.4],
        ['Jay', "Let her go, Calloway. It's over.", 2.6],
        ['Calloway', "Over? I have a plane at noon and a judge in my pocket. Your sister is a bargaining chip.", 4.6],
        ['Marcus', "Let her go, Cal. You wanted the set. I gave you the set. Take me instead.", 4.2],
        ['Calloway', "Sentimental. Fine.", 1.6]
      ]);
      // Marcus is shot
      r.watchers.length = 0;
      G.audio.play('shot_pistol', { pos: cal }); G.fx.blood(marcus.x, marcus.y + 1.3, marcus.z, 0, 0, 10);
      marcus.invincible = false; marcus.health = 0; marcus.die({ source: cal });
      nia.script = { type: 'goto', x: van.x, z: van.z, radius: 3, speed: 5.4 };
      cal.script = { type: 'goto', x: limo.x, z: limo.z, radius: 2.4, speed: 5.4, onArrive: () => { cal.enterVehicle(limo, 1, true); } };
      r.removeBlip(null);
      pl.controlEnabled = true; G.camera.snapTo(pl);
      await r.dialogue([['Nia', "Jay!! Marcus!", 2.2], ['Jay', "Nia, run to the van! Go!", 2.4], ['Ray', "I've got her, boy! Finish it!", 2.6]]);
      // Ray picks up Nia
      const rayAlly = r.ped({ x: van.x + 3, z: van.z, role: 'script', appearance: look('ray'), name: 'Ray' });
      // limo driver
      const ld = r.ped({ x: limo.x, z: limo.z, role: 'enemy', hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { role: 'business' }), weapon: 'pistol', ammo: 999 }); ld.sightRange = 0; ld.enterVehicle(limo, 0, true);
      await r.sleep(1.2);
      limo.locked = true;
      if (!cal.vehicle) cal.enterVehicle(limo, 1, true);
      const lai = new DriverAI(limo, 'goto', { dest: { x: dock.x, z: dock.z }, cruise: 34, aggressive: true, ignoreLights: true, stopDist: 18 });
      esc.v.ai.setMode('follow', { leader: limo, gap: 10 }); esc.v.ai.aggressive = true; esc.v.ai.ramTarget = true; for (const p of esc.peds) p.aggroT = 999;
      // nia leaves in van with Ray
      r.speak('Ray', "Go get him, Jay! Nia's safe!", 3);
      van.mission = false;
      G.police.setStars(3);
      const pv = r.car('sports', est.x + 6, est.z + 5, est.yaw, { color: 0xf0f0f4 }); pv.name = 'Kestrel GT';
      const b = r.blip({ entity: limo, color: '#ff3030', label: 'Calloway', flash: true, priority: 5 });
      r.objective("Chase <b>Calloway's limo</b>");
      let bailed = false; let waitT = 0;
      r.tick(dt => {
        if (bailed) return;
        if (limo.health < limo.maxHealth * 0.34 || lai.arrived || !limo.driver || limo.driver.dead) {
          bailed = true; limo.noDamage = true; lai.setMode('idle'); limo.input.handbrake = true; limo.locked = false;
          for (const p of limo.occupants()) { p.exitVehicle(false); p.role = 'enemy'; p.hostile = true; p.target = pl; p.setMode('attack', 90); p.aggroT = 90; p.sightRange = 90; }
          cal.health = Math.max(cal.health, 180);
        }
      });
      await r.wait(() => bailed);
      r.removeBlip(b);
      const dGuards = suits(r, dock.x, dock.z, 3, { rmin: 10, rmax: 28, weapons: ['smg', 'pistol', 'shotgun'], sightRange: 80 });
      r.cache(dock.x + 6, dock.z + 6, { health: 2, armor: 1, r: 8 });
      r.speak('Calloway', "You have no idea what you're fighting! Kill him!", 3.4);
      await r.killAll([cal, ...dGuards, ...esc.peds], { text: 'End it: take down <b>Dean Calloway</b> and his men', label: 'Targets' });
      G.police.clear();
      // epilogue
      await r.sleep(1.4);
      G.audio.radio.set(-1);
      G.hud.fade(1, 900); await sleep(1000);
      G.game.teleport(home.x + Math.sin(home.yaw) * 6, home.z + Math.cos(home.yaw) * 6, home.yaw + Math.PI);
      G.sky.hour = 17.6; G.sky.setWeather('clear');
      const rayE = r.ped({ x: home.x + 3, z: home.z + 4, role: 'script', appearance: look('ray'), name: 'Ray' }); const niaE = r.ped({ x: home.x + 4.5, z: home.z + 3, role: 'script', appearance: look('nia'), name: 'Nia' });
      lookAt(rayE, pl); lookAt(niaE, pl);
      G.world.update(0, home.x, home.z, 60);
      await r.cutscene([
        shot({ x: home.x + 10, z: home.z + 10, h: 2.2 }, { x: home.x + 3, z: home.z + 3, h: 1.6 }, 9, { to: { x: home.x + 7, z: home.z + 12, h: 1.8 }, fov: 45 }),
        shot({ x: home.x - 2, z: home.z + 9, h: 1.7 }, { x: home.x + 3.5, z: home.z + 3.4, h: 1.6 }, 10, { fov: 38 })
      ], [
        ['Nia', "You came back. After everything I said when you left.", 3.6],
        ['Jay', "Five years, Nia. I'm not leaving again.", 3.2],
        ['Ray', "Marcus would have liked this. The set is green from Idlewood to Jefferson. And you, Jay, you're what holds it together.", 6.2],
        ['Nia', "The cops who are left will find the evidence Tee published. The city is waking up.", 4.6],
        ['Jay', "Los Santos doesn't change. But for one morning it feels like it could.", 4.4]
      ], { fadeIn: false });
      G.hud.big('LOS SANTOS RISING', '', 'Thank you for playing · The city is yours', 9);
      await r.sleep(6);
      r.reward(25000, 25);
    }
  }
];
