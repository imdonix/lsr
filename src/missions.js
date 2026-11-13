// Mission framework: scripted async missions with helpers for objectives, cutscenes, fail conditions.
import * as THREE from 'three';
import { G } from './state.js';
import { Ped } from './peds.js';
import { Vehicle } from './vehicles.js';
import { DriverAI } from './driverai.js';
import { clamp, dist2, rrange, pick, sleep, fmtMoney, wrapAngle } from './util.js';
import { look } from './storylib.js';

export class MissionFail extends Error { constructor(reason) { super(reason); this.reason = reason; this.isFail = true; } }
export class MissionAbort extends Error { constructor() { super('abort'); this.isAbort = true; } }

// ------------------------------------------------------------------------------------------------ Runner
export class Runner {
  constructor(mgr, def) {
    this.mgr = mgr; this.def = def; this.title = def.title;
    this.peds = []; this.vehicles = []; this.markers = []; this.blips = []; this.pickups = []; this.extra = [];
    this.waiters = []; this.watchers = []; this.ticks = []; this.ended = false; this.objText = ''; this.timerObj = null;
    this.startTime = G.time; this.flags = {};
    // rejects as soon as the mission is failed / aborted, so a script blocked on a raw promise can never soft-lock the game
    this.abortP = new Promise((_, rej) => { this._rejectAbort = rej; }); this.abortP.catch(() => { });
    this.hintT = 0; this.hintObj = ''; this.hintN = 0;
  }
  onCleanup(fn) { (this.cleanupFns || (this.cleanupFns = [])).push(fn); }
  guard() { if (this.ended || this.pendingErr) throw this.pendingErr || new MissionAbort(); }
  get player() { return G.player; }

