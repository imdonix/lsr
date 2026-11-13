# Autonomous improvement loop

This repo can improve itself overnight. The loop runs a fresh OpenCode **director** session per
iteration, which delegates to recon, implementation, test and verification subagents. The harness
then independently runs deterministic game tests, asks a separate **verifier** agent to review the
diff, repairs failures when needed, and commits only verified iterations to an isolated branch.

```
            ┌──────────────────────────── one iteration ────────────────────────────┐
            │                                                                        │
  clean ──► │ director (fresh session)                                               │
  tree      │   ├─ scout ×N / designer / auditor   (parallel recon, read-only)       │
            │   ├─ implementer(s)                  (focused code change)             │
            │   ├─ tester                          (focused headless tests)           │
            │   └─ verifier                        (independent PASS/FAIL on the diff)│
            │                                                                        │
            │ harness gates: static → smoke → monkey → story (periodic)              │
            │   └─ fail? → fixer agent → gates again (up to N repair rounds)         │
            │                                                                        │
            │ independent harness verifier (fresh context)                           │
            │   └─ fail? → fixer → gates → verify again                              │
            │                                                                        │
            │ PASS → commit on agent/improve   ·   FAIL → stash & retry              │
            └────────────────────────────────────────────────────────────────────────┘
                                      ↻ forever
```

The loop is **never-ending by default** (`maxIterations: 0`, `maxHours: 0`), but has safety valves:
a stop file, failure/no-change streaks, per-iteration timeouts, and an exclusive lock.

## Quick start

Prerequisites:

- Node 20+ (this repo uses only built-ins; the game tests use `puppeteer-core` from `node_modules`).
- Chrome or Chromium. The loop auto-detects `/usr/bin/google-chrome`, `/usr/bin/chromium`, etc.
  Override with `chromium` in the config or `--chromium /path/to/chrome`.
- Authenticated OpenCode with a default model that can run subagents. `opencode debug agents`
  should list `director`, `scout`, `designer`, `auditor`, `implementer`, `tester`, `verifier`,
  `fixer`.
- A **clean git working tree**. The loop refuses to start otherwise, so it can never accidentally
  commit or hide your work.

```bash
# See exactly what the first prompt would be, without running agents or git.
npm run agent:dry

# Run the deterministic gates on the current tree (read-only; safe on a dirty tree).
npm run agent:gates            # full gates
npm run agent:gates -- --quick # static syntax + boot/drive/render smoke only
npm run agent:gates -- --story # force the story bot gate

# One supervised iteration.
npm run agent:once

# The real thing: run until stopped.
npm run agent:loop

# Watch progress from another terminal.
npm run agent:status

# Stop after the current iteration.
touch .agent/STOP
```

The loop checks out (or creates) the `agent/improve` branch and commits there. **It never pushes.**
Review with `git log agent/improve`, then merge/rebase into your branch when you are happy.

## What one iteration does

1. **Fresh context.** A new `opencode run --agent director --archived` session is started. Nothing
   carries over from the previous iteration except the backlog and state on disk.
2. **Recon.** The director launches several read-only subagents in parallel. Each returns concrete
   findings with `file:line`, impact, risk, effort and an acceptance test.
3. **One change.** The director picks one safe, verifiable slice. If the idea is too large, it
   writes the remainder to `.agent/backlog.md` and implements only the first slice.
4. **Implement.** One or more `implementer` subagents edit code, following `docs/SPEC.md` and
   `docs/ARCHITECTURE.md`. Implementers run syntax checks and focused tests.
5. **Test.** A `tester` subagent exercises the touched system and its blast radius with the existing
   headless harness.
6. **Report.** The director writes `report.json` (goal, acceptance criteria, files, tests, risks,
   follow-ups) into the run directory.
7. **Harness gates.** The harness stages the work and runs deterministic, non-agent tests:
   - **static** — `node --check` every `.js`/`.mjs` in `src/`, `tools/` and `server.js`.
   - **smoke** — boots the real game in headless Chromium, runs world streaming, 10 s of simulation,
     enters a car and drives, checks for NaNs/entity corruption, renders a frame and checks draw
     calls. Fails on page errors.
   - **monkey** — one simulated minute of random input (movement, combat, vehicles, camera,
     weapons), failing on uncaught exceptions or NaN entities.
   - **story** — every `storyEvery` iterations (default 3), auto-plays the first mission block with
     `tools/bot.js`, failing if any mission does not complete or a page error occurs.
   - **world-audit** (optional) — placement audit for buildings on roads, floating buildings and
     underwater props.
