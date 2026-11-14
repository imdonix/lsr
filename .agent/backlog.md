# Improvement backlog

> **ACTIVE PROGRAM — Quest Polish (highest priority).**
> Work through `.agent/quest-polish.md` top to bottom, **one quest per iteration**.
> Do not pick any item below until every quest box is checked. The harness assigns
> the next quest automatically when `questProgram` is on.

The autonomous loop reads this file every iteration. Keep it a **prioritized list of concrete,
verifiable work**, not a diary. The director may append follow-ups and tick items off, but must
keep the structure.

Rules:
- One iteration = one item or a safe slice of one item.
- Every item needs an acceptance test (command or in-game check).
- Prefer fixes with evidence (`file:line`, QA output, screenshot) over speculation.
- Do not duplicate an item; extend it with new evidence instead.
- Large ideas stay here until they can be split into safe slices.

Status markers: `[ ]` open · `[~]` in progress · `[x]` done (with commit) · `[!]` blocked

## P0 — correctness and regressions

- [ ] **Keep the gate baseline green.** Run `npm run agent:gates` and record the baseline in
  `.agent/runs/`. Fix any failure before adding features. Acceptance: all enabled gates pass.

- [x] **Replay-retry pays full reward and re-runs `afterDone`.** `retryLast()` called
  `start(def, { where })` with no replay flag (`src/missions.js:345-360`), so a mission first
  started with `{replay:true}` and then retried paid 100% (not the 40% replay rate) and executed
  `def.afterDone` / `done.add` again (`src/missions.js:394-404`). *Iteration 9:* `MissionManager`
  now records `lastFailedReplay = !!opts.replay` in the failure branch, clears it in
  `clearRetry()`/new start, and `retryLast()` passes `{ where, replay }`, so repeated failed
  retries keep the replay context. Parent probe: replay-start `$1000` def → fail → retry paid
  `+$1000`, `+10` respect, `afterDone` 1; fixed: `+$400`, 0 respect, 0 `afterDone`, done/stats
  unchanged. Regression: `node tools/play.js tools/qa_mission_retry_replay.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome`
  (16 checks; parent 10/16 with exactly the replay checks failing, 3 identical fixed runs; real
  `#mpRetry` HUD path 9/9; bot m02 PASS; story edge only its known m02 cash-wait FAIL).
- [ ] **Side-marker 50% replay also re-runs `afterDone`.** `again` (`src/missions.js:395`) covers
  both `opts.replay` and the side-mission marker replay (`def.side && this.done.has(id)`), but
  `afterDone` is gated only on `!opts.replay` (`src/missions.js:401`). No current side def has
  `afterDone`, so no impact today; hardening: gate with `!again`. Acceptance: a synthetic side
  def with `afterDone` started twice from its marker runs it exactly once.
  *Iteration 13 scout:* all six `afterDone` hooks belong to main defs (`story.js:192`,
  `story2.js:98/343`, `story4.js:784/831`); fold `!again` into the next missions.js touch.

- [x] **Police sirens keep looping after the wanted level clears.** *Iteration 10:* `cleanup()`
  demoted chasers to `owner='traffic'` without clearing `siren` (`src/police.js:101`),
  `releaseVeh()` kept the siren on its driver+AI branch (`src/events_world.js:655`), and the
  pull-over `arrest→leave` transition demoted the cruiser with the siren on (`:217`).
  `Vehicle.setSiren(false)` also only flipped flags, so sleeping/wrecked cars — which skip
  `updateAudio` entirely (`src/vehicles.js:153-154`) — kept a live loop forever (probe:
  `sirenHandle.alive` 1 s after `setSiren(false)`). Fix: `setSiren(false)` now stops
  `sirenHandle` immediately; `cleanup()` silences before demotion; `releaseVeh()` silences a
  demoted car but still keeps the siren on a police car promoted back to `owner:'police'` while
  wanted; the pull-over leave transition silences immediately. Regression:
  `tools/qa_police_siren_cleanup.js` (19 checks; parent HEAD 9 fails on the clear/lightbar/
  handle-3 s/release/sleeping-handle assertions).

- [x] **Homies crew survives quit/new game and permanently blocks recruiting.** *Iteration 11:*
  `G.homies` was built once (`src/game.js:101`) and never reset by `quitToTitle`/`startGame`;
  `PedManager.remove` does not mark the ped `dead`/`removeMe` (`src/peds.js:853`), so
  `Homies.update`'s filter (`src/homies.js:15`) kept disposed crew peds and the recruit gate
  `this.crew.length < this.max` (`:19`) stayed full: after quitting with 3 homies, recruiting was
  bricked for the rest of the page session. An active raid also survived (`this.raid`, blips,
  mission cars/peds, the `setTimeout` checks at `:83-84`). Fix: idempotent `Homies.reset()`
  demotes/clears the crew, removes raid blips, releases raid ped/car mission ownership, nulls
  `raid`, re-rolls `raidT` and clears the stale Recruit prompt; called before the entity wipe in
  both `quitToTitle()` and `startGame()`. Regression `tools/qa_homies_reset.js` (18 checks;
  parent HEAD 10 fails on exactly the C/D crew/raid/blip/prompt assertions; verifier reproduced
  18/0 twice and parent 18/10 twice). Minor test gap: it does not snapshot between quit and
  start, nor press G after reset (verifier probed both separately: 10/10 and 5/5).