  // ---- spawning (tracked & cleaned automatically)
  ped(o) {
    this.guard();
    const p = new Ped({ role: 'script', ...o }); p.mission = true; p.noDespawn = true; p.canDrop = o.canDrop ?? false; G.peds.add(p);
    if (o.hostile) { p.hostile = true; p.role = o.role || 'enemy'; if (o.skill === undefined) p.skillAcc = 0.3; }
    if (o.weapon) p.give(o.weapon, o.ammo ?? 500);
    if (o.name) p.name = o.name;
    if (o.health) { p.health = p.maxHealth = o.health; }
    this.peds.push(p);
    if (o.blip) p.blipObj = this.blip({ entity: p, ...(o.blip === true ? { color: '#ff3030' } : o.blip) });
    return p;
  }
  car(type, x, z, yaw, o = {}) {
    this.guard();
    const v = G.vehicles.spawn(type, x, z, yaw, { owner: 'mission', ...o }); v.mission = true; this.vehicles.push(v);
    if (o.blip) v.blipObj = this.blip({ entity: v, ...(o.blip === true ? { color: '#ff3030' } : o.blip) });
    if (o.locked) v.locked = true;
    return v;
  }
  // a scripted prop mesh (drill, vault door, breaker box...) tracked and removed with the mission
  prop(obj) { this.guard(); this.extra.push(obj); G.scene.add(obj); return obj; }
  // walk up to something and press E; returns a promise that resolves on interact (or mission abort)
  interact(x, z, o = {}) {
    this.guard();
    return new Promise((resolve) => {
      let handle = null, mk = null, bl = null;
      const clean = () => { if (G.interactions && handle) G.interactions.remove(handle); handle = null; if (mk) { this.removeMarker(mk); mk = null; } if (bl) { this.removeBlip(bl); bl = null; } };
      const finish = () => { clean(); if (o.onInteract) o.onInteract(); resolve(true); };
      if (G.interactions) handle = G.interactions.add({ x, z, radius: o.radius || 2.8, footOnly: o.footOnly !== false, label: o.label || 'Interact', mission: true, onInteract: finish });
      this.onCleanup(clean);
      if (o.marker !== false) mk = this.marker(x, z, { radius: (o.radius || 2.8) * 1.1, color: o.color ?? 0x40ffd0, once: false, arrow: true, footOnly: o.footOnly !== false });
      if (o.blip !== false) bl = this.blip({ x, z, color: o.blipColor ?? '#40ffd0', label: o.label || 'Objective', flash: true, priority: 4 });
      if (o.text) this.objective(o.text);
    });
  }
  // put ped in car and give AI driver
  driver(v, ped, mode, opts = {}) { ped.enterVehicle(v, 0, true); const ai = new DriverAI(v, mode, opts); return ai; }
  marker(x, z, o = {}) { const m = G.markers.add({ x, z, ...o }); this.markers.push(m); return m; }
  blip(o) { const b = G.blips.add({ priority: 3, ...o }); this.blips.push(b); return b; }
  removeBlip(b) { if (!b) return; G.blips.remove(b); const i = this.blips.indexOf(b); if (i >= 0) this.blips.splice(i, 1); }
  removeMarker(m) { if (!m) return; G.markers.remove(m); const i = this.markers.indexOf(m); if (i >= 0) this.markers.splice(i, 1); }
  pickup(kind, x, z, o = {}) { this.guard(); const p = G.pickups.spawn(kind, x, z, { life: 1e9, ...o }); p.mission = true; this.pickups.push(p); return p; }
  // a quest item: a pickup plus a radar blip that disappears the moment it is collected
  pickupItem(kind, x, z, o = {}, blipOpts) {
    const p = this.pickup(kind, x, z, o);
    const b = this.blip({ x, z, icon: 'dot', color: '#ff4fe0', label: 'Item', flash: true, priority: 5, ...(blipOpts || {}) });
    const orig = p.onCollect;
    p.onCollect = (pk) => { this.removeBlip(b); if (orig) orig(pk); };
    return p;
  }
  give(w, ammo = 0, equip = true) { G.player.give(w, ammo, equip); G.hud.weaponChanged(); }
  weapons(list) { for (const [w, a] of list) G.player.give(w, a, false); G.hud.weaponChanged(); }
  // make sure the player starts with a fair loadout: top ammo up to `ammo[weapon]` rounds, health >= hp, armor >= armor. Never takes anything away.
  supply(o = {}) {
    const pl = G.player;
    for (const [w, n] of Object.entries(o.ammo || {})) { const have = pl.weapons[w] ? pl.totalAmmo(w) : -1; if (have < 0) pl.give(w, n, false); else if (have < n) pl.give(w, n - have, false); }
    if (o.hp) { const want = o.hp * pl.maxHealth / 100; if (pl.health < want) pl.health = Math.min(pl.maxHealth, want); }
    if (o.armor && pl.armor < o.armor) pl.armor = o.armor;
    if (o.equip && pl.weapons[o.equip]) pl.equip(o.equip);
    G.hud.weaponChanged();
  }
  // supply cache: health / armor pickups (and optional ammo crates) scattered near a spot, tracked by the mission
  cache(x, z, o = {}) {
    const out = []; const n = o.health ?? 1, a = o.armor ?? 0, r = o.r ?? 5;
    for (let i = 0; i < n + a; i++) { const ang = (i / Math.max(1, n + a)) * Math.PI * 2 + 0.7; const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r; const sp = this._spot(px, pz); out.push(this.pickup(i < n ? 'health' : 'armor', sp.x, sp.z)); }
    for (const [w, amt] of Object.entries(o.ammo || {})) { const sp = this._spot(x + 1.5, z - 1.5); out.push(this.pickup('weapon', sp.x, sp.z, { weapon: w, ammo: amt })); }
    if (o.blip !== false) for (const p of out) p.blip = G.blips.add({ x: p.x, z: p.z, color: p.kind === 'health' ? '#ff6060' : p.kind === 'armor' ? '#60a0ff' : '#ffffff', icon: 'dot', label: p.kind === 'health' ? 'Health' : p.kind === 'armor' ? 'Body armor' : 'Ammo', priority: 1 });
    return out;
  }
  _spot(x, z) { const m = G.map; for (let i = 0; i < 12; i++) { const px = x + (i ? (Math.random() - 0.5) * 6 : 0), pz = z + (i ? (Math.random() - 0.5) * 6 : 0); if (m.roadDistAt(px, pz) > -0.5 && G.world.groundY(px, pz) > 0.6 && G.world.placement.propClear(px, pz, 0.8)) return { x: px, z: pz }; } return { x, z }; }

