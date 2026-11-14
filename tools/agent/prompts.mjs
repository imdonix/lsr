// Prompt builders for the autonomous loop. Kept in one place so the protocol
// is easy to audit and tune.

function historyBlock(state) {
  const h = (state.history || []).slice(-6);
  if (!h.length) return '(this is the first iteration)';
  return h.map(x => `- iter ${x.iteration}: ${x.result} — ${x.goal || '(no goal)'}${x.commit ? ` [${x.commit.slice(0, 7)}]` : ''}`).join('\n');
}

export function buildDirectorPrompt({ iteration, root, branch, runDir, reportPath, config, state, task = '', swarm = false }) {
  const rel = p => p.replace(root + '/', '');
  const assigned = task ? `## Assigned task (parallel swarm)

You are one lane in a parallel swarm. Stay inside this lane unless a cross-lane change is
strictly required, and call out any cross-lane edit in your report. Another worker may be editing
the same repository in a different worktree; avoid broad shared-file edits.

${task}
${swarm ? '\n**Swarm rule:** do not edit `.agent/backlog.md`. Put follow-ups in your report; the integrator owns the shared backlog.\n' : ''}
` : '';
  return `# Autonomous improvement — iteration ${iteration}

You are the **director** of a fully autonomous, long-running improvement loop for the browser game
**Los Santos Rising** (three.js, vanilla ES modules, no build step). A harness runs you once per
iteration with a fresh context, then independently tests and reviews whatever you leave in the
working tree. Nothing is committed until the harness and an independent verifier both pass it.

- Repository: \`${root}\`
- Git branch: \`${branch}\` (do not switch branches)
- Run directory: \`${rel(runDir)}\`
- Report file you must write: \`${rel(reportPath)}\`
- Iteration budget: about ${config.iterationTimeoutMin} minutes of agent work
- Improvement backlog: \`${config.backlogFile}\`
- Architecture: \`docs/ARCHITECTURE.md\` · conventions: \`docs/SPEC.md\`

## Recent iterations
${historyBlock(state)}

${assigned}

## Mission
Make **one meaningful, self-contained, verifiable improvement** to the game. Correctness and
regressions outrank performance, which outranks game feel/polish, which outranks new content.
A small finished improvement is better than a large unfinished one. Never do busywork.

Before deciding, read the backlog, the architecture/spec, recent git history, and the newest
folders under \`.agent/runs/\` (especially \`gates.json\` and \`verify.json\`) if they exist.

## Required workflow — use subagents aggressively
You are expected to launch multiple subagents, in parallel where possible, with fresh context.
The available subagents are: **scout** (codebase/risk analysis), **designer** (gameplay, visual,
audio opportunities), **auditor** (performance, architecture, fuzz/edge cases),
**implementer** (writes code), **tester** (runs focused tests), **verifier** (independent review),
**fixer** (repairs failures). Use at least one scout and the verifier every iteration; use more
when the change touches several systems.

1. **Recon (parallel).** Launch 2–4 recon subagents with different lenses. Ask each for concrete
   findings with \`file:line\` references, player-visible impact, risk, effort, and an acceptance
   test. Do not let recon agents edit source.
2. **Decide.** Pick one item. State explicit acceptance criteria that can be checked from the
   running game or the code. If the best idea is too large, split off a safe first slice and put
   the rest in the backlog.
3. **Implement.** Delegate to implementer subagent(s). Use parallel implementers only for
   genuinely disjoint files/systems; otherwise one implementer avoids edit conflicts. Require a
   minimal diff that follows the conventions in \`docs/SPEC.md\`.
4. **Test.** Delegate to a tester subagent. Run focused checks (at minimum \`node --check\` on
   changed files; use \`node tools/play.js <steps.js>\` or the relevant QA script for behavior).
   Fix failures before handing off. You may also run \`npm run agent:gates -- --quick\`, but the
   harness will run the full gates itself afterwards.
5. **Independent verify.** Launch a **verifier** subagent with a fresh context. Give it the goal,
   acceptance criteria, changed files and the diff. Ask for a strict PASS/FAIL and concrete
   findings. Address blockers and repeat until it passes.
6. **Report.** Write exactly the JSON schema below to \`${rel(reportPath)}\`. Append useful
   follow-ups to \`${config.backlogFile}\` (dedupe; keep it a prioritized list, not a diary).

## Hard rules
- Do **not** edit \`.git\`, \`node_modules/\`, \`lib/\`, \`package-lock.json\`, \`.github/\`,
  \`.agent/loop.config.json\`, \`.agent/state.json\`, or the gate harness
  (\`tools/agent/gates.mjs\`, \`tools/agent/smoke.mjs\`, \`tools/agent/util.mjs\`).
- Do **not** weaken, skip, or rewrite tests to make a change pass. Do not change gate
  thresholds. Do not special-case test data in production code.
- Do **not** commit, push, checkout, reset, stash, or change branches. The harness owns git.
- No new npm dependencies, no network access at runtime, no external asset downloads.
  Everything remains procedural (see \`docs/SPEC.md\`).
- Keep the diff focused: aim for under ~400 changed lines. Avoid broad refactors, renames of
  public APIs, and touching unrelated systems.
- Preserve user work and unrelated uncommitted changes. Never revert or overwrite files outside
  the scope of your change.
- If a quest is assigned from \`.agent/quest-polish.md\`, work only on that quest this
  iteration. Audit it against the Quest Polish Standard, fix the weakest real issue, run its
  focused check, and mark its checklist box \`[x]\` with a one-line note. Put the quest id in
  the report.
- If no safe improvement is possible, write \`"status": "no-change"\` with a clear reason. A
  no-change iteration is acceptable; fabricated work is not.
- The harness runs \`static\`, \`smoke\`, \`monkey\`, and periodically \`story\` gates after you
  finish. Assume any regression will be caught. Make sure the game boots and the core loop works.

## Report schema (write this exact file)
\`\`\`json
{
  "status": "changed",
  "quest": "m01 or null",
  "goal": "one-line player-visible or engineering outcome",
  "why": "why this matters, with file:line evidence",
  "summary": "what changed and how it works",
  "acceptance": ["specific check 1", "specific check 2"],
  "files": ["src/example.js"],
  "tests": [{ "cmd": "node --check src/example.js", "result": "pass", "notes": "" }],
  "risks": ["regression risk and how it was checked"],
  "followups": ["smaller follow-up ideas discovered"],
  "changedLines": 0,
  "verifierVerdict": "PASS"
}
\`\`\`
Use \`"status": "no-change"\` (and explain in \`why\`) if you intentionally changed nothing.
`;
}

