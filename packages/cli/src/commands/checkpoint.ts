import type {
  AccessScope,
  CheckpointAction,
  CheckpointTrigger,
  ItemKind,
  TelemetryEmitter,
  TelemetryEvent,
  TrajectorySource,
  Uuid,
} from '@mneia/core';
import { CHECKPOINT_TRIGGERS, createNoopEmitter, TRAJECTORY_SOURCES } from '@mneia/core';
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
  /** Turns the server actually extracted. Zero means nothing new was read at all. */
  readonly consumedTurns: number;
  readonly pendingTurns: number;
  readonly incompleteReason: string | null;
  readonly droppedBeforeUpload: number;
}

export interface ProposeRequest {
  readonly config: ProjectConfig;
  readonly trigger: CheckpointTrigger;
  readonly cwd?: string | undefined;
  readonly fromFile?: string | undefined;
  readonly sessionRef?: string | undefined;
  readonly source?: TrajectorySource | undefined;
}

export interface DiscoverRequest {
  readonly config: ProjectConfig;
  readonly cwd: string;
  readonly source?: TrajectorySource | undefined;
}

export interface DiscoveredSession {
  readonly source: TrajectorySource;
  readonly sessionRef: string;
  readonly lastActivityAt: Date | null;
}

export interface SessionDiscovery {
  readonly sessions: readonly DiscoveredSession[];
  readonly blocked: readonly string[];
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
  readonly discover: (request: DiscoverRequest) => Promise<SessionDiscovery>;
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

const USAGE =
  'mneia checkpoint [-m "<summary>"] [--trigger <trigger>] [--session <ref> [--source <harness>] | --all-sessions] [--json]';

export const MAX_CHECKPOINT_SESSIONS = 20;

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

export function readSessionRef(flags: CommandInvocation['flags']): string | null {
  const raw = flags.session;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw usageError(
      '--session needs the ref of one discovered agent session; run mneia checkpoint with no flags to see how many were found, or mneia sessions for the ones already recorded',
    );
  }
  return raw.trim();
}

export function readSource(flags: CommandInvocation['flags']): TrajectorySource | null {
  const raw = flags.source;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw usageError(`--source needs one of: ${TRAJECTORY_SOURCES.join(', ')}`);
  }
  const source = raw.trim();
  if (!(TRAJECTORY_SOURCES as readonly string[]).includes(source)) {
    throw usageError(
      `--source ${source} is not a harness Mneia can read; pass one of: ${TRAJECTORY_SOURCES.join(', ')}`,
    );
  }
  return source as TrajectorySource;
}

export function readAllSessions(flags: CommandInvocation['flags']): boolean {
  const raw = flags['all-sessions'];
  if (raw === undefined || raw === false || raw === 'false') {
    return false;
  }
  if (raw === true || raw === 'true') {
    return true;
  }
  throw usageError(
    `--all-sessions takes no value; it checkpoints every agent session discovered for this directory, and got ${raw}`,
  );
}

function noSessionsError(cwd: string, discovery: SessionDiscovery): CliError {
  const blocked = discovery.blocked.length === 0 ? '' : ` (${discovery.blocked.join('; ')})`;
  return new CliError(
    'not_configured',
    `mneia checkpoint found no agent session for ${cwd}${blocked}`,
    'run this from the directory your agent session is working in, or pass a transcript with --from-file',
  );
}

const sessionLabel = (session: DiscoveredSession): string =>
  `${session.source} ${session.sessionRef}`;

export function matchSessions(
  sessions: readonly DiscoveredSession[],
  reference: string,
): readonly DiscoveredSession[] {
  const wanted = reference.toLowerCase();
  const exact = sessions.filter((session) => session.sessionRef.toLowerCase() === wanted);
  if (exact.length > 0) {
    return exact;
  }
  return sessions.filter((session) => session.sessionRef.toLowerCase().includes(wanted));
}

