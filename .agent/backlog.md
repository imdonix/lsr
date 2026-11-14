# Improvement backlog

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

- [ ] **Helicopter freezes / rotor audio leaks when the wanted level clears.** `Police.updateHeli`
  is only called inside `if (this.stars > 0)` (`src/police.js:161`) or during cutscenes
  (`src/police.js:147`), and `cleanup()` only sets `this.heli.leave = true`
  (`src/police.js:103`). *Iteration 6 scout:* spawn the 4-star heli, `G.police.setStars(0)`, sim
  120 s -> `police.heli` non-null, the heli is still in `G.vehicles.list`, moved 0 m, siren on, and
  the `heli_rotor` loop is still alive. After `game.respawn('wasted')` (which removes police
  vehicles at `src/game.js:288` but not `police.heli`/its audio) the detached rotor loop stays
  alive for 120 s with 0 helis in the list. Fix: advance an existing heli even at zero stars —
  e.g. `else { this.seenNow = false; this.updateCops(dt); if (this.heli) this.updateHeli(dt); }`
  (`src/police.js:169`) — the `stars >= 4 && !this.heli` spawn guard already prevents respawn and
  the existing `leave` branch flies it out and calls `H.audio.stop()`. Acceptance: empty world,
  `setStars(4)`, sim 2 s (heli exists), `setStars(0)`, sim 20 s -> `police.heli === null`, no
  `isHeli` in `G.vehicles.list`, no live rotor loop; the same after a forced respawn. Add
  `tools/qa_police_heli.js` (parent-failing). Risk: low, police-only.
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
- [ ] **Immortal, uncapped non-timed pickups.** `life` defaults to `1e9` for health/armor/star/tag
  (`src/pickups.js:56`) and every swat death drops an armor pickup with no lifetime
  (`src/peds.js:145`), so long sessions accumulate permanent scene objects (~2.7 draw calls
  each). Fix: expire non-persistent drops (e.g. 180 s) or cap `G.pickups.list` and retire the
  oldest non-persistent entry. Acceptance: kill 100 swat peds, list bounded and
  `renderer.info.render.calls` returns to baseline after expiry.
  *Iteration 4 scout:* the swat armor drop is the **only** default-life caller; `places.js:96` and
  `missions.js:69` pass `persistent:true, life:1e9` explicitly, and cash/weapon already use 60 s.
  Safe one-line slice: `life: o.life ?? (cash || weapon ? 60 : (o.persistent ? 1e9 : 180))`.
  Acceptance: bare `armor` drop is gone after 200 s sim while `{persistent:true,life:1e9}`
  survives, and 100 swat kills leave a bounded list.
  *Iteration 5 probe:* bare `armor` and bare `health` both keep `life=1e9` and survive
  `Pickups.update(200)`; 200 bare armor drops add ~208 scene nodes and raise nearby sim cost.
  Cash/weapon remain 60 s and explicit `life:1e9` controls survive, so the one-line slice is
  still the safe fix.
  *Iteration 6 scout (full call-site audit):* the swat armor drop (`src/peds.js:145`) is the only
  bare caller. `places.js:96`/`missions.js:69` pass `persistent:true, life:1e9` explicitly
  (mission `pickup()` injects `life:1e9`), `events_world.js:251/:380` pass 45/55 s, and cash/
  weapon already default to 60 s. 200 bare armors: live list 10->210, `scene.children` +200,
  exactly +2 draw calls each when visible; `update(200)` drains none. Mass expiry is safe (600
  `life:1` pickups expire in ~0.2 ms, 0 errors, blips removed; detached entries linger one update,
  so never cap on raw `list.length`). Fix:
  `life: o.life ?? (o.persistent ? 1e9 : (kind === 'cash' || (kind === 'weapon' && o.temp !== false) ? 60 : 180))`
  (persistent first so a hypothetical persistent cash/weapon without explicit life survives).
  Acceptance: bare armor gone after `update(200)`, `scene.children` back to baseline;
  `{persistent:true,life:1e9}` armor survives; bare cash/weapon still gone by 61 s; 100 swat kills
  drain by ~181 s. Optional later cap: 200 non-persistent entries (exclude mission/persistent and
  dead entries) only if a soak shows sustained growth.
- [ ] **Static collision broadphase.** `World.pushCircle` queries a `r + 40` radius for every
  entity (`src/world.js:450`): measured 8,840 collider visits/step and ~54% of sim CPU
  downtown. A `r + 4` query measured 429 visits/step and ~50% lower sim step, bit-identical
  on valid entity states; only pathological deep-inside-collider starts differed (6/3500
  adversarial probes), which a post-push re-query can cover. *New evidence:* over 3,000 random
  positions r=0.4 returned 89.8 vs 7.1 colliders (12.6x less visit work) and 3000/3000
  identical positions; but r=1.2 diverged 4/1900 and r=2.1 diverged 16/1900 (max 5.61 m) on
  deep-inside starts, so the fix needs the re-query loop, not just a smaller pad. Acceptance:
  equivalence probe on random/real entity positions (<0.05 m) + collider visits/step < 2000,
  with `qa_game_soak`/`monkey` clean.
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
  "Get out"; exit -> mission starts; on foot prompts unchanged.
- [ ] **Combat feedback: headshot + hit audio.** `HUD.hitMarker(head)` ignores its argument
  (`src/hud.js:90`), so headshots look identical to body hits; ranged hits play no flesh SFX.
  Use a distinct red marker + throttled positional `hit_flesh` (`src/weapons.js:112-118`).
  *Designer prototype (iter 2):* add `head` class in `hitMarker` + `#crosshair.head` CSS
  (gold/red, 220 ms), and play `hit_flesh` at pitch 1.25 / volume 0.75 for heads, 1.0 / 0.55
  for bodies, throttled ~45 ms. Prototype passed 9/9 (parent 4/9). Acceptance: deagle headshot
  sets a distinct crosshair class and one throttled flesh SFX; body shot does not.
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
  fails, no crash).
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