- [x] **Helicopter freezes / rotor audio leaks when the wanted level clears.** *Iteration 7:*
  baseline probe confirmed the heli froze at 200 m with the rotor loop alive for 120+ s after
  `setStars(0)`, and after `respawn('wasted')` the detached loop survived with 0 helis in the list.
  Root causes: `updateHeli` was never called at 0 stars (`src/police.js:169`); `cleanup()` flipped
  the heli to `owner='traffic'` so respawn's police sweep missed it (`src/police.js:101`); the
  rotor handle lived only on `police.heli.audio`, so `Vehicle.dispose` could not stop it
  (`src/vehicles.js:439`). Fix: advance an existing heli at 0 stars; keep helis out of the
  owner flip; darken the heli (siren/searchlight off) and drop a stale reference in `cleanup()`;
  store `v.rotorHandle` and stop it in `dispose()`; treat external removal and avoid double
  remove in `updateHeli` (`src/police.js:103,169,292-298`, `src/vehicles.js:443`). Regression:
  `node tools/play.js tools/qa_police_heli.js ...` (39 checks; parent fails 12/23 on the original
  sections, and fails the new 4★→3★/external-removal/quit-to-title checks). Quick gates,
  qa_game_police, qa_vigilante_cleanup and a 5× 4★↔0★ cycle probe all clean; no leaked scene
  children or live loops from the heli.
- [x] **Vigilante duty leaks its criminals.** `startVigilante` spawned criminals with
  `owner:'mission'` / `mission=true` (`src/activities.js:176-179`), but `endDuty` only cleared
  `c.mission` (`src/activities.js:120`) and the timeout path did the same (`src/activities.js:202`).
  The car kept `owner:'mission'` (skipped forever by `src/population.js:61`), its peds kept
  `mission`, and `DriverAI.panicT=1e9` kept it fleeing. *Iteration 4:* shared
  `Activities.cleanupCriminal(c)` now records `criminalPeds` at spawn and, on `endDuty`, success
  and timeout, removes the blip, clears `mission`/`noDespawn`, always releases `owner` to
  `traffic`, resets `panicT`/`fleeFrom`/AI to traffic (or drops AI if the player is driving).
  `endDuty` also captures the duty car before state is nulled, fixing the stuck police/swatvan
  siren (`src/activities.js:122` used to see a null `G.player.vehicle` after `exitVehicle`).
  Regression: `node tools/play.js tools/qa_vigilante_cleanup.js ...` (27 checks; parent HEAD
  fails 18/27 with mission cars/peds surviving, the real-exit siren left on, and dead mission
  peds persisting). Monkey ex 0/NaN 0; m01-m04 PASS; static+smoke PASS.
- [x] **Empty vigilante target list pays out for free.** *Iteration 6:* `spawnCriminals` could
  leave `V.targets=[]` when `pickRoadSpot` failed all attempts and still enter `hunt`, where
  `V.targets.every(...)` is `true` for `[]`, awarding `400 + level*250`, +20 HP and levels every
  ~3 s (parent: +$650 by 2 s, +$9,800 / level 8 + `doneSet('vigilante')` by 20 s, objective
  "take out 0 criminals"). Fix: the empty branch now resets `V.state='spawn'; V.wait=0`, shows
  "Vigilante: looking for criminals…", hides the counter and returns before `hunt`; `done` is
  `V.targets.length > 0 && remaining.length === 0`, and one `cleared(c)` predicate now drives both
  the counter and success (wrecked / dead driver / all occupants dead, empty occupants as before),
  so the payout frame says "Criminals remaining: 0"; the unused `alive` was removed. Regression:
  `node tools/play.js tools/qa_vigilante_empty.js ...` (17 checks; parent 10 fails: free money/
  levels/doneSet/objective/counter, plus the forced-hunt safety net). `qa_vigilante_cleanup` 27/27;
  quick gates static+smoke PASS. Follow-up: a criminal car whose occupants bail out alive still
  counts as cleared (pre-existing, unchanged).
- [~] **Mission cleanup audit.** After each mission/quest, no mission-marked peds, vehicles,
  markers or blips should survive. Acceptance: `qa_legit` / `bot` entity-leak counters stay flat;
  a targeted script checks `G.peds.list.filter(p => p.mission)` after `M.abortAll()`.
  *Iteration 3 probe:* direct-start + 10-20 s mid-mission simulation, then `M.abortAll()`, for
  m02, m05, m08, m11, m12, m17, m20 and `c2_rampage` returned mission peds/vehicles/markers/
  blips/pickups to 0 every time (m11 had 3 pickups + 4 blips live before the abort). Remaining:
  run `qa_legit`/bot counters, and assert `qa_story_edge`'s already-computed blip/pickup counts
  (currently ignored at `tools/qa_story_edge.js:32`).
- [x] **Save/load round-trip.** Save at the safehouse, reload, and verify money, weapons, mission
  progress and quest completion survive. Acceptance: headless script comparing snapshots.
  *Iteration 1:* money/weapons/missions already survived; fixed the real gaps — New Game and
  save load now reset sprayed tags/activities and restore the map gang layer, and saved
  territories (`idlewood`, `jefferson`, `eastls`) repaint on load. Regression:
  `node tools/play.js tools/qa_state_reset.js --exe /usr/bin/google-chrome` (11 checks).
- [x] **Mission giver fallback.** Direct `M.start(def)` without a start-marker giver crashed
  scripts that touch `r.giver` (`src/missions.js:365-371`, `src/storylib.js:102`,
  `src/story.js:79-81`); 17 giver missions crashed immediately, more later, and
  `qa_story_edge` emitted 3 `mission error` traces / 2 FAILs. Fix (iter 2): `start()` now
  spawns a fallback via the existing `spawnGiver()` when no marker ped was adopted, using
  `opts.where` -> `def.where()` -> player position; marker adoption and cleanup unchanged.
  Regression: `node tools/play.js tools/qa_mission_giver.js ...` (19 checks, parent 16 fails).
  `qa_story_edge` now has zero mission errors and the idle reminder PASSes; its one remaining
  cash-wait FAIL is the tool's own stale setup (see P4), not the game.
- [ ] **NaN / stuck-entity sweep.** Use `qa_game_monkey` and `qa_game_soak` to find repeatable NaN
  positions, stuck cars or soft-locked missions. Acceptance: a reproducible failure fixed and the
  relevant QA output clean.
