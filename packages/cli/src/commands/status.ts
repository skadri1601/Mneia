import type { ActorKind, ContextItem, IntervalMs, ItemKind, ItemStatus, Uuid } from '@mneia/core';
import { shortenItemIds } from '@mneia/core';
import { callApi } from '../api.js';
import { confirmationMark, describeAsserter } from '../attribution.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpStatusApi } from '../http-api.js';
import {
  type BindingDial,
  bindingDial,
  isOverAllowance,
  USAGE_WARN_PERCENT,
  type UsageDial,
  type UsageDialName,
  type UsageSnapshot,
  usageWarns,
} from '../usage.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';

export interface StatusRequest {
  readonly config: ProjectConfig;
}

export interface StatusReport {
  readonly projectId: Uuid;
  readonly items: readonly ContextItem[];
}

export interface StatusApi {
  readonly status: (request: StatusRequest) => Promise<StatusReport>;
  /**
   * Optional because a surface can know how to list context items without knowing how to meter
   * a workspace. Resolving to null means the server serves no usage route - a deployment older
   * than the meter, which is not worth reporting as a failure.
   */
  readonly usage?: (request: StatusRequest) => Promise<UsageSnapshot | null>;
}

export interface StatusDeps {
  readonly api: StatusApi;
  readonly loadConfig: ProjectConfigLoader;
  readonly now?: () => Date;
}

export interface DecayWindow {
  readonly verifiedAt: Date;
  readonly decayAfter: IntervalMs;
  readonly staleAt: Date;
}

export interface StaleItem {
  readonly item: ContextItem;
  readonly window: DecayWindow;
  readonly overdueMs: number;
}

export interface DisputedItem {
  readonly item: ContextItem;
  readonly ageMs: number;
}

export interface UnansweredItem {
  readonly item: ContextItem;
  readonly ageMs: number;
}

/**
 * The meter is decoration on a report that stands without it, so every way of not having it is
 * a value rather than a thrown error. `unsupported` renders nothing at all; `unavailable` says
 * what failed, because a customer who cannot see their usage should know why.
 */
export type UsageOutcome =
  | { readonly kind: 'ready'; readonly usage: UsageSnapshot }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly fix: string };

export interface StatusSections {
  readonly stale: readonly StaleItem[];
  readonly disputed: readonly DisputedItem[];
  readonly unanswered: readonly UnansweredItem[];
  readonly reviewed: number;
}

const USAGE = 'mneia status [--json]';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function assertNoPositionals(args: readonly string[]): void {
  if (args.length === 0) {
    return;
  }
  throw usageError(`mneia status takes no positional arguments; got ${args.join(' ')}`);
}

export function decayWindow(item: ContextItem): DecayWindow | null {
  const decayAfter = item.decayAfter;
  if (decayAfter === null || !Number.isFinite(decayAfter) || decayAfter < 0) {
    return null;
  }

  const verifiedAt = item.lastVerifiedAt ?? item.assertedAt;
  const staleAt = new Date(verifiedAt.getTime() + decayAfter);
  if (Number.isNaN(staleAt.getTime())) {
    return null;
  }

  return { verifiedAt, decayAfter, staleAt };
}

function staleItemOf(item: ContextItem, now: Date): StaleItem | null {
  if (item.status !== 'active') {
    return null;
  }
  const window = decayWindow(item);
  if (window === null) {
    return null;
  }
  const overdueMs = now.getTime() - window.staleAt.getTime();
  if (overdueMs < 0) {
    return null;
  }
  return { item, window, overdueMs };
}

function sortDisputed(items: readonly DisputedItem[]): readonly DisputedItem[] {
  return [...items].sort((left, right) => {
    if (left.item.loadBearing !== right.item.loadBearing) {
      return left.item.loadBearing ? -1 : 1;
    }
    const delta = right.ageMs - left.ageMs;
    return delta !== 0 ? delta : left.item.id.localeCompare(right.item.id);
  });
}

function sortStale(items: readonly StaleItem[]): readonly StaleItem[] {
  return [...items].sort((left, right) => {
    if (left.item.loadBearing !== right.item.loadBearing) {
      return left.item.loadBearing ? -1 : 1;
    }
    const delta = right.overdueMs - left.overdueMs;
    return delta !== 0 ? delta : left.item.id.localeCompare(right.item.id);
  });
}

const ageSince = (item: ContextItem, now: Date): number =>
  Math.max(0, now.getTime() - item.assertedAt.getTime());