  // ---- text
  objective(text) { this.objText = text; if (!this.ended) G.hud.objective(text); }
  async say(speaker, text, dur) { G.hud.subtitle(text, dur ?? Math.max(2.4, text.length * 0.055), speaker); await this.sleep(dur ?? Math.max(2.4, text.length * 0.055)); }
  async dialogue(lines) { for (const l of lines) await this.say(l[0], l[1], l[2]); }
  // fire and forget subtitle
  speak(speaker, text, dur) { G.hud.subtitle(text, dur ?? Math.max(2.4, text.length * 0.055), speaker); }
  notify(t) { G.hud.notify(t); }

  // ---- waiting primitives
  wait(check, o = {}) {
    if (this.ended || this.pendingErr) return Promise.reject(this.pendingErr || new MissionAbort());
    return new Promise((resolve, reject) => {
      this.waiters.push({ check, resolve, reject, timeout: o.timeout ?? null, t: 0, onTimeout: o.onTimeout });
    });
  }
  sleep(sec) { let t = 0; return this.wait(dt => { t += dt; return t >= sec; }); }
  failIf(fn, reason) { this.watchers.push({ fn, reason }); }
  tick(fn) { this.ticks.push(fn); }
  fail(reason) { throw new MissionFail(reason); }
  keepAlive(target, label) {
    if (target.isHeli || target.def) this.failIf(() => target.wrecked || target.exploded, (label || 'The vehicle') + ' was destroyed.');
    else this.failIf(() => target.dead, (label || target.name || 'Your ally') + ' died.');
  }
  abortable() { if (this.ended) throw new MissionAbort(); }

  // ---- objectives
  // go to target {x,z}|entity. mode: 'foot'|'vehicle'|'any'
  async goto(target, o = {}) {
    const pos = () => ({ x: target.x, z: target.z });
    const radius = o.radius ?? 3.2;
    if (o.text) this.objective(o.text);
    const m = this.marker(target.x, target.z, { radius, color: o.color ?? 0xff3030, vehicleOnly: o.mode === 'vehicle', footOnly: o.mode === 'foot', once: false, arrow: o.arrow !== false, entity: o.follow ? target : null, needVehicle: o.needVehicle });
    const b = o.blip === false ? null : this.blip({ x: target.x, z: target.z, color: o.blipColor ?? '#ff3030', icon: o.blipIcon || 'dot', label: o.label || 'Objective', flash: true, priority: 4, entity: o.follow ? target : null });
    const pl = G.player;
    await this.wait(() => {
      const p = pos(); const px = pl.vehicle ? pl.vehicle.x : pl.x, pz = pl.vehicle ? pl.vehicle.z : pl.z;
      const d = Math.hypot(px - p.x, pz - p.z);
      if (o.mode === 'vehicle' && !pl.vehicle) return false; if (o.mode === 'foot' && pl.vehicle) return false;
      if (o.needVehicle && pl.vehicle !== o.needVehicle) return false;
      if (o.slow && pl.vehicle && pl.vehicle.totalSpeed > o.slow) return false;
      return d < radius;
    });
    this.removeMarker(m); this.removeBlip(b);
    if (o.stop && pl.vehicle) { await this.wait(() => pl.vehicle ? pl.vehicle.totalSpeed < 2 : true, { timeout: 4 }).catch(() => { }); }
  }
  async enterVehicle(v, o = {}) {
    if (o.text) this.objective(o.text);
    const b = this.blip({ entity: v, color: o.color ?? '#ffd040', label: o.label || 'Vehicle', flash: true, priority: 4 });
    const pl = G.player; await this.wait(() => pl.vehicle === v || v.wrecked); this.removeBlip(b);
    if (v.wrecked) this.fail('The vehicle was destroyed.');
  }
  async leaveVehicle(o = {}) { if (o.text) this.objective(o.text); await this.wait(() => !G.player.vehicle); }
  // kill all peds in list
  async killAll(list, o = {}) {
    const text = o.text || 'Eliminate the targets';
    this.objective(text);
    const tot = list.length; const blips = list.map(p => p.blipObj || this.blip({ entity: p, color: '#ff3030', label: 'Enemy', priority: 3 }));
    await this.wait(() => { const left = list.filter(p => !p.dead && !p.removeMe).length; G.hud.counter(o.counter === false ? null : `${o.label || 'Remaining'}: ${left}/${tot}`); return left === 0; });
    G.hud.counter(null); for (const b of blips) this.removeBlip(b);
  }
  async destroy(vehicles, o = {}) {
    this.objective(o.text || 'Destroy the vehicle'); const bl = vehicles.map(v => this.blip({ entity: v, color: '#ff3030', label: 'Target', priority: 3 }));
    await this.wait(() => vehicles.every(v => v.wrecked || v.exploded)); for (const b of bl) this.removeBlip(b);
  }
  async loseWanted(text) {
    if (G.police.stars <= 0) return; this.objective(text || 'Lose the cops'); await this.wait(() => G.police.stars === 0);
  }
  timer(seconds, label, onExpire) {
    const T = { left: seconds, label, active: true, expired: false, onExpire };
    this.timerObj = T; G.hud.timer(label || '', seconds); return T;
  }
  clearTimer() { this.timerObj = null; G.hud.timer(null); }
  wanted(n) { G.police.setStars(n); }
  // place player
  async teleport(x, z, yaw) { G.game.teleport(x, z, yaw ?? G.player.yaw); await this.sleep(0.05); }
  control(on) { G.player.controlEnabled = on; }

