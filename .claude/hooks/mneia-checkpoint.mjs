#!/usr/bin/env node
import {
  appendLog,
  claimLock,
  countTurns,
  disabled,
  minNewTurns,
  parseJson,
  projectBinding,
  readPayload,
  readState,
  releaseLock,
  repoRootFrom,
  runMneia,
  sessionIdOf,
  timeoutMs,
  writeState,
} from './mneia-dogfood.mjs';

const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MIN_NEW_TURNS = 6;

function pass() {
  process.exit(0);
}

function note(message) {
  process.stderr.write(`[mneia-dogfood] ${message}\n`);
}

const payload = readPayload();
if (payload === null) pass();
if (disabled()) pass();

if (payload.stop_hook_active === true) pass();

const root = repoRootFrom(payload.cwd ?? process.cwd());
if (projectBinding(root) === null) pass();

const sessionId = sessionIdOf(payload);
if (sessionId === null) pass();

const state = readState(root, sessionId);
if (state === null) pass();

const turns = countTurns(payload.transcript_path);
const alreadyCovered = Number.isInteger(state.checkpointedTurns) ? state.checkpointedTurns : 0;
const threshold = minNewTurns(DEFAULT_MIN_NEW_TURNS);

if (turns !== null && turns - alreadyCovered < threshold) pass();

if (!claimLock(root, sessionId)) pass();

try {
  const budgetMs = timeoutMs(DEFAULT_TIMEOUT_MS);
  const result = runMneia(
    [
      'checkpoint',
      '--json',
      '--trigger',
      'task_boundary',
      '--source',
      'claude-code',
      '--session',
      sessionId,
    ],
    {
      cwd: root,
      timeoutMs: budgetMs,
    },
  );

  const receipt = parseJson(result.stdout);
  const wroteNothing =
    receipt !== null && receipt.automaticCount === 0 && (receipt.pendingCount ?? 0) === 0;
  const succeeded = receipt !== null && (typeof receipt.checkpointId === 'string' || wroteNothing);

  const reason = succeeded
    ? null
    : receipt !== null && receipt.checkpointId === null
      ? `mneia checkpoint wrote nothing: ${receipt.automaticCount} automatic and ${receipt.pendingCount ?? 0} awaiting review, and no checkpoint id came back`
      : (result.failure ??
        `mneia checkpoint exited ${result.status}${result.stderr.trim().length === 0 ? '' : ` — ${result.stderr.trim().split('\n')[0]}`}`);

  writeState(root, sessionId, {
    ...state,
    checkpointedTurns: turns ?? alreadyCovered,
    checkpointCount: (Number.isInteger(state.checkpointCount) ? state.checkpointCount : 0) + 1,
    lastCheckpointAt: new Date().toISOString(),
    lastOutcome: succeeded ? 'checkpointed' : 'failed',
  });

  appendLog(root, {
    event: 'checkpoint',
    sessionId,
    outcome: succeeded ? 'ok' : 'failed',
    client: result.client,
    clientSource: result.clientSource,
    turns,
    newTurns: turns === null ? null : turns - alreadyCovered,
    reason,
    checkpointId: succeeded ? (receipt.checkpointId ?? null) : null,
    automaticCount: succeeded ? receipt.automaticCount : null,
    pendingCount: succeeded ? (receipt.pendingCount ?? null) : null,
    pendingTurns: succeeded ? (receipt.pendingTurns ?? null) : null,
    complete: succeeded ? (receipt.complete ?? null) : null,
  });

  if (!succeeded) {
    note(`checkpoint skipped (${result.client}): ${reason}`);
  }
} finally {
  releaseLock(root, sessionId);
}

process.exit(0);
