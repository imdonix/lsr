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
- [ ] **Save/load round-trip.** Save at the safehouse, reload, and verify money, weapons, mission
  progress and quest completion survive. Acceptance: headless script comparing snapshots.
- [ ] **NaN / stuck-entity sweep.** Use `qa_game_monkey` and `qa_game_soak` to find repeatable NaN
  positions, stuck cars or soft-locked missions. Acceptance: a reproducible failure fixed and the
  relevant QA output clean.
- [ ] **12 floating buildings (world-audit baseline).** `npm run agent:gates -- --quick --world`
  reports 0 buildings on roads but 12 floating >2 m above terrain. Find whether they are hillside
  landmarks or placement bugs; fix the real ones. Acceptance: `world-audit` clean or documented
  intentional exceptions with a threshold justified in the config.

## P1 — performance and stability

- [ ] **Frame-time hotspot profile.** Measure `game.sim` and `renderFrame` at downtown, docks,
  beach and hills with `qa_world_perf`. Find one repeatable hotspot and reduce it without visual
  loss. Acceptance: before/after numbers on the same spot, no new draw-call/triangle regression.
- [ ] **Chunk streaming hitch.** Look for spikes when crossing district boundaries; check
  `world.update` job scheduling and geometry merges. Acceptance: `qa_world_stream`/`qa_game_soak`
  max-frame-time improvement or no regression.
- [ ] **Entity culling.** Verify distant traffic/peds are removed and do not accumulate. Acceptance:
  `qa_game_soak` counts stable over 10+ simulated minutes.

## P2 — game feel and readability

- [ ] **Combat feedback pass.** Hit markers, muzzle flash, impact sparks, audio and ragdoll
  reactions should read clearly at 25–50 m. Acceptance: before/after screenshots + `qa_game_combat`.
- [ ] **Driving feel pass.** Check steering at low/high speed, handbrake, airborne landing and
  collision response. Acceptance: `qa_game_turn`, `qa_game_uturn`, `qa_game_hills` plus a short
  manual-feel clip.
- [ ] **Objective clarity.** Mission prompts and blips should always say what to do next; no
  ambiguous "go there". Acceptance: play through one mission and list every objective transition.
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