  // ---- cutscenes
  // shots: [{from:{x,y,z}, to?:{...}, look:{x,y,z}, lookTo?, dur, fov, follow?}]
  async cutscene(shots, lines = [], o = {}) {
    const total = shots.reduce((a, s) => a + s.dur, 0);
    G.game.inCutscene = true; G.player.controlEnabled = false; G.hud.objective(''); G.hud.root.classList.add('cine');
    G.hud.setCinematic && G.hud.setCinematic(true);
    if (o.fadeIn !== false) { G.hud.fade(1, 10); await sleep(40); }
    G.hud.fade(0, 600);
    let done = false, skipped = false, linesDone = lines.length === 0; G.camera.startCine({ shots, total, onEnd: () => done = true });
    // dialogue runs in parallel with the camera shots
    (async () => { for (const l of lines) { if (this.ended || skipped || done && false) return; const d = l[2] ?? Math.max(2.4, l[1].length * 0.055); G.hud.subtitle(l[1], d, l[0]); let t = 0; await this.wait(dt => { t += dt; return t >= d + 0.15 || skipped || this.ended; }); } linesDone = true; })();
    await this.wait(() => { if (G.input.wasPressed('Enter') && o.skippable !== false) { skipped = true; return true; } return done && linesDone; });
    G.camera.endCine(); G.hud.clearSubs();
    G.game.inCutscene = false; G.hud.setCinematic && G.hud.setCinematic(false);
    if (o.fadeOut) { G.hud.fade(1, 400); await sleep(450); }
    G.player.controlEnabled = true; G.camera.snapTo(G.player);
    if (o.fadeOut) G.hud.fade(0, 600);
  }
  sleepRaw(sec) { let t = 0; return this.wait(dt => { t += dt; return t >= sec; }); }

  // ---- finishing
  reward(money, respect = 0) { this.rewardMoney = money; this.rewardRespect = respect; }

