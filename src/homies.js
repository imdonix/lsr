// Gang mechanics: recruit Emerald Row homies, rival gang raids on our turf (random events).
import { G } from './state.js';
import { Ped } from './peds.js';
import { DriverAI } from './driverai.js';
import { dist2, rrange, pick, TAU, clamp } from './util.js';
import { GANG } from './mapdata.js';

export class Homies {
  constructor() {
    this.crew = []; this.max = 3; this.raidT = rrange(150, 260); this.raid = null; this.promptT = 0;
    this.lastRecruit = null;
  }
  // Session boundary: release crew/raid ownership so disposed entities cannot leak into the next game.
  reset() {
    for (const p of this.crew) {
      if (!p || p.dead || p.removeMe || !G.peds.list.includes(p)) continue;
      if (p.role === 'ally') p.role = 'civ';
      p.followPlayer = false; p.noDespawn = false;
      if (p.setMode) p.setMode('walk');
    }
    this.crew = [];
    if (this.raid) {
      const R = this.raid;
      for (const b of R.blips || []) G.blips.remove(b);
      for (const p of R.peds || []) { if (p && G.peds.list.includes(p)) { p.mission = false; p.noDespawn = false; } }
      for (const v of R.cars || []) {
        if (!v || !G.vehicles.list.includes(v)) continue;
        v.mission = false; if (v.owner === 'mission') v.owner = 'traffic';
        if (v.ai && v.ai.setMode) v.ai.setMode('traffic');
      }
      this.raid = null; this.raidT = rrange(170, 300);
    }
    this.promptT = 0;
    if (G.promptOverride && G.promptOverride.includes('Recruit')) G.promptOverride = null;
  }
  update(dt) {
    const pl = G.player; if (!pl || pl.dead || G.game.state !== 'play') return;
    this.crew = this.crew.filter(p => !p.dead && !p.removeMe);
    const story = G.missions && G.missions.active;
    // ---- recruit prompt / action
    let target = null, bd = 4.2 * 4.2;
    if (!pl.vehicle && pl.controlEnabled && !story && this.crew.length < this.max) {
      for (const p of G.peds.list) {
        if (p.dead || p.role !== 'gang' || p.gang !== GANG.EMERALD || p.mission || p.vehicle) continue;
        const d = dist2(p.x, p.z, pl.x, pl.z); if (d < bd) { bd = d; target = p; }
      }
    }
    if (target) { G.promptOverride = `<kbd>G</kbd> Recruit homie`; this.promptT = 0.2; if (G.input.wasPressed('KeyG')) this.recruit(target); }
    else if (this.promptT > 0) { this.promptT -= dt; if (this.promptT <= 0 && G.promptOverride && G.promptOverride.includes('Recruit')) G.promptOverride = null; }
    // ---- crew upkeep: follow the player, enter/leave cars, teleport when lost
    for (const p of this.crew) {
      if (story) { /* missions manage their own allies */ }
      const pv = pl.vehicle;
      if (pv && !p.vehicle && !p.enterVeh && dist2(p.x, p.z, pl.x, pl.z) < 22 * 22) { const seat = pv.freeSeat(); if (seat > 0) p.enterVehicle(pv, seat, false); }
      else if (!pv && p.vehicle && p.vehicle.totalSpeed < 3) p.exitVehicle(false);
      if (!p.vehicle && dist2(p.x, p.z, pl.x, pl.z) > 140 * 140) { p.x = pl.x + 3; p.z = pl.z + 3; }
    }
    // ---- gang raids
    this.updateRaid(dt, story);
  }
  recruit(p) {
    p.role = 'ally'; p.followPlayer = true; p.noDespawn = true; p.skillAcc = 0.55; p.health = p.maxHealth = 150; p.brave = true; p.setMode('walk');
    this.crew.push(p); G.audio && G.audio.play('pickup'); G.hud.notify('Homie recruited (' + this.crew.length + '/' + this.max + ')');
    if (!p.hasGun()) p.give('pistol', 200, true);
  }