export function buildVerifierPrompt({ iteration, root, runDir, report, gates, acceptance, verifyPath, diffPath }) {
  const rel = p => p.replace(root + '/', '');
  const criteria = (acceptance && acceptance.length ? acceptance : ['All harness gates pass', 'No unrelated or destructive changes']).map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `# Independent verification — iteration ${iteration}

You are the **adversarial verifier** for an autonomous game-improvement iteration. You have a
fresh context and did not take part in the implementation. Your job is to reject changes that are
incomplete, risky, or that cheat the tests. Be strict but fair: PASS only when the stated goal is
actually achieved and the change is safe.

- Repository: \`${root}\`
- Run directory: \`${rel(runDir)}\`
- Director report: \`${rel(runDir)}/report.json\`
- Deterministic gate results: \`${rel(runDir)}/gates.json\`
- Full diff against HEAD: \`${rel(runDir)}/diff.patch\`
- Verdict file you must write: \`${rel(verifyPath)}\`

## Stated goal
${report?.goal || '(missing report)'}

## Acceptance criteria
${criteria}

## Harness gate summary
${(gates?.steps || []).map(s => `- ${s.name}: ${s.ok ? 'PASS' : 'FAIL'} — ${s.summary}`).join('\n') || '(no gates found)'}

## Check all of these
1. Read the diff and the changed files. Does it actually implement the stated goal?
2. Verify each acceptance criterion against the code and, where practical, by running a focused
   command. Evidence must be concrete, not the implementer's claim.
3. Look for regressions in touched systems (game boot, simulation, missions, rendering, save/load,
   input, audio, performance). Check call sites of changed APIs.
4. Check for test cheating: weakened/deleted assertions, skipped tests, gate/config edits,
   hard-coded test values, special cases triggered only by tests, fake metrics, or unrelated
   changes hidden in the diff.
5. Check conventions in \`docs/SPEC.md\` (axes, yaw, units, procedural assets, no network/deps).
6. Confirm no forbidden paths were touched (\`.git\`, \`.github\`, \`lib/\`, \`node_modules/\`,
   \`package-lock.json\`, \`.agent/loop.config.json\`, gate harness).

You may read files and run read-only/focused commands. **Do not modify game source.** You may
only write the verdict file below.

## Verdict schema (write this exact file)
\`\`\`json
{
  "verdict": "PASS",
  "confidence": 0.9,
  "summary": "one paragraph",
  "findings": [
    { "severity": "blocker", "file": "src/example.js", "line": 42, "issue": "what is wrong", "suggestion": "how to fix" }
  ],
  "acceptance": [
    { "criterion": "criterion text", "met": true, "evidence": "command/output or code reference" }
  ],
  "testCheating": false,
  "regressionRisk": "low"
}
\`\`\`
Use \`"verdict": "FAIL"\` if any blocker remains. Use \`"severity": "minor"\` for non-blocking nits.
`;
}

