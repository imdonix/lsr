// LOS SANTOS RISING - the original optional side quests. They unlock after "Borrowed Wheels" (m04), never block the story,
// can be replayed (from the marker for 50% pay, from the pause menu for 40%) and save their completion like story missions.
// The twenty Chapter I / II quest-line contracts live in sidequests.js.
import { G } from './state.js';
import { clamp, dist2, rrange, pick, TAU } from './util.js';
import { GANG } from './mapdata.js';
import { L, D, doorOf, dist, laneSpot, kerbSpot, walkSpot, stableSpot, gy, look, shot, twoShot, lookAt, spawnGang, hostileCar, besideDoor, squad, ally } from './storylib.js';
import { DriverAI } from './driverai.js';
import { Ped } from './peds.js';

const nice = t => t.replace(/<[^>]*>/g, '');

// ============================================================================================ S1: Export List
function exportCars() {
  return [
    { type: 'sports', color: 0xd01c1c, name: 'Red Kestrel', text: 'red <b>Kestrel</b> sports car', area: 'Ocean Flats' },
    { type: 'muscle', color: 0xe07a1c, name: 'Orange Stinger', text: 'orange <b>Stinger</b> muscle car', area: 'El Corona' },
    { type: 'limo', color: 0x0f0f14, name: 'Black limousine', text: 'black <b>limousine</b>', area: 'East Los Santos' }
  ];
}
function dockDrop() {
  const c = D('Ocean Docks') || D('Los Santos Airport') || D('Ganton');
  const nr = G.map.nearestRoad(c.x, c.z, 400); return nr ? { x: nr.x, z: nr.z } : { x: c.x, z: c.z };
}

const EXPORT = {
  id: 's1', title: 'Export List', side: true, giver: 'mack', giverName: 'Mack', letter: 'E', reward: 3000, respect: 3, density: 0.9, heatOnShots: true,
  where: () => { const d = dockDrop(); return stableSpot('s1_start', d.x + 12, d.z - 10, 2, 16); },
  async run(r) {
    const pl = G.player; const drop = dockDrop(); const cars = exportCars();
    // A completed side quest replays for 50% from its world marker and 40% from the pause menu
    // (missions.js scales r.reward by the run mode). The per-car $800 is paid straight into the
    // wallet, so it must be skipped on a replay; otherwise a "40%" replay paid ~90% of $3,000.
    // On a replay the whole payout goes through r.reward so the advertised reduction applies.
    const again = r.mgr.done.has('s1');
    await r.dialogue([
      ['Mack', "Dockside rule number one: a container ship leaves at dusk and my buyers want three specific cars on board.", 5.4],
      ['Mack', "I do not ask where you find them. I pay on delivery, and the clock starts when you touch the door.", 5],
      ['Jay', "Three cars. Where?", 1.8],
      ['Mack', "Check your map. Drive each one to the docks. Scratch one too badly and I will not take it.", 4.8]
    ]);
    G.hud.notify('Steal each marked car and deliver it to the docks.');
    let done = 0;
    for (const c of cars) {
      const cc = D(c.area) || D('Jefferson'); const sp = kerbSpot({ x: cc.x, z: cc.z }, 1, 200);
      const v = r.car(c.type, sp.x, sp.z, sp.yaw, { color: c.color }); v.name = c.name; v.locked = false;
      const fail = () => v.wrecked || v.exploded;
      r.failIf(() => !v.delivered && fail(), 'The ' + c.name + ' was wrecked.');
      const b = r.blip({ entity: v, color: '#ffd040', label: c.name, flash: true, priority: 5 });
      const mk = r.marker(v.x, v.z, { entity: v, radius: 2.4, color: 0xffd040, once: false, arrow: true });
      r.objective(`Steal the ${c.text} in <b>${c.area}</b> (${done + 1}/3)`);
      await r.wait(() => pl.vehicle === v);
      r.removeBlip(b); r.removeMarker(mk);
      if (done === 1) { G.police.setStars(1); r.speak('Mack', "That one had an alarm. Keep your head down.", 3); }
      if (done === 2) { G.police.setStars(2); r.speak('Mack', "That is the big fish. Somebody called it in. Do not stop.", 3.4); }
      const d0 = Math.hypot(v.x - drop.x, v.z - drop.z); const limit = Math.round(55 + d0 / 10);
      const T = r.timer(limit, `Car ${done + 1}/3`, () => { });
      r.failIf(() => T.expired && !v.delivered, 'Too slow. The buyer walked away.');
      await r.goto(drop, { mode: 'vehicle', needVehicle: v, radius: 7, slow: 10, text: `Deliver the <b>${c.name}</b> to the <b>docks</b> (${done + 1}/3)`, label: 'Docks', color: 0x40d0ff, blipColor: '#40d0ff' });
      v.delivered = true; r.clearTimer();
      v.input.handbrake = true; await r.sleep(0.6); if (pl.vehicle === v) pl.exitVehicle(false);
      done++;
      if (again) { G.audio.play('ding'); G.hud.notify(`Delivered ${done}/3`); }
      else { pl.addMoney(800); G.audio.play('cash'); G.hud.notify(`Delivered ${done}/3: +$800`, 'cash'); }
      await r.sleep(0.8); try { if (v.driver === null || !v.driver || !v.driver.isPlayer) G.vehicles.remove(v); } catch (e) { }
    }
    await r.dialogue([['Mack', "Clean paint, no scratches. Pleasure doing business, Jay.", 3.4], ['Mack', "Come back when you need cash. The ship sails every time a rich man gets bored.", 4.4]]);
    r.reward(again ? 3000 : 600, 3);
  }
};