  // mode 'pass': release friendly peds/vehicles into the world, remove leftover enemies. mode 'fail': remove everything.
  cleanup(mode = 'fail') {
    if (this.cleanupFns) { for (const fn of this.cleanupFns) { try { fn(mode); } catch (e) { console.error('cleanup hook', e); } } this.cleanupFns = null; }
    for (const e of this.extra) { if (!e) continue; if (e.parent) e.parent.remove(e); if (e.userData && e.userData.own) e.traverse(o => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); }
    this.extra = [];
    for (const m of this.markers) G.markers.remove(m); this.markers = [];
    for (const b of this.blips) G.blips.remove(b); this.blips = [];
    for (const p of this.pickups) G.pickups.remove(p); this.pickups = [];
    const pl = G.player;
    for (const v of this.vehicles) {
      v.blipObj = null;
      if (mode === 'fail' && pl.vehicle !== v && !v.occupants().some(o => o.isPlayer)) { try { G.vehicles.remove(v); } catch (e) { } continue; }
      v.mission = false; if (v.owner === 'mission') v.owner = 'traffic'; if (v.ai && v.driver && v.driver.isPlayer) v.ai = null;
    }
    for (const p of this.peds) {
      p.blipObj = null;
      if (p.removeMe || p.isPlayer) continue;
      const hostile = p.hostile || p.role === 'enemy';
      if (mode === 'fail' || hostile || p.dead) { if (p.vehicle && p.vehicle.occupants().some(o => o.isPlayer)) { p.mission = false; continue; } try { G.peds.remove(p); } catch (e) { } continue; }
      p.mission = false; p.noDespawn = false; p.followPlayer = false;
      if (p.role === 'script' || p.role === 'ally') { p.role = 'civ'; p.setMode('walk'); p.script = null; p.faceOverride = null; p.path = null; }
    }
    this.peds = []; this.vehicles = [];
    if (this.giver && !this.giver.removeMe) { try { G.peds.remove(this.giver); } catch (e) { } this.giver = null; }
    G.hud.counter(null); G.hud.timer(null); G.hud.progress('', null); G.hud.objective(''); G.hud.clearSubs();
    this.timerObj = null;
  }

  // per-frame
  update(dt) {
    if (this.ended) return;
    // objective reminder: same objective for 60 s while the player is in control -> repeat it (and where to go)
    if (!G.game.inCutscene && G.player.controlEnabled) {
      if (this.objText !== this.hintObj) { this.hintObj = this.objText; this.hintT = 0; this.hintN = 0; }
      else if (this.objText && G.hud.subT <= 0) { this.hintT += dt; if (this.hintT > 60) { this.hintT = 0; this.hintN++; G.hud.subtitle('Objective: ' + this.objText.replace(/<[^>]*>/g, '') + (this.markers.length || this.blips.length ? ' (see the marker on your map)' : ''), 5, ''); } }
    }
    if (this.timerObj && this.timerObj.active) {
      const T = this.timerObj; T.left -= dt; G.hud.timer(T.label || '', T.left);
      if (T.left <= 0 && !T.expired) { T.expired = true; T.active = false; if (T.onExpire) T.onExpire(); }
    }
    for (const t of this.ticks) { try { t(dt); } catch (e) { console.error('tick error', e); } }
    for (const w of this.watchers) { let v = false; try { v = w.fn(); } catch (e) { } if (v) { this.abortAll(new MissionFail(typeof w.reason === 'function' ? w.reason() : w.reason)); return; } }
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i]; w.t += dt; let r = false;
      try { r = w.check(dt); } catch (e) { this.waiters.splice(i, 1); w.reject(e); continue; }
      if (r) { this.waiters.splice(i, 1); w.resolve(true); }
      else if (w.timeout != null && w.t > w.timeout) { this.waiters.splice(i, 1); if (w.onTimeout) w.onTimeout(); w.reject(new MissionFail('Timed out.')); }
    }
  }
  abortAll(err) { const ws = this.waiters; this.waiters = []; this.pendingErr = this.pendingErr || err; for (const w of ws) w.reject(err); if (this._rejectAbort) this._rejectAbort(err); }
}