8. **Repair loop.** If a gate fails, a `fixer` agent receives the failure logs, the diff and the
   original goal. It makes a minimal fix; the harness re-runs the gates. Default: 2 repair rounds.
9. **Independent verification.** Once the gates are green, a fresh `verifier` session reviews the
   diff against the stated acceptance criteria. It must produce `verify.json` with `PASS`/`FAIL`,
   findings and per-criterion evidence. It may not modify source. The harness detects if the
   verifier changes the staged diff and refuses to commit.
10. **Commit or stash.** On PASS, the harness commits to `agent/improve`. On final failure, the
    diff is archived in the run folder and stashed (`agent-loop iter N failed (...)`) so the next
    iteration starts clean. Recover failed work with `git stash list` / `git stash show -p <stash>`.
11. **State.** `.agent/state.json` gets the history and totals; `.agent/runs/<timestamp>-iter-N/`
    keeps the prompt, report, gate logs, diff, verdict, screenshots and `summary.md`.

## Agents

| Agent | Mode | Role | Can edit? |
|---|---|---|---|
| `director` | primary | Orchestrates the iteration; writes the report | yes (source + backlog) |
| `scout` | subagent | Read-only bug/risk/opportunity recon | no |
| `designer` | subagent | Gameplay, feel, visual, audio, content proposals | no |
| `auditor` | subagent | Performance, architecture, fuzz/edge-case analysis | no |
| `implementer` | subagent | Focused implementation | yes |
| `tester` | subagent | Runs headless tests, reports evidence | no |
| `verifier` | subagent | Independent adversarial review, writes verdict | verdict file only |
| `fixer` | subagent | Repairs gate/verifier failures | yes |

Definitions live in `.opencode/agents/`. The director's permissions allow it to launch all of them;
subagents cannot launch more subagents. `subagent_depth` is 2 so the director can use a verifier
inside its own flow as well as the harness's independent verifier.

## Deterministic gates (source of truth)

The harness never trusts the agents' test claims. Gate implementations:

- `tools/agent/gates.mjs` — orchestration and parsing.
- `tools/agent/smoke.mjs` — boots the real game and exercises core gameplay.
- `tools/play.js` + `tools/qa_game_monkey.js` — fuzz gate.
- `tools/bot.js` — mission/story gate.
- `tools/play.js` + `tools/qa_world_audit.js` — optional world audit.

Run them yourself with `npm run agent:gates`. Output is written to `.agent/runs/<run>/gates.json`
and each gate's log. A gate is enabled/disabled under `gates` in `.agent/loop.config.json`.

**Do not weaken or edit the gate harness to make an iteration pass.** The director, implementer and
fixer agents are denied edit access to those files. If a gate itself is wrong, fix it deliberately
in a separate human-reviewed change and record a new baseline.

## Safety model

- **Clean-tree guard.** The loop aborts if `git status --porcelain` is non-empty. It never commits
  or hides work it did not create.
- **Isolated branch.** All commits go to `agent/improve`; nothing is pushed. `main` stays untouched.
- **Forbidden paths.** Agents cannot edit `.git`, `.github`, `lib/`, `node_modules/`,
  `package-lock.json`, the loop config/state, or the gate harness.
- **Forbidden commands.** Shell denials cover git write operations, `rm`, `sudo`, package installs,
  non-local network fetches, process kills, permissions changes and similar destructive operations.
- **No secrets.** Reads of `.env*`, keys, `.git-credentials` and SSH keys are denied.
- **Stop conditions.** `.agent/STOP`, `maxIterations`, `maxHours`, `maxConsecutiveFailures`
  (default 6) and `maxConsecutiveNoChange` (default 5). `Ctrl-C` kills the current agent process
  group and the dev server it started.
- **Exclusive lock.** `.agent/loop.lock` prevents two loops from fighting over the tree. A stale
  lock (dead pid) is detected and replaced automatically.