export function classifyStatus(items: readonly ContextItem[], now: Date): StatusSections {
  const stale: StaleItem[] = [];
  const disputed: DisputedItem[] = [];
  const unanswered: UnansweredItem[] = [];

  for (const item of items) {
    const staleItem = staleItemOf(item, now);
    if (staleItem !== null) {
      stale.push(staleItem);
    }
    if (item.status === 'disputed') {
      disputed.push({ item, ageMs: ageSince(item, now) });
    }
    if (item.kind === 'open_question' && item.status === 'active') {
      unanswered.push({ item, ageMs: ageSince(item, now) });
    }
  }

  return {
    stale: sortStale(stale),
    disputed: sortDisputed(disputed),
    unanswered: [...unanswered].sort(
      (left, right) => right.ageMs - left.ageMs || left.item.id.localeCompare(right.item.id),
    ),
    reviewed: items.length,
  };
}

const isClean = (sections: StatusSections): boolean =>
  sections.stale.length === 0 && sections.disputed.length === 0 && sections.unanswered.length === 0;

const projectLabel = (config: ProjectConfig): string => `${config.workspace}/${config.project}`;

const utcDate = (at: Date): string => at.toISOString().slice(0, 10);

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

function describeDuration(ms: number): string {
  const elapsed = Math.max(0, Math.round(ms));
  const days = Math.floor(elapsed / MS_PER_DAY);
  if (days >= 1) {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const hours = Math.floor(elapsed / MS_PER_HOUR);
  if (hours >= 1) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const minutes = Math.floor(elapsed / MS_PER_MINUTE);
  if (minutes >= 1) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  return 'less than a minute';
}

// The label column matches `mneia whoami` - two spaces, a nine-wide label, two spaces - so a
// labelled row looks the same wherever this CLI prints one.
const USAGE_LABEL_WIDTH = 9;

const usageMeterRow = (value: string): string => `  ${'Usage'.padEnd(USAGE_LABEL_WIDTH)}  ${value}`;

const usageMeterNote = (text: string): string => `  ${' '.repeat(USAGE_LABEL_WIDTH)}  ${text}`;

const dialCount = (binding: BindingDial): string =>
  binding.dial.allowance === null
    ? `${binding.dial.used} ${binding.name}`
    : `${binding.dial.used} of ${binding.dial.allowance} ${binding.name}`;

function allowanceSegment(usage: UsageSnapshot): string {
  const binding = bindingDial(usage);

  // percentUsed is clamped to 100 by the server, so being genuinely over has to be said in
  // words - "100% of this month's allowance" reads as sitting exactly on it.
  if (isOverAllowance(usage)) {
    return binding === null
      ? "over this month's allowance"
      : `over this month's allowance (${dialCount(binding)})`;
  }
  if (usage.percentUsed === null) {
    return `no allowance cap on the ${usage.plan} plan`;
  }

  const which = usageWarns(usage) && binding !== null ? ` (${binding.name})` : '';
  return `${usage.percentUsed}% of this month's allowance${which}`;
}

const checkpointSegment = (usage: UsageSnapshot): string =>
  usage.checkpoints === 0 ? 'no checkpoints yet' : countOf(usage.checkpoints, 'checkpoint');

function usageMeterLines(outcome: UsageOutcome): readonly string[] {
  if (outcome.kind === 'unsupported') {
    return [];
  }
  if (outcome.kind === 'unavailable') {
    return [usageMeterRow(`unavailable - ${outcome.reason}`), usageMeterNote(outcome.fix)];
  }

  const usage = outcome.usage;
  const detail = [
    allowanceSegment(usage),
    checkpointSegment(usage),
    `resets ${utcDate(new Date(usage.periodEnd))}`,
  ].join(' · ');

  // The warning is a word, not a colour: this output is read through pipes, CI logs, and
  // terminals that render no colour at all, and every other explanation here is already text.
  return [usageMeterRow(usageWarns(usage) ? `warning: ${detail}` : detail)];
}

function titleLine(item: ContextItem, shortIds: ReadonlyMap<Uuid, string>): string {
  const marks: string[] = [item.kind];
  if (item.loadBearing) {
    marks.push('load-bearing');
  }
  marks.push(confirmationMark(item.humanConfirmed));
  return `  ${item.title}  [${shortIds.get(item.id) ?? item.id}] · ${marks.join(' · ')}`;
}

function staleBlock(stale: StaleItem, shortIds: ReadonlyMap<Uuid, string>): string {
  const verified =
    stale.item.lastVerifiedAt === null
      ? `asserted ${utcDate(stale.window.verifiedAt)}, never re-verified`
      : `last verified ${utcDate(stale.window.verifiedAt)}`;
  const detail = [
    describeAsserter(stale.item),
    verified,
    `decays after ${describeDuration(stale.window.decayAfter)}`,
    `overdue by ${describeDuration(stale.overdueMs)}`,
  ].join(' · ');
  return [titleLine(stale.item, shortIds), `    ${detail}`].join('\n');
}

function disputedBlock(entry: DisputedItem, shortIds: ReadonlyMap<Uuid, string>): string {
  return [
    titleLine(entry.item, shortIds),
    `    ${describeAsserter(entry.item)} · unresolved · ${describeDuration(entry.ageMs)} old · asserted ${utcDate(entry.item.assertedAt)}`,
  ].join('\n');
}

function unansweredBlock(entry: UnansweredItem, shortIds: ReadonlyMap<Uuid, string>): string {
  return [
    titleLine(entry.item, shortIds),
    `    ${describeAsserter(entry.item)} · open ${describeDuration(entry.ageMs)} · asked ${utcDate(entry.item.assertedAt)}`,
  ].join('\n');
}

function section(heading: string, blocks: readonly string[]): readonly string[] {
  return blocks.length === 0 ? [] : [[heading, blocks.join('\n\n')].join('\n')];
}

function headline(config: ProjectConfig, sections: StatusSections): string {
  const counts = [
    `${sections.stale.length} stale`,
    `${sections.disputed.length} disputed`,
    `${sections.unanswered.length} unanswered`,
  ].join(' · ');
  return `${projectLabel(config)} — ${counts} (${countOf(sections.reviewed, 'item')} reviewed)`;
}

function renderClean(
  config: ProjectConfig,
  sections: StatusSections,
  meter: readonly string[],
): string {
  if (sections.reviewed === 0) {
    return [
      `No context recorded for ${projectLabel(config)} yet, so there is nothing to review.`,
      ...meter,
      '',
      'Run mneia checkpoint after your next task to start the record.',
      '',
    ].join('\n');
  }
  return [
    `${projectLabel(config)} is clean — nothing stale, disputed, or unanswered across ${countOf(sections.reviewed, 'item')}.`,
    ...meter,
    '',
  ].join('\n');
}

function renderHuman(
  report: StatusReport,
  config: ProjectConfig,
  now: Date,
  usage: UsageOutcome,
): string {
  const sections = classifyStatus(report.items, now);
  const meter = usageMeterLines(usage);
  if (isClean(sections)) {
    return renderClean(config, sections, meter);
  }

  const shortIds = shortenItemIds(report.items.map((item) => item.id));
  const blocks = [
    [headline(config, sections), ...meter].join('\n'),
    ...section(
      `stale (${sections.stale.length}) — past their decay window; re-verify or supersede`,
      sections.stale.map((stale) => staleBlock(stale, shortIds)),
    ),
    ...section(
      `disputed (${sections.disputed.length}) — conflicting assertions; a human decides`,
      sections.disputed.map((entry) => disputedBlock(entry, shortIds)),
    ),
    ...section(
      `unanswered (${sections.unanswered.length}) — open questions with no answer yet`,
      sections.unanswered.map((entry) => unansweredBlock(entry, shortIds)),
    ),
  ];

  return `${blocks.join('\n\n')}\n`;
}

interface StatusJsonActor {
  readonly id: Uuid;
  readonly displayName: string | null;
  readonly kind: ActorKind | null;
}

interface StatusJsonItem {
  readonly id: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly status: ItemStatus;
  readonly loadBearing: boolean;
  readonly humanConfirmed: boolean;
  readonly assertedAt: string;
  readonly assertedBy: StatusJsonActor;
}

interface StatusJsonStale extends StatusJsonItem {
  readonly lastVerifiedAt: string | null;
  readonly decayAfterMs: IntervalMs;
  readonly staleAt: string;
  readonly overdueMs: number;
}

interface StatusJsonAged extends StatusJsonItem {
  readonly ageMs: number;
}

function toJsonItem(item: ContextItem): StatusJsonItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    status: item.status,
    loadBearing: item.loadBearing,
    humanConfirmed: item.humanConfirmed,
    assertedAt: item.assertedAt.toISOString(),
    assertedBy: {
      id: item.assertedBy,
      displayName: item.provenance?.actorDisplayName ?? null,
      kind: item.provenance?.actorKind ?? null,
    },
  };
}