// ============================================================================================ S2: Corner Store Protection
const STORE = {
  id: 's2', title: 'Corner Store Protection', side: true, giver: 'pak', giverName: 'Mr. Pak', letter: 'P', reward: 2200, respect: 3, density: 0.6,
  where: () => besideDoor('gas_a', 3, 2.5) || besideDoor('burger_a', 3, 2.5),
  async run(r) {
    const pl = G.player; const owner = r.giver; const door = doorOf('gas_a') || doorOf('burger_a');
    const cx = door.x, cz = door.z;
    await r.dialogue([
      ['Mr. Pak', "Jay, the Kings' collectors are coming back tonight. Thirty years I have run this store.", 4.8],
      ['Mr. Pak', "Three groups, they told me. If they break my windows again, I close for good.", 4.4],
      ['Jay', "Stay behind the counter. I will handle it.", 2.8]
    ]);
    owner.invincible = false; owner.health = owner.maxHealth = 260; owner.armor = 0; owner.script = { type: 'stand' }; owner.name = 'Mr. Pak';
    r.keepAlive(owner, 'Mr. Pak');
    r.supply({ ammo: { pistol: 70, smg: 90 }, hp: 70, armor: 25, equip: pl.hasGun() ? undefined : 'pistol' });
    r.cache(cx, cz, { health: 1, armor: 1, r: 7 });
    G.sky.hour = 21.4;
    const waves = [
      { n: 3, weapons: ['pistol', 'bat', 'pistol'], car: false, line: 'Here they come! Three on foot!' },
      { n: 3, weapons: ['smg', 'pistol', 'bat'], car: true, line: 'A car and more on foot! Keep them off the door!' },
      { n: 4, weapons: ['shotgun', 'smg', 'pistol', 'smg'], car: true, line: 'Their boss brought everyone. Last wave!' }
    ];
    // Keep the player near the store: chase the raiders, but do not abandon Mr. Pak.
    // A tick cannot throw (Runner.update swallows tick errors), so the fail must go through
    // abortAll like s3 below; a plain r.fail() here silently did nothing and spammed the log.
    const storeBlip = r.blip({ x: cx, z: cz, color: '#40d0ff', label: 'Store', priority: 4 });
    let away = 0, awaySec = null, baseObj = '';
    const setObj = t => { baseObj = t; r.objective(t); };
    r.tick(dt => {
      const d = Math.hypot(pl.x - cx, pl.z - cz);
      if (d <= 70) {
        if (away > 0) { away = 0; awaySec = null; storeBlip.flash = false; if (baseObj) r.objective(baseObj); }
        return;
      }
      away += dt;
      const left = Math.max(0, Math.ceil(12 - away));
      if (left !== awaySec) {
        awaySec = left; storeBlip.flash = true;
        r.objective(`Return to the <b>corner store</b> — Mr. Pak is alone (${left}s)`);
        if (left === 11) G.hud.notify('Mr. Pak needs you back at the store!');
      }
      if (away >= 12) r.abortAll(Object.assign(new Error('away'), { isFail: true, reason: 'You abandoned Mr. Pak at the store.' }));
    });
    setObj('Defend the <b>corner store</b> (wave 1/3)');
    await r.goto({ x: cx, z: cz }, { mode: 'foot', radius: 14, text: 'Get back to the <b>corner store</b>', label: 'Store', color: 0x40d0ff, blipColor: '#40d0ff', arrow: false });
    for (let w = 0; w < waves.length; w++) {
      const W = waves[w]; setObj(`Defend the <b>corner store</b> (wave ${w + 1}/3)`);
      r.speak('Mr. Pak', W.line, 3);
      const foes = [];
      const ang = Math.random() * TAU;
      const sx = cx + Math.cos(ang) * 40, sz = cz + Math.sin(ang) * 40;
      foes.push(...spawnGang(r, sx, sz, W.n, { gang: GANG.VIOLET, weapons: W.weapons, rmin: 2, rmax: 7, sightRange: 70, guard: false, health: 80 + w * 10, skill: 0.3 + w * 0.05 }));
      if (W.car) {
        const ls = laneSpot({ x: cx + Math.cos(ang + 2.2) * 120, z: cz + Math.sin(ang + 2.2) * 120 }, 1, 200);
        if (ls.nr) { const hc = hostileCar(r, 'sedan', ls.x, ls.z, ls.yaw, { n: 2, gang: GANG.VIOLET, color: 0x5a2a7a, speed: 26, target: pl, blip: false }); foes.push(...hc.peds); for (const p of hc.peds) { p.health = p.maxHealth = 80; p.skillAcc = 0.3; } }
      }
      foes.forEach((p, i) => { p.role = 'enemy'; p.hostile = true; p.target = i === 1 ? owner : pl; p.setMode('attack', 90); p.aggroT = 90; p.guard = false; });
      await r.killAll(foes, { text: `Defend the <b>corner store</b> (wave ${w + 1}/3)`, label: 'Raiders' });
      if (w < waves.length - 1) {
        r.speak('Mr. Pak', w === 0 ? "Fine work. Quick, take a breath: there are first aid kits by the door." : "They are regrouping. One more, Jay.", 3.6);
        if (w === 1) r.cache(cx, cz, { health: 1, armor: 0, r: 6, ammo: { smg: 60 } });
        await r.sleep(7);
      }
    }
    await r.dialogue([['Mr. Pak', "The street is quiet. Take this, and fresh coffee whenever you pass.", 4], ['Jay', "Call me if they come back.", 2.2]]);
    r.reward(2200, 3);
  }
};

