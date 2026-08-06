import type { Actor, ActorKind, ContextItem, ItemKind, ItemStatus, Uuid } from '@mneia/core';
import { shortenItemIds } from '@mneia/core';
import { callApi } from '../api.js';
import { localLogApi } from './local-api.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';

export interface LogRequest {
  readonly config: ProjectConfig;
  readonly limit: number;
  readonly since: Date | null;
}

export interface LogPage {
  readonly projectId: Uuid;
  readonly items: readonly ContextItem[];
  readonly actors: readonly Actor[];
}

export interface LogApi {
  readonly log: (request: LogRequest) => Promise<LogPage>;
}

export interface LogDeps {
  readonly api: LogApi;
  readonly loadConfig: ProjectConfigLoader;
  readonly now?: () => Date;
}

export const DEFAULT_LOG_LIMIT = 20;
export const MAX_LOG_LIMIT = 500;

const USAGE = 'mneia log [--limit <count>] [--since <duration|date>] [--json]';

const DURATION = /^(\d+)(m|h|d|w)$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

const DURATION_MS: Readonly<Record<string, number>> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const CONTINUATION = ' '.repeat(9);
const CLOCK_SKEW_TOLERANCE_MS = 1_000;

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function assertNoPositionals(args: readonly string[]): void {
  if (args.length === 0) {
    return;
  }
  throw usageError(
    `mneia log takes no positional arguments; got ${args.join(' ')} — did you mean --limit ${args[0] ?? ''}?`,
  );
}

function readLimit(flags: CommandInvocation['flags']): number {
  const raw = flags.limit;
  if (raw === undefined) {
    return DEFAULT_LOG_LIMIT;
  }
  if (typeof raw !== 'string') {
    throw usageError('--limit needs a number of entries');
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`--limit expects a positive whole number of entries; got ${raw}`);
  }
  if (parsed > MAX_LOG_LIMIT) {
    throw usageError(`--limit is capped at ${MAX_LOG_LIMIT} entries; got ${raw}`);
  }
  return parsed;
}

function relativeSince(value: string, now: Date, raw: string): Date | null {
  const matched = DURATION.exec(value);
  if (matched === null) {
    return null;
  }
  const amount = matched[1];
  const unit = matched[2];
  const scale = unit === undefined ? undefined : DURATION_MS[unit];
  if (amount === undefined || scale === undefined) {
    return null;
  }
  const count = Number(amount);
  if (!Number.isInteger(count) || count < 1) {
    throw usageError(`--since expects a duration of at least one unit; got ${raw}`);
  }
  const since = new Date(now.getTime() - count * scale);
  if (Number.isNaN(since.getTime())) {
    throw usageError(`--since reaches further back than a date can express; got ${raw}`);
  }
  return since;
}

function readSince(flags: CommandInvocation['flags'], now: Date): Date | null {
  const raw = flags.since;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string') {
    throw usageError('--since needs a value, such as 7d or 2026-07-01');
  }

  const value = raw.trim().toLowerCase();
  const relative = relativeSince(value, now, raw);
  if (relative !== null) {
    return relative;
  }

  if (CALENDAR_DATE.test(value)) {
    const parsed = Date.parse(raw.trim());
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }

  throw usageError(
    `--since expects a duration like 30m, 24h, 7d, 2w or a date like 2026-07-01; got ${raw}`,
  );
}

interface LogView {
  readonly item: ContextItem;
  readonly actor: Actor | undefined;
  readonly replaces: ContextItem | undefined;
  readonly replacedBy: ContextItem | undefined;
}

function orderNewestFirst(items: readonly ContextItem[]): readonly ContextItem[] {
  return [...items].sort((left, right) => {
    const delta = right.assertedAt.getTime() - left.assertedAt.getTime();
    return delta !== 0 ? delta : left.id.localeCompare(right.id);
  });
}

