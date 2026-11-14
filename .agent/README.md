# `.agent/` — autonomous loop runtime

Tracked files:
- `loop.config.json` — tunables for the loop and gates.
- `swarm.config.json` — workers, ports and integration settings for `npm run agent:swarm`.
- `swarm-tasks.json` — subsystem lanes assigned to parallel swarm workers.
- `quest-polish.md` — ordered, quest-by-quest polish program (48 quests).
- `backlog.md` — persistent, prioritized improvement list read by the director each iteration.

Ignored runtime files (created by `npm run agent:loop` / `agent:swarm`):
- `runs/` — one folder per iteration: prompt, report, gate logs, diff, verifier verdict, screenshots,
  and `summary.md`.
- `logs/server.log` — dev-server output.
- `state.json` — iteration counter, history and totals.
- `status.json` — live phase/status for `npm run agent:status`.
- `loop.lock` — prevents two loops from running at once.
- `swarm.lock`, `swarm-state.json`, `swarm-status.json` — swarm concurrency/state.
- `worktrees/` — isolated worker + integration git worktrees used by the swarm.
- `STOP` — create this file to stop after the current iteration/wave.

Full protocol and safety notes: [`docs/AGENT_LOOP.md`](../docs/AGENT_LOOP.md).