- [ ] **12 floating buildings (world-audit baseline).** `npm run agent:gates -- --quick --world`
  reports 0 buildings on roads but 12 floating >2 m above terrain. Find whether they are hillside
  landmarks or placement bugs; fix the real ones. Acceptance: `world-audit` clean or documented
  intentional exceptions with a threshold justified in the config.
  *Evidence:* all 15 floats (>2 m) are ordinary frontage/infill buildings on 2.5-5.7 m slopes;
  no landmarks. `terraceBuildings` (`src/placement.js:170`) cannot level the steep ones, but
  `world._podium` (`src/world.js:165`) already fills the gap down to `hmin-0.4`, so they are
  visually grounded. Likely the audit should distinguish skirt+podium coverage instead of
  moving buildings; `loop.config.json` is off-limits to this loop, so leave the gate disabled.

## P1 — performance and stability

- [ ] **Frame-time hotspot profile.** Measure `game.sim` and `renderFrame` at downtown, docks,
  beach and hills with `qa_world_perf`. Find one repeatable hotspot and reduce it without visual
  loss. Acceptance: before/after numbers on the same spot, no new draw-call/triangle regression.
- [ ] **Chunk streaming hitch.** Look for spikes when crossing district boundaries; check
  `world.update` job scheduling and geometry merges. Acceptance: `qa_world_stream`/`qa_game_soak`
  max-frame-time improvement or no regression.
- [x] **Entity culling (iteration 5).** Distant player-owned cars leaked forever: every carjack
  sets `owner='player'` (`src/player.js:282`) and mission handovers do too, while
  `cullVehicles` only admitted traffic/police/parked (`src/population.js:60`). Probes: 10/10
  abandoned player cars survived a 430 m teleport (traffic control was culled); 60/60 retained
  ~1,080 scene nodes at ~8 draw calls / 3.3k triangles each. Fix: admit `'player'`, skip
  player-owned cars with occupants, keep the mission/player-driver/`G.lastPlayerVehicle` skips,
  and pass `visible(v.x, v.y, v.z)` instead of the swapped `(v.x, v.z, v.y)` (signature is
  `visible(x,y,z)`, `src/population.js:78`). Regression:
  `node tools/play.js tools/qa_cull_player_cars.js ...` (13 checks; parent fails 2: 10/10
  survivors, swapped args). Gates quick, monkey, bot m01-m04 and qa_game_enter/traffic/flows
  all green. Remaining: only the far-branch `visible` call is not directly spied (it is inert
  beyond 250 m because `maxD=150`); the 90 m stuck branch is asserted.
- [x] **Immortal, uncapped non-timed pickups.** *Iteration 8:* `life` defaulted to `1e9` for
  health/armor/star/tag (`src/pickups.js:56`); the only bare caller is the 50% swat armor roll
  (`src/peds.js:145`), while shop plates (`places.js:96`), mission `pickup()` (`missions.js:69`)
  and world events (`events_world.js:251/:380`) pass explicit lifetimes. HEAD probe: 100 bare
  armors survived `update(181)` (live 10→110, scene children +100, +200 draw calls); armor at
  100 was consumed (`src/pickups.js:79`), unlike health/star. Fix: default is now
  `o.life ?? (o.persistent ? 1e9 : (cash || weapon ? 60 : 180))`; respawn copies carry
  `persistent: p.persistent` with no hardcoded `life`, so generic respawns inherit the kind
  default while persistent plates stay immortal; armor at full armor returns early like health.
  Mission pickups stay non-persistent + explicit `life:1e9` so `qa_story_edge.js:10` still
  detects leaks. Regression: `tools/qa_pickups_life.js` (21 checks; parent HEAD fails 12:
  defaults, 181 s expiry, blip, mass scene/draw calls, generic respawns, full-armor, final
  baseline) passes 3/3 deterministically; dispose 13/13; quick gates static+smoke PASS;
  `qa_life_react` cash-grab unaffected. Follow-ups: respawn copies still omit
  `temp`/`radius`/`onCollect`/`mission` (no production caller combines them with `respawn`), and
  non-persistent drops survive quit-to-title/new game (new P1 item below).
- [x] **Non-persistent drops survive quit-to-title / new game.** `G.pickups` is constructed once
  (`src/game.js:87`); `startGame`/`quitToTitle` cleared peds/vehicles but not dropped pickups, and
  `titleFrame` never ticks pickups, so a drop could neither be cleared nor expire at the title.
  *Iteration 12:* added idempotent `Pickups.resetSession()` (`src/pickups.js:88-103`): backwards
  sweep splices dead entries, keeps live `persistent`/`mission` pickups, remove()+splices every
  transient, and prunes `respawnQueue` to `q.o.persistent` entries. Called next to
  `Homies.reset()` in `quitToTitle()` (after `missions.abortAll()`) and `startGame()`.
  Persistent plates are not rebuilt (`Places.seedPickups` only runs in its constructor,
  `src/places.js:71`). Parent HEAD live probe: 13 live/2 bare/1 mission + 2 queue entries after
  quit and after New Game; fixed: title/list==live==10 plates, transient blip gone, onCollect not
  called, queue keeps only the persistent entry. Regression `tools/qa_session_pickups.js`
  (18 checks: quit, New Game, save+Continue, plates alive+attached; public API only, no direct
  `resetSession` call). Parent control 18 checks/9 fails through the normal RESULT path; working
  tree 18/0 on 5+ runs; qa_pickups_life 21/0, qa_pickups_dispose 13/0, qa_state_reset 11/0,
  qa_homies_reset 18/0; quick gates GREEN. Minor test gap: the live `p.mission` keep-branch is
  only exercised indirectly (abortAll + dead-torso splice); verifier probed it directly and it
  is idempotent. Nit: `startGame()` resets pickups before `missions.reset()`, so a mid-mission
  `startGame()` (not UI-reachable) leaves the killed mission pickup listed until the next
  `update()`; it is already detached and in no list-visible leak.