- **Timeouts.** Director 75 min, verifier 25 min, gates 25 min, story 35 min by default. Timed-out
  process groups are killed.

## Configuration

Edit `.agent/loop.config.json` (or pass CLI flags). Most useful knobs:

| Key | Default | Meaning |
|---|---|---|
| `branch` | `agent/improve` | Branch the loop commits to |
| `agent` / `model` | `director` / default | Primary agent and optional `provider/model#variant` |
| `iterationTimeoutMin` | 75 | Director time budget |
| `verifyTimeoutMin` | 25 | Verifier time budget |
| `repairRounds` | 2 | Fixer rounds after gate/verify failure |
| `verify` / `requireVerification` | `true` / `true` | Run the independent verifier; fail if it is unavailable |
| `maxIterations` | 0 | 0 = unlimited |
| `maxHours` | 0 | 0 = unlimited |
| `maxConsecutiveFailures` | 6 | Safety stop |
| `maxConsecutiveNoChange` | 5 | Safety stop when the loop cannot find work |
| `cooldownSec` | 10 | Pause between successful iterations |
| `failureBackoffSec` | 120 | Pause after a failure |
| `port` | 8123 | Dev-server port used by gates |
| `chromium` | auto | Chrome/Chromium binary |
| `storyEvery` | 3 | Run the story gate every N iterations (0 = never) |
| `storyFrom` / `storyTo` | `m01` / `m04` | Story block for the gate |
| `monkeyMinutes` | 1 | Fuzz minutes per iteration |
| `gates.worldAudit` | false | Enable the placement audit |

To lower cost, set `gates.monkey: false`, `storyEvery: 10`, `repairRounds: 1`, and/or run
`--quick`. To raise quality, enable `worldAudit` and run the full story range (`m01`–`m24`)
periodically by editing `storyFrom`/`storyTo`.

## Runtime files

```
.agent/
  loop.config.json     tracked — tunables
  backlog.md           tracked — persistent improvement list (director edits this)
  README.md            tracked
  runs/                ignored — one folder per iteration
    <ts>-iter-0001/
      prompt.md        exact director prompt
      logs/            opencode, gate and server logs
      report.json      director report (or report.inferred.json)
      diff.patch       staged diff reviewed by the verifier
      gates.json       deterministic gate results
      gates/*.log      per-gate logs
      verify.json      independent verdict
      repair-N.*       repair prompts/reports
      shots/           smoke/monkey/bot screenshots
      summary.md       human-readable iteration summary
  state.json           ignored — iteration history/totals
  status.json          ignored — live phase
  logs/server.log      ignored
  loop.lock            ignored — exclusive lock
  STOP                 create to stop after the current iteration
```

`npm run agent:status` prints the current branch, lock, phase, totals, recent iterations and the
latest gate/verifier results.

## Reviewing the loop's work

```bash
git log --oneline --decorate agent/improve
git diff main...agent/improve
npm run agent:status
less .agent/runs/<latest>/summary.md
```

Each commit message contains the goal, gate summary, verifier verdict and run directory. If you
dislike an iteration, revert or drop that commit; the loop only ever adds commits to its own branch.

## Troubleshooting

- **"working tree is not clean"** — commit/stash your changes first. The loop deliberately refuses
  to run on top of unknown work.
- **"missing OpenCode agents"** — run `opencode debug agents`; check `.opencode/agents/*.md`
  frontmatter. Config changes reload without restarting OpenCode.
- **Chrome not found / WebGL fails** — set `chromium` to your Chrome binary. Headless WebGL is
  software-rendered and slow; that is expected. The smoke gate waits up to 3 minutes for boot.
- **Verifier wrote no verdict** — inspect `.agent/runs/<latest>/logs/verify-*.log`. With
  `requireVerification: true` the iteration fails rather than committing unverified work. You can
  lower the bar with `--no-verify` for a supervised run, but do not leave it off for unattended use.
- **Loop stops after repeated no-change** — add concrete items to `.agent/backlog.md` or point the
  loop at a specific area in the director prompt/config.
- **A failed iteration was stashed** — `git stash list`, then inspect with
  `git stash show -p <stash>`. Drop it when you no longer need it.
- **Server port already in use** — change `port`; the loop probes for an existing compatible server
  and will reuse it, but it will not kill a server it did not start.
