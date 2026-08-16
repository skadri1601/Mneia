#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ENV_OVERRIDE = process.env.MNEIA_WORKTREE_GUARD === 'off';

function overrideInCommand(text) {
  const sh = text.match(/^\s*((?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+)/);
  if (sh && /\bMNEIA_WORKTREE_GUARD=(?:"off"|'off'|off)(?:\s|$)/.test(sh[1])) return true;
  return /^\s*\$env:MNEIA_WORKTREE_GUARD\s*=\s*['"]?off['"]?\s*;/i.test(text);
}

const LANES = [
  [
    '.claude/worktrees/lane-a-handoff',
    'feat/mne-89-handoff-artifact',
    'A — handoff and the clients',
  ],
  [
    '.claude/worktrees/lane-b-account',
    'feat/mne-181-multi-workspace',
    'B — account and team plane',
  ],
  [
    '.claude/worktrees/lane-c-billing',
    'feat/mne-141-checkout-and-quota',
    'C — billing and telemetry',
  ],
];

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function pass() {
  process.exit(0);
}

function existing() {
  try {
    const out = execFileSync('git', ['worktree', 'list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? `\nWorktrees that already exist:\n${out}\n` : '';
  } catch {
    return '';
  }
}

function lanes() {
  return LANES.map(([p, b, w]) => `  ${p}\n      branch ${b}   (lane ${w})`).join('\n');
}

const REASON =
  `BLOCKED: do not create a new git worktree in this repository.\n\n` +
  `There are exactly four, and they are set up already — dependencies installed and synced to\n` +
  `main. A new worktree costs a full pnpm install and reintroduces the sprawl that was just\n` +
  `cleaned up (twenty stale worktrees, removed 2026-08-16).\n\n` +
  `Work in your lane instead — docs/WORKSTREAMS.md §0:\n\n${lanes()}\n\n` +
  `The fourth is the primary checkout at the repo root, which stays on main.\n` +
  existing() +
  `\nIf your work genuinely does not belong to a lane, say so and let the founder decide rather\n` +
  `than creating one.\n\n` +
  `Real exception, and it has to go through a shell so the guard can see it:\n` +
  `  MNEIA_WORKTREE_GUARD=off git worktree add <path> <branch>\n` +
  `The EnterWorktree tool has no way to carry the override — use the command above instead.`;

const raw = readFileSync(0, 'utf8');
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  pass();
}

if (ENV_OVERRIDE) pass();

const toolName = payload?.tool_name ?? '';

if (toolName === 'EnterWorktree') deny(REASON);

const cmd = payload?.tool_input?.command ?? '';
if (!cmd) pass();

function stripData(text) {
  return text
    .replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, ' ')
    .replace(/@(['"])([\s\S]*?)\1@/g, ' ')
    .replace(/-(?:m|F)\s+(['"])[\s\S]*?\1/g, ' ');
}

if (overrideInCommand(cmd)) pass();

const code = stripData(cmd);
if (!/\bworktree\s+add\b/.test(code)) pass();

deny(REASON);