function buildViews(page: LogPage): readonly LogView[] {
  const items = new Map(page.items.map((item) => [item.id, item]));
  const actors = new Map(page.actors.map((actor) => [actor.id, actor]));

  return orderNewestFirst(page.items).map((item) => ({
    item,
    actor: actors.get(item.assertedBy),
    replaces: item.supersedesId === null ? undefined : items.get(item.supersedesId),
    replacedBy: item.supersededById === null ? undefined : items.get(item.supersededById),
  }));
}

const projectLabel = (config: ProjectConfig): string => `${config.workspace}/${config.project}`;

const utcDate = (at: Date): string => at.toISOString().slice(0, 10);

const utcTime = (at: Date): string => at.toISOString().slice(11, 16);

function describeActor(view: LogView): string {
  if (view.actor === undefined) {
    return `an actor outside this page (${view.item.assertedBy.slice(0, 8)})`;
  }
  return `${view.actor.displayName} (${view.actor.kind})`;
}

function provenanceLine(view: LogView): string {
  const parts = [`by ${describeActor(view)}`];
  if (view.item.humanConfirmed) {
    parts.push('human-confirmed');
  }
  if (view.item.loadBearing) {
    parts.push('load-bearing');
  }
  parts.push(`confidence ${view.item.confidence.toFixed(2)}`);
  return parts.join(' · ');
}

function referTo(
  resolved: ContextItem | undefined,
  id: Uuid,
  shortIds: ReadonlyMap<Uuid, string>,
): string {
  if (resolved === undefined) {
    return `an item outside this page [${id.slice(0, 8)}]`;
  }
  return `"${resolved.title}" [${shortIds.get(resolved.id) ?? resolved.id}]`;
}

function supersessionLines(view: LogView, shortIds: ReadonlyMap<Uuid, string>): string[] {
  const lines: string[] = [];
  const { item } = view;

  if (item.supersedesId !== null) {
    lines.push(`replaces ${referTo(view.replaces, item.supersedesId, shortIds)}`);
  }

  if (item.supersededById !== null) {
    const replacedAt = item.validTo ?? view.replacedBy?.assertedAt;
    const when = replacedAt === undefined ? '' : ` on ${utcDate(replacedAt)}`;
    lines.push(`superseded by ${referTo(view.replacedBy, item.supersededById, shortIds)}${when}`);
  }

  return lines;
}

function validityLine(item: ContextItem): string | null {
  const drift = Math.abs(item.validFrom.getTime() - item.assertedAt.getTime());
  if (drift < CLOCK_SKEW_TOLERANCE_MS) {
    return null;
  }
  return `effective from ${utcDate(item.validFrom)}`;
}

function entryBlock(view: LogView, shortIds: ReadonlyMap<Uuid, string>, kindWidth: number): string {
  const { item } = view;
  const shortId = shortIds.get(item.id) ?? item.id;
  const state = item.status === 'active' ? '' : `  — ${item.status}`;
  const headline = `  ${utcTime(item.assertedAt)}  ${item.kind.padEnd(kindWidth)}  ${item.title}  [${shortId}]${state}`;

  const detail = [provenanceLine(view)];
  const validity = validityLine(item);
  if (validity !== null) {
    detail.push(validity);
  }
  detail.push(...supersessionLines(view, shortIds));

  return [headline, ...detail.map((line) => `${CONTINUATION}${line}`)].join('\n');
}

function describeWindow(count: number, limit: number, since: Date | null): string {
  const parts = [`${count} ${count === 1 ? 'entry' : 'entries'}`, `limit ${limit}`];
  if (since !== null) {
    parts.push(`since ${since.toISOString()}`);
  }
  parts.push('times in UTC');
  return parts.join(' · ');
}

function emptyLog(config: ProjectConfig, since: Date | null): string {
  const reason =
    since === null
      ? `No decisions recorded for ${projectLabel(config)} yet.`
      : `No decisions recorded for ${projectLabel(config)} since ${since.toISOString()}.`;
  const next =
    since === null
      ? 'Run mneia checkpoint after your next task to start the record.'
      : 'Widen the window with --since, or drop it to see the whole history.';
  return [reason, '', next, ''].join('\n');
}