// ------------------------------------------------------------------------------------------------ Manager
export class MissionManager {
  constructor() {
    this.defs = []; this.done = new Set(); this.active = null; this.flags = {}; this.startMarkers = new Map(); this.blocksShops = false; this.t = 0; this.lastFailed = null; this.noStartUntil = 0;
    this.loadStory();
    // Story fights must not bring the police in on their own: no crime raises stars during a
    // mission, so heavy gunfights (turf wars, raids) stay star-free. Heat stays fully scripted
    // via setStars (chases, escapes); missions with heatOnShots get open-world heat as usual.
    const P = G.police;
    if (P && !P._missionShield) {
      P._missionShield = true; const raise0 = P.raise.bind(P);
      P.raise = (n, reason = '', min = 0) => { const a = this.active; if (a && !a.ended && !a.def.heatOnShots) return; return raise0(n, reason, min); };
    }
    G.events.on('playerDied', () => this.onPlayerFailed('You were wasted.'));
    G.events.on('playerBusted', () => this.onPlayerFailed('You were busted.'));
  }
  loadStory() {
    Promise.all([
      import('./story.js'),
      import('./story3.js').catch(e => { console.warn('side quests failed to load', e); return { SIDE: [] }; }),
      import('./sidequests.js').catch(e => { console.warn('chapter side quests failed to load', e); return { SIDE_EXTRA: [] }; })
    ])
      .then(([m, s, x]) => { const side = [...(s.SIDE || []), ...(x.SIDE_EXTRA || [])].map(d => Object.assign(d, { side: true })); this.defs = [...m.STORY, ...side]; this.storyLoaded = true; this.refreshStarts(); })
      .catch(e => console.error('story failed to load', e));
  }
  storyTotal() { return this.defs.filter(d => !d.side).length; }
  completedCount() { return this.defs.filter(d => !d.side && this.done.has(d.id)).length; }
  sideTotal() { return this.defs.filter(d => d.side).length; }
  sideDoneCount() { return this.defs.filter(d => d.side && this.done.has(d.id)).length; }
  isDone(id) { return this.done.has(id); }
  reset() { this.abortAll(); this.done.clear(); this.flags = {}; this.clearStarts(); }
  serialize() { return { done: [...this.done], flags: this.flags }; }
  deserialize(s) { this.done = new Set(s.done || []); this.flags = s.flags || {}; }
  afterLoad() { this.refreshStarts(); this.applyWorldState(); }
  applyWorldState() { const d = this.defs.find(x => x.onLoadState); for (const def of this.defs) if (this.done.has(def.id) && def.afterDone) { try { def.afterDone(this); } catch (e) { console.error(e); } } }
  async startNewGame() {
    // wait until story is loaded
    for (let i = 0; i < 200 && !this.storyLoaded; i++) await sleep(50);
    const first = this.defs[0]; this.refreshStarts();
    if (first && first.autostart !== false) this.start(first);
    else { const s = G.game.spawnPoint; G.game.teleport(s.x, s.z, s.yaw); G.player.controlEnabled = true; }
  }
  available(def) { const needs = def.needs || (def.side ? ['m04'] : null); return (def.side || !this.done.has(def.id)) && (!needs || needs.every(n => this.done.has(n))) && !(def.when && !def.when(this)); }
  // the story mission to do next: the running one, else the first available main mission
  nextMain() { if (this.active) return this.active.def; return this.defs.find(d => !d.side && this.available(d)) || null; }
  clearStarts() { for (const [id, s] of this.startMarkers) { G.markers.remove(s.marker); G.blips.remove(s.blip); if (s.ped) G.peds.remove(s.ped); } this.startMarkers.clear(); }
  refreshStarts() {
    this.clearStarts();
    if (this.active || !this.storyLoaded) return;
    for (const def of this.defs) {
      if (!this.available(def)) continue;   // even auto-started missions get a marker again if they were failed/aborted
      const where = def.where ? def.where() : null; if (!where) continue;
      const col = def.color ?? (def.side ? 0x40d0ff : 0xffd040);
      const marker = G.markers.add({ x: where.x, z: where.z, radius: 2.3, color: col, once: false, footOnly: !def.vehicleStart, onEnter: () => this.tryStart(def), arrow: true });
      const blip = G.blips.add({ x: where.x, z: where.z, color: '#' + col.toString(16).padStart(6, '0'), icon: 'text', text: def.letter || (def.side ? 'S' : 'M'), label: (def.side ? 'Side: ' : '') + def.title, priority: def.side ? 3 : 5 });
      let ped = null;
      if (def.giver) {
        try {
          ped = new Ped({ x: where.x + 1.2, z: where.z + 1.2, role: 'script', appearance: look(def.giver), name: def.giver });
          ped.mission = true; ped.noDespawn = true; ped.invincible = true; ped.canDrop = false; ped.script = { type: 'stand', look: G.player };
          G.peds.add(ped);
        } catch (e) { console.warn('giver spawn failed', e); ped = null; }
      }
      this.startMarkers.set(def.id, { marker, blip, ped });
    }
    // flag the next main quest so the HUD / radar / map can highlight it
    const next = this.nextMain(); const ne = next && this.startMarkers.get(next.id);
    if (ne) { ne.blip.nextQuest = true; ne.marker.nextQuest = true; }
  }
  tryStart(def) { if (this.active || G.game.state !== 'play') return; if (G.time < this.noStartUntil) return; if (def.canStart && !def.canStart()) { if (G.time - (this._warnT || -9) > 4) { this._warnT = G.time; G.hud.notify(def.cantStart || 'You cannot start this yet'); } return; } this.start(def); }
  abortAll() { if (this.active) { this.active.ended = true; this.active.abortAll(new MissionAbort()); this.active.cleanup(); this.active = null; } this.noStartUntil = G.time + 0.6; G.game.inCutscene = false; G.camera && G.camera.endCine(); if (G.hud) { G.hud.setCinematic(false); G.hud.fade(0, 100); G.hud.clearSubs(); } G.player.controlEnabled = true; G.game.timeScale = 1; G.missionDensity = 1; this.blocksShops = false; this.restoreAmbient(); }
  onPlayerFailed(reason) { if (this.active && !this.active.ended) { this.active.abortAll(new MissionFail(reason)); } }

