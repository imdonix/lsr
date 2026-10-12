// Main game: bootstrap, loop, state machine (title / play / wasted / busted), save & load.
import * as THREE from 'three';
import { G } from './state.js';
import { Events } from './events.js';
import { MapData, WORLD_HALF, GANG, MPP, HALF, MAP_N } from './mapdata.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { FX, Rain } from './fx.js';
import { Input } from './input.js';
import { GameCamera } from './camera.js';
import { HUD } from './hud.js';
import { Menus } from './menus.js';
import { RoadNav } from './roadnav.js';
import { Combat } from './weapons.js';
import { PedManager } from './peds.js';
import { VehicleManager } from './vehicles.js';
import { Player } from './player.js';
import { Police } from './police.js';
import { Population } from './population.js';
import { Ambient } from './ambient.js';
import { WorldEvents } from './events_world.js';
import { Lights } from './lights.js';
import { Homies } from './homies.js';
import { Pickups, PropManager, Blips, Markers } from './pickups.js';
import { clamp, lerp, dist2, rrange, wrapAngle, TAU } from './util.js';

const TIPS = [
  'Stealing a car in front of a cop will earn you a star. Pay \'n\' Spray shops repaint the car and wipe the heat.',
  'Hold the aim button with a gun to lock onto nearby targets. Headshots do triple damage.',
  'Every safehouse lets you save your progress. Look for the green house marker in Ganton.',
  'Food from Burger Bonanza, Pizza Stack and Clucky\'s restores health.',
  'Press M to open the map and click to set a waypoint.',
  'Tune the radio with R and T while driving. X turns it off.',
  'Police lose track of you if you break line of sight long enough. Change cars to speed it up.',
  'Hitting the handbrake while steering makes the car slide. Good for sharp corners.'
];

export class Game {
  constructor() {
    this.running = false; this.state = 'loading'; this.inCutscene = false; this.timeScale = 1; this.suppressPause = false;
    this.saveKey = 'lsr_save_v1'; this._lastRadio = -1; this.territories = new Set(); this.lastSaveT = 0; this.fpsAvg = 60; this.lowT = 0; this.highT = 0;
    G.game = this; window.G = G; window.game = this;
  }

  mark(label) { const t = performance.now(); if (window.__bootT === undefined) window.__bootT = t; if (window.__bootLog === undefined) window.__bootLog = []; window.__bootLog.push(label + ': ' + Math.round(t - window.__bootT) + ' ms'); }

  setProgress(text, frac) {
    const b = document.querySelector('#loadbar i'); if (b) b.style.width = Math.round(frac * 100) + '%';
    const t = document.getElementById('loadtxt'); if (t && text) t.textContent = text;
  }