function dayBlocks(views: readonly LogView[], shortIds: ReadonlyMap<Uuid, string>): string[] {
  const kindWidth = views.reduce((widest, view) => Math.max(widest, view.item.kind.length), 0);
  const blocks: string[] = [];
  let day = '';
  let entries: string[] = [];

  for (const view of views) {
    const date = utcDate(view.item.assertedAt);
    if (date !== day) {
      if (entries.length > 0) {
        blocks.push([day, entries.join('\n\n')].join('\n'));
      }
      day = date;
      entries = [];
    }
    entries.push(entryBlock(view, shortIds, kindWidth));
  }

  if (entries.length > 0) {
    blocks.push([day, ...entries].join('\n\n'));
  }

  return blocks;
}

function renderHuman(
  page: LogPage,
  config: ProjectConfig,
  limit: number,
  since: Date | null,
): string {
  const views = buildViews(page);
  if (views.length === 0) {
    return emptyLog(config, since);
  }

  const shortIds = shortenItemIds(page.items.map((item) => item.id));
  const header = [
    `${projectLabel(config)} — decision history, newest first`,
    describeWindow(views.length, limit, since),
  ].join('\n');

  return `${[header, ...dayBlocks(views, shortIds)].join('\n\n')}\n`;
}

interface LogJsonRef {
  readonly id: Uuid;
  readonly title: string | null;
}

interface LogJsonActor {
  readonly id: Uuid;
  readonly displayName: string | null;
  readonly kind: ActorKind | null;
}

interface LogJsonEntry {
  readonly id: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body: string | null;
  readonly status: ItemStatus;
  readonly assertedAt: string;
  readonly assertedBy: LogJsonActor;
  readonly humanConfirmed: boolean;
  readonly loadBearing: boolean;
  readonly confidence: number;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly supersedes: LogJsonRef | null;
  readonly supersededBy: LogJsonRef | null;
}

function toJsonRef(resolved: ContextItem | undefined, id: Uuid | null): LogJsonRef | null {
  if (id === null) {
    return null;
  }
  return { id, title: resolved?.title ?? null };
}

function toJsonEntry(view: LogView): LogJsonEntry {
  const { item } = view;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    status: item.status,
    assertedAt: item.assertedAt.toISOString(),
    assertedBy: {
      id: item.assertedBy,
      displayName: view.actor?.displayName ?? null,
      kind: view.actor?.kind ?? null,
    },
    humanConfirmed: item.humanConfirmed,
    loadBearing: item.loadBearing,
    confidence: item.confidence,
    validFrom: item.validFrom.toISOString(),
    validTo: item.validTo === null ? null : item.validTo.toISOString(),
    supersedes: toJsonRef(view.replaces, item.supersedesId),
    supersededBy: toJsonRef(view.replacedBy, item.supersededById),
  };
}

function renderJson(
  page: LogPage,
  config: ProjectConfig,
  limit: number,
  since: Date | null,
): string {
  const views = buildViews(page);
  const payload = {
    project: projectLabel(config),
    projectId: page.projectId,
    limit,
    since: since === null ? null : since.toISOString(),
    count: views.length,
    entries: views.map(toJsonEntry),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

const systemClock = (): Date => new Date();

export function createLogCommand(deps: LogDeps): CommandDefinition {
  return {
    name: 'log',
    summary: 'Show the decision history for this project, newest first.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      assertNoPositionals(invocation.args);
      const limit = readLimit(invocation.flags);
      const since = readSince(invocation.flags, (deps.now ?? systemClock)());
      const config = await deps.loadConfig(invocation.io.cwd);
      const page = await callApi(config.endpoint, 'log', () =>
        deps.api.log({ config, limit, since }),
      );
      invocation.io.stdout(
        invocation.json
          ? renderJson(page, config, limit, since)
          : renderHuman(page, config, limit, since),
      );
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd);
};

export const logCommand: CommandDefinition = createLogCommand({
  api: localLogApi,
  loadConfig: defaultLoadConfig,
});