- [x] **Spray-can loop survives quit-to-title / save load / respawn.** `_sprayLoop` is stopped
  only in `Player.handleWeapons` (`src/player.js:198-203`); quitting while in a vehicle or paused
  leaves it hissing over the title/load (iteration 8 probe: `sprayAlive:true` after
  `pause(true)`→`quitToTitle()`). *Iteration 12 scout (live probe, stubbed handle):* the loop is
  still alive at the title, still alive after `startGame(false)`, and still alive after
  `respawn('wasted')`; it also holds one of the 40 live audio voices. `GameAudio.stopAll()` does
  not mark handles dead, so it is not a substitute. Fix: stop/null it in `quitToTitle`,
  `startGame` and `respawn`. Acceptance: extend `qa_state_reset.js` — fire the spraycan, quit to
  title, assert the handle is dead/null; repeat after respawn.
  *Iteration 13:* `Player.stopSprayLoop()` (`src/player.js:177`) idempotently stops/nulls
  `_sprayLoop`; called from `Game.resetSessionTransients()` (quit + New Game/Continue) and
  `Game.respawn()` (`src/game.js:294`). Covered by `tools/qa_session_transients.js` section G
  (stub handle: exactly one stop per boundary, cleared; parent 0 stops). The test uses a stub,
  not a real audio handle.
- [ ] **Mission/event cleanup releases siren police cars (and two latent demotion branches).**
  `Runner.cleanup()` demotes `owner:'mission' → 'traffic'` and clears `mission` without touching
  the siren (`src/missions.js:211`); `story2.js:304/312` spawns "Harlan's cruiser" as a mission
  police car and calls `setSiren(true)`, so a cruiser that survives the mission is released to
  traffic with the siren on. Also latent (no current live-siren path): `releaseVeh()`'s
  `driver && !ai` branch (`src/events_world.js:656`) demotes without silencing, and
  `releaseLeave()` (`:114`) relies on its two callers (`:488`, `:529`) to silence. *Iteration 11
  scout (live probe):* the meaningful path is `cleanup('pass')`, not abort — abort removes mission
  vehicles, while pass demotes them. After `cleanup('pass')` Harlan's cruiser is
  `owner:'traffic', siren:true, st.siren:true slot:3, aiMode:'flee', panicT:999`, with a live
  handle and `sirenCount:1` three seconds later. The same cleanup leaves two more flags on
  released entities: friendly allies keep `invincible=true` (`src/storylib.js:181-186` sets it;
  `src/missions.js:218-219` never clears it; probe: 500 damage leaves health 200), and
  `noDamage` survives on the limo (`src/story2.js:431`, `src/missions.js:211`). Fix: call
  `v.setSiren(false)` + reset AI/panic on every non-keepPolice demotion, `v.noDamage=false`, and
  `p.invincible=false` in the friendly-release branch. Acceptance: synthetic `Runner` police car
  with `setSiren(true)` + hostile driver + flee AI and a friendly ally, then `cleanup('pass')` →
  siren/lightbar/handle off, AI traffic, noDamage false, ally invincible false and killable.
  *Iteration 13 scout (independent live probe, HEAD):* confirmed after `cleanup('pass')` the
  cruiser is `owner:'traffic', siren:true, st.siren:true`, `sirenHandle alive`, `ai:'flee'`,
  `panicT:992.5`, `sirenCount:1`; a driverless demoted car keeps its stale AI so the sleeping-car
  short-circuit never clears the loop until cull; the ally survives 500 damage (invincible) and
  the limo `noDamage:true`. Fix stays confined to `cleanup('pass')` tails:
  `v.setSiren(false)`, `v.noDamage=false`, reset AI (`setMode('traffic')`, `agent=null`,
  `ignoreLights/aggressive=false`, `panicT=0`, `fleeFrom=null`, `input.handbrake=false`) or drop
  AI when driverless, and `p.invincible=false` for released friends. `releaseVeh`'s
  `driver && !ai` branch (`src/events_world.js:656`) remains latent — every siren event car gets
  a `DriverAI`, so leave it until a real caller appears.
- [ ] **KeyN toggles a police siren on taxis.** `Player.updateDriving` lets any
  police/ambulance/taxi toggle the siren (`src/player.js:302`); `Vehicle.updateAudio` plays the
  `siren_police` loop for every type except ambulance (`src/vehicles.js:425`), so a taxi can get a
  live police siren (probe: handle alive, `sirenCount:1`). Fix: restrict the toggle to
  police/swatvan/ambulance. Acceptance: KeyN in a taxi does nothing; in a police car it still
  toggles and stops the loop.
