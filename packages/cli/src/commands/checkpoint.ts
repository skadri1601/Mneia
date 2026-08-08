import type {
  AccessScope,
  CheckpointAction,
  CheckpointTrigger,
  ItemKind,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';
import { CHECKPOINT_TRIGGERS, createNoopEmitter } from '@mneia/core';
import { callApi } from '../api.js';
import {
  CliError,
  type CommandDefinition,
  type CommandInvocation,
  EXIT_FAILED,
  EXIT_OK,
} from '../command.js';
import { httpCheckpointApi } from '../http-api.js';
import type { PromptChoice, Prompter } from '../prompt.js';
import { PromptCancelled } from '../prompt.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';

export interface SupersedeTarget {
  readonly id: Uuid;
  readonly title: string;
  readonly humanConfirmed: boolean;
  readonly loadBearing: boolean;
}

export interface CheckpointCandidate {
  readonly index: number;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body: string | null;
  readonly confidence: number;
  readonly loadBearing: boolean;
  readonly accessScope: AccessScope;
  readonly supersedes: SupersedeTarget | null;
}

export interface CheckpointProposal {
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly actorId: Uuid;
  readonly sessionId: Uuid | null;
  readonly source: string;
  readonly sourceSessionRef: string;
  readonly watermark: string | null;
  readonly candidates: readonly CheckpointCandidate[];
}

export interface ProposeRequest {
  readonly config: ProjectConfig;
  readonly trigger: CheckpointTrigger;
  readonly cwd?: string | undefined;
  readonly fromFile?: string | undefined;
}

export type ReviewDecision = 'confirmed' | 'edited' | 'rejected';

export interface ReviewedCandidate {
  readonly candidate: CheckpointCandidate;
  readonly decision: ReviewDecision;
  readonly title: string;
  readonly body: string | null;
  readonly loadBearing: boolean;
  readonly fieldsChanged: readonly string[];
}

export interface CommitRequest {
  readonly config: ProjectConfig;
  readonly projectId: Uuid;
  readonly sessionId: Uuid | null;
  readonly source?: string | undefined;
  readonly sourceSessionRef?: string | undefined;
  readonly watermark?: string | null | undefined;
  readonly trigger: CheckpointTrigger;
  readonly summary: string | null;
  readonly automatic: readonly CheckpointCandidate[];
  readonly reviewed: readonly ReviewedCandidate[];
}

export interface CommittedItem {
  readonly index: number;
  readonly itemId: Uuid;
  readonly action: CheckpointAction;
}

export interface CheckpointReceipt {
  readonly checkpointId: Uuid;
  readonly items: readonly CommittedItem[];
}

export interface CheckpointApi {
  readonly propose: (request: ProposeRequest) => Promise<CheckpointProposal>;
  readonly commit: (request: CommitRequest) => Promise<CheckpointReceipt>;
}

export interface CheckpointDeps {
  readonly api: CheckpointApi;
  readonly loadConfig: ProjectConfigLoader;
  readonly prompter: Prompter;
  readonly telemetry?: TelemetryEmitter;
  readonly now?: () => Date;
}

const USAGE = 'mneia checkpoint [-m "<summary>"] [--trigger <trigger>] [--json]';

const REVIEW_CHOICES: readonly PromptChoice[] = [
  { key: 'y', label: 'confirm' },
  { key: 'e', label: 'edit' },
  { key: 'r', label: 'reject' },
  { key: '?', label: 'why am I being asked' },
];

const EDIT_CHOICES: readonly PromptChoice[] = [
  { key: 't', label: 'title' },
  { key: 'b', label: 'body' },
  { key: 'l', label: 'toggle load-bearing' },
  { key: 'd', label: 'done' },
];

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function assertNoPositionals(args: readonly string[]): void {
  if (args.length === 0) {
    return;
  }
  throw usageError(`mneia checkpoint takes no positional arguments; got ${args.join(' ')}`);
}

export function readSummary(flags: CommandInvocation['flags']): string | null {
  const raw = flags.message;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string') {
    throw usageError('-m needs a summary of what happened in this session');
  }
  const summary = raw.trim();
  return summary.length === 0 ? null : summary;
}

