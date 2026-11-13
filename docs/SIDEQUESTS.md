# Side Quest Lines — Chapters I & II

The campaign is not one straight line. Twenty optional contracts unlock in parallel
chains around the main story, split between **Chapter I: Blood & Concrete** and
**Chapter II: The Hollow Crown**. They are ordinary side quests: they never block the
main plot, they save like story missions, and they can be replayed from the pause menu.

The first four legacy side jobs (`Export List`, `Corner Store Protection`, `Gym Brawl`,
`Street Medic`) still unlock after `m04`. The new Chapter I contracts start earlier:
Bad Debts after `m02`, and the repo/driving jobs after `m03`.

## Chapter I

| # | Quest | Giver | Unlocks after | New idea |
|---|---|---|---|---|
| 1 | **Repo Men** | Mack | `m03` | Cut a wheel boot while a lot guard patrols; crouch to stay unseen. |
| 2 | **Bad Debts** | Mr. Pak | `m02` | Non-lethal collection: hold three debtors at gunpoint until their nerve breaks. |
| 3 | **Crash Course** | Sal | `m03` | Driving school: slalom gates, parallel parking and a high-speed brake box. |
| 4 | **Wrong Side of the Tracks** | Sal | `c1_school` | Six-checkpoint street race against three AI racers with live position tracking. |
| 5 | **Front Page** | Tee | `m06` | Surveillance photography: follow a source car and frame three meetings. |
| 6 | **Fire Drill** | Cody | `m05` | Firefighting: drive the fire truck, get close and spray three building fires. |
| 7 | **Demolition Derby** | Sal | `c1_fire` | Weapon-free vehicle arena: wreck four rivals without leaving the lot. |
| 8 | **The Getaway** | Cody | `c1_derby` | Forced-driver mission: keep the car moving while Cody shoots from the passenger seat. |
| 9 | **Glass Run** | Mack | `c1_repo` | Fragile cargo: smooth driving and cornering keep the glass inventory intact. |
| 10 | **The Runner** | Tee | `c1_photo` | Foot pursuit and tackle through the pier district. |

Chapter I quest lines:

```
Mack:          Repo Men ──> Glass Run
Pak:           Bad Debts
Sal:           Crash Course ──> Wrong Side of the Tracks
Tee:           Front Page ──> The Runner
Cody/Sal/Cody: Fire Drill ──> Demolition Derby ──> The Getaway
```

## Chapter II

| # | Quest | Giver | Unlocks after | New idea |
|---|---|---|---|---|
| 11 | **Paper Trail** | Tee | `m15` | Stealth download: hack three records terminals while guards fill a detection meter. |
| 12 | **The Bodyguard** | Ellis | `m15` | VIP escort: keep an AI-driven armoured SUV alive through three ambushes. |
| 13 | **Alley Run** | Birdie | `c2_paper` | Foot race: eight checkpoints against a courier, no vehicles allowed. |
| 14 | **Buried Truth** | Nia | `m15` | Metal-detector search: hunt three buried stashes using signal strength, then dig. |
| 15 | **The Marker** | Tee | `c2_paper` | Plant a tracker, follow it at your own pace, then record a meeting from a clean vantage. |
| 16 | **Spike Strip** | Hollis | `m16` | Set a road trap, stop a prison transport without destroying it, then extract the informant. |
| 17 | **The Bounty** | Mack | `m16` | Non-linear bounty board: capture three targets alive, in any order. |
| 18 | **Rampage** | Sol | `m17` | Timed kill challenge: wipe out fifteen Soles in ninety seconds. |
| 19 | **Short Fuse** | Birdie | `m17` | Timed bomb defusal: inspect the device and cut the right coloured wire. |
| 20 | **The Auction** | Nia | `c2_bodyguard` + `m16` | Social heist: wait for the auction, grab the briefcase and escape the lockdown. |

Chapter II quest lines:

```
Tee:           Paper Trail ──> Birdie: Alley Run
                          └──> The Marker
Ellis:         The Bodyguard ──> Nia: The Auction
Nia:           Buried Truth
Hollis:        Spike Strip
Mack:          The Bounty
Sol:           Rampage
Birdie:        Short Fuse
```

## Notes for testing

* Mission definitions live in `src/sidequests.js` and are merged into the side-quest
  list by `src/missions.js`.
* Every quest has explicit `needs`, so chains only appear when their prerequisite is
  complete. Several chains run in parallel, which is the point: the player can choose
  which fixer to work for next.
* New mechanics are implemented with the existing mission runner, interaction system,
  markers and vehicle/physics code — no external assets or build step.
