import type { Actor, ActorKind, ContextItem, ItemKind, ItemStatus, Uuid } from '@mneia/core';
import { shortenItemIds } from '@mneia/core';
import { callApi } from '../api.js';
import { confirmationMark, describeActorAttribution } from '../attribution.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { compactId, MAX_CHAIN_REVISIONS, matchItemIds } from '../item-ids.js';
import { httpLogApi } from '../http-api.js';
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

export interface LogChainRequest {
  readonly config: ProjectConfig;
  readonly reference: string;
}

export interface LogChainPage {
  readonly projectId: Uuid;
  readonly itemId: Uuid;
  readonly revisions: readonly ContextItem[];
  readonly actors: readonly Actor[];
  readonly truncated: boolean;
}

export interface LogApi {
  readonly log: (request: LogRequest) => Promise<LogPage>;
  readonly chain: (request: LogChainRequest) => Promise<LogChainPage>;
}

export interface LogDeps {
  readonly api: LogApi;
  readonly loadConfig: ProjectConfigLoader;
  readonly now?: () => Date;
}

export const DEFAULT_LOG_LIMIT = 20;
export const MAX_LOG_LIMIT = 500;
export const MIN_CHAIN_REFERENCE_LENGTH = 4;

export { MAX_CHAIN_REVISIONS, matchItemIds };

const USAGE = 'mneia log [--limit <count>] [--since <duration|date>] [--chain <id>] [--json]';

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

const CHAIN_REFERENCE = /^[0-9a-f-]+$/;

function readChain(flags: CommandInvocation['flags']): string | null {
  const raw = flags.chain;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string') {
    throw usageError('--chain needs the id of a decision, as mneia log prints it in [brackets]');
  }
  const value = raw.trim().toLowerCase();
  if (!CHAIN_REFERENCE.test(value) || compactId(value).length < MIN_CHAIN_REFERENCE_LENGTH) {
    throw usageError(
      `--chain expects at least ${MIN_CHAIN_REFERENCE_LENGTH} characters of an item id, such as 4f3a1b2c or a full uuid; got ${raw}`,
    );
  }
  return value;
}

function assertChainAlone(flags: CommandInvocation['flags']): void {
  const narrowing = ['limit', 'since'].filter((name) => flags[name] !== undefined);
  if (narrowing.length === 0) {
    return;
  }
  throw usageError(
    `--chain shows one decision's whole history, so it cannot be combined with ${narrowing
      .map((name) => `--${name}`)
      .join(' or ')}`,
  );
}

interface Provenanced {
  readonly item: ContextItem;
  readonly actor: Actor | undefined;
}