export function readTrigger(flags: CommandInvocation['flags']): CheckpointTrigger {
  const raw = flags.trigger;
  if (raw === undefined) {
    return 'task_boundary';
  }
  if (typeof raw !== 'string') {
    throw usageError(`--trigger needs one of: ${CHECKPOINT_TRIGGERS.join(', ')}`);
  }
  const trigger = raw.trim();
  const match = CHECKPOINT_TRIGGERS.find((candidate) => candidate === trigger);
  if (match === undefined) {
    throw usageError(`--trigger expects one of ${CHECKPOINT_TRIGGERS.join(', ')}; got ${trigger}`);
  }
  return match;
}

export function needsHuman(candidate: CheckpointCandidate): boolean {
  return candidate.loadBearing || candidate.supersedes !== null;
}

export interface Partitioned {
  readonly automatic: readonly CheckpointCandidate[];
  readonly review: readonly CheckpointCandidate[];
}

export function partitionCandidates(candidates: readonly CheckpointCandidate[]): Partitioned {
  const automatic: CheckpointCandidate[] = [];
  const review: CheckpointCandidate[] = [];

  for (const candidate of candidates) {
    if (needsHuman(candidate)) {
      review.push(candidate);
    } else {
      automatic.push(candidate);
    }
  }

  return { automatic, review };
}

export function whyAsked(candidate: CheckpointCandidate): string {
  const reasons: string[] = [];
  if (candidate.loadBearing) {
    reasons.push(
      'It is load-bearing, so later work is wrong if it is missing or wrong. vision.md §10.1 step 5 requires a human to confirm a load-bearing item before a checkpoint writes it.',
    );
  }
  const supersedes = candidate.supersedes;
  if (supersedes !== null) {
    const confirmed = supersedes.humanConfirmed
      ? ' That item was confirmed by a human, and §10.1 rule 1 says an agent assertion never supersedes a human-confirmed item on its own.'
      : '';
    reasons.push(
      `It contradicts "${supersedes.title}" (${supersedes.id}) and would replace it.${confirmed}`,
    );
  }
  return reasons.join(' ');
}

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

export function renderCandidate(
  candidate: CheckpointCandidate,
  position: number,
  total: number,
): string {
  const marks: string[] = [candidate.kind];
  if (candidate.loadBearing) {
    marks.push('load-bearing');
  }
  if (candidate.supersedes !== null) {
    marks.push(`would replace ${candidate.supersedes.id}`);
  }
  marks.push(`confidence ${candidate.confidence.toFixed(2)}`);
  marks.push(candidate.accessScope);

  const lines = ['', `(${position}/${total}) ${candidate.title}`, `    ${marks.join(' · ')}`];

  if (candidate.body !== null && candidate.body.trim().length > 0) {
    lines.push(`    ${truncate(candidate.body.trim(), 300)}`);
  }

  return lines.join('\n');
}

function changed(
  candidate: CheckpointCandidate,
  title: string,
  body: string | null,
  loadBearing: boolean,
): readonly string[] {
  const fields: string[] = [];
  if (title !== candidate.title) {
    fields.push('title');
  }
  if (body !== candidate.body) {
    fields.push('body');
  }
  if (loadBearing !== candidate.loadBearing) {
    fields.push('loadBearing');
  }
  return fields;
}

async function editCandidate(
  candidate: CheckpointCandidate,
  prompter: Prompter,
  io: CommandInvocation['io'],
): Promise<ReviewedCandidate> {
  let title = candidate.title;
  let body = candidate.body;
  let loadBearing = candidate.loadBearing;

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

  const fieldsChanged = changed(candidate, title, body, loadBearing);

  return {
    candidate,
    decision: fieldsChanged.length === 0 ? 'confirmed' : 'edited',
    title,
    body,
    loadBearing,
    fieldsChanged,
  };
}

function confirmedAsIs(candidate: CheckpointCandidate): ReviewedCandidate {
  return {
    candidate,
    decision: 'confirmed',
    title: candidate.title,
    body: candidate.body,
    loadBearing: candidate.loadBearing,
    fieldsChanged: [],
  };
}

function rejected(candidate: CheckpointCandidate): ReviewedCandidate {
  return {
    candidate,
    decision: 'rejected',
    title: candidate.title,
    body: candidate.body,
    loadBearing: candidate.loadBearing,
    fieldsChanged: [],
  };
}