- [ ] **Player-abandoned emergency car keeps its siren loop.** `Player` makes a stolen car
  `owner:'player'` (`src/player.js:282`) and `KeyN` turns the siren on (`:302`); exiting never
  silences it, and a sleeping car skips `updateAudio`, so the handle stays alive (probe: siren on,
  exit, 10 s → `sleeping:true siren:true handleAlive:true sirenCount:1`) until cull. Fix: in
  `Ped.exitVehicle`, `if (this.isPlayer && v.siren) v.setSiren(false)` (player-only guard leaves
  `qa_police_siren_cleanup` section D's sleeping-NPC expectation intact). Acceptance: enter a
  police car, siren on, exit → false/lightbar off/no handle immediately and after 5 s.
- [x] **Remaining session transients: world events, projectiles/fires, duty, gang heat.**
  *Iteration 11 scout (live probes):* `worldEvents.active` survives (blip + jobs run against
  wiped entities; `abort()` exists at `src/events_world.js:587` but **has no caller**), in-flight
  grenades/molotov fires survive (`src/weapons.js:38-41`; both arrays non-empty after quit and
  after start), `Activities.mode` survives with fare/criminal markers+blips and never re-shows the
  one-time `_taxiHint`/`_vigHint` (`src/activities.js:94-133`), `G.gangHeat` is not saved but
  survives quit/start (probe: 179.8 → New Game), and `G.lastPlayerVehicle` retains a disposed car
  (`src/game.js:374`). Bundle into one idempotent `Game.resetSessionTransients()` called before
  the entity wipe in both `quitToTitle` and `startGame` (homies now does this separately): abort
  events, clear projectiles/fires (+dispose meshes), `endDuty('')` + reset hint flags, zero
  gangHeat, null lastPlayerVehicle, then share one headless script. Acceptance: after quit+new
  game `worldEvents.active===null` and its blip is gone, `combat.projectiles.length===fires.length
  ===0`, `activities.mode===null` with no fare marker/blip, gangHeat all 0, lastPlayerVehicle null,
  entity/scene-child counts flat, no page errors. Note: the older "radio duck" premise is wrong —
  `G.audio.setDuck` does not exist (`src/audio.js` GameAudio has no setDuck; only
  `Radio.setDuck` at `:1105`), so `Game.pause`'s duck call is dead code; either add a delegating
  `GameAudio.setDuck` (a real audio behavior change, then assert 0.4/0) or drop that assertion.
  *Iteration 12 scout (live probes):* independently confirmed all six leaks on HEAD — active
  event at title (+21 blips), 1 grenade + 1 fire at title and still 1/1 into the new session,
  `Activities.mode==='taxi'` at title, gangHeat 180/5 → 179.6/4.6 after New Game, and a truthy
  stale `lastPlayerVehicle`. The event can self-heal on the first play frame, but Continue can
  run queued jobs against wiped entities for up to ~10 s. Still the right bundle; no new
  blockers found.
  *Iteration 13 (shipped):* `Game.resetSessionTransients()` (`src/game.js:187-196`) is called
  from `startGame()` (`:157`, after the pickup reset, before the entity wipe) and
  `quitToTitle()` (`:202`, after `missions.abortAll()`, before the wipe). It nulls
  `lastPlayerVehicle` first (event-vehicle release is not skipped), clears the stale retry offer
  + overlay, stops the spray loop, aborts the world event, clears ordnance/fires, ends duty and
  re-arms hints, and zeroes gang heat. Helpers: `Combat.clearTransients()` detaches/disposes the
  per-instance projectile meshes and empties both arrays (`src/weapons.js:242-251`);
  `Activities.resetSession()` = `endDuty('')` + hint re-arm (`src/activities.js:126`);
  `Player.stopSprayLoop()` (`src/player.js:177`) is also called from `Game.respawn()` (`:294`).
  Retry reset is only in the boundary helper, never `abortAll`, so the mid-mission failure
  branch is untouched. Regression `tools/qa_session_transients.js` (75 checks: A quit, B New
  Game, C Continue, F retry, G spray+respawn; working tree 75/0 twice, pristine `1d0db19`
  parent 75/27 through the normal RESULT path, 21/21 setup checks pass; in-page mutation
  disabling the helper gives 26 fails). Regressions all 0 fails: qa_state_reset 11,
  qa_session_pickups 18, qa_homies_reset 18, qa_police_heli 39, qa_cull_player_cars 13,
  qa_game_flows, qa_police_siren_cleanup 19, qa_vigilante_cleanup 27, qa_pickups_life 21;
  `agent:gates --quick` GREEN (10.8 s). Test gaps: only taxi duty is driven
  end-to-end, rocket/molotov and a real audio spray handle are not.
- [x] **Stale mission-retry overlay survives quit-to-title.**
  `MissionManager.reset()` (`src/missions.js:281`) does not clear `lastFailed`/`lastFailedReplay`
  (only `clearRetry()` at `:343` or a new mission `start()` at `:365` does), and `quitToTitle()`
  only hides the HUD root. *Iteration 12 scout:* fail a mission, quit to title, then Continue
  (no mission start to clear it) → the 14 s "MISSION FAILED / Retry" overlay can reappear and
  `retryLast()` would start a mission that was never active in the loaded save. Narrow (14 s
  window + Continue) but the fix is one `this.clearRetry()` in `reset()` or `quitToTitle()`.
  Acceptance: fail a mission, quit, Continue → no retry overlay, `lastFailed===null`, and
  `retryLast()` no-ops.
  *Iteration 13:* `Game.resetSessionTransients()` calls `missions.clearRetry()` +
  `hud.dismissFail()` (only there, never `abortAll`, so a mid-mission death still offers Retry);
  tested by `tools/qa_session_transients.js` section F after quit and Continue: `lastFailed`
  null, `#mp` opacity 0, `canRetry()` false (parent fails quit/Continue).
- [ ] **Static collision broadphase — exact `r+4` early-out.** `World.pushCircle` queries
  `r + 40` for every entity (`src/world.js:450`) and is called 162–178 times/sim-step
  downtown: 8,383–31,498 collider visits/step and 56.6% of `game.sim` (1.16 of 2.04 ms);
  only ~1% of calls touch anything. *Iteration 10 audit:* the backlog's old "r+4 query +
  post-push re-query" plan is rejected — it diverged on 50/3,000 random positions (max
  1.275 m) and 1/74 deep-inside starts. Use an **exact early-out** instead: a non-mutating
  `r+4` overlap check (separate query array, same circleVsObb/circle-circle predicate) that
  returns `false` immediately when it finds no contact, and otherwise falls through to the
  existing `r+40` two-pass code unchanged. Sound because any collider that can overlap the
  circle has a point within `r`, inside the collider's conservative indexed AABB, so it is
  returned by the small query. Measured: 0/13,902 real entity samples, 0/1,500 random
  positions, 0/74 adversarial deep-inside starts differ; 0 missed colliders in 3,118
  no-contact positions; `game.sim` −52% (downtown), −54% (hills), −61% (rich), −53% (ganton).
  Acceptance: new `tools/qa_push_broadphase.js` — ≥12,000 real samples with 0 diffs
  (tolerance 0), ≥2,000 no-contact soundness probes with 0 misses, collider visits ≥5× lower
  per district (relative, not the old absolute <2000), hybrid ≥30% lower sim ms, plus
  `qa_game_camclip`, `qa_game_monkey`, `qa_game_soak`, `qa_world_perf` unreggressed.
  *Iteration 11 auditor: GO-WITH-CHANGES.* Independent replay reproduced 0/15,553 real,
  0/6,000 random and 0/~800 adversarial diffs; 0 soundness misses; 13.3× fewer visits; sim
  −50% (medians −55.6%). Required test amendments: (a) timing must warm ≥120 sim steps and
  compare medians of ≥5 alternating 60-step blocks, because the first pair measured only 9%
  (flaky); also assert comparable pushCircle call counts and prefer a deterministic captured-
  stream replay as the primary benchmark; (b) add deep-inside/edge/`out`/dynamic-collider
  sections, plus a brute-force `placement.colliders` cross-check; (c) count the forward query
  list (`near` vs `wide`, ≥5× by construction) or require `contactPct < 5`; (d) capture until
  ≥12,000 calls with a bounded retry; (e) keep a separate `_qNear` scratch array and an inline
  predicate with the same `dead` skip/dispatch as the loop below.
  *Iteration 12 auditor: GO-WITH-CHANGES on HEAD 9d2a089.* Re-validated `pushCircle` at
  `src/world.js:448-465` and all 16 callers (13 src + 3 tools), the hash AABBs
  (`src/world.js:63-64`), `queryRadius` (`src/util.js:85-103`) and `circleVsObb` (`:115-137`).
  Fresh probes: 0 diffs on 27,482 real samples (+15,644 prior), 0 soundness misses on 5,600
  random/near-collider probes, 0 adversarial/exact-tangent/`r=7`/dead/dynamic diffs, wide/near
  list ratios 8.9× (downtown), 16.8–17.2× (hills/rich/ganton), median `game.sim` −50.7%, −49.4%,
  −62.3%, −48.5%. Source diff is insert-only (~10-14 lines after `let hit=false`); the `r+40`
  two-pass block, the `dead` skip and the `hw !== undefined`/circle dispatch must stay
  byte-identical; never re-query after a push. Story gate runs in iteration 13, so budget for the
  ~45-60 min QA file; do not bundle the dead `y0`/`y1` height-filter idea.
  *Iteration 13 auditor: GO for iteration 14 (non-story).* Deferred because iteration 13 was
  already carrying the session-boundary fix. Re-validated on HEAD: 26,704 comparisons (6,000
  random, 2,000 near-collider × 8 radii, exact-tangent OBB/circle, 1,223 real calls) → 0 diffs;
  brute-force scan of all 27,390 `placement.colliders` over 1,796 no-contact probes → 0 missed
  contacts; all 16 callers and both hash index formulas checked. Median `game.sim` 3.022→1.428 ms
  downtown (−52.7%), 1.248→0.498 hills (−60.1%), 1.687→0.720 rich (−57.3%), 2.518→1.032 ganton
  (−59.0%); visits −7–25×. Story gate is ~29 s, not 45-60 min (iter 10 gates.json all gates
  48.4 s); the cost is the new `tools/qa_push_broadphase.js`. Use the deterministic captured-
  stream replay as the primary perf assertion (warm ≥120 steps, medians of ≥5 alternating 60-step
  blocks) to avoid the old 9% first-pair flake.