interface LogView extends Provenanced {
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

function describeActor(view: Provenanced): string {
  return describeActorAttribution(view.actor, view.item.assertedBy);
}

function provenanceLine(view: Provenanced): string {
  const parts = [`by ${describeActor(view)}`, confirmationMark(view.item.humanConfirmed)];
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
  readonly supersedeReason: string | null;
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
    supersedeReason: item.supersedeReason,
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

interface ChainStep extends LogView {
  readonly agentOverHumanConfirmed: boolean;
}

const CHAIN_CONTINUATION = ' '.repeat(20);

const utcStamp = (at: Date): string => `${utcDate(at)} ${utcTime(at)}`;

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

function chainOrder(page: LogChainPage, reference: string): readonly ContextItem[] {
  const byId = new Map(page.revisions.map((item) => [item.id, item]));
  const seed = byId.get(page.itemId);
  if (seed === undefined) {
    throw new CliError(
      'failed',
      `mneia log --chain ${reference} expected the revisions to include ${page.itemId}, but the API returned ${page.revisions.length} without it`,
      'retry, and report it if it keeps failing',
    );
  }

  const seen = new Set<Uuid>([seed.id]);
  const earlier: ContextItem[] = [];
  let cursor = seed;
  while (cursor.supersedesId !== null) {
    const previous = byId.get(cursor.supersedesId);
    if (previous === undefined || seen.has(previous.id)) {
      break;
    }
    seen.add(previous.id);
    earlier.unshift(previous);
    cursor = previous;
  }

  const later: ContextItem[] = [];
  cursor = seed;
  while (cursor.supersededById !== null) {
    const next = byId.get(cursor.supersededById);
    if (next === undefined || seen.has(next.id)) {
      break;
    }
    seen.add(next.id);
    later.push(next);
    cursor = next;
  }

  return [...earlier, seed, ...later];
}

function buildChainSteps(page: LogChainPage, reference: string): readonly ChainStep[] {
  const actors = new Map(page.actors.map((actor) => [actor.id, actor]));
  const ordered = chainOrder(page, reference);

  return ordered.map((item, index) => {
    const replaces = ordered[index - 1];
    return {
      item,
      actor: actors.get(item.assertedBy),
      replaces,
      replacedBy: ordered[index + 1],
      agentOverHumanConfirmed: (replaces?.humanConfirmed ?? false) && !item.humanConfirmed,
    };
  });
}

const isSettled = (steps: readonly ChainStep[]): boolean =>
  steps.every((step) => step.item.status !== 'disputed' && !step.agentOverHumanConfirmed);

const isInForce = (steps: readonly ChainStep[], index: number): boolean =>
  isSettled(steps) && index === steps.length - 1 && steps[index]?.item.status === 'active';

function chainRationale(step: ChainStep): string {
  if (step.item.supersedesId === null) {
    return 'first recorded revision — it replaced nothing';
  }
  const reason = step.item.supersedeReason;
  if (reason === null || reason.trim().length === 0) {
    return 'no rationale recorded for this replacement';
  }
  return `because: ${reason.trim()}`;
}

function chainSupersededLine(step: ChainStep, shortIds: ReadonlyMap<Uuid, string>): string | null {
  const { item } = step;
  if (item.supersededById === null) {
    return null;
  }
  const at = item.validTo ?? step.replacedBy?.assertedAt;
  const when = at === undefined ? '' : ` on ${utcDate(at)}`;
  return `superseded${when} by ${referTo(step.replacedBy, item.supersededById, shortIds)}`;
}

interface ChainBlockOptions {
  readonly shortIds: ReadonlyMap<Uuid, string>;
  readonly kindWidth: number;
  readonly inForce: boolean;
  readonly isSubject: boolean;
}

function chainBlock(step: ChainStep, options: ChainBlockOptions): string {
  const { item } = step;
  const shortId = options.shortIds.get(item.id) ?? item.id;
  const state = options.inForce ? 'in force' : item.status;
  const headline = `  ${utcStamp(item.assertedAt)}  ${item.kind.padEnd(options.kindWidth)}  ${item.title}  [${shortId}]  — ${state}`;

  const detail = [provenanceLine(step), chainRationale(step)];
  const validity = validityLine(item);
  if (validity !== null) {
    detail.push(validity);
  }
  const superseded = chainSupersededLine(step, options.shortIds);
  if (superseded !== null) {
    detail.push(superseded);
  }
  if (step.agentOverHumanConfirmed) {
    detail.push(
      'flagged: this replaced a human-confirmed decision without human confirmation — §10.1 says only a human may overrule one',
    );
  }
  if (item.status === 'disputed') {
    detail.push(
      'disputed: Mneia does not pick a winner here — §10.4 leaves that to the actors involved',
    );
  }
  if (options.isSubject) {
    detail.push('this is the revision you asked for');
  }

  return [headline, ...detail.map((line) => `${CHAIN_CONTINUATION}${line}`)].join('\n');
}

function chainNotes(steps: readonly ChainStep[]): readonly string[] {
  const disputed = steps.filter((step) => step.item.status === 'disputed').length;
  const flagged = steps.filter((step) => step.agentOverHumanConfirmed).length;
  const notes: string[] = [];

  if (steps.length === 1) {
    notes.push('This decision has never been superseded.');
  }
  if (disputed > 0) {
    notes.push(
      `Unresolved: ${countOf(disputed, 'revision')} disputed. Mneia does not choose between them — §10.4 leaves a human-versus-human conflict to the people who made it.`,
    );
  }
  if (flagged > 0) {
    notes.push(
      `Flagged: ${countOf(flagged, 'replacement')} replaced a human-confirmed decision without human confirmation. §10.1 says only a human may overrule one.`,
    );
  }
  return notes;
}

function renderChainHuman(page: LogChainPage, config: ProjectConfig, reference: string): string {
  const steps = buildChainSteps(page, reference);
  const shortIds = shortenItemIds(steps.map((step) => step.item.id));
  const kindWidth = steps.reduce((widest, step) => Math.max(widest, step.item.kind.length), 0);
  const subject = steps.find((step) => step.item.id === page.itemId);
  const subjectId =
    subject === undefined ? reference : (shortIds.get(subject.item.id) ?? subject.item.id);

  const window = [countOf(steps.length, 'revision'), 'oldest first', 'times in UTC'];
  if (page.truncated) {
    window.push(`truncated at ${MAX_CHAIN_REVISIONS}`);
  }

  const header = [
    `${projectLabel(config)} — supersede chain for "${subject?.item.title ?? reference}" [${subjectId}]`,
    window.join(' · '),
  ].join('\n');

  const blocks = steps.map((step, index) =>
    chainBlock(step, {
      shortIds,
      kindWidth,
      inForce: isInForce(steps, index),
      isSubject: steps.length > 1 && step.item.id === page.itemId,
    }),
  );

  return `${[header, ...blocks, ...chainNotes(steps)].join('\n\n')}\n`;
}

interface LogChainJsonEntry extends LogJsonEntry {
  readonly inForce: boolean;
  readonly agentOverHumanConfirmed: boolean;
}

function renderChainJson(page: LogChainPage, config: ProjectConfig, reference: string): string {
  const steps = buildChainSteps(page, reference);
  const payload = {
    project: projectLabel(config),
    projectId: page.projectId,
    chain: reference,
    itemId: page.itemId,
    count: steps.length,
    truncated: page.truncated,
    settled: isSettled(steps),
    revisions: steps.map(
      (step, index): LogChainJsonEntry => ({
        ...toJsonEntry(step),
        inForce: isInForce(steps, index),
        agentOverHumanConfirmed: step.agentOverHumanConfirmed,
      }),
    ),
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

      const reference = readChain(invocation.flags);
      if (reference !== null) {
        assertChainAlone(invocation.flags);
        const chainConfig = await deps.loadConfig(invocation.io.cwd, invocation.io.env);
        const chain = await callApi(chainConfig.endpoint, 'log', () =>
          deps.api.chain({ config: chainConfig, reference }),
        );
        invocation.io.stdout(
          invocation.json
            ? renderChainJson(chain, chainConfig, reference)
            : renderChainHuman(chain, chainConfig, reference),
        );
        return EXIT_OK;
      }

      const limit = readLimit(invocation.flags);
      const since = readSince(invocation.flags, (deps.now ?? systemClock)());
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);
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

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

export const logCommand: CommandDefinition = createLogCommand({
  api: httpLogApi,
  loadConfig: defaultLoadConfig,
});
