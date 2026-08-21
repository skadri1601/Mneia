import type {
  ContextItemReview,
  ContextItemReviewOutcome,
  PendingReviewItem,
  Uuid,
} from '@mneia/core';
import { sanitizeActorName, shortenItemIds } from '@mneia/core';
import { callApi } from '../api.js';
import { confirmationMark, describeActorAttribution } from '../attribution.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpReviewApi } from '../http-api.js';
import type { PromptChoice, Prompter } from '../prompt.js';
import { PromptCancelled } from '../prompt.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';

export interface PendingQueueRequest {
  readonly config: ProjectConfig;
  readonly limit: number;
}

export interface PendingQueue {
  readonly projectId: Uuid;
  readonly items: readonly PendingReviewItem[];
}

export interface SubmitReviewRequest {
  readonly config: ProjectConfig;
  readonly projectId: Uuid;
  readonly reviews: readonly ContextItemReview[];
  readonly summary: string | null;
}

export interface ReviewReceipt {
  readonly checkpointId: Uuid;
  readonly outcomes: readonly ContextItemReviewOutcome[];
}

export interface ReviewApi {
  readonly pending: (request: PendingQueueRequest) => Promise<PendingQueue>;
  readonly submit: (request: SubmitReviewRequest) => Promise<ReviewReceipt>;
}

export interface ReviewDeps {
  readonly api: ReviewApi;
  readonly loadConfig: ProjectConfigLoader;
  readonly prompter: Prompter;
  readonly now?: () => Date;
}

export const DEFAULT_REVIEW_LIMIT = 20;
export const MAX_REVIEW_LIMIT = 100;
export const BODY_PREVIEW_LENGTH = 240;

const USAGE = 'mneia review [--drain] [--limit <count>] [--json]';

const REVIEW_CHOICES: readonly PromptChoice[] = [
  { key: 'y', label: 'confirm' },
  { key: 'e', label: 'edit' },
  { key: 'r', label: 'reject' },
  { key: 's', label: 'leave pending' },
  { key: '?', label: 'why am I being asked' },
];

const EDIT_CHOICES: readonly PromptChoice[] = [
  { key: 't', label: 'title' },
  { key: 'b', label: 'body' },
  { key: 'l', label: 'toggle load-bearing' },
  { key: 'd', label: 'done' },
];

const DECISION_FLAGS: readonly string[] = [
  'confirm',
  'accept',
  'reject',
  'deny',
  'yes',
  'all',
  'human-confirmed',
  'asserted-by',
];

export const DISPUTE_NOTE =
  'A disputed item never appears here: the queue lists active items only, and §10.4 leaves a disagreement between two people to the people involved.';

export const OFF_TTY_MESSAGE =
  'mneia review --drain records a decision only from a keypress by a person, and this is not an interactive terminal — stdin or stdout is piped, redirected, or running under CI, so nothing was confirmed and nothing was written';

export const OFF_TTY_FIX =
  'run mneia review --drain in a terminal; to read the queue from a script, run mneia review --json, which writes nothing';

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function assertNoPositionals(args: readonly string[]): void {
  if (args.length === 0) {
    return;
  }
  throw usageError(
    `mneia review takes no positional arguments; got ${args.join(' ')} — it reads the whole queue for the project this directory is bound to`,
  );
}

export function assertNoDecisionFlags(flags: CommandInvocation['flags']): void {
  for (const name of DECISION_FLAGS) {
    if (flags[name] === undefined) {
      continue;
    }
    throw usageError(
      `mneia review has no --${name}: a confirmation is a keypress by a person, never a flag, because vision.md §10.1 forbids anything else deciding on their behalf`,
    );
  }
}

export function readDrain(flags: CommandInvocation['flags']): boolean {
  const raw = flags.drain;
  if (raw === undefined || raw === false || raw === 'false') {
    return false;
  }
  if (raw === true || raw === 'true') {
    return true;
  }
  throw usageError(
    `--drain takes no value; it walks the queue one item at a time and asks you about each, and got ${raw}`,
  );
}

export function readLimit(flags: CommandInvocation['flags']): number {
  const raw = flags.limit;
  if (raw === undefined) {
    return DEFAULT_REVIEW_LIMIT;
  }
  if (typeof raw !== 'string') {
    throw usageError('--limit needs a number of items');
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`--limit expects a positive whole number of items; got ${raw}`);
  }
  if (parsed > MAX_REVIEW_LIMIT) {
    throw usageError(
      `--limit is capped at ${MAX_REVIEW_LIMIT} items; got ${raw} — the queue is meant to be drained, not paged through`,
    );
  }
  return parsed;
}