export async function reviewCandidates(
  candidates: readonly CheckpointCandidate[],
  prompter: Prompter,
  io: CommandInvocation['io'],
): Promise<readonly ReviewedCandidate[]> {
  const reviewed: ReviewedCandidate[] = [];

  for (const [position, candidate] of candidates.entries()) {
    io.stdout(`${renderCandidate(candidate, position + 1, candidates.length)}\n`);

    for (;;) {
      const key = await prompter.key('  confirm this item?', REVIEW_CHOICES);

      if (key === '?') {
        io.stdout(`  ${whyAsked(candidate)}\n`);
        continue;
      }
      if (key === 'y') {
        reviewed.push(confirmedAsIs(candidate));
        break;
      }
      if (key === 'r') {
        reviewed.push(rejected(candidate));
        break;
      }
      if (key === 'e') {
        reviewed.push(await editCandidate(candidate, prompter, io));
        break;
      }
    }
  }

  return reviewed;
}

async function emitQuietly(telemetry: TelemetryEmitter, event: TelemetryEvent): Promise<void> {
  try {
    await telemetry.emit(event);
  } catch {
    return;
  }
}

export interface EmitPlan {
  readonly proposal: CheckpointProposal;
  readonly receipt: CheckpointReceipt;
  readonly reviewed: readonly ReviewedCandidate[];
  readonly occurredAt: Date;
}

export async function emitReviewEvents(
  telemetry: TelemetryEmitter,
  plan: EmitPlan,
): Promise<number> {
  const { proposal, receipt, reviewed, occurredAt } = plan;
  const itemByIndex = new Map(receipt.items.map((item) => [item.index, item.itemId]));

  const base = {
    workspaceId: proposal.workspaceId,
    projectId: proposal.projectId,
    actorId: proposal.actorId,
    sessionId: proposal.sessionId,
    occurredAt,
  };

  let emitted = 0;

  for (const entry of reviewed) {
    const itemId = itemByIndex.get(entry.candidate.index);
    if (itemId === undefined) {
      continue;
    }

    if (entry.decision === 'edited') {
      await emitQuietly(telemetry, {
        ...base,
        name: 'checkpoint.item_edited',
        checkpointId: receipt.checkpointId,
        itemId,
        fieldsChanged: entry.fieldsChanged,
      });
    } else if (entry.decision === 'rejected') {
      await emitQuietly(telemetry, {
        ...base,
        name: 'checkpoint.item_rejected',
        checkpointId: receipt.checkpointId,
        itemId,
      });
    } else {
      await emitQuietly(telemetry, {
        ...base,
        name: 'checkpoint.item_confirmed',
        checkpointId: receipt.checkpointId,
        itemId,
      });
    }

    emitted += 1;
  }

  return emitted;
}

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

export interface CheckpointOutcome {
  readonly checkpointId: Uuid;
  readonly automatic: number;
  readonly confirmed: number;
  readonly edited: number;
  readonly rejected: number;
}

export function summarize(
  receipt: CheckpointReceipt,
  automatic: readonly CheckpointCandidate[],
  reviewed: readonly ReviewedCandidate[],
): CheckpointOutcome {
  return {
    checkpointId: receipt.checkpointId,
    automatic: automatic.length,
    confirmed: reviewed.filter((entry) => entry.decision === 'confirmed').length,
    edited: reviewed.filter((entry) => entry.decision === 'edited').length,
    rejected: reviewed.filter((entry) => entry.decision === 'rejected').length,
  };
}

function renderOutcome(outcome: CheckpointOutcome, config: ProjectConfig): string {
  const parts = [
    `${countOf(outcome.automatic, 'item')} recorded without asking`,
    `${outcome.confirmed} confirmed`,
    `${outcome.edited} edited`,
    `${outcome.rejected} rejected`,
  ];
  return [
    `Checkpoint ${outcome.checkpointId} recorded for ${config.workspace}/${config.project}.`,
    `  ${parts.join(' · ')}`,
    '',
  ].join('\n');
}

function renderNothingToDo(config: ProjectConfig): string {
  return [
    `Nothing to checkpoint for ${config.workspace}/${config.project} — no candidates were proposed.`,
    '',
  ].join('\n');
}