// ============================================================================================ S3: Gym Brawl
const BRAWL = {
  id: 's3', title: 'Gym Brawl', side: true, giver: 'sal', giverName: 'Sal', letter: 'G', reward: 650, respect: 2, density: 0.5, ambientGangs: 0,
  stake: 100,
  where: () => besideDoor('gym', 4, 3),
  canStart: () => G.player.money >= 100, cantStart: 'Sal: the fight club needs a $100 stake. Come back with cash.',
  async run(r) {
    const pl = G.player; const sal = r.giver; const gym = doorOf('gym');
    const ring = besideDoor('gym', 0, 13) || { x: gym.x, z: gym.z };
    await r.dialogue([
      ['Sal', "Welcome to the only fight club in Ganton. Three opponents, one after another, no guns.", 4.4],
      ['Sal', "You put a hundred on yourself. Win all three and I pay six fifty. Get knocked out and the house keeps it.", 5.4],
      ['Jay', "Give me the bat.", 1.8]
    ]);
    if (pl.money < 100) r.fail('You need $100 to bet.');
    pl.money -= 100; G.hud.notify('Stake paid: -$100'); G.audio.play('cash');
    // stash the firearms: fists and the gym bat only
    const stash = pl.weapons; const hadW = pl.weaponId; pl.weapons = { fist: stash.fist || { ammo: 0, clip: 0 }, bat: { ammo: 0, clip: 0 } }; pl.equip('bat'); G.hud.weaponChanged();
    r.onCleanup(() => { pl.weapons = stash; pl.equip(stash[hadW] ? hadW : 'fist'); G.hud.weaponChanged(); });
    pl.health = Math.max(pl.health, 70);
    G.game.teleport(ring.x + 4, ring.z + 2, Math.atan2(ring.x - pl.x, ring.z - pl.z));
    const fighters = [
      { name: 'Big Mo', hp: 80, hat: 'none' }, { name: 'Razor', hp: 110 }, { name: 'Tank', hp: 150 }
    ];
    // knocked out = fail without dying. Only while a fighter is still standing: a killing blow can
    // drop the player under 14 on the same frame the round ends, and that must not count as a KO.
    r.tick(() => { if (!pl.dead && pl.health < 14 && r.peds.some(p => !p.dead && !p.removeMe)) { pl.health = 30; r.abortAll(Object.assign(new Error('ko'), { isFail: true, reason: 'You were knocked out. Sal keeps the stake.' })); } });
    // leaving the ring forfeits the stake: count real seconds (not frames, so 30/60/144 Hz all get the
    // same grace), and announce it with a live countdown and a flashing ring blip instead of a silent fail.
    const ringBlip = r.blip({ x: ring.x, z: ring.z, color: '#ff7a9a', label: 'Fight ring', priority: 4 });
    let baseObj = '', awayT = 0, awaySec = null, fightOver = false;
    r.tick(dt => {
      if (fightOver) return;   // the third knockout ends the brawl; the payout dialogue cannot forfeit
      const d = Math.hypot(pl.x - ring.x, pl.z - ring.z);
      if (d <= 38) {
        if (awayT > 0) { awayT = 0; awaySec = null; ringBlip.flash = false; if (baseObj) r.objective(baseObj); }
        return;
      }
      awayT += dt;
      const left = Math.max(0, Math.ceil(12 - awayT));
      if (left !== awaySec) {
        awaySec = left; ringBlip.flash = true;
        r.objective(`Return to the <b>fight ring</b> — Sal forfeits in ${left}s`);
        if (left === 11) G.hud.notify('Leaving the ring forfeits the fight!');
      }
      if (awayT >= 12) r.abortAll(Object.assign(new Error('x'), { isFail: true, reason: 'You walked out on the fight. Sal keeps the stake.' }));
    });
    let round = 0;
    for (const f of fighters) {
      round++;
      baseObj = `Fight ${round}/3: beat <b>${f.name}</b>`;
      r.objective(baseObj);
      G.hud.big(`ROUND ${round}`, '', f.name, 2);
      const sp = walkSpot(ring.x, ring.z, 7, 10);
      const app = G.models.peds.randomAppearance(Math.random, { role: 'gangster', gang: 3, gender: 'm' }); app.build = 'big'; app.hat = 'none'; app.bandana = null;
      const p = r.ped({ x: sp.x, z: sp.z, role: 'enemy', gang: 0, hostile: true, appearance: app, name: f.name, health: f.hp, blip: { color: '#ff3030', label: f.name } });
      p.sightRange = 60; p.guard = false; p.canDrop = false; p.brave = true; p.cash = 0;
      p.setMode('attack', 90); p.target = pl; p.aggroT = 90;
      await r.killAll([p], { text: `Fight ${round}/3: beat <b>${f.name}</b>`, label: f.name });
      if (round < 3) {
        pl.health = Math.min(pl.maxHealth, pl.health + 35); G.hud.notify('Sal patches you up: +35 health');
        r.speak('Sal', round === 1 ? 'One down! Razor is next, and he is quick.' : 'Last one. Tank has never gone down. Not yet.', 3.4);
        await r.sleep(5);
      }
    }
    fightOver = true; if (awayT > 0) { ringBlip.flash = false; if (baseObj) r.objective(baseObj); }
    await r.dialogue([['Sal', "Three for three! Nobody has done that in this gym since... ever.", 3.8], ['Sal', "Here is your six fifty. Come back when you want a real fight.", 3.6]]);
    r.reward(650, 2);
  }
};