  spawnGiver(def, where) {
    try {
      const ped = new Ped({ x: where.x + 1.2, z: where.z + 1.2, role: 'script', appearance: look(def.giver), name: def.giver });
      ped.mission = true; ped.noDespawn = true; ped.invincible = true; ped.canDrop = false; ped.script = { type: 'stand', look: G.player }; G.peds.add(ped); return ped;
    } catch (e) { return null; }
  }
  // story fights are between the player's crew and the mission's scripted enemies: turf gangsters strolling about are cleared away
  purgeAmbientGangs() {
    for (const p of G.peds.list.slice()) { if (p.isPlayer || p.mission || p.dead || p.role !== 'gang' || p.gang === 1 || p.vehicle) continue; try { G.peds.remove(p); } catch (e) { } }
  }
  restoreAmbient() { if (G.game.state === 'play' && G.sky) G.sky.lockWeather = false; if (this.savedGangTarget !== undefined) { if (G.game.state === 'play') G.population.gangTarget = this.savedGangTarget; this.savedGangTarget = undefined; } }
  canReplay() { return !this.active && G.game.state === 'play' && !G.player.vehicle && !G.player.dead; }
  replay(def) {
    if (!this.canReplay()) { G.hud.toast('Finish what you are doing first (on foot)'); return; }
    const w = def.where ? def.where() : null;
    if (w) G.game.teleport(w.x + 2.5, w.z + 2.5, 0);
    this.clearStarts();
    this.start(def, { replay: true, where: w });
  }
  clearRetry() { this.lastFailed = null; }
  canRetry() { return !!this.lastFailed && !this.active && G.game.state === 'play' && !G.paused; }
  retryLast() {
    const def = this.lastFailed;
    if (!def || this.active) return false;
    if (G.game.state !== 'play' || G.paused) { G.hud.toast('Retry once you are back on your feet'); return false; }
    if (def.canStart && !def.canStart()) { G.hud.toast(def.cantStart || 'You cannot start this yet'); return false; }
    this.lastFailed = null;
    G.hud.dismissFail();
    G.audio.play('menu_click');
    const w = def.where ? def.where() : null;
    if (w) G.game.teleport(w.x + 2.5, w.z + 2.5, 0);
    this.clearStarts();
    G.game.suppressPause = false;
    this.start(def, { where: w });
    G.input.lock();
    return true;
  }

