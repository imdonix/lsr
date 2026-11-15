# Quest Polish Program

This is the active priority for the autonomous loop. Work through **one quest per
iteration, top to bottom**. Do not pick another backlog item until every quest
here is checked.

## Quest Polish Standard

Every quest must be audited against all eight criteria. Fix the weakest one or
two that are worth fixing; do not rewrite the whole mission.

1. **Clarity** — every objective change has a clear prompt, blip, label and toast. The player always knows what to do next.
2. **Fairness** — no unavoidable damage, no instant unexplained failure, no soft-lock. Fail states explain themselves and retry quickly.
3. **Cleanup** — after pass, fail or abort, no mission peds, vehicles, markers, blips, props or timers survive.
4. **Flow** — pacing is deliberate: no dead waiting, no cutscene that outlasts its dialogue, no objective that completes before the player understands it.
5. **Presentation** — camera framing, cutscene shots, audio cues, hit/reward feedback and HUD use feel intentional.
6. **Mechanic readability** — the quest's unique mechanic is taught in one sentence, has visible feedback, and cannot be missed.
7. **State safety** — death, busted, quit-to-title, save/load, replay, low FPS and vehicle destruction leave the quest in a sane state.
8. **Performance** — no new per-frame allocations, geometry/material leaks or unbounded entity growth. Reuse the existing systems.

## Per-iteration workflow

1. Read the assigned quest's `run()` and helpers in its source file. Read the objective text and cutscene lines.
2. Run the quest headlessly with `node tools/bot.js --only <id>` (add `--cuts 1` if it has cutscenes). Capture the objective transitions and any page errors.
3. Score the quest against the eight criteria. Record the concrete weakest issue with `file:line`.
4. Implement the smallest player-visible polish that fixes it. Stay inside the quest/source systems; no unrelated refactors.
5. Run the focused check again (`bot --only <id>`, a targeted `tools/play.js` step, or a screenshot for visual changes).
6. Mark the quest `[x]` below with the commit hash and a one-line note in the same edit. If the quest is already excellent, do a short audit with evidence and mark it `[x] (audited — no change needed: <reason>)`.
7. Put follow-ups in the report, not in the shared backlog.

## Checklist

Legend: `[ ]` not done · `[x]` done · `[!]` blocked (say why)

Progress: 36 / 48

### Chapter I — story (m01–m07)