export function selectSessions(
  discovery: SessionDiscovery,
  reference: string | null,
  cwd: string,
): readonly DiscoveredSession[] {
  if (discovery.sessions.length === 0) {
    throw noSessionsError(cwd, discovery);
  }

  if (reference !== null) {
    const matches = matchSessions(discovery.sessions, reference);
    const matched = matches[0];
    if (matches.length === 0 || matched === undefined) {
      throw new CliError(
        'usage',
        `--session ${reference} matches none of the ${discovery.sessions.length} sessions discovered for ${cwd}: ${discovery.sessions.map(sessionLabel).join(', ')}`,
        'pass one of those refs, or run mneia checkpoint --all-sessions to checkpoint every one of them',
      );
    }
    if (matches.length > 1) {
      throw new CliError(
        'usage',
        `--session ${reference} matches ${matches.length} discovered sessions: ${matches.map(sessionLabel).join(', ')}`,
        'pass more of the ref so it names one session, or run mneia checkpoint --all-sessions',
      );
    }
    return [matched];
  }

  return discovery.sessions.slice(0, MAX_CHECKPOINT_SESSIONS);
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
  session: {
    readonly pendingTurns: number;
    readonly incompleteReason: string | null;
    readonly droppedBeforeUpload: number;
  } = { pendingTurns: 0, incompleteReason: null, droppedBeforeUpload: 0 },
  discovery: SessionSelection | null = null,
): string {
  const payload = {
    project: `${config.workspace}/${config.project}`,
    checkpointId: outcome?.checkpointId ?? null,
    interactive: false,
    session:
      discovery === null
        ? null
        : {
            source: discovery.chosen.source,
            sessionRef: discovery.chosen.sessionRef,
            discovered: discovery.discovered,
            unread: discovery.discovered - 1,
          },
    automaticCount: automatic.length,
    pendingCount: pending.length,
    pendingTurns: session.pendingTurns,
    droppedBeforeUpload: session.droppedBeforeUpload,
    complete: session.pendingTurns === 0 && session.droppedBeforeUpload === 0,
    incompleteReason: session.incompleteReason,
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

export interface SessionSelection {
  readonly chosen: DiscoveredSession;
  readonly discovered: number;
}

export interface SessionRun {
  readonly session: DiscoveredSession;
  readonly proposal: CheckpointProposal | null;
  readonly outcome: CheckpointOutcome | null;
  readonly automatic: readonly CheckpointCandidate[];
  readonly pending: readonly CheckpointCandidate[];
  readonly error: string | null;
}

interface SessionRunContext {
  readonly config: ProjectConfig;
  readonly trigger: CheckpointTrigger;
  readonly summary: string | null;
  readonly session: DiscoveredSession;
  readonly prefix: string;
}

function reportTurnGaps(
  invocation: CommandInvocation,
  proposal: CheckpointProposal,
  prefix: string,
): void {
  if (invocation.json) {
    return;
  }
  if (proposal.pendingTurns > 0) {
    invocation.io.stderr(
      `${prefix}${proposal.pendingTurns} turn${proposal.pendingTurns === 1 ? '' : 's'} were not read this time, so run mneia checkpoint again to cover them — nothing was skipped${proposal.incompleteReason === null ? '' : `: ${proposal.incompleteReason}`}\n`,
    );
  }
  if (proposal.droppedBeforeUpload > 0) {
    invocation.io.stderr(
      `${prefix}expected 0 turns to be dropped before upload; ${proposal.droppedBeforeUpload} were. The whole transcript is meant to be sent and chunked by the server, so this is a defect in mneia rather than a limit you reached — please report it.\n`,
    );
  }
}

async function runSession(
  deps: CheckpointDeps,
  invocation: CommandInvocation,
  context: SessionRunContext,
): Promise<SessionRun> {
  const { config, trigger, summary, session, prefix } = context;
  const now = deps.now ?? systemClock;
  const telemetry = deps.telemetry ?? createNoopEmitter();

  const proposal = await callApi(config.endpoint, 'checkpoint', () =>
    deps.api.propose({
      config,
      trigger,
      cwd: invocation.io.cwd,
      sessionRef: session.sessionRef,
      source: session.source,
    }),
  );

  reportTurnGaps(invocation, proposal, prefix);

  if (proposal.candidates.length === 0) {
    // Extraction that read turns and kept nothing still has to bank how far it got.
    // Returning here without committing left the watermark where it was, so the next run
    // re-uploaded and re-extracted the same turns and paid for them again — and a session
    // too large for one request never advanced past its first upload (MNE-100). Guarded on
    // consumedTurns so the far commoner "nothing new to read" case, which reaches the
    // model not at all, does not write a fresh empty checkpoint on every invocation.
    if (proposal.watermark !== null && proposal.consumedTurns > 0) {
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
          automatic: [],
          reviewed: [],
        }),
      );
    }
    return { session, proposal, outcome: null, automatic: [], pending: [], error: null };
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
    return { session, proposal, outcome: null, automatic, pending: review, error: null };
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

  await emitReviewEvents(telemetry, { proposal, receipt, reviewed, occurredAt: now() });

  return {
    session,
    proposal,
    outcome: summarize(receipt, automatic, reviewed),
    automatic,
    pending: [],
    error: null,
  };
}