function toJsonStale(stale: StaleItem): StatusJsonStale {
  return {
    ...toJsonItem(stale.item),
    lastVerifiedAt:
      stale.item.lastVerifiedAt === null ? null : stale.item.lastVerifiedAt.toISOString(),
    decayAfterMs: stale.window.decayAfter,
    staleAt: stale.window.staleAt.toISOString(),
    overdueMs: stale.overdueMs,
  };
}

function toJsonAged(entry: DisputedItem | UnansweredItem): StatusJsonAged {
  return { ...toJsonItem(entry.item), ageMs: entry.ageMs };
}

interface StatusJsonUsageReady {
  readonly state: 'ready';
  readonly plan: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly percentUsed: number | null;
  readonly warn: boolean;
  readonly warnAtPercent: number;
  readonly overAllowance: boolean;
  readonly binding: UsageDialName | null;
  readonly checkpoints: number;
  readonly dials: {
    readonly turns: UsageDial;
    readonly extractions: UsageDial;
  };
}

type StatusJsonUsage =
  | StatusJsonUsageReady
  | { readonly state: 'unsupported' }
  | { readonly state: 'unavailable'; readonly reason: string; readonly fix: string };

/**
 * Carries the dials as the server sent them alongside the percentage, and names the dial the
 * percentage came from, so a script can act on which limit is binding without recomputing the
 * arithmetic - or disagree with this client's rounding if it wants to.
 */
