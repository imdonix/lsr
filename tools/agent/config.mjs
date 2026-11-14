// Defaults + loader for the autonomous agent loop.
import path from 'node:path';
import { ROOT, readJson } from './util.mjs';

export const DEFAULT_CONFIG = {
  // Git isolation: the loop refuses to start on a dirty tree, then commits
  // every verified iteration to this branch. It never pushes.
  branch: 'agent/improve',
  baseBranch: null,

  // Single non-interactive OpenCode session per iteration. Each iteration is a
  // fresh session (archived) so context never accumulates across the night.
  agent: 'director',
  model: null,
  verifyAgent: 'verifier',
  fixAgent: 'fixer',
  iterationTimeoutMin: 75,
  verifyTimeoutMin: 25,
  repairRounds: 2,
  verify: true,
  requireVerification: true,

  // Unlimited by default: the loop runs until stopped. These are safety valves.
  maxIterations: 0,
  maxHours: 0,
  maxConsecutiveFailures: 6,
  maxConsecutiveNoChange: 5,
  cooldownSec: 10,
  failureBackoffSec: 120,

  // Deterministic gates run by the harness, never by the agent under test.
  port: 8123,
  chromium: null,
  gateTimeoutMin: 25,
  storyTimeoutMin: 35,
  monkeyMinutes: 1,
  storyEvery: 3,
  storyFrom: 'm01',
  storyTo: 'm04',
  gates: {
    static: true,
    smoke: true,
    monkey: true,
    story: true,
    worldAudit: false,
  },
  worldMaxBuildingsOnRoad: 0,
  worldMaxFloating: 0,

  // Guided programs. When questProgram is on, every iteration is assigned the
  // first unchecked quest from questFile and advances the checklist.
  questProgram: false,
  questFile: '.agent/quest-polish.md',

  // Repo behaviour.
  commit: true,
  resetOnFailure: true,
  backlogFile: '.agent/backlog.md',
  stopFile: '.agent/STOP',
  stateFile: '.agent/state.json',
  runsDir: '.agent/runs',
  serverLog: '.agent/logs/server.log',
};

export function loadConfig(root = ROOT) {
  const file = path.join(root, '.agent/loop.config.json');
  const user = readJson(file, {}) || {};
  const merged = { ...DEFAULT_CONFIG, ...user, gates: { ...DEFAULT_CONFIG.gates, ...(user.gates || {}) } };
  return merged;
}

export function applyOverrides(config, overrides = {}) {
  const next = { ...config, gates: { ...config.gates } };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    if (k === 'gates') Object.assign(next.gates, v);
    else next[k] = v;
  }
  return next;
}