- [x] **Pickup geometry leak (iter 3).** `Pickups.remove` never reclaimed the per-pickup
  `BoxGeometry`/`ExtrudeGeometry`/`SphereGeometry`/`SpriteMaterial` (`src/pickups.js:44` had a
  no-op traverse); 60 mixed pickups took renderer geometries 215 -> 275 and stayed 275 after
  removing all 70, and a deterministic per-kind cycle leaked 6 geometries (cash 1, health 2,
  armor 1, star 1, tag 1). Fix uses a cache instead of per-pickup dispose: `src/pickups.js` now
  keeps one module-level `GEO` per shape and one `SpriteMaterial` per glow colour
  (`glowMaterial`), reuses them in `spawn`, and `remove` is an idempotent detach (also fixes the
  mission cleanup double-remove path, `src/missions.js:69`/`:206`). This deliberately avoids
  disposing the shared weapon-model cache (`src/models_weapons.js:301-337`), `MAT.*`, `glowTex`
  and three's shared sprite geometry. Regression: `node tools/play.js tools/qa_pickups_dispose.js
  ...` (13 checks; parent code fails the geometry/material growth checks, 48 geometries/cycle).

## P2 — game feel and readability

- [ ] **Combat feedback pass.** Hit markers, muzzle flash, impact sparks, audio and ragdoll
  reactions should read clearly at 25–50 m. Acceptance: before/after screenshots + `qa_game_combat`.
- [ ] **Driving feel pass.** Check steering at low/high speed, handbrake, airborne landing and
  collision response. Acceptance: `qa_game_turn`, `qa_game_uturn`, `qa_game_hills` plus a short
  manual-feel clip.
- [ ] **Objective clarity.** Mission prompts and blips should always say what to do next; no
  ambiguous "go there". Acceptance: play through one mission and list every objective transition.
- [ ] **Marker mode-mismatch hint.** Driving onto any mission/shop start ring does nothing and
  shows no prompt: markers are `footOnly` (`src/pickups.js:164`) and HUD prompts are gated on
  `!p.vehicle` (`src/game.js:415-425`), so the tracker says `0 m` with no feedback. Add a
  `G.markerHint` ("F  Get out to start <title>" / "Come back in a vehicle") from the existing
  unused `Markers.hint` field, with labels from `missions.js:304`, `places.js`, `activities.js`.
  *Designer-validated plan (iter 2/3, ~25-35 lines):* add `Markers.hintFor(pl)` that scans only
  markers carrying `hint` while parked/slow (<=4 m/s), with a per-marker `hintPad` (5 m shops,
  3 m mission rings); in `updatePrompts` use it as a **guarded fallback** (`if (!text && ...)
  text = G.markers.hintFor(p)`) after `G.promptOverride`/`G.interactPrompt`, so scripted prompts
  win. Set hints at `missions.js:304` (start rings, except `vehicleStart`) and `:130`
  (`mode === 'foot'` goto rings only), `places.js:77` (food/gym) and `:80` (Pay 'n' Spray
  reverse case). Do not hint `needVehicle` rings in this slice ("come back in a vehicle" is the
  wrong message when the objective names a car). *Iteration 3 live prototype:* car centred on
  m02's ring -> "F Get out to start Family Business"; after F -> m02 active; food ring in car ->
  "F Get out to enter Burger Bonanza"; P'n'P ring on foot -> "Pay 'n' Spray: drive in to
  respray"; `G.interactPrompt`/`G.promptOverride` still win; removing the marker clears it;
  8 m away or 6 m/s hides it. Parent probe: all mismatch rings show `#prompt` display none.
  *Iteration 6 designer revalidation:* live monkey-patch passed all 8 checks (m01 ring, speed gate,
  override/interact precedence, real F-key start, P'n'P on foot, distance/removal; ~0.10 µs per
  call at 11 markers). Do not hint taxi fare/destination rings (only live while driving, so the
  mismatch is unreachable) and keep `needVehicle` rings unhinted. `hintFor` must return null during
  cutscenes/death/car-enter animations. Acceptance: park a car on m02's ring -> prompt contains
  "Get out"; exit -> mission starts; on foot prompts unchanged. *Iteration 11 designer drift
  audit (plan still valid, 3 traps):* `Markers.add` now persists `hint` at `pickups.js:165` but
  not `hintPad`; `Markers.update` skips while `pl.enterT > 0` (`:176`) so `hintFor` must copy that
  guard; the fallback in `updatePrompts` must be **outside** the `!p.vehicle` block
  (`game.js:417-423`) or it can never fire while driving; and `Places.heal()` rebuilds markers
  after quit (`places.js:85-92`), so hints must live inside `makeMarker` too. Probe on HEAD:
  `hintFor` undefined, a car on a food ring leaves `#prompt` display none.
  *Iteration 12 designer:* all five drift claims re-verified on HEAD and the prototype passed
  13/13 (real m01 start, exit-to-start, food ring, P'n'P-on-foot, speed/distance/enterT/
  cutscene/dead guards, override precedence, removal, 0.15 µs/call at 11 markers). Extra drift:
  `Places.heal()` runs every 1.5 s (`src/places.js:323`), not only after quit, so a hint attached
  at runtime is stripped within 1.5 s — hints MUST be set inside `makeMarker`. HUD hides the
  prompt via `display`, not by clearing textContent, so headless checks must assert `display`.
  Wire only markers that carry `hint`; leave taxi/destination/`needVehicle` rings unhinted.
