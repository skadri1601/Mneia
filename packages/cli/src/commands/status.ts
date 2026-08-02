import type { ContextItem, IntervalMs, ItemKind, ItemStatus, Uuid } from '@mneia/core';
import { shortenItemIds } from '@mneia/core';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
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

export interface UnansweredItem {
  readonly item: ContextItem;
  readonly ageMs: number;
}

export interface StatusSections {
  readonly stale: readonly StaleItem[];
  readonly disputed: readonly ContextItem[];
  readonly unanswered: readonly UnansweredItem[];
  readonly reviewed: number;
}

const USAGE = 'mneia status [--json]';

const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const CAUSE_DEPTH = 5;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function readOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function networkErrorCode(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < CAUSE_DEPTH; depth += 1) {
    const code = readOf(current, 'code');
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
      return code;
    }
    const name = readOf(current, 'name');
    if (name === 'TimeoutError' || name === 'ConnectTimeoutError') {
      return 'ETIMEDOUT';
    }
    current = readOf(current, 'cause');
    if (current === undefined || current === null) {
      return null;
    }
  }

  return null;
}

async function callApi<T>(endpoint: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    const code = networkErrorCode(error);
    if (code !== null) {
      throw new CliError(
        'network',
        `the Mneia API at ${endpoint} could not be reached (${code})`,
        'check your network connection, then run mneia status again — your token is fine',
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      'failed',
      `the Mneia API call failed: ${detail}`,
      'retry, and report it if it keeps failing',
    );
  }
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

const byAssertedNewest = (left: ContextItem, right: ContextItem): number => {
  const delta = right.assertedAt.getTime() - left.assertedAt.getTime();
  return delta !== 0 ? delta : left.id.localeCompare(right.id);
};

function sortStale(items: readonly StaleItem[]): readonly StaleItem[] {
  return [...items].sort((left, right) => {
    if (left.item.loadBearing !== right.item.loadBearing) {
      return left.item.loadBearing ? -1 : 1;
    }
    const delta = right.overdueMs - left.overdueMs;
    return delta !== 0 ? delta : left.item.id.localeCompare(right.item.id);
  });
}

export function classifyStatus(items: readonly ContextItem[], now: Date): StatusSections {
  const stale: StaleItem[] = [];
  const disputed: ContextItem[] = [];
  const unanswered: UnansweredItem[] = [];

  for (const item of items) {
    const staleItem = staleItemOf(item, now);
    if (staleItem !== null) {
      stale.push(staleItem);
    }
    if (item.status === 'disputed') {
      disputed.push(item);
    }
    if (item.kind === 'open_question' && item.status === 'active') {
      unanswered.push({ item, ageMs: Math.max(0, now.getTime() - item.assertedAt.getTime()) });
    }
  }

  return {
    stale: sortStale(stale),
    disputed: [...disputed].sort(byAssertedNewest),
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

function titleLine(item: ContextItem, shortIds: ReadonlyMap<Uuid, string>): string {
  const marks: string[] = [item.kind];
  if (item.loadBearing) {
    marks.push('load-bearing');
  }
  if (item.humanConfirmed) {
    marks.push('human-confirmed');
  }
  return `  ${item.title}  [${shortIds.get(item.id) ?? item.id}] · ${marks.join(' · ')}`;
}

function staleBlock(stale: StaleItem, shortIds: ReadonlyMap<Uuid, string>): string {
  const verified =
    stale.item.lastVerifiedAt === null
      ? `asserted ${utcDate(stale.window.verifiedAt)}, never re-verified`
      : `last verified ${utcDate(stale.window.verifiedAt)}`;
  const detail = [
    verified,
    `decays after ${describeDuration(stale.window.decayAfter)}`,
    `overdue by ${describeDuration(stale.overdueMs)}`,
  ].join(' · ');
  return [titleLine(stale.item, shortIds), `    ${detail}`].join('\n');
}

function disputedBlock(item: ContextItem, shortIds: ReadonlyMap<Uuid, string>): string {
  return [titleLine(item, shortIds), `    asserted ${utcDate(item.assertedAt)}`].join('\n');
}

function unansweredBlock(entry: UnansweredItem, shortIds: ReadonlyMap<Uuid, string>): string {
  return [
    titleLine(entry.item, shortIds),
    `    open ${describeDuration(entry.ageMs)} · asked ${utcDate(entry.item.assertedAt)}`,
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

function renderClean(config: ProjectConfig, sections: StatusSections): string {
  if (sections.reviewed === 0) {
    return [
      `No context recorded for ${projectLabel(config)} yet, so there is nothing to review.`,
      '',
      'Run mneia checkpoint after your next task to start the record.',
      '',
    ].join('\n');
  }
  return `${projectLabel(config)} is clean — nothing stale, disputed, or unanswered across ${countOf(sections.reviewed, 'item')}.\n`;
}

function renderHuman(report: StatusReport, config: ProjectConfig, now: Date): string {
  const sections = classifyStatus(report.items, now);
  if (isClean(sections)) {
    return renderClean(config, sections);
  }

  const shortIds = shortenItemIds(report.items.map((item) => item.id));
  const blocks = [
    headline(config, sections),
    ...section(
      `stale (${sections.stale.length}) — past their decay window; re-verify or supersede`,
      sections.stale.map((stale) => staleBlock(stale, shortIds)),
    ),
    ...section(
      `disputed (${sections.disputed.length}) — conflicting assertions; a human decides`,
      sections.disputed.map((item) => disputedBlock(item, shortIds)),
    ),
    ...section(
      `unanswered (${sections.unanswered.length}) — open questions with no answer yet`,
      sections.unanswered.map((entry) => unansweredBlock(entry, shortIds)),
    ),
  ];

  return `${blocks.join('\n\n')}\n`;
}

interface StatusJsonItem {
  readonly id: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly status: ItemStatus;
  readonly loadBearing: boolean;
  readonly humanConfirmed: boolean;
  readonly assertedAt: string;
}

interface StatusJsonStale extends StatusJsonItem {
  readonly lastVerifiedAt: string | null;
  readonly decayAfterMs: IntervalMs;
  readonly staleAt: string;
  readonly overdueMs: number;
}

interface StatusJsonUnanswered extends StatusJsonItem {
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

function toJsonUnanswered(entry: UnansweredItem): StatusJsonUnanswered {
  return { ...toJsonItem(entry.item), ageMs: entry.ageMs };
}

function renderJson(report: StatusReport, config: ProjectConfig, now: Date): string {
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
    stale: sections.stale.map(toJsonStale),
    disputed: sections.disputed.map(toJsonItem),
    unanswered: sections.unanswered.map(toJsonUnanswered),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
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
      const config = await deps.loadConfig(invocation.io.cwd);
      const report = await callApi(config.endpoint, () => deps.api.status({ config }));
      invocation.io.stdout(
        invocation.json ? renderJson(report, config, now) : renderHuman(report, config, now),
      );
      return EXIT_OK;
    },
  };
}

const unwiredApi: StatusApi = {
  status: () =>
    Promise.reject(
      new CliError(
        'failed',
        'the hosted Mneia API client is not wired into this build yet',
        'the hosted API lands with MNE-101; there is nothing to fix locally',
      ),
    ),
};

const defaultLoadConfig: ProjectConfigLoader = async (cwd) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd);
};

export const statusCommand: CommandDefinition = createStatusCommand({
  api: unwiredApi,
  loadConfig: defaultLoadConfig,
});
