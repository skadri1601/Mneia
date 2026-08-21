import type { ActorKind, ContextItem, ItemKind, ItemStatus, Uuid } from '@mneia/core';
import { shortenItemIds } from '@mneia/core';
import { callApi } from '../api.js';
import { confirmationMark, describeAsserter } from '../attribution.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpVerifyApi } from '../http-api.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';
import { matchItemIds } from './log.js';
import { decayWindow } from './status.js';

export type Verification = 'confirmed' | 'denied';

export interface StaleEntry {
  readonly item: ContextItem;
  readonly staleSince: Date;
  readonly staleForMs: number;
}

export interface StaleListRequest {
  readonly config: ProjectConfig;
  readonly limit: number;
  readonly asOf: Date;
}

export interface StaleList {
  readonly projectId: Uuid;
  readonly entries: readonly StaleEntry[];
}

export interface VerifyRequest {
  readonly config: ProjectConfig;
  readonly itemId: Uuid;
  readonly verification: Verification;
  readonly reason: string | null;
}

export interface VerifyOutcome {
  readonly checkpointId: Uuid;
  readonly item: ContextItem;
  readonly verification: Verification;
  readonly previousLastVerifiedAt: Date | null;
}

export interface VerifyApi {
  readonly stale: (request: StaleListRequest) => Promise<StaleList>;
  readonly verify: (request: VerifyRequest) => Promise<VerifyOutcome>;
}

export interface VerifyDeps {
  readonly api: VerifyApi;
  readonly loadConfig: ProjectConfigLoader;
  readonly now?: () => Date;
}

export const DEFAULT_VERIFY_LIMIT = 20;
export const MAX_VERIFY_LIMIT = 200;
export const MIN_ITEM_REFERENCE_LENGTH = 4;

const USAGE =
  'mneia verify [<id> --confirm | <id> --deny --reason "<why>"] [--limit <count>] [--json]';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ITEM_REFERENCE = /^[0-9a-f-]+$/;
const HYPHENS = /-/g;

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function readLimit(flags: CommandInvocation['flags']): number {
  const raw = flags.limit;
  if (raw === undefined) {
    return DEFAULT_VERIFY_LIMIT;
  }
  if (typeof raw !== 'string') {
    throw usageError('--limit needs a number of items');
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`--limit expects a positive whole number of items; got ${raw}`);
  }
  if (parsed > MAX_VERIFY_LIMIT) {
    throw usageError(`--limit is capped at ${MAX_VERIFY_LIMIT} items; got ${raw}`);
  }
  return parsed;
}

function readReference(args: readonly string[]): string | null {
  if (args.length === 0) {
    return null;
  }
  if (args.length > 1) {
    throw usageError(
      `mneia verify takes one item id; got ${args.length} (${args.join(' ')}) — verify one item at a time`,
    );
  }
  const value = (args[0] ?? '').trim().toLowerCase();
  if (
    !ITEM_REFERENCE.test(value) ||
    value.replace(HYPHENS, '').length < MIN_ITEM_REFERENCE_LENGTH
  ) {
    throw usageError(
      `mneia verify expects at least ${MIN_ITEM_REFERENCE_LENGTH} characters of an item id, such as 4f3a1b2c or a full uuid; got ${args[0] ?? ''}`,
    );
  }
  return value;
}

function readReason(flags: CommandInvocation['flags']): string | null {
  const raw = flags.reason;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw usageError('--reason needs the text explaining why the item no longer holds');
  }
  return raw.trim();
}

interface Decision {
  readonly verification: Verification;
  readonly reason: string | null;
}

function assertNothingToDecide(reference: string | null, reason: string | null): null {
  if (reference !== null) {
    throw usageError(
      `mneia verify ${reference} needs to know what you decided; add --confirm if the item still holds, or --deny --reason "<why>" if it does not`,
    );
  }
  if (reason !== null) {
    throw usageError('--reason only means something alongside --deny');
  }
  return null;
}

function assertReasonMatches(
  verification: Verification,
  reference: string | null,
  reason: string | null,
): string | null {
  if (reference === null) {
    throw usageError(
      `mneia verify --${verification === 'confirmed' ? 'confirm' : 'deny'} needs the id of the item you decided on; run mneia verify to see the ids in [brackets]`,
    );
  }
  if (verification === 'confirmed' && reason !== null) {
    throw usageError(
      '--reason records why an item no longer holds, so it belongs with --deny; drop it to confirm',
    );
  }
  if (verification === 'denied' && reason === null) {
    throw usageError(
      `mneia verify ${reference} --deny retires the item, so it needs --reason "<why it no longer holds>" — that reason is what the record keeps`,
    );
  }
  return reason;
}