- [ ] **Combat feedback: headshot + hit audio.** `HUD.hitMarker(head)` ignores its argument
  (`src/hud.js:90`), so headshots look identical to body hits; ranged hits play no flesh SFX.
  Use a distinct red marker + throttled positional `hit_flesh` (`src/weapons.js:112-118`).
  *Designer prototype (iter 2):* add `head` class in `hitMarker` + `#crosshair.head` CSS
  (gold/red, 220 ms), and play `hit_flesh` at pitch 1.25 / volume 0.75 for heads, 1.0 / 0.55
  for bodies, throttled ~45 ms. Prototype passed 9/9 (parent 4/9). Acceptance: deagle headshot
  sets a distinct crosshair class and one throttled flesh SFX; body shot does not. *Iteration 11
  designer finding:* the existing hit marker is invisible whenever not aiming or when scoped —
  `hitMarker` toggles a class on `#crosshair` (`hud.js:90`) but that element is hidden by
  `hud.js:153-155`, and `hitT` (`hud.js:36`) is declared but unused. Ship a dedicated
  `#hitmark` element (pointer-events none) driven by `hitT` so hip-fire, melee and scoped hits
  all show feedback; otherwise the headshot marker is unseen in those modes.
- [ ] **Directional damage feedback.** `Player.onDamaged` ignores `info.source`
  (`src/player.js:49-54`) and only flashes the full screen. Add a short side wedge based on
  camera-relative source angle. Acceptance: shooter left vs right produces mirrored DOM
  transforms in a screenshot probe.
- [ ] **Wanted-star flash dead code.** `HUD.update` force-removes `.flash` every frame
  (`src/hud.js:160` has `&& false`), killing the 1.8 s CSS blink from `setWanted`.
  Fixed shape: delete the toggle (do not replace it with `this.seen`, which would blink
  forever); `setWanted`'s `setTimeout` at `hud.js:86` is the only remover, so it cannot stick.
  Confirmed live (iter 2): `#stars.className` is `"flash"` immediately after `raise(2)` but
  `""` at +1 s. *Iteration 3 probe:* `""` at +200 ms/+1.1 s/+2.5 s, so the blink never shows.
  Acceptance: after `G.police.raise(2)`, `#stars` still has `flash` at +1 s and loses it by +2.2 s.
- [ ] **`c2_rampage` objective line.** The Rampage side quest only sets a counter/timer and
  never calls `r.objective` (`src/sidequests.js:1058-1089`), so `#objective` is empty.
  One-liner after the dialogue: `r.objective('Take out <b>15</b> ... before the 90-second
  timer runs out')`; 18 other quests already use this API. Confirmed live (iter 2): active
  quest + `counter="Kills: 0/15 · 87s"` but `#objective === ""`. *Iteration 3 probe:* same at
  t=15-20 s; abort cleans mission entities. Acceptance: start it
  headlessly; objective text contains the 15-kill goal and clears after abort.
- [ ] **Cutscene/dialogue timing.** Use `bot.js --cuts 1` to catch dialogue longer than shots or
  shots that outlast dialogue. Acceptance: fixed timings and screenshots from the cutscene frames.

## P3 — content and variety

- [ ] **Ambient city life.** Add or improve one ambient scene/event using existing systems
  (`ambient_scenes.js`, `events_world.js`, `lifebrain.js`). Acceptance: trigger it headlessly and
  screenshot it; no entity leak.
- [ ] **Radio/audio polish.** One concrete improvement to the generative stations or engine/ambience
  mix. Acceptance: audio-state assertions + a short recorded clip if practical.
- [ ] **Side-quest chain polish.** Pick one of the 20 contracts and improve its readability,
  fail-state fairness or replay value. Acceptance: run that quest with the bot/QA and capture the
  relevant objective transitions.
- [ ] **Visual setpiece.** Improve one landmark or skyline moment with procedural geometry/materials.
  Acceptance: before/after screenshot from a fixed camera.