function toJsonUsage(outcome: UsageOutcome): StatusJsonUsage {
  if (outcome.kind === 'unsupported') {
    return { state: 'unsupported' };
  }
  if (outcome.kind === 'unavailable') {
    return { state: 'unavailable', reason: outcome.reason, fix: outcome.fix };
  }

  const usage = outcome.usage;
  const binding = bindingDial(usage);

  return {
    state: 'ready',
    plan: usage.plan,
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
    percentUsed: usage.percentUsed,
    warn: usageWarns(usage),
    warnAtPercent: USAGE_WARN_PERCENT,
    overAllowance: isOverAllowance(usage),
    binding: binding === null ? null : binding.name,
    checkpoints: usage.checkpoints,
    dials: { turns: usage.turns, extractions: usage.extractions },
  };
}

function renderJson(
  report: StatusReport,
  config: ProjectConfig,
  now: Date,
  usage: UsageOutcome,
): string {
  const sections = classifyStatus(report.items, now);
  const payload = {
    project: projectLabel(config),
    projectId: report.projectId,
    generatedAt: now.toISOString(),
    clean: isClean(sections),
    counts: {
      stale: sections.stale.length,
      disputed: sections.disputed.length,
      unanswered: sections.unanswered.length,
      reviewed: sections.reviewed,
    },
    usage: toJsonUsage(usage),
    stale: sections.stale.map(toJsonStale),
    disputed: sections.disputed.map(toJsonAged),
    unanswered: sections.unanswered.map(toJsonAged),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * Never throws. The usage line is the least important thing on this screen, and a status report
 * that dies because the meter could not be read is worse than one with no meter - including in
 * --json, where an exception would replace a parseable payload with an error envelope.
 */
async function readUsage(api: StatusApi, config: ProjectConfig): Promise<UsageOutcome> {
  const read = api.usage;
  if (read === undefined) {
    return { kind: 'unsupported' };
  }

  try {
    const usage = await callApi(config.endpoint, 'status', () => read({ config }));
    return usage === null ? { kind: 'unsupported' } : { kind: 'ready', usage };
  } catch (error) {
    if (error instanceof CliError) {
      return { kind: 'unavailable', reason: error.message, fix: error.fix };
    }
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
      fix: 'run mneia status again; everything else in this report is unaffected',
    };
  }
}

const systemClock = (): Date => new Date();

export function createStatusCommand(deps: StatusDeps): CommandDefinition {
  return {
    name: 'status',
    summary: 'Show what is stale, disputed, or unanswered in this project.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      assertNoPositionals(invocation.args);
      const now = (deps.now ?? systemClock)();
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);
      const report = await callApi(config.endpoint, 'status', () => deps.api.status({ config }));
      const usage = await readUsage(deps.api, config);
      invocation.io.stdout(
        invocation.json
          ? renderJson(report, config, now, usage)
          : renderHuman(report, config, now, usage),
      );
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

export const statusCommand: CommandDefinition = createStatusCommand({
  api: httpStatusApi,
  loadConfig: defaultLoadConfig,
});