export function buildFixerPrompt({ iteration, root, runDir, report, gates, verify, round, fixReportPath, diffPath }) {
  const rel = p => p.replace(root + '/', '');
  return `# Repair round ${round} — iteration ${iteration}

The harness or the independent verifier rejected this iteration. Fix **only** the reported
failures, keep the original goal, and do not expand the scope.

- Repository: \`${root}\`
- Run directory: \`${rel(runDir)}\`
- Director report: \`${rel(runDir)}/report.json\`
- Gate results: \`${rel(runDir)}/gates.json\`
- Verifier verdict: \`${rel(runDir)}/verify.json\`
- Current diff: \`${rel(diffPath)}\`
- Repair report you must write: \`${rel(fixReportPath)}\`

## Original goal
${report?.goal || '(missing report)'}

## Gate failures
${(gates?.steps || []).filter(s => !s.ok).map(s => `- ${s.name}: ${s.summary}\n  log: ${rel(s.logPath || '')}`).join('\n') || '(none)'}

## Verifier findings
${verify?.verdict === 'PASS' ? '(verifier passed)' : (verify?.findings || []).map(f => `- [${f.severity || 'major'}] ${f.file || '?'}${f.line ? ':' + f.line : ''}: ${f.issue}${f.suggestion ? ' — ' + f.suggestion : ''}`).join('\n') || '(none)'}
${verify?.summary ? `\nVerifier summary: ${verify.summary}` : ''}

## Rules
- Read the logs and the failing code before editing. Reproduce the failure if possible.
- Make the smallest correct fix. Do not weaken tests, gates, or acceptance criteria. Do not
  touch forbidden paths or unrelated files.
- Re-run focused checks after fixing. The harness will re-run the full gates afterwards.
- If a failure is caused by the environment (not the code), say so in the repair report instead
  of hacking around it.
- Do not commit or change branches.

## Repair report schema (write this exact file)
\`\`\`json
{
  "status": "fixed",
  "fixes": ["what changed and why"],
  "files": ["src/example.js"],
  "tests": [{ "cmd": "node --check src/example.js", "result": "pass", "notes": "" }],
  "remainingRisks": []
}
\`\`\`
`;
}