export type ReviewDecision = 'confirmed' | 'edited' | 'rejected' | 'pending';

export interface DecidedItem {
  readonly item: PendingReviewItem;
  readonly decision: ReviewDecision;
  readonly title: string;
  readonly body: string | null;
  readonly loadBearing: boolean;
  readonly fieldsChanged: readonly string[];
  readonly reason: string | null;
}

const projectLabel = (config: ProjectConfig): string => `${config.workspace}/${config.project}`;

const utcDate = (at: Date): string => at.toISOString().slice(0, 10);

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

const asserterName = (item: PendingReviewItem): string => sanitizeActorName(item.assertedByName);

const describeAsserter = (item: PendingReviewItem): string =>
  `by ${describeActorAttribution({ displayName: item.assertedByName, kind: item.assertedByKind }, item.assertedBy)}`;

export function marksFor(item: PendingReviewItem): readonly string[] {
  const marks: string[] = [item.kind];
  if (item.loadBearing) {
    marks.push('load-bearing');
  }
  marks.push(`confidence ${item.confidence.toFixed(2)}`);
  marks.push(item.accessScope);
  return marks;
}

export function detailFor(item: PendingReviewItem): string {
  return [
    describeAsserter(item),
    confirmationMark(false),
    `asserted ${utcDate(item.assertedAt)}`,
  ].join(' · ');
}

export function whyAsked(item: PendingReviewItem): string {
  const reasons = [
    `A ${item.assertedByKind} asserted it and no person has confirmed it, so it waits here rather than counting as settled.`,
  ];
  if (item.loadBearing) {
    reasons.push(
      'It is load-bearing, so later work is wrong if it is missing or wrong. vision.md §10.1 step 5 requires a human to confirm a load-bearing item.',
    );
  }
  reasons.push(
    'Only a person decides it: an MCP tool cannot block and ask, so mneia_review_queue lists this queue and writes nothing.',
  );
  return reasons.join(' ');
}

function itemBlock(item: PendingReviewItem, shortIds: ReadonlyMap<Uuid, string>): string {
  const lines = [
    `  ${item.title}  [${shortIds.get(item.id) ?? item.id}] · ${marksFor(item).join(' · ')}`,
    `    ${detailFor(item)}`,
  ];
  if (item.body !== null && item.body.trim().length > 0) {
    lines.push(`    ${truncate(item.body.replace(/\s+/g, ' ').trim(), BODY_PREVIEW_LENGTH)}`);
  }
  return lines.join('\n');
}

export function renderEmptyQueue(config: ProjectConfig): string {
  return [
    `Nothing in ${projectLabel(config)} is waiting for human review.`,
    '',
    'Every item a checkpoint recorded has already been confirmed, edited, or rejected by a person.',
    '',
  ].join('\n');
}

export function renderQueue(queue: PendingQueue, config: ProjectConfig, limit: number): string {
  if (queue.items.length === 0) {
    return renderEmptyQueue(config);
  }

  const shortIds = shortenItemIds(queue.items.map((item) => item.id));
  const loadBearing = queue.items.filter((item) => item.loadBearing).length;

  const header = [
    `${projectLabel(config)} — ${countOf(queue.items.length, 'item')} waiting for human review, ${loadBearing} load-bearing`,
    queue.items.length === limit
      ? `limit ${limit} reached, so there may be more · load-bearing first, then oldest first · times in UTC`
      : `limit ${limit} · load-bearing first, then oldest first · times in UTC`,
  ].join('\n');

  const footer = [
    'Drain them with mneia review --drain — confirm is one keypress, and edit does not make you retype the item.',
    DISPUTE_NOTE,
  ].join('\n');

  return `${[header, ...queue.items.map((item) => itemBlock(item, shortIds)), footer].join('\n\n')}\n`;
}

