# `.agent/` — autonomous loop runtime

Tracked files:
- `loop.config.json` — tunables for the loop and gates.
- `backlog.md` — persistent, prioritized improvement list read by the director each iteration.

Ignored runtime files (created by `npm run agent:loop`):
- `runs/` — one folder per iteration: prompt, report, gate logs, diff, verifier verdict, screenshots,
  and `summary.md`.
- `logs/server.log` — dev-server output.
- `state.json` — iteration counter, history and totals.
- `status.json` — live phase/status for `npm run agent:status`.
- `loop.lock` — prevents two loops from running at once.
- `STOP` — create this file to stop after the current iteration.

Full protocol and safety notes: [`docs/AGENT_LOOP.md`](../docs/AGENT_LOOP.md).