- [x] **m01 — Welcome Home**
  Meta: autostart · reward: $300 · source: `src/story.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m01` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
  Note: iteration 14 — arrival cutscene now covers its 23.1 s of dialogue with 24.0 s of shots (Ray's close-up reframed; drive chatter can no longer stomp the reunion), and Marcus exits/is released on pass or fail instead of riding along as an invincible passenger.
- [x] **m02 — Family Business**   — swarm merge f43e310: m02's intro cutscene now cuts across three framed shots for its full 18.4 s of dialogue instead of f
  Meta: giver: ray · needs: m01 · reward: $800 · source: `src/story.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m02` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m03 — Rolling Thunder**   — swarm merge a786697: m03 'Rolling Thunder' now cuts across three framed shots covering its full 14.3 s of opening dialogu
  Meta: giver: marcus · needs: m02 · reward: $1100 · source: `src/story.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m03` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m04 — Borrowed Wheels**   — swarm merge 19dc7e2: m04 'Borrowed Wheels' now opens on a framed three-shot cutscene instead of 14.6 s of flat subtitles 
  Meta: giver: ray · needs: m03 · reward: $1500 · source: `src/story.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m04` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m05 — Turf War**   — swarm merge b806a17: Keep m05's 15.8 s Turf War briefing inside a framed cutscene instead of dropping the camera back to 
  Meta: giver: ray · needs: m04 · reward: $2500 · source: `src/story.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m05` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m06 — Two Wheels**   — swarm merge 431752e: m06 'Two Wheels' opening cutscene now frames all 15.7 s of Tee's briefing, and the escort beat gets 
  Meta: giver: tee · needs: m04 · reward: $1900 · source: `src/story.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m06` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m07 — The Rat**   — swarm merge 46b9440: m07 'The Rat' now plays its 20.4 s meeting dialogue over three framed shots (20.7 s), so the camera 
  Meta: giver: ray · needs: m05, m06 · reward: $2200 · source: `src/story.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m07` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
### Chapter I — story (m08–m14)

- [x] **m08 — Vinewood Nights**   — swarm merge a10afa6: m08's opening cutscene now covers all 17.4 s of dialogue with 18.0 s across three distinct shots, re
  Meta: giver: tee · needs: m07 · reward: $3000 · source: `src/story2.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m08` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m09 — Hit List**   — swarm merge 50fcd28: Make Duke's m09 bail-out climax readable and race-proof: he only bails once the escape is under way,
  Meta: giver: ray · needs: m07 · reward: $3500 · source: `src/story2.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m09` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m10 — Fire Sale**   — swarm merge 2c0a84a: m10 'Fire Sale' now cuts across three framed shots covering its full 14.5 s of opening dialogue inst
  Meta: giver: ray · needs: m08, m09 · reward: $1800 · source: `src/story2.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m10` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m11 — Harbor Heist**   — swarm merge b990427: Harbor Heist's briefing is now a properly framed three-shot cutscene covering all 18.6 s of dialogue
  Meta: giver: marcus · needs: m10 · reward: $4500 · source: `src/story2.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m11` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m12 — Cash in Transit**   — swarm merge 804515b: m12's opening briefing now cuts across three framed shots (16.2 s) for its full 15.9 s of dialogue i
  Meta: giver: ray · needs: m11 · reward: $8000 · source: `src/story2.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m12` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m13 — Broken Badge**   — swarm merge 197a4cb: m13 'Broken Badge': Harlan now bails out of his cruiser before it can explode, so Marcus's 'alive lo
  Meta: giver: marcus · needs: m12 · reward: $4000 · source: `src/story2.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m13` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m14 — Blood & Concrete**   — swarm merge 7a8cf0d: m14 'Blood & Concrete' cutscenes now hold camera shots for their full dialogue instead of freezing o
  Meta: giver: ray · needs: m13 · reward: $25000 · source: `src/story2.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m14` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
### Chapter II — story (m15–m24)

- [x] **m15 — Aftermath**   — swarm merge e20ca34: m15's chase marker now follows the lieutenant after he bails, and the opening cutscene is no longer 
  Meta: giver: ray · needs: m14 · reward: $5000 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m15` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m16 — The Source**   — swarm merge 2efeda5: Make m16's escape finish safe and legible: the vehicle-only Grove Street objective states the car re
  Meta: giver: tee · needs: m15 · reward: $6000 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m16` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m17 — Ghost Protocol**   — swarm merge 2cb6106: Make m17's getaway car a real, visible escape step instead of a dead objective and a purposeless bli
  Meta: giver: birdie · needs: m16 · reward: $6500 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m17` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m18 — Low Tide**   — swarm merge 20bed98: m18 'Low Tide' now presents its 18.8 s pier briefing as three framed shots that keep the Santa Maria
  Meta: giver: hollis · needs: m17 · reward: $7000 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m18` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m19 — Grounded**   — swarm merge 55bafc9: m19 'Grounded' now gives the player an explicit HUD objective for both combat phases instead of runn
  Meta: giver: ray · needs: m18 · reward: $7500 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m19` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m20 — Dead Reckoning**   — swarm merge a19409a: m20 'Dead Reckoning': make the player shake the 3-star heat before the Grove Street delivery, so the
  Meta: giver: cody · needs: m19 · reward: $8000 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m20` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m21 — Wiretap**   — swarm merge 9eb4e2d: m21 'Wiretap' now opens on a framed three-shot cutscene covering Tee's full 13.9 s briefing, and the
  Meta: giver: tee · needs: m20 · reward: $8500 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m21` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m22 — Break In**   — swarm merge 2fef5a9: M22 'Break In' no longer stalls for 5.6 s on the bank-arrival cutscene: its two shots now cover Bird
  Meta: giver: birdie · needs: m21 · reward: $12000 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m22` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m23 — Kingmaker**   — swarm merge 2d703cc: m23 'Kingmaker': each of the three territory corners is now a real, named street junction, so the dr
  Meta: giver: ray · needs: m22 · reward: $13000 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m23` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **m24 — The Hollow Crown**   — swarm merge 9f296da: m24's Wexler/Marsh showdown is now staged in the open and filmed with a clear two-shot instead of sp
  Meta: giver: ray · needs: m23 · reward: $30000 · source: `src/story4.js`  
  Focus: objective/prompt clarity; fail-state fairness and retries; entity/marker cleanup; cutscene and camera timing; combat/driving readability; save/replay; edge cases (death, busted, destroyed vehicle, low FPS).  
  Acceptance: `node tools/bot.js --only m24` passes (add `--cuts 1` for cutscene timing); objective transitions and cleanup checked; visual/cutscene change has a screenshot.
### Legacy side quests (s1–s4)

- [x] **s1 — Export List**   — swarm merge 255c0c1: s1 Export List replays now pay the advertised 50% (world marker) / 40% (pause menu) instead of ~90%.
  Meta: giver: Mack · reward: $3000 · source: `src/story3.js`  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only s1` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **s2 — Corner Store Protection**   — swarm merge 125248c: Make s2's 'do not abandon the store' rule actually work: a live countdown warning, a flashing store 
  Meta: giver: Mr. Pak · reward: $2200 · source: `src/story3.js`  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only s2` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **s3 — Gym Brawl**   — swarm merge 0632c67: s3 Gym Brawl: leaving the fight ring now warns the player with a live 12 s countdown and a flashing 
  Meta: giver: Sal · reward: $650 · source: `src/story3.js`  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only s3` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **s4 — Street Medic**   — swarm merge e0b9126: s4 Street Medic now ends cleanly at the hospital door: the bleed meter and its HUD line stop at drop
  Meta: giver: Dre · reward: $2000 · source: `src/story3.js`  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only s4` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
### Chapter I & II quest lines (c1_*, c2_*)

- [x] **c1_repo — Repo Men**   — swarm merge e8eb1b7: Make Repo Men's guard-sneak mechanic readable: the lot guard visibly watches the car and the player 
  Meta: chapter 1 · giver: Mack · needs: m03 · reward: $2400 · source: `src/sidequests.js`  
  Mechanic idea: Cut a wheel boot while a lot guard patrols; crouch to stay unseen.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_repo` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **c1_debts — Bad Debts**   — swarm merge 8a81d0b: Bad Debts' pressure meter now says exactly what the player is missing (gun drawn, distance) and the 
  Meta: chapter 1 · giver: Mr. Pak · needs: m02 · reward: $2100 · source: `src/sidequests.js`  
  Mechanic idea: Non-lethal collection: hold three debtors at gunpoint until their nerve breaks.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_debts` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **c1_school — Crash Course**   — swarm merge aa24595: Make Crash Course's brake-box test completable by a clean stop instead of failing on a hidden 60 km/
  Meta: chapter 1 · giver: Sal · needs: m03 · reward: $1800 · source: `src/sidequests.js`  
  Mechanic idea: Driving school: slalom gates, parallel parking and a high-speed brake box.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_school` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **c1_race — Wrong Side of the Tracks**   — swarm merge d05d9be: Wrong Side of the Tracks
  Meta: chapter 1 · giver: Sal · needs: c1_school · reward: $3200 · source: `src/sidequests.js`  
  Mechanic idea: Six-checkpoint street race against three AI racers with live position tracking.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_race` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **c1_photo — Front Page**   — swarm merge 2d119fc: Make c1_photo completable end-to-end: the target car can no longer be entered, each photo stop keeps
  Meta: chapter 1 · giver: Tee · needs: m06 · reward: $2600 · source: `src/sidequests.js`  
  Mechanic idea: Surveillance photography: follow a source car and frame three meetings.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_photo` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **c1_fire — Fire Drill**   — swarm merge 3379afe: Fire Drill's spray can be performed from outside the burn ring, and its get-out step now gives the r
  Meta: chapter 1 · giver: Cody · needs: m05 · reward: $2900 · source: `src/sidequests.js`  
  Mechanic idea: Firefighting: drive the fire truck, get close and spray three building fires.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_fire` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c1_derby — Demolition Derby**  
  Meta: chapter 1 · giver: Sal · needs: c1_fire · reward: $3500 · source: `src/sidequests.js`  
  Mechanic idea: Weapon-free vehicle arena: wreck four rivals without leaving the lot.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_derby` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **c1_getaway — The Getaway**   — swarm merge f3ecca2: The Getaway now shows the pier destination and starts the getaway drive immediately after the player
  Meta: chapter 1 · giver: Cody · needs: c1_derby · reward: $3800 · source: `src/sidequests.js`  
  Mechanic idea: Forced-driver mission: keep the car moving while Cody shoots from the passenger seat.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_getaway` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [x] **c1_glass — Glass Run**   — swarm merge 803c772: Glass Run's cargo meter now tells the player what is damaging the load, warns before the glass shatt
  Meta: chapter 1 · giver: Mack · needs: c1_repo · reward: $3000 · source: `src/sidequests.js`  
  Mechanic idea: Fragile cargo: smooth driving and cornering keep the glass inventory intact.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_glass` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c1_runner — The Runner**  
  Meta: chapter 1 · giver: Tee · needs: c1_photo · reward: $1700 · source: `src/sidequests.js`  
  Mechanic idea: Foot pursuit and tackle through the pier district.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c1_runner` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_paper — Paper Trail**  
  Meta: chapter 2 · giver: Tee · needs: m15 · reward: $4500 · source: `src/sidequests.js`  
  Mechanic idea: Stealth download: hack three records terminals while guards fill a detection meter.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_paper` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_bodyguard — The Bodyguard**  
  Meta: chapter 2 · giver: Ellis · needs: m15 · reward: $4700 · source: `src/sidequests.js`  
  Mechanic idea: VIP escort: keep an AI-driven armoured SUV alive through three ambushes.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_bodyguard` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_alley — Alley Run**  
  Meta: chapter 2 · giver: Birdie · needs: c2_paper · reward: $3600 · source: `src/sidequests.js`  
  Mechanic idea: Foot race: eight checkpoints against a courier, no vehicles allowed.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_alley` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_collector — Buried Truth**  
  Meta: chapter 2 · giver: Nia · needs: m15 · reward: $4200 · source: `src/sidequests.js`  
  Mechanic idea: Metal-detector search: hunt three buried stashes using signal strength, then dig.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_collector` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_marker — The Marker**  
  Meta: chapter 2 · giver: Tee · needs: c2_paper · reward: $4300 · source: `src/sidequests.js`  
  Mechanic idea: Plant a tracker, follow it at your own pace, then record a meeting from a clean vantage.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_marker` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_spike — Spike Strip**  
  Meta: chapter 2 · giver: Hollis · needs: m16 · reward: $4600 · source: `src/sidequests.js`  
  Mechanic idea: Set a road trap, stop a prison transport without destroying it, then extract the informant.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_spike` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_bounty — The Bounty**  
  Meta: chapter 2 · giver: Mack · needs: m16 · reward: $5000 · source: `src/sidequests.js`  
  Mechanic idea: Non-linear bounty board: capture three targets alive, in any order.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_bounty` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_rampage — Rampage**  
  Meta: chapter 2 · giver: Sol · needs: m17 · reward: $4800 · source: `src/sidequests.js`  
  Mechanic idea: Timed kill challenge: wipe out fifteen Soles in ninety seconds.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_rampage` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_fuse — Short Fuse**  
  Meta: chapter 2 · giver: Birdie · needs: m17 · reward: $5200 · source: `src/sidequests.js`  
  Mechanic idea: Timed bomb defusal: inspect the device and cut the right coloured wire.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_fuse` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
- [ ] **c2_auction — The Auction**  
  Meta: chapter 2 · giver: Nia · needs: c2_bodyguard, m16 · reward: $6500 · source: `src/sidequests.js`  
  Mechanic idea: Social heist: wait for the auction, grab the briefcase and escape the lockdown.  
  Focus: giver and unlock clarity; unique mechanic readability; fail/retry fairness; cleanup and marker leaks; reward/replay feedback; edge cases for the custom mechanic.  
  Acceptance: `node tools/bot.js --only c2_auction` passes; objective transitions and cleanup checked; visual/cutscene change has a screenshot.
## Completion

When every box is checked, the program is complete. Return to `.agent/backlog.md`
for the next priority. Do not invent busywork to keep the program open.