function readDecision(
  flags: CommandInvocation['flags'],
  reference: string | null,
): Decision | null {
  const confirm = flags.confirm === true || flags.confirm === 'true';
  const deny = flags.deny === true || flags.deny === 'true';
  const reason = readReason(flags);

  if (confirm && deny) {
    throw usageError(
      '--confirm and --deny say opposite things about the same item; pass exactly one',
    );
  }
  if (!confirm && !deny) {
    return assertNothingToDecide(reference, reason);
  }

  const verification: Verification = confirm ? 'confirmed' : 'denied';
  return { verification, reason: assertReasonMatches(verification, reference, reason) };
}

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

function marksFor(item: ContextItem): readonly string[] {
  const marks: string[] = [item.kind];
  if (item.loadBearing) {
    marks.push('load-bearing');
  }
  marks.push(confirmationMark(item.humanConfirmed));
  return marks;
}

function titleLine(item: ContextItem, shortIds: ReadonlyMap<Uuid, string>): string {
  return `  ${item.title}  [${shortIds.get(item.id) ?? item.id}] · ${marksFor(item).join(' · ')}`;
}

const isDisputed = (item: ContextItem): boolean => item.status === 'disputed';

function entryBlock(entry: StaleEntry, shortIds: ReadonlyMap<Uuid, string>): string {
  const verified =
    entry.item.lastVerifiedAt === null
      ? `asserted ${utcDate(entry.item.assertedAt)}, never re-verified`
      : `last verified ${utcDate(entry.item.lastVerifiedAt)}`;

  const detail = [
    describeAsserter(entry.item),
    verified,
    `due since ${utcDate(entry.staleSince)}`,
    `overdue by ${describeDuration(entry.staleForMs)}`,
  ].join(' · ');

  const lines = [titleLine(entry.item, shortIds), `    ${detail}`];

  if (isDisputed(entry.item)) {
    lines.push(
      '    disputed — Mneia does not pick a winner here; §10.4 leaves that to the people who disagree',
    );
  }

  return lines.join('\n');
}

function renderList(list: StaleList, config: ProjectConfig, limit: number): string {
  if (list.entries.length === 0) {
    return [
      `Nothing in ${projectLabel(config)} is due for re-verification.`,
      '',
      'Constraints never go stale, so they will never appear here — §9 keeps their decay window null on purpose.',
      '',
    ].join('\n');
  }

  const shortIds = shortenItemIds(list.entries.map((entry) => entry.item.id));
  const decidable = list.entries.filter((entry) => !isDisputed(entry.item));
  const first = decidable[0] ?? list.entries[0];
  const example =
    first === undefined ? '<id>' : (shortIds.get(first.item.id) ?? first.item.id.slice(0, 8));

  const header = [
    `${projectLabel(config)} — ${countOf(list.entries.length, 'item')} due for re-verification`,
    `limit ${limit} · oldest first · times in UTC`,
  ].join('\n');

  const footer = [
    `Confirm one with mneia verify ${example} --confirm if it still holds.`,
    `Retire one with mneia verify ${example} --deny --reason "<why it no longer holds>".`,
  ].join('\n');

  return `${[header, ...list.entries.map((entry) => entryBlock(entry, shortIds)), footer].join('\n\n')}\n`;
}

interface VerifyJsonItem {
  readonly id: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly status: ItemStatus;
  readonly loadBearing: boolean;
  readonly humanConfirmed: boolean;
  readonly assertedAt: string;
  readonly assertedBy: {
    readonly id: Uuid;
    readonly displayName: string | null;
    readonly kind: ActorKind | null;
  };
  readonly lastVerifiedAt: string | null;
  readonly decayAfterMs: number | null;
}

function toJsonItem(item: ContextItem): VerifyJsonItem {
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
    lastVerifiedAt: item.lastVerifiedAt === null ? null : item.lastVerifiedAt.toISOString(),
    decayAfterMs: item.decayAfter,
  };
}

