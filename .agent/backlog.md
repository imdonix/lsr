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
- [ ] **Mission cleanup audit.** After each mission/quest, no mission-marked peds, vehicles,
  markers or blips should survive. Acceptance: `qa_legit` / `bot` entity-leak counters stay flat;
  a targeted script checks `G.peds.list.filter(p => p.mission)` after `M.abortAll()`.
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
- [ ] **Entity culling.** Verify distant traffic/peds are removed and do not accumulate. Acceptance:
  `qa_game_soak` counts stable over 10+ simulated minutes. Known gap: stolen/abandoned
  `owner === 'player'` cars are exempt from the population despawner forever
  (`src/player.js:282`, `src/population.js:60-66`); 30/30 survived a 300 m teleport. Keep
  `G.lastPlayerVehicle` and mission cars, cull the rest outside `farR+40`.
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
- [ ] **Pickup geometry leak.** `Pickups.remove` never disposes `BoxGeometry`/`ExtrudeGeometry`/
  `SphereGeometry` or the sprite material (`src/pickups.js:44`); renderer geometries grew
  252 -> 373 after 140 field drops and never returned. Track per-pickup owned disposables
  (weapon models and `MAT.*` are shared — do not dispose those). *Live probe (iter 2):* 60
  mixed pickups in view took geometries 220 -> 284 and did not reclaim them; safe shape is a
  per-pickup `owned[]` list covering each mesh geometry created in `spawn` plus the
  per-pickup `SpriteMaterial` (keep `glowTex`, `MAT.*`, three's shared sprite geometry and
  cached weapon models). Acceptance: geometry count returns to baseline after spawning/removing
  N pickups; weapon pickups still equip.

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
  *Designer-validated plan (iter 2, ~35 lines):* add `Markers.hintFor(pl)` that scans only
  mismatch markers while parked/slow (<=4 m/s), with a per-marker `hintPad` (5 m shops, 3 m
  mission rings), and call it last in `updatePrompts` so scripted/interact prompts still win;
  set hints at `missions.js:304` + `:130`, `places.js:77` (food/gym) and `:80` (Pay 'n' Spray
  reverse case). Parent probe: car centred on m02's ring -> `#prompt` empty; prototype ->
  "F Get out to start Family Business", on-foot paths unchanged. Acceptance: park a car on
  m02's ring -> prompt contains "Get out"; exit -> mission starts; on foot prompts unchanged.
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
  `""` at +1 s. Acceptance: after `G.police.raise(2)`, `#stars` still has `flash` at +1 s and
  loses it by +2.2 s.
- [ ] **`c2_rampage` objective line.** The Rampage side quest only sets a counter/timer and
  never calls `r.objective` (`src/sidequests.js:1058-1089`), so `#objective` is empty.
  One-liner after the dialogue: `r.objective('Take out <b>15</b> ... before the 90-second
  timer runs out')`; 18 other quests already use this API. Confirmed live (iter 2): active
  quest + `counter="Kills: 0/15 · 87s"` but `#objective === ""`. Acceptance: start it
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

- [ ] **Regression test for the last fix.** Every iteration that fixes a bug should leave behind a
  focused test under `tools/` when the behaviour can be exercised headlessly. Acceptance: the new
  test fails on the parent commit and passes on the fix.
- [ ] **`qa_story_edge` m02 cash-wait setup.** Section 2 claims to test "die while waiting for the
  cash pickup" but only teleports to m02's start (Grove Street) and never moves the 168 m to
  `vk_base`, so `r.goto` never completes and the cash pickup never spawns
  (`tools/qa_story_edge.js:38-47`, `src/story.js:93-97`). After iter 2 the mission no longer
  errors; `pickups=0` is the only remaining FAIL. Fix the setup only (teleport to the vk_base
  door +3 and sim a few seconds before the kill loop); keep every assertion unchanged.
  Acceptance: `PASS m02 reached cash-pickup wait pickups=1` and the whole file prints all PASS.
- [ ] **Docs drift.** Update `docs/ARCHITECTURE.md` / `docs/SPEC.md` when a module API changes.
  Acceptance: docs match the code paths touched.
- [ ] **Dead code / unused exports.** Remove only code proven unused by grep and the runtime.
  Acceptance: static check + smoke + story subset pass.

## Ideas parked for a human decision

- Large mission/story additions, new districts, new vehicle classes, save-format changes, and
  anything requiring new dependencies or external assets. The loop should not start these alone.