  async boot() {
    const tip = document.getElementById('loadtip'); if (tip) tip.textContent = 'TIP: ' + TIPS[(Math.random() * TIPS.length) | 0];
    this.loadSettings();
    const canvas = document.getElementById('game');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer; G.renderer = renderer;
    const scene = new THREE.Scene(); G.scene = scene;
    const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.15, 4200); G.cam = camera; scene.add(camera);
    canvas.addEventListener('click', () => { if (this.state === 'play' && !G.paused && !G.input.locked && !(G.menus && G.menus.open)) G.input.lock(); });
    window.addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
    G.events = new Events();
    G.input = new Input(canvas);
    this.mark('start'); this.setProgress('Loading models…', 0.01);
    const safe = (p, fb) => import(p).catch(e => { console.warn('module missing', p, e.message); return fb; });
    const propsFallback = { PROP_DEFS: {}, createPropGeometry: () => null, createPropMaterial: () => new THREE.MeshLambertMaterial({ vertexColors: true }) };
    const [mv, mp, mpd, mw, mb, au] = await Promise.all([import('./models_vehicles.js'), safe('./models_props.js', propsFallback), import('./models_peds.js'), import('./models_weapons.js'), import('./buildings.js'), import('./audio.js')]);
    G.models = { vehicles: mv, props: mp, peds: mpd, weapons: mw, buildings: mb };
    G.audio = new au.GameAudio();
    { const R = G.audio.radio; const pop = () => { const i = R.current; if (G.player && G.player.vehicle) this.lastStation = i; if (!G.hud || this.state !== 'play') return; if (i === this._lastRadio) return; this._lastRadio = i; const name = i < 0 ? 'Radio Off' : R.stations[i].name; G.hud.radioPopup(name, i < 0 ? '' : R.nowPlaying()); if (i >= 0) setTimeout(() => { if (R.current === i && G.hud) G.hud.radioPopup(name, R.nowPlaying()); }, 1600); };
      for (const fn of ['next', 'prev', 'set']) { const o = R[fn].bind(R); R[fn] = (...a) => { const r = o(...a); pop(); return r; }; } }
    this.mark('modules'); const mapBase = new URLSearchParams(location.search).get('map') || 'assets/'; const map = await MapData.load(mapBase, (t, f) => this.setProgress(t, f)); G.map = map; this.mark('map loaded');
    await new Promise(r => setTimeout(r, 10));
    this.setProgress('Generating Los Santos…', 0.3);
    const world = new World(scene, map, { buildings: mb, props: mp }); G.world = world;
    world.build((t, f) => this.setProgress(t, f)); this.mark('world built');
    G.terrain = world.terrain;
    G.nav = new RoadNav(map, world.signals);
    G.sky = new Sky(scene, renderer); G.fx = new FX(scene, world.terrain); this.rain = new Rain(scene);
    G.camera = new GameCamera(camera);
    G.blips = new Blips(); G.markers = new Markers();
    G.hud = new HUD(); G.hud.buildMapCanvas(map, world.placement);
    G.combat = new Combat(); G.peds = new PedManager(); G.vehicles = new VehicleManager();
    G.pickups = new Pickups(); G.props = new PropManager(); G.police = new Police(); G.population = new Population(); G.ambient = new Ambient(); G.worldEvents = new WorldEvents();
    G.gangHeat = { 1: 0, 2: 0, 3: 0, 4: 0 };
    G.landmarks = world.landmarks;
    // optional modules
    try { const { MissionManager } = await import('./missions.js'); G.missions = new MissionManager(); } catch (e) { console.error('missions failed to load', e); }
    try { const { Interactions } = await import('./interactions.js'); G.interactions = new Interactions(); } catch (e) { console.error('interactions failed to load', e); }
    try { const { Places } = await import('./places.js'); G.places = new Places(); } catch (e) { console.error('places failed to load', e); }
    try { const { Activities, Tags } = await import('./activities.js'); G.activities = new Activities(); G.tags = new Tags(); } catch (e) { console.error('activities failed to load', e); }
    G.menus = new Menus();
    // car radio: comes on with the last station when you take the wheel, off when you leave (X = off for this ride)
    this.lastStation = 0; this.radioMuted = false;
    G.events.on('playerEnterVehicle', (v) => { if (this.state !== 'play') return; this.radioMuted = false; if (v.isBike || v.type === 'bicycle' || v.type === 'policeheli') return; if (this.lastStation >= 0) G.audio.radio.set(this.lastStation); });
    G.events.on('playerExitVehicle', () => { G.audio.radio.set(-1); });
    G.lights = new Lights();
    G.homies = new Homies();
    this.applySettings();
    // spawn point: Emerald Row safehouse
    const home = G.landmarks.home;
    const sx = home ? home.door.x : 0, sz = home ? home.door.z : 0;
    G.player = new Player(sx, sz); G.peds.add(G.player);
    G.player.controlEnabled = false;
    const hf = home ? { x: Math.sin(home.yaw), z: Math.cos(home.yaw) } : { x: 0, z: 0 };
    this.spawnPoint = { x: sx + hf.x * 6 + hf.z * 3, z: sz + hf.z * 6 - hf.x * 3, yaw: home ? home.yaw + Math.PI : 0 };
    this.mark('systems'); await world.preload(sx, sz, 2, (t, f) => this.setProgress(t, f)); this.mark('preloaded');
    this.setProgress('Placing traffic…', 0.98);
    G.population.seedParked(sx, sz, 160, 14);
    G.sky.hour = 14;
    this.enterTitle();
    document.getElementById('loading').style.display = 'none';
    this.mark('done'); this.running = true; this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));
  }

  // ---------------------------------------------------------------- settings
  loadSettings() { try { const s = JSON.parse(localStorage.getItem('lsr_settings') || 'null'); if (s) Object.assign(G.settings, s); delete G.settings.qualityApplied; } catch (e) { } }
  applySettings() {
    try { const { qualityApplied, ...keep } = G.settings; localStorage.setItem('lsr_settings', JSON.stringify(keep)); } catch (e) { }
    const S = G.settings;
    if (G.audio) { G.audio.setVolumes({ master: S.volume, sfx: S.sfx, music: S.music }); }
    if (S.qualityApplied !== S.quality) { S.qualityApplied = S.quality; this.applyQuality(S.quality); }
    if (G.sky) G.sky.setShadows(S.shadows, S.quality === 'low' || S.quality === 'medium' ? 1024 : 2048);
    this.renderer.shadowMap.enabled = S.shadows;
    if (G.world) G.world.loadRadius = S.viewDist;
    if (G.cam) { G.cam.fov = S.fov; G.cam.updateProjectionMatrix(); }
  }

  applyQuality(q) {
    const S = G.settings; const dpr = window.devicePixelRatio || 1;
    const P = { low: { shadows: false, viewDist: 3, pr: Math.min(dpr, 0.85), dens: 0.6 }, medium: { shadows: true, viewDist: 4, pr: Math.min(dpr, 1.0), dens: 0.85 }, high: { shadows: true, viewDist: 4, pr: Math.min(dpr, 1.5), dens: 1 }, ultra: { shadows: true, viewDist: 5, pr: Math.min(dpr, 2), dens: 1.25 } }[q];
    if (!P) return;
    S.shadows = P.shadows; S.viewDist = P.viewDist;
    if (G.population) G.population.density = P.dens;
    this.renderer.setPixelRatio(P.pr); this.renderer.setSize(innerWidth, innerHeight);
  }

  // ---------------------------------------------------------------- title
  enterTitle() {
    this.state = 'title'; G.player.controlEnabled = false; G.player.invincible = true;
    G.hud.root.style.display = 'none';
    G.menus.show('title'); G.menus.stack.length = 0;
    this.titleT = 0; G.sky.hour = 17.3; G.sky.lockWeather = true; G.sky.setWeather('clear');
    G.police.noWanted = true; G.population.gangTarget = 2;
  }
  startGame(cont) {
    G.audio.init();
    G.menus.hideAll(); G.hud.root.style.display = '';
    this.state = 'play'; G.paused = false;
    G.player.invincible = false; G.police.noWanted = false; G.sky.lockWeather = false; G.population.gangTarget = 6;
    // wipe ambient
    for (const p of G.peds.list.slice()) if (p !== G.player) G.peds.remove(p);
    for (const v of G.vehicles.list.slice()) G.vehicles.remove(v);
    const save = cont ? this.readSave() : null;
    G.player.dead = false; G.player.health = G.player.maxHealth;
    if (G.missions) G.missions.reset();
    if (save) this.applySave(save);
    else {
      this.newGameSetup();
    }
    G.input.lock();
    G.camera.snapTo(G.player);
    G.audio.radio.set(-1);
  }
  newGameSetup() {
    const pl = G.player;
    pl.money = 500; pl.respect = 0; pl.health = pl.maxHealth; pl.armor = 0; pl.weapons = { fist: { ammo: 0, clip: 0 } }; pl.equip('fist');
    pl.stats = { kills: 0, copKills: 0, distance: 0, carsStolen: 0, moneyEarned: 0, missions: 0, deaths: 0, busted: 0, playTime: 0, tags: 0, headshots: 0 };
    G.sky.hour = 11; G.police.clear();
    if (G.missions) G.missions.startNewGame();
    else { this.teleport(this.spawnPoint.x, this.spawnPoint.z, this.spawnPoint.yaw); pl.controlEnabled = true; }
  }

  quitToTitle() {
    if (G.missions) G.missions.abortAll();
    G.paused = false; G.menus.hideAll();
    for (const p of G.peds.list.slice()) if (p !== G.player) G.peds.remove(p);
    for (const v of G.vehicles.list.slice()) G.vehicles.remove(v);
    if (G.player.vehicle) G.player.exitVehicle(true);
    this.teleport(this.spawnPoint.x, this.spawnPoint.z, this.spawnPoint.yaw);
    G.police.clear(); G.hud.objective(''); G.hud.clearSubs(); G.hud.fade(0, 300); this.inCutscene = false;
    this.enterTitle(); G.audio.radio.set(-1);
  }

  // ---------------------------------------------------------------- pause
  pause(flag, silent) {
    if (this.state !== 'play') return;
    if (flag === G.paused) return;
    G.paused = flag;
    if (flag) { if (!silent) G.menus.show('pause'); G.input.unlock(); G.audio && G.audio.setDuck && G.audio.setDuck(0.4); }
    else { G.menus.hideAll(); G.menus.stack.length = 0; G.input.lock(); G.audio && G.audio.setDuck && G.audio.setDuck(0); }
  }

  // ---------------------------------------------------------------- save / load
  hasSave() { try { return !!localStorage.getItem(this.saveKey); } catch (e) { return false; } }
  canSave() { return (!G.missions || !G.missions.active) && G.police.stars === 0 && !G.player.dead; }
  readSave() { try { return JSON.parse(localStorage.getItem(this.saveKey)); } catch (e) { return null; } }
  save() {
    const p = G.player;
    const data = { v: 1, t: Date.now(), player: { x: p.x, z: p.z, yaw: p.yaw, health: p.health, armor: p.armor, money: p.money, respect: p.respect, weapons: p.weapons, weaponId: p.weaponId, stats: p.stats },
      hour: G.sky.hour, missions: G.missions ? G.missions.serialize() : null, territories: [...this.territories], tags: G.tags ? G.tags.serialize() : null, activities: G.activities ? G.activities.serialize() : null, settings: null };
    try { localStorage.setItem(this.saveKey, JSON.stringify(data)); this.lastSaveT = G.time; } catch (e) { console.warn('save failed', e); }
  }
  applySave(s) {
    const p = G.player; const d = s.player;
    p.money = d.money; p.respect = d.respect || 0; p.health = d.health; p.armor = d.armor || 0; p.weapons = d.weapons || { fist: { ammo: 0, clip: 0 } };
    p.stats = Object.assign(p.stats, d.stats || {}); p.equip(p.weapons[d.weaponId] ? d.weaponId : 'fist');
    G.sky.hour = s.hour ?? 12;
    this.territories = new Set(s.territories || []);
    if (G.missions && s.missions) G.missions.deserialize(s.missions);
    if (G.tags && s.tags) G.tags.deserialize(s.tags); if (G.activities && s.activities) G.activities.deserialize(s.activities);
    for (const t of this.territories) this.applyTerritory(t);
    this.teleport(d.x, d.z, d.yaw); p.controlEnabled = true;
    if (G.missions) G.missions.afterLoad();
  }
  applyTerritory(id) { const t = this.territoryDefs && this.territoryDefs[id]; if (t) this.paintTerritory(t.x, t.z, t.r, GANG.EMERALD); }
  paintTerritory(x, z, r, gang) {
    const m = G.map; const r2 = r * r / (MPP * MPP); const cx = x / MPP + HALF, cz = z / MPP + HALF; const R = Math.ceil(r / MPP);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { if (i * i + j * j > r2) continue; const px = Math.floor(cx) + i, pz = Math.floor(cz) + j; if (px < 0 || pz < 0 || px >= MAP_N || pz >= MAP_N) continue; if (m.gang[pz * MAP_N + px]) m.gang[pz * MAP_N + px] = gang; }
    if (G.hud) G.hud._gangDirty = true;
  }

  teleport(x, z, yaw = 0) {
    const p = G.player;
    if (p.vehicle) { p.vehicle.vx = p.vehicle.vz = 0; p.vehicle.input.throttle = 0; p.exitVehicle(true); }
    if (p.rag) p.rag.stop();
    p.x = x; p.z = z; p.yaw = yaw; p.faceOverride = null; p.y = G.world.groundY(x, z); p.vx = p.vz = 0; p.vy = 0;
    p.group.quaternion.identity(); p.group.position.set(p.x, p.y, p.z); p.group.rotation.set(0, yaw, 0);
    G.camera.yaw = yaw; G.camera.snapTo(p);
  }

  // ---------------------------------------------------------------- death / busted / respawn
  onPlayerDeath(info) {
    if (this.state !== 'play') return;
    this.state = 'dead'; this.deadT = 0; this.timeScale = 0.35;
    G.hud.big('WASTED', 'wasted', '', 0);
    G.audio.play('wasted');
    G.events.emit('playerDied', info);
    G.input.unlock && 0;
  }
  onPlayerBusted() {
    if (this.state !== 'play' || G.player.dead) return;
    this.state = 'busted'; this.deadT = 0; this.timeScale = 0.5;
    G.player.controlEnabled = false; G.player.stats.busted++;
    G.hud.big('BUSTED', 'busted', '', 0);
    G.audio.play('busted');
    G.events.emit('playerBusted');
    if (G.player.vehicle) { G.player.vehicle.input.handbrake = true; }
  }
  respawn(kind) {
    const p = G.player;
    // pick nearest hospital/police
    const ids = kind === 'busted' ? ['police_hq', 'police_b', 'police_c'] : ['hospital_a', 'hospital_b'];
    let best = null, bd = 1e18;
    for (const id of ids) { const l = G.landmarks[id]; if (!l) continue; const d = dist2(l.door.x, l.door.z, p.x, p.z); if (d < bd) { bd = d; best = l; } }
    if (!best) best = { door: { x: this.spawnPoint.x, z: this.spawnPoint.z }, yaw: 0 };
    const fee = Math.min(p.money, Math.floor(clamp(p.money * 0.1, 50, kind === 'busted' ? 1000 : 500)));
    p.money -= fee;
    if (p.rag) p.rag.stop();
    p.dead = false; p.health = p.maxHealth; p.downT = 0; p.rig.setState('idle'); p.rig.setDeadPose(0); p.group.quaternion.identity(); p.group.rotation.set(0, 0, 0); p.fadeOut = 0;
    p.rig.setWeapon(p.weaponId === 'fist' ? null : p.weaponId);
    if (kind === 'busted') { const keep = { fist: p.weapons.fist }; if (p.weapons.bat) keep.bat = p.weapons.bat; p.weapons = keep; p.equip('fist'); }
    G.police.clear();
    for (const v of G.vehicles.list.slice()) if (v.owner === 'police' && !v.mission) G.vehicles.remove(v);
    this.teleport(best.door.x, best.door.z, (best.yaw || 0) + Math.PI);
    G.camera.snapTo(p);
    G.world.update(0, p.x, p.z, 30);
    p.controlEnabled = true; this.state = 'play'; this.timeScale = 1;
    G.hud.hideBig();
    G.hud.notify(kind === 'busted' ? 'Busted: weapons confiscated, fined ' + fee : 'Hospital bill: $' + fee);
    G.hud.fade(0, 900);
    G.sky.hour = (G.sky.hour + 0.3) % 24;
    G.events.emit('respawned', kind);
  }

  // ---------------------------------------------------------------- main loop
  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    let dt = (now - this.last) / 1000; this.last = now; dt = clamp(dt, 0.0001, 0.1);
    G.input.pollGamepad();
    // adaptive quality
    this.fpsAvg = lerp(this.fpsAvg, 1 / dt, 0.03);
    if (this.fpsAvg < 26 && this.state === 'play') { this.lowT += dt; if (this.lowT > 4) { this.lowT = 0; this.degrade(); } } else this.lowT = Math.max(0, this.lowT - dt);
    if (window.__simOverride) { window.__simOverride(dt); }
    try { this.frame(dt); } catch (e) { console.error('frame error', e); this.errCount = (this.errCount || 0) + 1; }
    G.input.endFrame();
  }
  degrade() {
    const S = G.settings;
    if (S.shadows) { S.shadows = false; this.applySettings(); G.hud.toast('Performance: shadows disabled'); }
    else if (S.viewDist > 3) { S.viewDist--; this.applySettings(); G.hud.toast('Performance: lowered view distance'); }
    else if (this.renderer.getPixelRatio() > 0.85) { this.renderer.setPixelRatio(this.renderer.getPixelRatio() - 0.25); this.renderer.setSize(innerWidth, innerHeight); }
  }

  frame(dt) {
    const player = G.player;
    if (this.state === 'title') { this.titleFrame(dt); this.renderFrame(dt); return; }
    if (!G.paused) {
      const sdt = dt * this.timeScale;
      const steps = Math.max(1, Math.ceil(sdt / 0.02)); const h = sdt / steps;
      for (let i = 0; i < steps; i++) this.sim(h);
      // death / busted sequences
      if (this.state === 'dead' || this.state === 'busted') {
        this.deadT += dt;
        if (this.deadT > (this.state === 'dead' ? 2.4 : 1.6) && !this._fading) { G.hud.fade(1, 800); this._fading = true; }
        if (this.deadT > (this.state === 'dead' ? 3.4 : 2.6)) { this._fading = false; this.respawn(this.state); }
      }
      G.camera.update(sdt > 0 ? Math.max(sdt, 0.0001) : 0.0001, dt, player, G.input);
      G.sky.update(sdt, G.cam, player.vehicle ? player.vehicle : player);
      G.world.setNight(G.sky.dark);
      G.world.update(dt, player.vehicle ? player.vehicle.x : player.x, player.vehicle ? player.vehicle.z : player.z, this.state === 'play' ? 3.5 : 6);
      G.fx.update(sdt);
      this.rain.update(sdt, G.cam.position, G.sky.rain);
      G.audio.update(dt, { x: G.cam.position.x, y: G.cam.position.y, z: G.cam.position.z, yaw: G.camera.yaw });
      this.ambientAudio(dt);
      G.hud.update(dt);
      this.updateWorldFx(dt);
      this.updateFps(dt);
      this.updatePrompts(dt);
      if (G.input.wasPressed('F5') && this.canSave()) { this.save(); G.hud.toast('Quick saved'); }
    } else {
      G.camera.update(0.0001, dt, player, { consumeMouse: () => [0, 0] });
      if (G.menus.open === 'map') G.menus.drawMap();
    }
    this.renderFrame(dt);
  }

  renderFrame(dt) { this.renderer.render(G.scene, G.cam); }

  sim(dt) {
    G.time += dt;
    G.camera.cineTick(dt);
    if (G.interactions) G.interactions.scan();
    G.nav.update(dt);
    G.peds.update(dt);
    if (G.interactions) G.interactions.consume();
    G.vehicles.update(dt);
    G.combat.update(dt);
    G.police.update(dt);
    G.population.update(dt);
    if (G.ambient) G.ambient.update(dt);
    if (G.worldEvents) G.worldEvents.update(dt);
    G.pickups.update(dt); G.pickups.tickRespawn(dt); G.props.update(dt); G.markers.update(dt); G.blips.update();
    if (G.missions) G.missions.update(dt);
    if (G.places) G.places.update(dt);
    if (G.activities) G.activities.update(dt);
    if (G.homies) G.homies.update(dt);
    for (let k in G.gangHeat) if (G.gangHeat[k] > 0) G.gangHeat[k] -= dt;
    // remember the last vehicle so the despawner does not pick it up right after exit
    if (G.player.vehicle) G.lastPlayerVehicle = G.player.vehicle;
    // mission-less world bounds
    const p = G.player; if (!p.vehicle) { const L = WORLD_HALF - 14; if (Math.abs(p.x) > L || Math.abs(p.z) > L) { p.x = clamp(p.x, -L, L); p.z = clamp(p.z, -L, L); G.hud.prompt('You cannot leave Los Santos'); setTimeout(() => G.hud.prompt(null), 1200); } }
    G.population.enabled = this.state === 'play' || this.state === 'title' || this.state === 'dead' || this.state === 'busted';
  }

  titleFrame(dt) {
    this.titleT += dt;
    G.sky.update(dt * 0.3, G.cam, { x: G.player.x, y: G.player.y, z: G.player.z });
    G.world.setNight(G.sky.dark);
    const c = this.spawnPoint; const a = this.titleT * 0.06;
    const r = 26, h = 10 + Math.sin(this.titleT * 0.2) * 2;
    const cx = c.x, cz = c.z;
    G.cam.position.set(cx + Math.cos(a) * r, G.world.groundY(cx, cz) + h, cz + Math.sin(a) * r);
    G.cam.lookAt(cx, G.world.groundY(cx, cz) + 3, cz);
    G.cam.fov = 55; G.cam.updateProjectionMatrix(); G.cam.updateMatrixWorld();
    G.camera.pos.copy(G.cam.position);
    G.world.update(dt, cx, cz, 3);
    // light ambient sim so the city lives
    G.time += dt; G.nav.update(dt); G.peds.update(dt); G.vehicles.update(dt); G.population.update(dt); G.fx.update(dt);
  }

  ambientAudio(dt) {
    this._ambT = (this._ambT || 0) - dt; if (this._ambT > 0) return; this._ambT = 0.5;
    const p = G.player; const zone = G.map.zoneAt(p.x, p.z); const s = G.sky;
    let cars = 0, peds = 0; for (const v of G.vehicles.list) if (v.owner === 'traffic' && dist2(v.x, v.z, p.x, p.z) < 90 * 90) cars++; for (const q of G.peds.list) if (!q.dead && q.role === 'civ' && dist2(q.x, q.z, p.x, p.z) < 40 * 40) peds++;
    const sea = clamp(1 - G.map.waterDist[G.map._idx(p.x, p.z)] / 55, 0, 1);
    G.audio.setAmbient({ night01: s.night, rain01: s.rain, crowd01: clamp(peds / 10, 0, 1), traffic01: clamp(cars / 10, 0, 1), wind01: clamp(0.2 + (p.vehicle ? p.vehicle.totalSpeed / 50 : 0) + (p.y > 25 ? 0.3 : 0), 0, 1), sea01: sea });
  }

  updateFps(dt) {
    if (G.input.wasPressed('F2')) { this.hudHidden = !this.hudHidden; G.hud.root.style.visibility = this.hudHidden ? 'hidden' : 'visible'; }
    if (G.input.wasPressed('F3')) { this.showFps = !this.showFps; let e = document.getElementById('fpsBox'); if (!e) { e = document.createElement('div'); e.id = 'fpsBox'; e.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:9;font:12px monospace;color:#9f9;background:rgba(0,0,0,.5);padding:2px 8px;border-radius:4px;pointer-events:none'; document.body.appendChild(e); } e.style.display = this.showFps ? 'block' : 'none'; }
    if (this.showFps) { this._fpsT = (this._fpsT || 0) + dt; if (this._fpsT > 0.4) { this._fpsT = 0; const i = this.renderer.info.render; document.getElementById('fpsBox').textContent = `${Math.round(this.fpsAvg)} fps · ${Math.round(i.triangles / 1000)}k tris · ${i.calls} calls · peds ${G.peds.list.length} · cars ${G.vehicles.list.length}`; } }
  }

  updateWorldFx(dt) {
    // street-lamp / signal visuals handled in world effects module (lights.js) if present
    if (G.lights) G.lights.update(dt);
  }

  updatePrompts(dt) {
    const p = G.player; let text = null;
    if (!p.vehicle && p.controlEnabled && !this.inCutscene) {
      let best = null, bd = 4.5 * 4.5;
      for (const v of G.vehicles.list) { if (v.exploded || v.locked) continue; const dd = dist2(v.x, v.z, p.x, p.z); if (dd < (v.radius + 4) ** 2) { const dw = v.doorWorldPos(0); const d = dist2(dw.x, dw.z, p.x, p.z); if (d < bd) { bd = d; best = v; } } }
      if (best) text = best.driver ? `<kbd>F</kbd> Hijack ${best.name}` : `<kbd>F</kbd> Enter ${best.name}`;
    }
    if (G.promptOverride) text = G.promptOverride;
    if (G.interactPrompt) text = G.interactPrompt;
    if (text !== this._promptText) { this._promptText = text; G.hud.prompt(text); }
  }
}