const lastActivityOf = (session: DiscoveredSession): string =>
  session.lastActivityAt === null
    ? 'last activity unknown'
    : `last active ${session.lastActivityAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`;

function sessionRunLine(run: SessionRun): string {
  if (run.error !== null) {
    return `    failed: ${run.error}`;
  }
  if (run.outcome !== null) {
    return `    checkpoint ${run.outcome.checkpointId} — ${run.outcome.automatic} recorded without asking · ${run.outcome.confirmed} confirmed · ${run.outcome.edited} edited · ${run.outcome.rejected} rejected`;
  }
  if (run.pending.length > 0) {
    return `    ${countOf(run.pending.length, 'candidate')} need a human and this is not an interactive terminal · ${countOf(run.automatic.length, 'item')} recorded without asking`;
  }
  return '    nothing to checkpoint — no candidates were proposed';
}

function renderAllSessions(
  runs: readonly SessionRun[],
  config: ProjectConfig,
  discovery: SessionDiscovery,
): string {
  const recorded = runs.filter((run) => run.outcome !== null).length;
  const failed = runs.filter((run) => run.error !== null).length;
  const pending = runs.filter((run) => run.error === null && run.pending.length > 0).length;

  const header = [
    `${config.workspace}/${config.project} — checkpointed ${countOf(runs.length, 'agent session')} discovered for this directory`,
    discovery.sessions.length > runs.length
      ? `${discovery.sessions.length} discovered · capped at ${MAX_CHECKPOINT_SESSIONS} per run · times in UTC`
      : 'times in UTC',
  ].join('\n');

  const blocks = runs.map((run) =>
    [`  ${sessionLabel(run.session)} · ${lastActivityOf(run.session)}`, sessionRunLine(run)].join(
      '\n',
    ),
  );

  const tally = [
    `${recorded} of ${runs.length} ${runs.length === 1 ? 'session' : 'sessions'} recorded a checkpoint`,
    `${pending} left waiting on a human`,
    `${failed} failed`,
  ].join(' · ');

  const footer = [
    tally,
    'Each session resumes from its own watermark, so re-running mneia checkpoint covers whatever is left.',
  ].join('\n');

  return `${[header, ...blocks, footer].join('\n\n')}\n`;
}