## P4 — engineering hygiene

- [ ] **`tools/play.js` hides step failures.** `tools/play.js` catches a thrown `steps` error and
  still exits 0, so CI/reviewers that trust the exit code can miss a crashed QA script. Make it
  print `STEPS_ERROR` and exit nonzero (keep closing the browser). Acceptance: a deliberately
  throwing steps file exits nonzero and prints the error; existing QA scripts still exit 0.
- [ ] **Regression test for the last fix.** Every iteration that fixes a bug should leave behind a
  focused test under `tools/` when the behaviour can be exercised headlessly. Acceptance: the new
  test fails on the parent commit and passes on the fix. *Iteration 3:* pickup lifecycle is now
  covered by `tools/qa_pickups_dispose.js` (13 checks, parent-failing). *Iteration 4:* vigilante
  car/ped/blip/siren release is covered by `tools/qa_vigilante_cleanup.js` (27 checks, parent
  18 fails, no crash). *Iteration 5:* player-car culling and the `visible(x,y,z)` order are
  covered by `tools/qa_cull_player_cars.js` (13 checks, parent 2 fails). Minor gap: the far-branch
  `visible` call is not directly spied (only the 90 m stuck branch); add it when touching the
  file again. *Iteration 6:* vigilante empty-spawn payout is covered by
  `tools/qa_vigilante_empty.js` (17 checks: 22 s of failed spawns, recovery, exact-once payout,
  health/armor, repeated updates, forced `hunt` + direct `spawnCriminals` safety nets; parent 10
  fails, no crash). *Iteration 9:* replay/retry economy is covered by
  `tools/qa_mission_retry_replay.js` (16 checks; parent 10/16, only the replay checks fail).
  *Iteration 10:* police siren demotion/cleanup and the immediate `setSiren(false)` handle stop
  are covered by `tools/qa_police_siren_cleanup.js` (19 checks; parent 9 fails — cleanup/release
  flags, lightbar, 3 s re-flash, siren voices and the sleeping-car handle). *Iteration 11:*
  homies crew/raid session reset is covered by `tools/qa_homies_reset.js` (18 checks; parent
  10 fails; verifier also probed quitToTitle-only 10/10 and a real G-key recruit 5/5). Test
  gap to close when touched: snapshot crew/raid/blips immediately after `quitToTitle()` before
  `startGame`, and use a real `KeyG` press after reset instead of calling `recruit()` directly.
  *Iteration 12:* transient pickup session reset is covered by `tools/qa_session_pickups.js`
  (18 checks; working tree 18/0 five-plus runs; parent 9d2a089 18/9 through the normal RESULT
  path for the quit/New Game/Continue leak checks only). Test gap: the live `p.mission`
  keep-branch is only hit indirectly (abortAll then dead-torso splice). *Iteration 13:* the
  session-boundary reset is covered by `tools/qa_session_transients.js` (75 checks: A quit,
  B New Game, C Continue, F stale retry, G spray + respawn; working tree 75/0 twice, pristine
  `1d0db19` parent 75/27 through the normal RESULT path with 21/21 setup checks passing; a
  mutation control that disables `resetSessionTransients` in-page yields 26 fails). Gaps: only
  taxi duty is driven end-to-end; rocket/molotov meshes and a real audio spray handle are not.
- [ ] **`qa_life_react` cash-grab flake.** Section D depends on a stochastic ambient pickup: the
  civ must pass `!p.life`/`mode==='walk'`/the 40% gate in `src/ambient.js:332-343` and reach the
  cash within 10 s. Measured 4/6 on the current build and 5-6/6 on parent HEAD. Make the setup
  deterministic (force the target ped/mode) without changing the assertion. Acceptance: 10/10
  runs report `pickedUp:true`.
- [ ] **Suspended mission coroutines on abort.** Raw-Promise pickup waits
  (`src/story.js:97,275`, `src/story4.js:276,576`) never reject on abort, so the coroutine and its
  captured entity lists stay suspended (memory-only; `start()` races `r.abortP`, so no soft-lock).
  Fix: use an abort-aware wait. Acceptance: start one of these missions, abort during the cash
  wait, and assert the runner releases its references.
- [ ] **`qa_story_edge` m02 cash-wait setup.** Section 2 claims to test "die while waiting for the
  cash pickup" but only teleports to m02's start (Grove Street) and never moves the 168 m to
  `vk_base`, so `r.goto` never completes and the cash pickup never spawns
  (`tools/qa_story_edge.js:38-47`, `src/story.js:93-97`). After iter 2 the mission no longer
  errors; `pickups=0` is the only remaining FAIL. Fix the setup only (teleport to the vk_base
  door +3 and sim a few seconds before the kill loop); keep every assertion unchanged.
  Acceptance: `PASS m02 reached cash-pickup wait pickups=1` and the whole file prints all PASS.
  *Iteration 8:* reproduced identically on parent HEAD (so not a pickup regression); the m02
  opening cutscene is ~24 s (`src/story.js:80-87`, 7 s shot + 17.8 s dialogue) but the test only
  sims ~19 s, so the mission is still in the cutscene when `pickups` is counted.
- [ ] **Docs drift.** Update `docs/ARCHITECTURE.md` / `docs/SPEC.md` when a module API changes.
  Acceptance: docs match the code paths touched. *Iteration 3 audit:* `docs/ARCHITECTURE.md:44`
  omits `interactions.scan/consume`, `ambient`, `worldEvents`, `homies` and gang-heat decay from
  the sim order (`src/game.js:354-372`); the module map omits `homies.js`, `events.js`,
  `state.js`, `util.js`, `geomutil.js`, `version.js`. SPEC module APIs match the code.
- [ ] **Dead code / unused exports.** Remove only code proven unused by grep and the runtime.
  Acceptance: static check + smoke + story subset pass.

## Ideas parked for a human decision

- Large mission/story additions, new districts, new vehicle classes, save-format changes, and
  anything requiring new dependencies or external assets. The loop should not start these alone.
