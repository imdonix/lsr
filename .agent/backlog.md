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
- [ ] **Mission giver fallback.** Direct `M.start(def)` without a start-marker giver crashes
  scripts that touch `r.giver` (`src/missions.js:365-371`, `src/storylib.js:102`,
  `src/story.js:79-81`). This makes the repo's `qa_story_edge` FAIL twice (m02 cash wait and
  idle reminder). Fix: spawn/adopt a fallback giver in `MissionManager.start` when
  `def.giver && !giverPed` (~5-10 lines). Acceptance: `node tools/play.js
  tools/qa_story_edge.js --exe /usr/bin/google-chrome` shows zero `mission error` lines and
  all PASS.
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
  adversarial probes), which a post-push re-query can cover. Acceptance: equivalence probe on
  random/real entity positions + collider visits/step < 2000, with `qa_game_soak`/`monkey`
  clean.
- [ ] **Pickup geometry leak.** `Pickups.remove` never disposes `BoxGeometry`/`ExtrudeGeometry`/
  `SphereGeometry` or the sprite material (`src/pickups.js:44`); renderer geometries grew
  252 -> 373 after 140 field drops and never returned. Track per-pickup owned disposables
  (weapon models and `MAT.*` are shared — do not dispose those). Acceptance: geometry count
  returns to baseline after spawning/removing N pickups; weapon pickups still equip.

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
  `!p.vehicle` (`src/game.js:397`), so the tracker says `0 m` with no feedback. Add a
  `G.markerHint` ("F  Get out to start <title>" / "Come back in a vehicle") from the existing
  unused `Markers.hint` field, with labels from `missions.js:304`, `places.js`, `activities.js`.
  Acceptance: park a car on m02's ring -> prompt contains "Get out"; exit -> mission starts.
- [ ] **Combat feedback: headshot + hit audio.** `HUD.hitMarker(head)` ignores its argument
  (`src/hud.js:90`), so headshots look identical to body hits; ranged hits play no flesh SFX.
  Use a distinct red marker + throttled positional `hit_flesh` (`src/weapons.js:112-118`).
  Acceptance: deagle headshot sets a distinct crosshair class; body shot does not.
- [ ] **Directional damage feedback.** `Player.onDamaged` ignores `info.source`
  (`src/player.js:49-54`) and only flashes the full screen. Add a short side wedge based on
  camera-relative source angle. Acceptance: shooter left vs right produces mirrored DOM
  transforms in a screenshot probe.
- [ ] **Wanted-star flash dead code.** `HUD.update` force-removes `.flash` every frame
  (`src/hud.js:160` has `&& false`), killing the 1.8 s CSS blink from `setWanted`.
  Acceptance: after `G.police.raise(2)`, `#stars` still has `flash` at +1 s.
- [ ] **`c2_rampage` objective line.** The Rampage side quest only sets a counter/timer and
  never calls `r.objective` (`src/sidequests.js:1058-1089`), so `#objective` is empty.
  Acceptance: start it headlessly; objective text contains the 15-kill goal.
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
- [ ] **Docs drift.** Update `docs/ARCHITECTURE.md` / `docs/SPEC.md` when a module API changes.
  Acceptance: docs match the code paths touched.
- [ ] **Dead code / unused exports.** Remove only code proven unused by grep and the runtime.
  Acceptance: static check + smoke + story subset pass.

## Ideas parked for a human decision

- Large mission/story additions, new districts, new vehicle classes, save-format changes, and
  anything requiring new dependencies or external assets. The loop should not start these alone.