function renderListJson(list: StaleList, config: ProjectConfig, limit: number, now: Date): string {
  const payload = {
    project: projectLabel(config),
    projectId: list.projectId,
    generatedAt: now.toISOString(),
    limit,
    count: list.entries.length,
    due: list.entries.map((entry) => ({
      ...toJsonItem(entry.item),
      staleSince: entry.staleSince.toISOString(),
      staleForMs: entry.staleForMs,
      disputed: isDisputed(entry.item),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function nextDueLine(item: ContextItem): string {
  const window = decayWindow(item);
  if (window === null) {
    return 'It has no decay window now, so it will not be asked about again.';
  }
  return `Next due ${utcDate(window.staleAt)}.`;
}

function renderOutcome(outcome: VerifyOutcome, config: ProjectConfig): string {
  const shortId = outcome.item.id.slice(0, 8);
  const previous =
    outcome.previousLastVerifiedAt === null
      ? 'never re-verified before'
      : `previously verified ${utcDate(outcome.previousLastVerifiedAt)}`;

  if (outcome.verification === 'confirmed') {
    return [
      `Confirmed "${outcome.item.title}" [${shortId}] in ${projectLabel(config)} — ${previous}.`,
      nextDueLine(outcome.item),
      `Recorded in checkpoint ${outcome.checkpointId}.`,
      '',
    ].join('\n');
  }

  return [
    `Retired "${outcome.item.title}" [${shortId}] in ${projectLabel(config)} — ${previous}.`,
    'It stays in the record as retired rather than being deleted, so the history still reads.',
    `Recorded in checkpoint ${outcome.checkpointId}.`,
    '',
  ].join('\n');
}

function renderOutcomeJson(outcome: VerifyOutcome, config: ProjectConfig): string {
  const payload = {
    project: projectLabel(config),
    verification: outcome.verification,
    checkpointId: outcome.checkpointId,
    previousLastVerifiedAt:
      outcome.previousLastVerifiedAt === null ? null : outcome.previousLastVerifiedAt.toISOString(),
    item: toJsonItem(outcome.item),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function referenceUnknown(reference: string, limit: number): CliError {
  return new CliError(
    'usage',
    `mneia verify found no item matching ${reference} among the ${limit} due for re-verification in this project`,
    'run mneia verify to see what is due, then pass one of the ids it prints in [brackets], or pass a full uuid',
  );
}

async function resolveItemId(
  deps: VerifyDeps,
  request: StaleListRequest,
  reference: string,
): Promise<Uuid> {
  if (FULL_UUID.test(reference)) {
    return reference;
  }

  const list = await callApi(request.config.endpoint, 'verify', () => deps.api.stale(request));
  const matches = matchItemIds(
    list.entries.map((entry) => entry.item.id),
    reference,
  );

  if (matches.length === 0) {
    throw referenceUnknown(reference, request.limit);
  }
  if (matches.length > 1) {
    throw new CliError(
      'usage',
      `mneia verify matched ${matches.length} items for ${reference}: ${matches.join(', ')}`,
      'pass more characters of the id, or the full uuid',
    );
  }

  const matched = matches[0];
  if (matched === undefined) {
    throw referenceUnknown(reference, request.limit);
  }

  const entry = list.entries.find((candidate) => candidate.item.id === matched);
  if (entry !== undefined && isDisputed(entry.item)) {
    throw new CliError(
      'failed',
      `context item ${matched} is disputed, and mneia does not settle a disagreement between people by taking one side's answer to a re-verification prompt`,
      'resolve the dispute with the other actor first — §10.4 leaves this to the people involved',
    );
  }

  return matched;
}

const systemClock = (): Date => new Date();

export function createVerifyCommand(deps: VerifyDeps): CommandDefinition {
  return {
    name: 'verify',
    summary: 'List the context items due for re-verification, and confirm or retire one.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      const reference = readReference(invocation.args);
      const decision = readDecision(invocation.flags, reference);
      const limit = readLimit(invocation.flags);
      const now = (deps.now ?? systemClock)();
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);
      const listRequest: StaleListRequest = { config, limit, asOf: now };

      if (decision === null || reference === null) {
        const list = await callApi(config.endpoint, 'verify', () => deps.api.stale(listRequest));
        invocation.io.stdout(
          invocation.json
            ? renderListJson(list, config, limit, now)
            : renderList(list, config, limit),
        );
        return EXIT_OK;
      }

      const itemId = await resolveItemId(deps, listRequest, reference);
      const outcome = await callApi(config.endpoint, 'verify', () =>
        deps.api.verify({
          config,
          itemId,
          verification: decision.verification,
          reason: decision.reason,
        }),
      );

      invocation.io.stdout(
        invocation.json ? renderOutcomeJson(outcome, config) : renderOutcome(outcome, config),
      );
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

export const verifyCommand: CommandDefinition = createVerifyCommand({
  api: httpVerifyApi,
  loadConfig: defaultLoadConfig,
});
