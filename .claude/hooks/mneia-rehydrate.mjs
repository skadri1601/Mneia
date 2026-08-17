#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  appendLog,
  disabled,
  parseJson,
  projectBinding,
  readPayload,
  releaseLock,
  repoRootFrom,
  runMneia,
  sessionIdOf,
  timeoutMs,
  writeState,
} from './mneia-dogfood.mjs';

const DEFAULT_TIMEOUT_MS = 12000;

function pass() {
  process.exit(0);
}

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    }),
  );
  process.exit(0);
}

function currentBranch(root) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function taskFor(root, binding) {
  const branch = currentBranch(root);
  if (branch.length > 0 && branch !== 'HEAD') {
    return `continuing work on branch ${branch} in the ${binding.project} project`;
  }
  return `starting a session in the ${binding.project} project`;
}

function unavailableNote(reason) {
  return [
    '## Mneia project memory — unavailable',
    '',
    `The session-start rehydration did not run: ${reason}`,
    '',
    'Work normally. Project memory is not loaded for this session, so do not assume the',
    'constraints and decisions already recorded are in front of you.',
  ].join('\n');
}

function sliceContext(binding, slice, task) {
  const markdown = typeof slice.renderedMarkdown === 'string' ? slice.renderedMarkdown.trim() : '';
  const itemCount = Array.isArray(slice.items) ? slice.items.length : 0;

  if (markdown.length === 0 || itemCount === 0) {
    return [
      '## Mneia project memory — empty',
      '',
      `No context is recorded for ${binding.workspace}/${binding.project} yet.`,
      '',
      'Assert decisions and constraints as they are made so the next session inherits them.',
    ].join('\n');
  }

  const sliceId = typeof slice.sliceId === 'string' ? slice.sliceId : null;

  const lines = [
    '## Mneia project memory (rehydrated at session start)',
    '',
    `Project ${binding.workspace}/${binding.project} · task "${task}" · ${itemCount} items · ${slice.tokensUsed}/${slice.tokenBudget} tokens.`,
    '',
    markdown,
    '',
    '---',
    '',
    'Rehydrate again when the task changes. When you record a checkpoint, pass the ids of the',
    'items above that actually changed what you did — that is the only signal of whether this',
    'slice was worth loading.',
  ];

  if (sliceId !== null) {
    lines.push('', `Slice id: ${sliceId}`);
  }

  return lines.join('\n');
}

const payload = readPayload();
if (payload === null) pass();
if (disabled()) pass();

const root = repoRootFrom(payload.cwd ?? process.cwd());
const binding = projectBinding(root);
if (binding === null) pass();

const sessionId = sessionIdOf(payload);
if (sessionId === null) pass();

const startedAt = new Date().toISOString();
const source = typeof payload.source === 'string' ? payload.source : null;

function armSession(lastOutcome, sliceId) {
  writeState(root, sessionId, {
    sessionId,
    startedAt,
    source,
    checkpointedTurns: 0,
    checkpointCount: 0,
    lastCheckpointAt: null,
    lastOutcome,
    sliceId,
  });
}

releaseLock(root, sessionId);
armSession(null, null);

const task = taskFor(root, binding);
const budgetMs = timeoutMs(DEFAULT_TIMEOUT_MS);
const result = runMneia(['brief', task, '--json'], { cwd: root, timeoutMs: budgetMs });

if (result.status !== 0) {
  const reason =
    result.failure ??
    `mneia brief exited ${result.status}${result.stderr.trim().length === 0 ? '' : ` — ${result.stderr.trim().split('\n')[0]}`}`;
  appendLog(root, { event: 'rehydrate', sessionId, outcome: 'failed', reason });
  process.stderr.write(`[mneia-dogfood] rehydrate skipped: ${reason}\n`);
  emit(unavailableNote(reason));
}

const slice = parseJson(result.stdout);
if (slice === null) {
  const reason = 'mneia brief --json did not return parseable JSON';
  appendLog(root, { event: 'rehydrate', sessionId, outcome: 'failed', reason });
  process.stderr.write(`[mneia-dogfood] rehydrate skipped: ${reason}\n`);
  emit(unavailableNote(reason));
}

armSession('rehydrated', typeof slice.sliceId === 'string' ? slice.sliceId : null);

appendLog(root, {
  event: 'rehydrate',
  sessionId,
  outcome: 'ok',
  task,
  sliceId: typeof slice.sliceId === 'string' ? slice.sliceId : null,
  items: Array.isArray(slice.items) ? slice.items.length : 0,
  tokensUsed: slice.tokensUsed ?? null,
});

emit(sliceContext(binding, slice, task));