  updateRaid(dt, story) {
    const pl = G.player;
    if (this.raid) {
      const R = this.raid; R.t += dt;
      const alive = R.peds.filter(p => !p.dead);
      if (!alive.length || R.t > 150 || pl.dead) {
        if (!alive.length && !pl.dead) { pl.addMoney(400); pl.respect += 2; G.hud.notify('Raid repelled: +$400', 'cash'); }
        for (const p of R.peds) { p.mission = false; p.noDespawn = false; } for (const v of R.cars) { v.mission = false; v.owner = 'traffic'; if (v.ai) v.ai.setMode('traffic'); }
        for (const b of R.blips) G.blips.remove(b); this.raid = null; this.raidT = rrange(170, 300); return;
      }
      return;
    }
    if (story || G.police.stars > 0 || pl.vehicle && pl.vehicle.totalSpeed > 25) { this.raidT = Math.max(this.raidT, 20); return; }
    if (G.map.gangAt(pl.x, pl.z) !== GANG.EMERALD) return;
    this.raidT -= dt; if (this.raidT > 0) return;
    this.startRaid();
  }
  startRaid() {
    const pl = G.player; const gang = pick([GANG.VIOLET, GANG.SOLES, GANG.BLUELINE]);
    const spot = G.population.pickRoadSpot(pl.x, pl.z, 110, 190, 14); if (!spot) { this.raidT = 30; return; }
    const R = { t: 0, peds: [], cars: [], blips: [] };
    const n = 2;
    for (let i = 0; i < n; i++) {
      const e = spot.edge; const dir = Math.random() < 0.5 ? 1 : -1; const agent = { edge: e, dir, s: clamp((dir > 0 ? spot.s : e.len - spot.s) + i * 14, 2, e.len - 2), lane: 0, route: null };
      const p = {}; G.nav.lanePoint(agent, agent.s, p);
      const v = G.vehicles.spawn(pick(['lowrider', 'sedan', 'coupe', 'muscle']), p.x, p.z, Math.atan2(p.tx, p.tz), { owner: 'mission', color: { 2: 0x6a2a8a, 3: 0xc8a820, 4: 0x1c3a8a }[gang] });
      v.mission = true; R.cars.push(v);
      for (let k = 0; k < 3; k++) {
        const ped = new Ped({ x: p.x, z: p.z, role: 'enemy', gang, hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { gang, role: 'gangster' }) }); ped.give(k === 0 ? 'pistol' : pick(['smg', 'pistol', 'shotgun']), 300); ped.mission = true; ped.noDespawn = true; ped.sightRange = 70; ped.aggroT = 999; ped.canDrop = true;
        G.peds.add(ped); ped.enterVehicle(v, k, true); R.peds.push(ped);
      }
      const ai = new DriverAI(v, 'chase', { target: pl, aggressive: true, ignoreLights: true, stopDist: 9 }); ai.pursuitSpeed = 26; ai.ramTarget = true;
      R.blips.push(G.blips.add({ entity: v, color: '#ff3030', icon: 'dot', label: 'Gang raid', priority: 4 }));
      // bail out when close to the player on foot
      v.raidBail = true;
    }
    this.raid = R; G.hud.notify('Rival gang raid on Emerald Row turf!'); G.audio && G.audio.play('wanted_up');
    G.hud.subtitle('Homie: They are coming for the block. Hit them hard!', 3.2, '');
    // simple exit logic
    const check = () => { if (this.raid !== R) return; for (const v of R.cars) { if (!v.wrecked && v.driver && !pl.vehicle && dist2(v.x, v.z, pl.x, pl.z) < 20 * 20 && v.totalSpeed < 7) { for (const q of v.occupants()) { q.exitVehicle(false); q.setMode('attack', 60); q.target = pl; } v.ai = null; } } setTimeout(check, 800); };
    setTimeout(check, 800);
  }
}
