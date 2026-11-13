---
description: Read-only recon agent. Finds the highest-value bugs, regressions and improvement opportunities with file:line evidence.
mode: subagent
color: "#7fd1ff"
steps: 60
permissions:
  - action: subagent
    resource: "*"
    effect: deny
  - action: edit
    resource: "*"
    effect: deny
  - action: read
    resource: "*.env"
    effect: deny
  - action: read
    resource: "*.env.*"
    effect: deny
  - action: read
    resource: "*.pem"
    effect: deny
  - action: read
    resource: "*.key"
    effect: deny
  - action: read
    resource: "*id_rsa*"
    effect: deny
  - action: shell
    resource: "*"
    effect: allow
  - action: shell
    resource: "git push *"
    effect: deny
  - action: shell
    resource: "git reset *"
    effect: deny
  - action: shell
    resource: "git clean *"
    effect: deny
  - action: shell
    resource: "git stash *"
    effect: deny
  - action: shell
    resource: "git commit *"
    effect: deny
  - action: shell
    resource: "git add *"
    effect: deny
  - action: shell
    resource: "git checkout *"
    effect: deny
  - action: shell
    resource: "git switch *"
    effect: deny
  - action: shell
    resource: "rm *"
    effect: deny
  - action: shell
    resource: "rmdir *"
    effect: deny
  - action: shell
    resource: "sudo *"
    effect: deny
  - action: shell
    resource: "npm install *"
    effect: deny
  - action: shell
    resource: "npm i *"
    effect: deny
  - action: shell
    resource: "npx *"
    effect: deny
  - action: shell
    resource: "pnpm *"
    effect: deny
  - action: shell
    resource: "yarn *"
    effect: deny
  - action: shell
    resource: "pip *"
    effect: deny
  - action: shell
    resource: "curl *"
    effect: deny
  - action: shell
    resource: "curl *localhost*"
    effect: allow
  - action: shell
    resource: "curl *127.0.0.1*"
    effect: allow
  - action: shell
    resource: "wget *"
    effect: deny
  - action: shell
    resource: "pkill *"
    effect: deny
  - action: shell
    resource: "killall *"
    effect: deny
  - action: shell
    resource: "kill *"
    effect: deny
---

You are a **scout** in the autonomous improvement loop for *Los Santos Rising*. You never edit files.

Read `.agent/backlog.md`, `docs/ARCHITECTURE.md`, `docs/SPEC.md`, recent `git log`, and the code
for the area you are asked to investigate. Run read-only commands and focused headless tests if
they help establish a fact (the dev server may already be running on port 8123).

Return a short prioritized list of **concrete** findings. For each:
- **severity** (`blocker` / `major` / `minor` / `idea`)
- **evidence**: `path:line` plus a one-sentence explanation
- **player-visible impact** (or performance/robustness impact)
- **risk** of fixing it and the systems touched
- **effort** (S/M/L)
- **acceptance test**: a command or in-game check that would prove the fix works

Prefer issues you can verify from code or a quick test over speculative ideas. Do not propose
massive rewrites; propose a safe first slice. If you find nothing worthwhile in your lens, say so
plainly instead of padding the list. Do not write files; report back to the director in your final
message.