export function renderQueueJson(
  queue: PendingQueue,
  config: ProjectConfig,
  limit: number,
  now: Date,
): string {
  const payload = {
    project: projectLabel(config),
    projectId: queue.projectId,
    generatedAt: now.toISOString(),
    limit,
    count: queue.items.length,
    limitReached: queue.items.length === limit,
    readOnly: true,
    items: queue.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      confidence: item.confidence,
      loadBearing: item.loadBearing,
      accessScope: item.accessScope,
      humanConfirmed: false,
      assertedBy: {
        id: item.assertedBy,
        displayName: asserterName(item),
        kind: item.assertedByKind,
      },
      assertedAt: item.assertedAt.toISOString(),
      sourceRef: item.sourceRef,
      originCheckpointId: item.originCheckpointId,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function changed(
  item: PendingReviewItem,
  title: string,
  body: string | null,
  loadBearing: boolean,
): readonly string[] {
  const fields: string[] = [];
  if (title !== item.title) {
    fields.push('title');
  }
  if (body !== item.body) {
    fields.push('body');
  }
  if (loadBearing !== item.loadBearing) {
    fields.push('load_bearing');
  }
  return fields;
}

function leftPending(item: PendingReviewItem): DecidedItem {
  return {
    item,
    decision: 'pending',
    title: item.title,
    body: item.body,
    loadBearing: item.loadBearing,
    fieldsChanged: [],
    reason: null,
  };
}

function confirmedAsIs(item: PendingReviewItem): DecidedItem {
  return {
    item,
    decision: 'confirmed',
    title: item.title,
    body: item.body,
    loadBearing: item.loadBearing,
    fieldsChanged: [],
    reason: null,
  };
}

async function editItem(
  item: PendingReviewItem,
  prompter: Prompter,
  io: CommandInvocation['io'],
): Promise<DecidedItem> {
  let title = item.title;
  let body = item.body;
  let loadBearing = item.loadBearing;

  for (;;) {
    const key = await prompter.key('  edit which field?', EDIT_CHOICES);

    if (key === 'd') {
      break;
    }
    if (key === 't') {
      title = (await prompter.edit('  title', title)).trim();
      continue;
    }
    if (key === 'b') {
      const next = (await prompter.edit('  body', body ?? '')).trim();
      body = next.length === 0 ? null : next;
      continue;
    }
    if (key === 'l') {
      loadBearing = !loadBearing;
      io.stdout(`  load-bearing is now ${loadBearing ? 'yes' : 'no'}\n`);
    }
  }

  const fieldsChanged = changed(item, title, body, loadBearing);

  return {
    item,
    decision: fieldsChanged.length === 0 ? 'confirmed' : 'edited',
    title,
    body,
    loadBearing,
    fieldsChanged,
    reason: null,
  };
}

async function rejectItem(
  item: PendingReviewItem,
  prompter: Prompter,
  io: CommandInvocation['io'],
): Promise<DecidedItem> {
  for (;;) {
    const reason = (await prompter.edit('  why does this not hold?', '')).trim();
    if (reason.length > 0) {
      return {
        item,
        decision: 'rejected',
        title: item.title,
        body: item.body,
        loadBearing: item.loadBearing,
        fieldsChanged: [],
        reason,
      };
    }
    io.stdout(
      '  a rejection needs a reason — it is what the record keeps, so say in one line why this does not hold\n',
    );
  }
}

export function renderPrompt(item: PendingReviewItem, position: number, total: number): string {
  const lines = [
    '',
    `(${position}/${total}) ${item.title}`,
    `    ${marksFor(item).join(' · ')}`,
    `    ${detailFor(item)}`,
  ];
  if (item.body !== null && item.body.trim().length > 0) {
    lines.push(`    ${truncate(item.body.replace(/\s+/g, ' ').trim(), BODY_PREVIEW_LENGTH)}`);
  }
  return lines.join('\n');
}

export async function drainQueue(
  items: readonly PendingReviewItem[],
  prompter: Prompter,
  io: CommandInvocation['io'],
): Promise<readonly DecidedItem[]> {
  const decided: DecidedItem[] = [];

  for (const [position, item] of items.entries()) {
    io.stdout(`${renderPrompt(item, position + 1, items.length)}\n`);

    for (;;) {
      const key = await prompter.key('  confirm this item?', REVIEW_CHOICES);

      if (key === '?') {
        io.stdout(`  ${whyAsked(item)}\n`);
        continue;
      }
      if (key === 'y') {
        decided.push(confirmedAsIs(item));
        break;
      }
      if (key === 's') {
        decided.push(leftPending(item));
        break;
      }
      if (key === 'r') {
        decided.push(await rejectItem(item, prompter, io));
        break;
      }
      if (key === 'e') {
        decided.push(await editItem(item, prompter, io));
        break;
      }
    }
  }

  return decided;
}

export const toReview = (entry: DecidedItem): ContextItemReview =>
  entry.decision === 'rejected'
    ? { itemId: entry.item.id, decision: 'reject' }
    : {
        itemId: entry.item.id,
        decision: 'accept',
        title: entry.title,
        body: entry.body,
        loadBearing: entry.loadBearing,
      };

const tally = (decided: readonly DecidedItem[], decision: ReviewDecision): number =>
  decided.filter((entry) => entry.decision === decision).length;

export function reviewSummary(decided: readonly DecidedItem[]): string {
  const submitted = decided.filter((entry) => entry.decision !== 'pending');
  const rejected = decided.filter((entry) => entry.decision === 'rejected');

  const head = `Reviewed ${countOf(submitted.length, 'item')} from the terminal: ${tally(decided, 'confirmed')} confirmed, ${tally(decided, 'edited')} edited, ${rejected.length} rejected.`;

  return [
    head,
    ...rejected.map((entry) => `Rejected "${entry.title}": ${entry.reason ?? 'no reason given'}`),
  ].join(' ');
}

export function renderDrained(
  decided: readonly DecidedItem[],
  receipt: ReviewReceipt,
  config: ProjectConfig,
): string {
  const recorded = (kind: ContextItemReviewOutcome['outcome']): number =>
    receipt.outcomes.filter((outcome) => outcome.outcome === kind).length;

  const parts = [
    `${recorded('confirmed')} confirmed`,
    `${recorded('edited')} edited`,
    `${recorded('rejected')} rejected`,
    `${tally(decided, 'pending')} left pending`,
  ];

  return [
    `Reviewed ${countOf(decided.length, 'item')} waiting in ${projectLabel(config)}.`,
    `  ${parts.join(' · ')}`,
    `Recorded in checkpoint ${receipt.checkpointId}.`,
    'The confirmations, edits, and rejections were written by the API, which emits the §17 events for them, so a terminal reviewer and a web reviewer leave the same record.',
    '',
  ].join('\n');
}

export function renderNothingDecided(decided: readonly DecidedItem[]): string {
  return [
    `Nothing was written: all ${countOf(decided.length, 'item')} were left pending.`,
    'They stay in the queue exactly as they were — run mneia review --drain again when you are ready to decide them.',
    '',
  ].join('\n');
}

const systemClock = (): Date => new Date();

export function createReviewCommand(deps: ReviewDeps): CommandDefinition {
  return {
    name: 'review',
    summary:
      'List the items waiting for a human to confirm, and drain that queue one keypress at a time.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      assertNoPositionals(invocation.args);
      assertNoDecisionFlags(invocation.flags);

      const drain = readDrain(invocation.flags);
      const limit = readLimit(invocation.flags);
      const now = (deps.now ?? systemClock)();

      if (drain && invocation.json) {
        throw usageError(
          '--drain runs an interactive review and --json prints a machine-readable queue, so they cannot be combined; a confirmation has to come from a person at a keypress (vision.md §10.1)',
        );
      }
      if (drain && !deps.prompter.interactive) {
        throw new CliError('usage', OFF_TTY_MESSAGE, OFF_TTY_FIX);
      }

      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);
      const queue = await callApi(config.endpoint, 'review', () =>
        deps.api.pending({ config, limit }),
      );

      if (!drain) {
        invocation.io.stdout(
          invocation.json
            ? renderQueueJson(queue, config, limit, now)
            : renderQueue(queue, config, limit),
        );
        return EXIT_OK;
      }

      if (queue.items.length === 0) {
        invocation.io.stdout(renderEmptyQueue(config));
        return EXIT_OK;
      }

      let decided: readonly DecidedItem[] = [];

      try {
        decided = await drainQueue(queue.items, deps.prompter, invocation.io);
      } catch (cause) {
        if (cause instanceof PromptCancelled) {
          throw new CliError(
            'failed',
            'the review was cancelled before every item was decided, so nothing was written and the queue is unchanged',
            'run mneia review --drain again and decide each item, or press s to leave one pending',
          );
        }
        throw cause;
      } finally {
        await deps.prompter.close();
      }

      const reviews = decided
        .filter((entry) => entry.decision !== 'pending')
        .map((entry) => toReview(entry));

      if (reviews.length === 0) {
        invocation.io.stdout(renderNothingDecided(decided));
        return EXIT_OK;
      }

      const receipt = await callApi(config.endpoint, 'review', () =>
        deps.api.submit({
          config,
          projectId: queue.projectId,
          reviews,
          summary: reviewSummary(decided),
        }),
      );

      invocation.io.stdout(renderDrained(decided, receipt, config));
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

let processPrompter: Prompter | null = null;

async function sharedPrompter(): Promise<Prompter> {
  if (processPrompter === null) {
    const { createPrompter } = await import('../prompt.js');
    processPrompter = createPrompter({ input: process.stdin, output: process.stdout });
  }
  return processPrompter;
}

const lazyPrompter: Prompter = {
  interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  async key(question, choices) {
    return (await sharedPrompter()).key(question, choices);
  },
  async edit(label, current) {
    return (await sharedPrompter()).edit(label, current);
  },
  async close() {
    await processPrompter?.close();
  },
};

export const reviewCommand: CommandDefinition = createReviewCommand({
  api: httpReviewApi,
  loadConfig: defaultLoadConfig,
  prompter: lazyPrompter,
});