// ============================================================================================ S4: Street Medic
const MEDIC = {
  id: 's4', title: 'Street Medic', side: true, giver: 'dre', giverName: 'Dre', letter: '+', reward: 2000, respect: 3, density: 0.9, heatOnShots: true,
  where: () => besideDoor('church', 5, 8) || besideDoor('school', 5, 6),
  async run(r) {
    const pl = G.player; const dre = r.giver; const hosp = doorOf('hospital_a') || doorOf('hospital_b');
    // once Dre is at the hospital door the delivery is won: the bleed, the timer and the
    // "car destroyed" fail must stop so a last burst of cop fire cannot undo the objective
    let arrived = false;
    // injured homie
    dre.name = 'Dre'; dre.role = 'script'; dre.script = { type: 'stand' }; dre.invincible = false; dre.health = dre.maxHealth = 200;
    await r.dialogue([
      ['Dre', "Jay... they jumped me outside the church. I am bleeding, man.", 3.4],
      ['Jay', "Hang on. Where is the ambulance?", 2.2],
      ['Dre', "Stuck behind a pile-up on the freeway. Please, get me to All Saints before I pass out.", 4.6]
    ]);
    const ks = kerbSpot({ x: dre.x, z: dre.z }, 1, 100);
    const car = r.car('sedan', ks.x, ks.z, ks.yaw, { color: 0x2d7a3c }); car.name = "Dre's sedan"; car.locked = false;
    const DROP_RADIUS = 9, DROP_SLOW = 14;
    // The watchers run before the waiters, so re-evaluate the drop-off condition here: on the
    // frame the sedan reaches the door the timer/damage watcher must not outrun the goto.
    const atHospital = () => pl.vehicle === car && car.totalSpeed <= DROP_SLOW && Math.hypot(car.x - hosp.x, car.z - hosp.z) < DROP_RADIUS;
    r.failIf(() => !arrived && !atHospital() && (car.wrecked || car.exploded), "Dre's car was destroyed.");
    const ally0 = dre; ally0.role = 'ally'; ally0.followPlayer = true; ally0.gang = 1; ally0.brave = false; ally0.invincible = true;
    squad(r, [dre]);
    r.objective("Get in <b>Dre's sedan</b> (F)");
    await r.enterVehicle(car, { text: "Get in <b>Dre's sedan</b> (F)", label: "Dre's car" });
    await r.wait(() => dre.vehicle === car || dre.dead, { timeout: 25 }).catch(() => { });
    if (dre.dead) r.fail('Dre died.');
    if (dre.vehicle !== car) { dre.x = car.x; dre.z = car.z; dre.enterVehicle(car, 1, true); }
    // cops on the road
    G.police.setStars(2);
    const spawnCop = (ox, oz) => {
      const s = laneSpot({ x: pl.x + ox, z: pl.z + oz }, 1, 200); if (!s.nr) return;
      const v = G.vehicles.spawn('police', s.x, s.z, s.yaw + Math.PI, { owner: 'police', color: 0xeeeeee }); v.setSiren(true);
      const d = new Ped({ x: s.x, z: s.z, role: 'cop', appearance: G.models.peds.randomAppearance(Math.random, { role: 'cop' }) }); d.give('pistol', 200); G.peds.add(d); d.enterVehicle(v, 0, true);
      new DriverAI(v, 'chase', { target: pl, aggressive: true, ignoreLights: true, stopDist: 7 });
    };
    for (const o of [[90, 50], [-110, 20]]) spawnCop(o[0], o[1]);
    r.speak('Dre', 'Cops! They think I am the shooter! Floor it!', 3);
    const d0 = Math.hypot(pl.x - hosp.x, pl.z - hosp.z); const limit = Math.round(45 + d0 / 11);
    const T = r.timer(limit, 'Dre bleeding out', () => { });
    // The tick used to keep draining after the drop-off, leaving a stale "Dre's condition" line
    // on the HUD through the closing dialogue (and failing the finished quest in the worst case).
    // Stop at arrival, redraw only when the whole percent changes, and warn once when time is short.
    let hurt = 100, lastPct = -1, warned = false; const drain = 100 / (limit * 1.1);
    r.tick(dt => {
      if (arrived) return;
      hurt -= drain * dt;
      const pct = Math.max(0, Math.round(hurt));
      if (pct !== lastPct) {
        lastPct = pct; G.hud.counter(`Dre's condition: ${pct}%`);
        if (pct <= 30 && !warned) { warned = true; G.hud.notify('Dre is fading — get him to All Saints now!'); }
      }
    });
    r.failIf(() => !arrived && !atHospital() && (T.expired || hurt <= 0), 'Dre bled out before you reached the hospital.');
    r.failIf(() => dre.dead, 'Dre died.');
    await r.goto(hosp, { mode: 'vehicle', needVehicle: car, radius: DROP_RADIUS, slow: DROP_SLOW, text: 'Get Dre to <b>All Saints Hospital</b>', label: 'All Saints', color: 0xffffff, blipColor: '#ffffff', arrow: true });
    arrived = true; r.clearTimer(); G.hud.counter(null);
    // The player is still in the sedan for the closing dialogue: stand the pursuit down and keep
    // them alive through the hand-off so a late cop shot or car explosion cannot undo the delivery.
    const wasInvincible = pl.invincible; pl.invincible = true;
    r.onCleanup(() => { pl.invincible = wasInvincible; });
    G.police.clear();
    car.input.handbrake = true;
    dre.exitVehicle(false); dre.script = { type: 'goto', x: hosp.x, z: hosp.z, radius: 2, speed: 3 };
    await r.dialogue([['Dre', "I can walk from here. You drive like a madman, Jay. I owe you one.", 3.8], ['Nurse', "We have him. Go, before the police catch up with you.", 3.4]]);
    r.reward(2000, 3);
  }
};

export const SIDE = [EXPORT, STORE, BRAWL, MEDIC];