  async start(def, opts = {}) {
    if (this.active) return;
    if (this.lastFailed) { G.hud.dismissFail(); this.lastFailed = null; }
    const ent = this.startMarkers.get(def.id); let giverPed = ent ? ent.ped : null; if (ent) ent.ped = null;
    this.clearStarts();
    if (!giverPed && def.giver && opts.where) giverPed = this.spawnGiver(def, opts.where);
    if (this.savedGangTarget === undefined) { this.savedGangTarget = G.population.gangTarget; }
    G.population.gangTarget = Math.min(G.population.gangTarget, def.ambientGangs ?? 0);
    this.purgeAmbientGangs();
    const r = new Runner(this, def); r.giver = giverPed; if (giverPed) giverPed.script = { type: 'stand', look: G.player }; this.active = r; G.missionDensity = def.density ?? 0.6; this.blocksShops = !!def.blocksShops;
    G.hud.missionTitle(def.title);
    let passed = false, failReason = '';
    try {
      const body = (async () => { if (def.setup) await def.setup(r); await def.run(r, G); })();
      body.catch(() => { });   // late errors of an aborted script are expected
      await Promise.race([body, r.abortP]);
      passed = true;
    } catch (e) {
      if (e && e.isFail) failReason = e.reason || 'Mission failed';
      else if (e && e.isAbort) { failReason = null; }
      else { console.error('mission error', def.id, e, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : ''); failReason = 'Something went wrong.'; }
    }
    r.ended = true;
    if (failReason === null) { return; } // aborted by abortAll(): it already cleaned up (and a new mission may be running)
    G.game.inCutscene = false; G.camera.endCine(); G.hud.setCinematic && G.hud.setCinematic(false);
    G.player.controlEnabled = G.game.state === 'play' || G.game.state === 'title' ? true : G.player.controlEnabled;
    if (passed) {
      const again = !!opts.replay || (def.side && this.done.has(def.id));
      const money = Math.round((r.rewardMoney ?? def.reward ?? 0) * (opts.replay ? 0.4 : again ? 0.5 : 1)); const respect = again ? 0 : (r.rewardRespect ?? def.respect ?? 0);
      if (!opts.replay && !this.done.has(def.id)) { this.done.add(def.id); G.player.stats.missions++; }
      const replay = !!opts.replay;
      if (money) G.player.addMoney(money); G.player.respect += respect;
      G.audio.play('mission_pass'); G.hud.missionPassed(def.title, money, respect ? `Respect +${respect}` : '');
      if (def.afterDone && !replay) { try { def.afterDone(this); } catch (e) { console.error(e); } }
      r.cleanup('pass');
      G.hud.objective('');
      if (this.active === r) { this.active = null; G.missionDensity = 1; this.blocksShops = false; this.restoreAmbient(); }
      if (G.police.stars > 0 && !def.keepWanted) G.police.clear();
      this.refreshStarts();
      const nx = this.nextMain();
      if (nx) G.hud.notify('Next mission: ' + nx.title + ' — follow the gold marker');
      if (G.game.canSave()) { await sleep(2500); if (G.game.state === 'play' && G.game.canSave() && !G.game.inCutscene) { G.game.save(); G.hud.notify('Game saved'); } }
    } else {
      if (failReason !== null) {
        G.audio.play('mission_fail'); G.hud.missionFailed(failReason);
        this.lastFailed = def;
        if (G.input.locked) { G.game.suppressPause = true; G.input.unlock(); setTimeout(() => { G.game.suppressPause = false; }, 600); }
        if (def.giver) G.hud.notify('Go back to ' + (def.giverName || def.giver[0].toUpperCase() + def.giver.slice(1)) + ' to try again');
      }
      r.cleanup(); G.hud.objective('');
      if (this.active === r) { this.active = null; G.missionDensity = 1; this.blocksShops = false; this.restoreAmbient(); }
      if (def.onFail) { try { def.onFail(this); } catch (e) { console.error(e); } }
      G.game.timeScale = G.game.state === 'play' ? 1 : G.game.timeScale;
      if (failReason !== null) { G.police.clear(); }
      await sleep(400); this.noStartUntil = G.time + 1.2; this.refreshStarts();
    }
  }

  update(dt) {
    if (this.active) this.active.update(dt);
    // clean start markers on state changes (e.g. while mission active)
    this.t += dt;
  }
}
