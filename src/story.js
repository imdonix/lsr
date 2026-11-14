// LOS SANTOS RISING - story missions 1-7 (missions 8-14 live in story2.js, 15-24 in story4.js)
import { G } from './state.js';
import { clamp, dist2, rrange, pick, TAU } from './util.js';
import { CLS, GANG } from './mapdata.js';
import { L, D, doorOf, dist, laneSpot, kerbSpot, walkSpot, aroundSpots, gy, look, shot, orbit, twoShot, faceEachOther, lookAt, spawnGang, spawnCops, hostileCar, besideDoor, chatter, squad, ally } from './storylib.js';
import { DriverAI } from './driverai.js';
import { STORY2 } from './story2.js';
import { STORY4 } from './story4.js';

const homeWhere = (side) => () => besideDoor('home', side, 1.5);

export const STORY1 = [
  // ============================================================================================ 1
  {
    id: 'm01', title: 'Welcome Home', autostart: true, letter: 'M', color: 0x40ff80, reward: 300, respect: 2, density: 0.5,
    where: () => doorOf('terminal') || doorOf('home'),
    async run(r) {
      const term = doorOf('terminal') || doorOf('home');
      const tp = { x: term.x, z: term.z };
      const ks = kerbSpot(tp, 1, 300);
      G.sky.hour = 11.2; G.sky.setWeather('clear'); G.sky.lockWeather = true;
      const car = r.car('sedan', ks.x, ks.z, ks.yaw, { color: 0x2d7a3c }); car.name = 'Stallion';
      const marcus = ally(r, 'marcus', ks.x, ks.z, { follow: false }); marcus.enterVehicle(car, 1, true);
      r.onCleanup(() => { if (marcus.vehicle) marcus.exitVehicle(false); marcus.invincible = false; });
      const start = { x: tp.x - Math.sin(term.yaw) * -3, z: tp.z - Math.cos(term.yaw) * -3 };
      G.game.teleport(tp.x, tp.z, Math.atan2(ks.x - tp.x, ks.z - tp.z));
      G.world.update(0, tp.x, tp.z, 60);
      const pl = G.player; pl.health = pl.maxHealth;
      await r.cutscene([
        shot({ x: tp.x + 60, z: tp.z + 70, h: 55 }, { x: tp.x, z: tp.z, h: 5 }, 5.2, { to: { x: tp.x - 40, z: tp.z + 50, h: 30 }, fov: 50 }),
        shot({ x: tp.x - Math.sin(term.yaw) * 4, z: tp.z - Math.cos(term.yaw) * 4, h: 2.4 }, { x: pl.x, z: pl.z, h: 1.6 }, 4.2, { fov: 40 }),
        shot({ x: ks.x + 6, z: ks.z + 4, h: 1.4 }, { x: ks.x, z: ks.z, h: 1.4 }, 4.5, { fov: 42 })
      ], [
        ['Jay', "Ray called. Four words: \"Nia's gone. Come home.\"", 3.6],
        ['Jay', 'Five years I stayed away. Turns out it only took one phone call to burn that promise.', 4.2],
        ['Marcus', 'Jay! Jay Mercer! You gonna stand there or get in the car?', 3.4]
      ]);
      r.objective('Walk to <b>Marcus</b> and his car');
      G.hud.notify('Move with W A S D, look with the mouse. Hold Shift to sprint.');
      await r.goto(car, { mode: 'foot', radius: 5.5, text: 'Walk to <b>Marcus</b> and his car', label: 'Marcus', blipColor: '#40ff80', color: 0x40ff80 });
      r.speak('Marcus', "Hey, man. Get in — you're driving. Let's see if Chicago made you forget how.", 4);
      await r.enterVehicle(car, { text: 'Get in the car: press <b>F</b> next to the driver door', label: 'Car' });
      G.audio.radio.set(0); G.hud.radioPopup(G.audio.radio.stations[0].name, G.audio.radio.nowPlaying());
      const home = doorOf('home');
      chatter(r, [
        [2.5, 'Marcus', 'Radio Los Santos. Some things you never forget. R and T tune the radio, X kills it.', 4.6],
        [9, 'Marcus', 'Man, the set has been a mess since you left. Violet Kings crept up from Jefferson.', 4.6],
        [14, 'Marcus', 'Ray will fill you in. Follow the marker. Space is your handbrake if you want to show off.', 4.8],
        [20, 'Marcus', "Nia wasn't herself the last weeks. Asking questions about who owns what.", 4.4],
        [26, 'Marcus', 'We have people looking. Not the cops. Never the cops.', 3.6]
      ]);
      await r.goto(home, { mode: 'vehicle', radius: 7, slow: 14, text: 'Drive to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      car.input.handbrake = true; await r.sleep(0.4);
      // arrival scene
      pl.controlEnabled = false;
      const hd = doorOf('home');
      const ray = r.ped({ x: hd.x + 1.5, z: hd.z + 1.5, role: 'script', appearance: look('ray'), name: 'Ray' });
      await r.sleep(0.1);
      r.control(true);
      const pv = pl.vehicle || car, mx = (ray.x + pv.x) / 2, mz = (ray.z + pv.z) / 2;
      G.hud.clearSubs();   // drop any remaining drive chatter before Ray's reunion lines
      await r.cutscene([
        shot({ x: hd.x + 8, z: hd.z + 6, h: 2 }, { x: hd.x, z: hd.z, h: 1.5 }, 7, { to: { x: hd.x + 6, z: hd.z + 9, h: 1.7 } }),
        shot({ x: hd.x + 3.5, z: hd.z + 6.5, h: 2.0 }, { x: ray.x, z: ray.z, h: 1.6 }, 8, { fov: 42, to: { x: hd.x + 4.6, z: hd.z + 7.5, h: 2.0 } }),
        shot({ x: hd.x + 6, z: hd.z + 9, h: 2.4 }, { x: mx, z: mz, h: 1.4 }, 9, { fov: 48, to: { x: hd.x + 8, z: hd.z + 6, h: 2.8 } })
      ], [
        ['Ray', "Look at you. Chicago made you skinny. Come here, boy.", 3.4],
        ['Jay', "Where's Nia, Ray?", 2.2],
        ['Ray', "Three days. Left for work and never came back. Her phone went dead on the pier.", 4.6],
        ['Ray', "The Violet Kings have been squeezing every corner since you left. And there is something rotten in the LSPD, too.", 5.2],
        ['Marcus', "We'll find her, Jay. The whole set is behind you.", 3.4],
        ['Ray', "Get your bearings. Come find me when you're ready to work.", 3.4]
      ]);
      car.input.handbrake = false; car.mission = false; car.owner = 'player'; ray.script = { type: 'stand' };
      r.reward(300, 2);
    }
  },
  // ============================================================================================ 2
  {
    id: 'm02', title: 'Family Business', needs: ['m01'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 800, respect: 4, density: 0.3,
    where: homeWhere(4.5),
    async run(r) {
      const ray = r.giver; const pl = G.player; const base = doorOf('vk_base') || doorOf('home');
      // one static two-shot for 18.4 s of dialogue froze the camera for the last 11 s: cut to Ray, then reverse onto the street.
      const sep = Math.max(0.5, Math.hypot(pl.x - ray.x, pl.z - ray.z));
      const pairD = Math.max(4.2, Math.min(8.5, sep * 2.5));   // keep the pair framed even if the player stops further back
      const ux = (pl.x - ray.x) / sep, uz = (pl.z - ray.z) / sep;
      await r.cutscene([
        twoShot(ray, pl, 5.2, { dist: pairD, side: -1, drift: -0.4 }),   // home + save icon behind them
        shot({ x: ray.x + ux * 2.4 + uz * 0.8, z: ray.z + uz * 2.4 - ux * 0.8, h: 1.8 }, { x: ray.x, z: ray.z, h: 1.62 }, 5.2, { fov: 34 }),
        twoShot(ray, pl, 8.4, { dist: pairD * 0.9, side: 1, h: 1.9, drift: 0.4 })
      ], [
        ['Ray', "First lesson. The Violet Kings took over a house in Idlewood. Every shop on that strip pays them now.", 5],
        ['Ray', "One of their runners saw Nia the night she vanished. I want him. And I want that house emptied.", 5],
        ['Jay', "How many?", 1.4],
        ['Ray', "Three, maybe four. Take the bat off the porch and Marcus's spare nine. Hold the right mouse button to aim, left to fire, R reloads.", 6.4]
      ], { fadeIn: false });
      r.give('bat', 0, false); r.supply({ ammo: { pistol: 85 }, equip: 'pistol', hp: 100, armor: 40 });
      G.hud.notify('Aim: hold RIGHT MOUSE. Fire: LEFT MOUSE. Reload: R.');
      const enemies = spawnGang(r, base.x, base.z, 4, { gang: GANG.VIOLET, weapons: ['pistol', 'bat', 'pistol', 'pistol'], rmin: 3, rmax: 11, sightRange: 30, health: 75 });
      r.cache(base.x + 14, base.z + 6, { health: 1, armor: 0, r: 4 });
      const toHouse = { x: base.x, z: base.z };
      await r.goto(toHouse, { mode: 'any', radius: 55, text: 'Go to the <b>Violet Kings hideout</b> in Idlewood', label: 'VK hideout', blipColor: '#9a4fd0', color: 0x9a4fd0, arrow: false });
      r.speak('Jay', 'Time to see what these guys are made of.', 3);
      await r.killAll(enemies, { text: 'Take out the <b>Violet Kings</b>' });
      const cs = besideDoor('vk_base', 0, 2.4) || { x: base.x, z: base.z };
      const cash = await new Promise(res => { r.pickupItem('cash', cs.x, cs.z, { amount: 450, onCollect: () => res(true) }, { color: '#4fd36b', label: 'Cash' }); r.objective('Grab the <b>cash</b> they left behind'); });
      G.hud.notify('Nicely done. Heal with food: Burger Bonanza and Pizza Stack restore health.');
      await r.goto(ray, { mode: 'any', radius: 4.5, text: 'Return to <b>Ray</b> at Grove Street', label: 'Ray', blipColor: '#ffd040', color: 0xffd040, follow: false });
      await r.dialogue([['Ray', 'You still swing like a Mercer. The runner talked before he ran: a cop has been taking envelopes from Duke Price.', 5], ['Ray', "We'll work our way up. Step one, win the streets.", 3.4]]);
      r.reward(800, 4);
    }
  },
  // ============================================================================================ 3
  {
    id: 'm03', title: 'Rolling Thunder', needs: ['m02'], giver: 'marcus', letter: 'M', color: 0x40ff80, reward: 1100, respect: 5, density: 0.8,
    where: homeWhere(-4.5),
    async run(r) {
      const marcus = r.giver; const pl = G.player; const hd = doorOf('home');
      const ks = kerbSpot({ x: hd.x, z: hd.z }, 1, 120);
      const car = r.car('lowrider', ks.x, ks.z, ks.yaw, { color: 0x1c6a3a }); car.name = 'Cruiser';
      const mc = ally(r, 'marcus', marcus.x, marcus.z, { follow: false, weapon: 'smg' }); G.peds.remove(marcus); r.giver = null;
      // one 5.4 s car shot under 13.8 s of dialogue froze the camera for the last 8 s and never framed the speaker: cut to Marcus.
      const sep = Math.max(0.5, Math.hypot(pl.x - mc.x, pl.z - mc.z));
      const pairD = Math.max(3.6, Math.min(7, sep * 2.4));   // keep both Marcus and the player framed even if the player hangs back
      const ux = (pl.x - mc.x) / sep, uz = (pl.z - mc.z) / sep;
      await r.cutscene([
        shot({ x: ks.x + 7, z: ks.z + 5, h: 1.3 }, { x: ks.x, z: ks.z, h: 0.9 }, 4.5, { to: { x: ks.x + 6, z: ks.z - 6, h: 1.1 }, fov: 45 }),
        twoShot(mc, pl, 4.5, { dist: pairD, side: 1, drift: 0.4 }),
        shot({ x: mc.x + ux * 2.4 + uz * 0.8, z: mc.z + uz * 2.4 - ux * 0.8, h: 1.8 }, { x: mc.x, z: mc.z, h: 1.62 }, 5.5, { fov: 34 })
      ], [
        ['Marcus', "My cousin's lowrider. Low and slow, the way a message should arrive.", 4],
        ['Marcus', "Violet Kings have been shooting up our corners in Jefferson. Today we return the favour.", 4.4],
        ['Marcus', 'You drive, I cover the right side. Hold the right mouse button to aim out the window and left to fire.', 5.4]
      ], { fadeIn: false });
      r.supply({ ammo: { smg: 300, pistol: 60 }, equip: 'smg', hp: 100, armor: 50 });
      G.hud.notify('Drive-by: aim with RIGHT MOUSE, fire with LEFT MOUSE.');
      mc.enterVehicle(car, 1, true);
      r.keepAlive(mc, 'Marcus'); r.keepAlive(car, 'The Cruiser');
      await r.enterVehicle(car, { text: 'Get in the <b>Cruiser</b> (F)', label: 'Cruiser' });
      G.audio.radio.set(0);
      const jc = D('Jefferson') || hd;
      // three clusters of VK along roads around Jefferson
      const targets = [];
      const offs = [[-70, -30], [90, -10]];
      for (const o of offs) { const nr = G.map.nearestRoad(jc.x + o[0], jc.z + o[1], 120); if (!nr) continue; const side = Math.random() < 0.5 ? 1 : -1; const cx = nr.x + nr.tz * side * (nr.edge.w / 2 + 2.5), cz = nr.z - nr.tx * side * (nr.edge.w / 2 + 2.5); targets.push(...spawnGang(r, cx, cz, 2, { gang: GANG.VIOLET, weapons: ['pistol', 'pistol'], rmin: 1, rmax: 4, sightRange: 40, blip: false, health: 60, skill: 0.25 })); }
      await r.goto({ x: jc.x, z: jc.z }, { mode: 'vehicle', radius: 90, text: 'Drive to <b>Jefferson</b>', label: 'Jefferson', blipColor: '#9a4fd0', color: 0x9a4fd0, arrow: false });
      r.speak('Marcus', "That's their corner! Hit 'em as we roll past!", 3);
      await r.killAll(targets, { text: 'Drive by the <b>Violet Kings</b>', label: 'Kings' });
      // chase
      const p = pl.vehicle || pl; const back = laneSpot({ x: p.x - Math.sin(p.yaw || 0) * 120, z: p.z - Math.cos(p.yaw || 0) * 120 }, 1, 200);
      const chasers = [];
      for (let i = 0; i < 2; i++) { const s = laneSpot({ x: back.x + (i * 30), z: back.z + (i * 14) }, 1, 200); const hc = hostileCar(r, 'sedan', s.x, s.z, s.yaw, { n: 2, gang: GANG.VIOLET, color: 0x5a2a7a, speed: 27, blip: true, weapon: i ? 'pistol' : 'smg', health: 65 }); chasers.push(hc); }
      r.speak('Marcus', 'Two carloads on our tail! Shake them, or shoot them!', 3.6);
      const t0 = G.time;
      await r.wait(() => chasers.every(c => c.v.wrecked || c.peds.every(q => q.dead) || dist2(c.v.x, c.v.z, (pl.vehicle || pl).x, (pl.vehicle || pl).z) > 280 * 280) && G.time - t0 > 3);
      r.objective('');
      await r.goto(hd, { mode: 'vehicle', radius: 7, slow: 12, text: 'Return to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.dialogue([['Marcus', "Ha! Did you see their faces? That's how you come home, Jay.", 3.6], ['Marcus', "Keep the Cruiser. Ray wants you.", 2.6]]);
      car.mission = false; car.owner = 'player'; mc.enterVehicle && mc.exitVehicle && (mc.vehicle && mc.exitVehicle(false));
      r.reward(1100, 5);
    }
  },
  // ============================================================================================ 4
  {
    id: 'm04', title: 'Borrowed Wheels', needs: ['m03'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 1500, respect: 4, density: 0.8,
    where: homeWhere(4.5),
    async run(r) {
      const ray = r.giver, pl = G.player; const dealer = doorOf('dealer') || doorOf('home'); const home = doorOf('home');
      // m04 was the only Chapter I briefing without a framed scene: 14.6 s of Ray's exposition played under free roam.
      // Same two-shot / close-up / reverse geometry that m02 uses at this exact home offset, sized from the pair's separation.
      const sep = Math.max(0.5, Math.hypot(pl.x - ray.x, pl.z - ray.z));
      const pairD = Math.max(4.2, Math.min(8.5, sep * 2.5));
      const ux = (pl.x - ray.x) / sep, uz = (pl.z - ray.z) / sep;
      await r.cutscene([
        twoShot(ray, pl, 5.4, { dist: pairD, side: -1, drift: -0.3 }),
        shot({ x: ray.x + ux * 2.4 + uz * 0.8, z: ray.z + uz * 2.4 - ux * 0.8, h: 1.8 }, { x: ray.x, z: ray.z, h: 1.62 }, 3.6, { fov: 34 }),
        twoShot(ray, pl, 6.2, { dist: pairD * 0.95, side: 1, drift: 0.3 })
      ], [
        ['Ray', "We need a clean getaway car. The best one in Los Santos sits in the window at Prestige Motors, Rodeo.", 5.2],
        ['Ray', "They'll call it stealing. I call it a long-term loan.", 3.4],
        ['Ray', "When the police show up, don't try to outrun them forever. Find a Pay 'n' Spray. Paint and a hundred dollars wipe the slate clean.", 6]
      ], { fadeIn: false });
      r.supply({ hp: 100, armor: 30 });
      const hk = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const ride = r.car('sedan', hk.x, hk.z, hk.yaw, { color: 0x6a5a3a }); ride.name = "Ray's old Sentinel"; ride.locked = false;
      const ks = kerbSpot({ x: dealer.x, z: dealer.z }, 1, 120);
      const car = r.car('sports', ks.x, ks.z, ks.yaw, { color: 0xf0f0f4 }); car.name = 'Kestrel GT'; car.locked = false;
      const guards = [];
      for (let i = 0; i < 2; i++) { const s = walkSpot(dealer.x, dealer.z, 3, 8); const g = r.ped({ x: s.x, z: s.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'worker' }), weapon: 'pistol', ammo: 200, name: 'Guard', health: 70, skill: 0.25 }); g.script = { type: 'stand' }; guards.push(g); }
      r.keepAlive(car, 'The Kestrel');
      await r.enterVehicle(ride, { text: "Take <b>Ray's old Sentinel</b> parked outside (F)", label: "Ray's car" });
      r.speak('Ray', "She is slow but she runs. Prestige Motors is in Rodeo, far west.", 3.4);
      await r.goto(dealer, { mode: 'any', radius: 70, text: 'Go to <b>Prestige Motors</b> in Rodeo', label: 'Prestige Motors', arrow: false });
      r.speak('Ray', "That's the white Kestrel at the curb. Take it.", 3);
      const b = r.blip({ entity: car, color: '#ffd040', label: 'Kestrel GT', flash: true, priority: 4 });
      r.objective('Steal the <b>white sports car</b>');
      await r.wait(() => G.player.vehicle === car);
      r.removeBlip(b);
      // alarm: guards shoot, wanted
      for (const g of guards) { g.role = 'enemy'; g.hostile = true; g.target = pl; g.setMode('attack', 30); g.aggroT = 30; g.sightRange = 60; g.script = null; }
      G.police.setStars(2);
      r.speak('Ray', "Cops are coming! Lose them, then bring it home!", 3.4);
      G.hud.notify("Tip: a Pay 'n' Spray drops the heat.");
      r.failIf(() => car.health < 280, 'The car is wrecked.');
      await r.loseWanted('Lose the <b>cops</b>');
      car.model.setBodyColor && 0;
      await r.goto(home, { mode: 'vehicle', radius: 7, slow: 12, needVehicle: car, text: 'Bring the <b>Kestrel</b> to Grove Street', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      await r.dialogue([['Ray', "Beautiful. Wasted on a getaway, but beautiful.", 3.2], ['Ray', 'Leave it in the garage. We will need it.', 2.6]]);
      car.mission = false; car.owner = 'player'; r.reward(1500, 4);
    }
  },
  // ============================================================================================ 5
  {
    id: 'm05', title: 'Turf War', needs: ['m04'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 2500, respect: 10, density: 0.4,
    where: homeWhere(4.5),
    afterDone() { G.game.territories.add('idlewood'); const b = doorOf('vk_base'); if (b) G.game.paintTerritory(b.x, b.z, 130, GANG.EMERALD); },
    async run(r) {
      const ray = r.giver, pl = G.player; const base = doorOf('vk_base') || doorOf('home'); const home = doorOf('home');
      await r.cutscene([
        twoShot(ray, pl, 6, { dist: 5, side: -1, drift: -0.4 })
      ], [
        ['Ray', "The Kings own Idlewood block by block. We take it back today. Marcus, Cody and Dre ride with you.", 5.4],
        ['Ray', "Drive them there. Hit the hideout hard. When the captain shows, put him down and that block flips green.", 5.4],
        ['Jay', "And after that?", 1.4],
        ['Ray', "After that they come for us. Good. Let them.", 3]
      ], { fadeIn: false });
      const ks = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const van = r.car('van', ks.x, ks.z, ks.yaw, { color: 0x254a30 }); van.name = 'Workhorse';
      const allies = [ally(r, 'marcus', home.x, home.z, { weapon: 'smg' }), ally(r, 'Cody', home.x + 2, home.z, { weapon: 'pistol' }), ally(r, 'Dre', home.x - 2, home.z, { weapon: 'shotgun' })];
      allies[1].appearance && 0;
      r.supply({ ammo: { ak47: 150, smg: 150, pistol: 60 }, equip: 'smg', hp: 100, armor: 60 });
      squad(r, allies); r.keepAlive(allies[0], 'Marcus');
      r.objective('Get in the <b>van</b> with your crew');
      await r.enterVehicle(van, { text: 'Take the wheel of the <b>van</b>', label: 'Van' });
      const enemies = spawnGang(r, base.x, base.z, 5, { gang: GANG.VIOLET, weapons: ['pistol', 'bat', 'pistol', 'smg', 'pistol'], rmin: 4, rmax: 14, sightRange: 34 });
      await r.goto({ x: base.x, z: base.z }, { mode: 'any', radius: 60, text: 'Drive to <b>Idlewood</b>', label: 'VK hideout', blipColor: '#9a4fd0', color: 0x9a4fd0, arrow: false });
      r.speak('Marcus', "Here we go! Guns up!", 2.4);
      await r.killAll(enemies, { text: 'Wave 1: clear the <b>Violet Kings</b>' });
      r.speak('Marcus', "More coming from the east!", 2.6);
      const p2 = laneSpot({ x: base.x + 130, z: base.z + 40 }, 1, 200); const p3 = laneSpot({ x: base.x - 120, z: base.z - 60 }, 1, 200);
      const cars = [hostileCar(r, 'sedan', p2.x, p2.z, p2.yaw, { n: 2, gang: GANG.VIOLET, weapon: 'smg', speed: 26, blip: true, color: 0x5a2a7a }), hostileCar(r, 'coupe', p3.x, p3.z, p3.yaw, { n: 2, gang: GANG.VIOLET, weapon: 'pistol', speed: 26, blip: true, color: 0x6a2a8a })];
      r.cache(base.x - 10, base.z + 8, { health: 1, armor: 1, r: 5 });
      const wave2 = cars.flatMap(c => c.peds);
      await r.killAll(wave2, { text: 'Wave 2: stop the <b>reinforcements</b>' });
      r.speak('Marcus', 'The captain. Tyrell. He is coming out of the house!', 3.4);
      const tyrell = spawnGang(r, base.x, base.z, 1, { gang: GANG.VIOLET, weapons: ['shotgun'], health: 190, rmin: 2, rmax: 5, sightRange: 70, blip: true })[0]; tyrell.armor = 40; tyrell.name = 'Tyrell';
      const guards = spawnGang(r, base.x, base.z, 3, { gang: GANG.VIOLET, weapons: ['smg', 'pistol', 'pistol'], rmin: 3, rmax: 10, sightRange: 70 });
      r.cache(base.x + 8, base.z - 10, { health: 1, armor: 0, r: 4, ammo: { smg: 60 } });
      await r.killAll([tyrell, ...guards], { text: 'Wave 3: take down <b>Tyrell</b> and his guards' });
      G.game.paintTerritory(base.x, base.z, 130, GANG.EMERALD); G.game.territories.add('idlewood');
      r.speak('Marcus', 'Idlewood is green again! Nobody takes it from us now!', 3.6);
      G.hud.notify('Idlewood is now Emerald Row territory', 'cash');
      await r.goto(home, { mode: 'any', radius: 7, text: 'Return to <b>Grove Street</b>', label: 'Home', color: 0xffd040, blipColor: '#ffd040' });
      for (const a of allies) { a.followPlayer = false; }
      van.mission = false; van.owner = 'player';
      r.reward(2500, 10);
    }
  },
  // ============================================================================================ 6
  {
    id: 'm06', title: 'Two Wheels', needs: ['m04'], giver: 'tee', letter: 'T', color: 0xff5090, reward: 1900, respect: 4, density: 0.7,
    where: () => { const p = besideDoor('pier_shop', 2, 4); return p; },
    async run(r) {
      const tee = r.giver, pl = G.player; const sh = doorOf('pier_shop') || doorOf('home'); const club = doorOf('club') || doorOf('home');
      const ks = kerbSpot({ x: tee.x, z: tee.z }, 1, 100);
      const bike = r.car('motorbike', ks.x, ks.z, ks.yaw, { color: 0x222a3a }); bike.name = 'Phantom 600';
      const cour = r.ped({ x: ks.x + 12, z: ks.z, role: 'script', appearance: G.models.peds.randomAppearance(Math.random, { role: 'biker' }), weapon: 'pistol', name: 'Courier', health: 70, skill: 0.25 });
      const nr = G.map.nearestRoad(sh.x + 28, sh.z + 14, 140) || G.map.nearestRoad(sh.x, sh.z, 200);
      const cs = laneSpot({ x: nr.x, z: nr.z }, 1, 10);
      const cbike = r.car('motorbike', cs.x, cs.z, cs.yaw, { color: 0x7a1a1a }); cbike.name = 'Courier bike';
      cour.enterVehicle(cbike, 0, true);
      await r.cutscene([
        twoShot(tee, pl, 4.6, { dist: 3.8, side: 1, drift: 0.4 }),
        shot({ x: cs.x + 10, z: cs.z + 6, h: 1.2 }, { x: cs.x, z: cs.z, h: 1 }, 4.2, { fov: 42 })
      ], [
        ['Tee', "You're Nia's brother. I'm Tee, I write for the Sentinel. Your sister and I were chasing the same money.", 5.6],
        ['Tee', "She left me a locker key. The phone inside is her evidence. But Blue Line sent a courier to grab it.", 5.6],
        ['Tee', "That's him. Red bike. If he reaches Vinewood, it's gone for good.", 4]
      ], { fadeIn: false });
      const cai = new DriverAI(cbike, 'goto', { dest: { x: club.x, z: club.z }, cruise: 30, aggressive: true, ignoreLights: true, stopDist: 12 });
      r.keepAlive(bike, 'Your bike');
      r.objective('Get on the <b>motorbike</b>');
      await r.enterVehicle(bike, { text: 'Mount the <b>Phantom 600</b> (F)', label: 'Bike' });
      r.supply({ hp: 100, armor: 40, ammo: { pistol: 90 } });
      const esc = laneSpot({ x: cs.x - 25, z: cs.z }, 1, 120); const escort = hostileCar(r, 'suv', esc.x, esc.z, esc.yaw, { n: 2, gang: GANG.BLUELINE, weapon: 'pistol', driverWeapon: 'pistol', mode: 'follow', speed: 28, color: 0x1a2a5a, noBail: true, health: 65, skill: 0.25 });
      // the escort only opens fire 10 s after you mount up, so you get a fair chance to reach the courier first
      for (const q of escort.peds) { q.hostile = false; q.aggroT = 0; } let armT = 0; r.tick(dt => { armT += dt; if (armT > 10 && !escort.armed) { escort.armed = true; for (const q of escort.peds) { q.hostile = true; q.aggroT = 999; } } });
      escort.v.ai.setMode('follow', { leader: cbike, gap: 12 }); escort.v.ai.aggressive = true;
      const cb = r.blip({ entity: cbike, color: '#ff3030', label: 'Courier', flash: true, priority: 5 });
      r.objective('Catch the <b>courier</b> and take him down');
      let lost = 0;
      r.tick(dt => { const pv = pl.vehicle || pl; const d = Math.hypot(pv.x - cbike.x, pv.z - cbike.z); if (!cour.dead && !cour.vehicle) lost = 0; else if (d > 170) lost += dt; else lost = Math.max(0, lost - dt); if (lost > 7) r.abortAll(new (class extends Error { constructor() { super('x'); this.isFail = true; this.reason = 'You lost the courier.'; } })()); });
      await r.wait(() => cour.dead || !cour.vehicle || cbike.wrecked);
      r.removeBlip(cb); cbike.ai && cbike.ai.setMode('idle');
      if (!cour.dead) { cour.role = 'enemy'; cour.hostile = true; cour.target = pl; cour.setMode('attack', 30); cour.aggroT = 30; }
      const dropX = cour.x, dropZ = cour.z;
      await r.wait(() => cour.dead || cour.removeMe, { timeout: 40 }).catch(() => { });
      r.speak('Tee', 'He dropped it! Grab the phone!', 2.6);
      await new Promise(res => { r.pickupItem('tag', dropX, dropZ, { onCollect: () => res(true), radius: 2.2 }, { color: '#ff4fe0', label: 'Phone', flash: true, priority: 5 }); r.objective('Pick up <b>Nia\'s phone</b>'); });
      await r.wait(() => escort.peds.every(q => q.dead) || escort.v.wrecked || dist2(escort.v.x, escort.v.z, G.player.x, G.player.z) > 250 * 250, { timeout: 25 }).catch(() => { });
      await r.dialogue([['Tee', 'Got it? The phone has three weeks of voice notes and a ledger photo. Calloway\'s name is all over it.', 5.4], ['Tee', "Calloway runs Hollow Kings Records. The label is a laundromat. I'll dig. Come find me in Vinewood.", 5.2]]);
      r.reward(1900, 4);
    }
  },
  // ============================================================================================ 7
  {
    id: 'm07', title: 'The Rat', needs: ['m05', 'm06'], giver: 'ray', letter: 'R', color: 0xffd040, reward: 2200, respect: 6, density: 0.7,
    where: homeWhere(4.5),
    async run(r) {
      const ray = r.giver, pl = G.player; const home = doorOf('home'); const gar = doorOf('garage_harlan') || doorOf('bl_dock') || doorOf('home');
      await r.dialogue([
        ['Ray', "Somebody sold us out at the Turf War. The Kings were waiting for that van.", 4.6],
        ['Ray', "Marcus left in a hurry last night and lied about where. Follow him. Stay close enough to see, far enough not to be seen.", 6.4]
      ]);
      const ks = kerbSpot({ x: home.x, z: home.z }, -1, 100);
      const mcar = r.car('coupe', ks.x, ks.z, ks.yaw, { color: 0x1a1a22 }); mcar.name = "Marcus's coupe";
      const marcus = r.ped({ x: ks.x, z: ks.z, role: 'script', appearance: look('marcus'), name: 'Marcus' }); marcus.enterVehicle(mcar, 0, true);
      const mw = { fn: () => marcus.dead || mcar.wrecked, reason: 'Marcus was killed before you learned the truth.' }; r.watchers.push(mw);
      const mai = new DriverAI(mcar, 'goto', { dest: { x: gar.x, z: gar.z }, cruise: 15, stopDist: 14 });
      const pk = kerbSpot({ x: home.x, z: home.z }, 1, 100);
      const my = r.car('sedan', pk.x + 8, pk.z + 6, pk.yaw, { color: 0x555a66 }); my.name = 'Getaway sedan';
      r.objective('Get in a <b>car</b> and tail Marcus');
      const myb = r.blip({ entity: my, color: '#ffd040', label: 'Car', flash: true, priority: 4 });
      await r.wait(() => pl.vehicle || false); r.removeBlip(myb);
      const mb = r.blip({ entity: mcar, color: '#40ff80', label: 'Marcus', priority: 5 });
      r.objective('Tail <b>Marcus</b>. Stay close but don\'t get spotted');
      let lost = 0, close = 0;
      let arrived = false;
      r.tick(dt => {
        if (arrived) return; const pv = pl.vehicle || pl; const d = Math.hypot(pv.x - mcar.x, pv.z - mcar.z);
        G.hud.counter(`Distance: ${Math.round(d)} m  (keep 18 to 90)`);
        if (d > 120) lost += dt; else lost = Math.max(0, lost - dt * 2);
        if (d < 11 && mcar.totalSpeed > 3) close += dt; else close = Math.max(0, close - dt);
        if (lost > 8) r.abortAll(Object.assign(new Error('f'), { isFail: true, reason: 'You lost Marcus.' }));
        if (close > 5) r.abortAll(Object.assign(new Error('f'), { isFail: true, reason: 'Marcus spotted you.' }));
        if (mai.arrived) arrived = true;
      });
      await r.wait(() => mai.arrived || mcar.totalSpeed < 0.6 && dist2(mcar.x, mcar.z, gar.x, gar.z) < 40 * 40);
      arrived = true; G.hud.counter(null); r.removeBlip(mb);
      // meeting set-up
      marcus.exitVehicle(false);
      const hs = walkSpot(gar.x, gar.z, 6, 10);
      const harlan = r.ped({ x: hs.x, z: hs.z, role: 'script', appearance: look('harlan'), name: 'Lt. Harlan', weapon: 'shotgun', health: 170 }); harlan.armor = 40;
      const cops = spawnCops(r, hs.x, hs.z, 2, { rmin: 2, rmax: 5, sightRange: 0, weapons: ['pistol', 'pistol', 'smg'], health: 85 }); for (const c of cops) { c.role = 'script'; c.hostile = false; }
      marcus.script = { type: 'goto', x: hs.x + 1.8, z: hs.z + 0.4, radius: 1.2, speed: 2.3 };
      await r.wait(() => dist2(marcus.x, marcus.z, hs.x + 1.8, hs.z + 0.4) < 3 * 3, { timeout: 12 }).catch(() => { });
      r.supply({ hp: 100, armor: 50, ammo: { pistol: 80, smg: 120 }, equip: pl.weapons.smg ? 'smg' : 'pistol' });
      r.objective('Get closer on foot to hear them. <b>Stay hidden</b>');
      const spot = walkSpot((gar.x + hs.x) / 2 - 10, (gar.z + hs.z) / 2 - 10, 14, 30);
      const far = dist({ x: marcus.x, z: marcus.z }, spot) > 12 ? spot : walkSpot(hs.x, hs.z, 18, 26);
      await r.goto(far, { mode: 'foot', radius: 4.5, text: 'Sneak closer to <b>the yard</b> on foot', label: 'Vantage', blipColor: '#ffd040' });
      r.watchers = r.watchers.filter(w => w !== mw);
      marcus.script = { type: 'stand', look: harlan }; lookAt(harlan, marcus); lookAt(marcus, harlan);
      await r.cutscene([
        twoShot(marcus, harlan, 9, { dist: 6.5, side: 1, drift: 0.35, fov: 40 }),
        shot({ x: far.x, z: far.z, h: 1.3 }, { x: (marcus.x + harlan.x) / 2, z: (marcus.z + harlan.z) / 2, h: 1.6 }, 6, { fov: 38 })
      ], [
        ['Harlan', "The Emerald Row shipment schedule, Okafor. Every drop, every night. That's all I want.", 4.6],
        ['Marcus', "You said you'd let her go. You said Nia would be out by Friday.", 3.8],
        ['Harlan', "I said she'd be comfortable. And she is. Calloway keeps his guests comfortable.", 4.4],
        ['Marcus', "I gave you the van. I gave you the Turf War. She better be breathing, Harlan.", 4.2],
        ['Jay', "Marcus... what did you do?", 2.6]
      ]);
      // spotted
      for (const c of cops) { c.role = 'enemy'; c.hostile = true; c.sightRange = 70; c.target = pl; c.setMode('attack', 60); c.aggroT = 60; }
      harlan.role = 'enemy'; harlan.hostile = true; harlan.sightRange = 70; harlan.target = pl; harlan.setMode('attack', 60); harlan.aggroT = 60;
      marcus.script = { type: 'flee', from: pl }; marcus.speedTarget = 5;
      const mcar2 = mcar; marcus.enterVehicle(mcar, 0, false); mcar.ai = new DriverAI(mcar, 'flee', {}); mcar.ai.fleeFrom = { x: pl.x, z: pl.z }; mcar.ai.panicT = 30;
      r.speak('Harlan', "Who the hell is that? Kill him!", 2.6);
      await r.killAll([harlan, ...cops], { text: 'Fight your way out: take down <b>Harlan</b> and his crooked cops', label: 'Cops' }).catch(e => { throw e; });
      await r.dialogue([['Jay', "Marcus sold us out. But he's the only one who knows where they keep Nia.", 4.4], ['Jay', "I'll keep this to myself for now. Nobody knows I know.", 3.4]]);
      r.reward(2200, 6);
    }
  }
];

export const STORY = [...STORY1, ...STORY2, ...STORY4];