function renderPendingWithoutTty(
  pending: readonly CheckpointCandidate[],
  automatic: readonly CheckpointCandidate[],
): string {
  const blocks = [
    `${countOf(pending.length, 'candidate')} need a human and this is not an interactive terminal, so nothing was confirmed for them.`,
    [
      'PENDING HUMAN CONFIRMATION — not recorded:',
      ...pending.map(
        (candidate) => `  [${candidate.kind}] "${candidate.title}"\n    ${whyAsked(candidate)}`,
      ),
    ].join('\n'),
    automatic.length === 0
      ? 'Nothing was written.'
      : `${countOf(automatic.length, 'item')} needed no human and ${automatic.length === 1 ? 'was' : 'were'} recorded.`,
    'Run mneia checkpoint in a terminal to decide these, or surface them through the mneia_checkpoint MCP tool.',
  ];
  return `${blocks.join('\n\n')}\n`;
}

function renderJson(
  outcome: CheckpointOutcome | null,
  pending: readonly CheckpointCandidate[],
  automatic: readonly CheckpointCandidate[],
  config: ProjectConfig,
): string {
  const payload = {
    project: `${config.workspace}/${config.project}`,
    checkpointId: outcome?.checkpointId ?? null,
    interactive: false,
    automaticCount: automatic.length,
    pendingCount: pending.length,
    pending: pending.map((candidate) => ({
      index: candidate.index,
      kind: candidate.kind,
      title: candidate.title,
      loadBearing: candidate.loadBearing,
      supersedesId: candidate.supersedes?.id ?? null,
      reason: whyAsked(candidate),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

const systemClock = (): Date => new Date();

export function createCheckpointCommand(deps: CheckpointDeps): CommandDefinition {
  return {
    name: 'checkpoint',
    summary: 'Record what this session decided, confirming only what needs a human.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      assertNoPositionals(invocation.args);

      const summary = readSummary(invocation.flags);
      const trigger = readTrigger(invocation.flags);
      const now = deps.now ?? systemClock;
      const telemetry = deps.telemetry ?? createNoopEmitter();
      const config = await deps.loadConfig(invocation.io.cwd);

      const proposal = await callApi(config.endpoint, 'checkpoint', () =>
        deps.api.propose({ config, trigger }),
      );

      if (proposal.candidates.length === 0) {
        invocation.io.stdout(
          invocation.json ? renderJson(null, [], [], config) : renderNothingToDo(config),
        );
        return EXIT_OK;
      }

      const { automatic, review } = partitionCandidates(proposal.candidates);
      const canPrompt = deps.prompter.interactive && !invocation.json;

      if (!canPrompt && review.length > 0) {
        if (automatic.length > 0) {
          await callApi(config.endpoint, 'checkpoint', () =>
            deps.api.commit({
              config,
              projectId: proposal.projectId,
              sessionId: proposal.sessionId,
              source: proposal.source,
              sourceSessionRef: proposal.sourceSessionRef,
              watermark: proposal.watermark,
              trigger,
              summary,
              automatic,
              reviewed: [],
            }),
          );
        }
        invocation.io.stdout(
          invocation.json
            ? renderJson(null, review, automatic, config)
            : renderPendingWithoutTty(review, automatic),
        );
        return EXIT_FAILED;
      }

      let reviewed: readonly ReviewedCandidate[] = [];

      try {
        reviewed = await reviewCandidates(review, deps.prompter, invocation.io);
      } catch (cause) {
        if (cause instanceof PromptCancelled) {
          throw new CliError(
            'failed',
            'the review was cancelled, so nothing was recorded for any candidate',
            'run mneia checkpoint again and decide every item, or use --json to see what is pending',
          );
        }
        throw cause;
      } finally {
        await deps.prompter.close();
      }

      const receipt = await callApi(config.endpoint, 'checkpoint', () =>
        deps.api.commit({
          config,
          projectId: proposal.projectId,
          sessionId: proposal.sessionId,
          source: proposal.source,
          sourceSessionRef: proposal.sourceSessionRef,
          watermark: proposal.watermark,
          trigger,
          summary,
          automatic,
          reviewed,
        }),
      );

      await emitReviewEvents(telemetry, {
        proposal,
        receipt,
        reviewed,
        occurredAt: now(),
      });

      const outcome = summarize(receipt, automatic, reviewed);

      invocation.io.stdout(
        invocation.json
          ? renderJson(outcome, [], automatic, config)
          : renderOutcome(outcome, config),
      );

      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd);
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

export const checkpointCommand: CommandDefinition = createCheckpointCommand({
  api: httpCheckpointApi,
  loadConfig: defaultLoadConfig,
  prompter: lazyPrompter,
});