function renderAllSessionsJson(
  runs: readonly SessionRun[],
  config: ProjectConfig,
  discovery: SessionDiscovery,
): string {
  const payload = {
    project: `${config.workspace}/${config.project}`,
    discovered: discovery.sessions.length,
    processed: runs.length,
    cappedAt: MAX_CHECKPOINT_SESSIONS,
    blocked: discovery.blocked,
    sessions: runs.map((run) => ({
      source: run.session.source,
      sessionRef: run.session.sessionRef,
      lastActivityAt: run.session.lastActivityAt?.toISOString() ?? null,
      checkpointId: run.outcome?.checkpointId ?? null,
      automaticCount: run.automatic.length,
      pendingCount: run.pending.length,
      pendingTurns: run.proposal?.pendingTurns ?? 0,
      droppedBeforeUpload: run.proposal?.droppedBeforeUpload ?? 0,
      incompleteReason: run.proposal?.incompleteReason ?? null,
      error: run.error,
      pending: run.pending.map((candidate) => ({
        index: candidate.index,
        kind: candidate.kind,
        title: candidate.title,
        loadBearing: candidate.loadBearing,
        supersedesId: candidate.supersedes?.id ?? null,
        reason: whyAsked(candidate),
      })),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

const failureMessage = (error: unknown): string =>
  error instanceof CliError
    ? `${error.message} — ${error.fix}`
    : error instanceof Error
      ? error.message
      : String(error);

async function runEverySession(
  deps: CheckpointDeps,
  invocation: CommandInvocation,
  context: Omit<SessionRunContext, 'session' | 'prefix'>,
  discovery: SessionDiscovery,
  chosen: readonly DiscoveredSession[],
): Promise<number> {
  const runs: SessionRun[] = [];

  for (const session of chosen) {
    try {
      runs.push(
        await runSession(deps, invocation, {
          ...context,
          session,
          prefix: `${sessionLabel(session)}: `,
        }),
      );
    } catch (cause) {
      runs.push({
        session,
        proposal: null,
        outcome: null,
        automatic: [],
        pending: [],
        error: failureMessage(cause),
      });
    }
  }

  invocation.io.stdout(
    invocation.json
      ? renderAllSessionsJson(runs, context.config, discovery)
      : renderAllSessions(runs, context.config, discovery),
  );

  const unfinished = runs.filter((run) => run.error !== null || run.pending.length > 0);
  return unfinished.length === 0 ? EXIT_OK : EXIT_FAILED;
}

function renderOneSession(
  run: SessionRun,
  invocation: CommandInvocation,
  config: ProjectConfig,
  selection: SessionSelection,
): number {
  const proposal = run.proposal;

  if (proposal === null || proposal.candidates.length === 0) {
    invocation.io.stdout(
      invocation.json
        ? renderJson(null, [], [], config, proposal ?? undefined, selection)
        : renderNothingToDo(config),
    );
    return EXIT_OK;
  }

  if (run.pending.length > 0) {
    invocation.io.stdout(
      invocation.json
        ? renderJson(null, run.pending, run.automatic, config, proposal, selection)
        : renderPendingWithoutTty(run.pending, run.automatic),
    );
    return EXIT_FAILED;
  }

  const outcome = run.outcome;
  invocation.io.stdout(
    invocation.json
      ? renderJson(outcome, [], run.automatic, config, proposal, selection)
      : outcome === null
        ? renderNothingToDo(config)
        : renderOutcome(outcome, config),
  );
  return EXIT_OK;
}

export function createCheckpointCommand(deps: CheckpointDeps): CommandDefinition {
  return {
    name: 'checkpoint',
    summary: 'Record what this session decided, confirming only what needs a human.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      assertNoPositionals(invocation.args);

      const summary = readSummary(invocation.flags);
      const trigger = readTrigger(invocation.flags);
      const sessionRef = readSessionRef(invocation.flags);
      const allSessions = readAllSessions(invocation.flags);
      const source = readSource(invocation.flags);

      if (sessionRef !== null && allSessions) {
        throw usageError(
          '--session names one session and --all-sessions means every one of them, so they cannot be combined; pass exactly one',
        );
      }

      if (source !== null && sessionRef === null) {
        throw usageError(
          '--source narrows the search to one harness and only means something alongside --session; pass --session <ref> with it, or drop it',
        );
      }

      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);

      const named =
        source !== null && sessionRef !== null
          ? ({ source, sessionRef, lastActivityAt: null } satisfies DiscoveredSession)
          : null;

      const discovery: SessionDiscovery =
        named === null
          ? await callApi(config.endpoint, 'checkpoint', () =>
              deps.api.discover({ config, cwd: invocation.io.cwd }),
            )
          : { sessions: [named], blocked: [] };

      const chosen =
        named === null ? selectSessions(discovery, sessionRef, invocation.io.cwd) : [named];
      const context = { config, trigger, summary };
      const canPrompt = deps.prompter.interactive && !invocation.json;

      try {
        if (chosen.length > 1) {
          return await runEverySession(deps, invocation, context, discovery, chosen);
        }

        const only = chosen[0];
        if (only === undefined) {
          throw noSessionsError(invocation.io.cwd, discovery);
        }

        const selection: SessionSelection = {
          chosen: only,
          discovered: discovery.sessions.length,
        };

        const run = await runSession(deps, invocation, { ...context, session: only, prefix: '' });
        return renderOneSession(run, invocation, config, selection);
      } finally {
        if (canPrompt) {
          await deps.prompter.close();
        }
      }
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

export const checkpointCommand: CommandDefinition = createCheckpointCommand({
  api: httpCheckpointApi,
  loadConfig: defaultLoadConfig,
  prompter: lazyPrompter,
});
