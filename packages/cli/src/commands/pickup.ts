import type { Actor, Handoff, Uuid } from '@mneia/core';
import { shortenItemIds } from '@mneia/core';
import { callApi } from '../api.js';
import { describeActorAttribution } from '../attribution.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpHandoffApi } from '../http-api.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';
import type { HandoffApi } from './handoff.js';
import { type HandoffInbox, toJsonActor } from './handoff.js';
import { matchItemIds } from './log.js';

export interface PickupDeps {
  readonly api: HandoffApi;
  readonly loadConfig: ProjectConfigLoader;
}

export const DEFAULT_INBOX_LIMIT = 50;
export const MAX_INBOX_LIMIT = 200;
export const MIN_HANDOFF_REFERENCE_LENGTH = 4;

const USAGE = 'mneia pickup [<handoff-id>] [--limit <count>] [--json]';

const HYPHENS = /-/g;
const HANDOFF_REFERENCE = /^[0-9a-f-]+$/;

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function readReference(invocation: CommandInvocation): string | null {
  const positional = invocation.args.filter((arg) => arg.trim().length > 0);
  if (positional.length === 0) {
    return null;
  }
  if (positional.length > 1) {
    throw usageError(`mneia pickup takes one handoff id; got ${positional.length}`);
  }
  const value = (positional[0] ?? '').trim().toLowerCase();
  if (
    !HANDOFF_REFERENCE.test(value) ||
    value.replace(HYPHENS, '').length < MIN_HANDOFF_REFERENCE_LENGTH
  ) {
    throw usageError(
      `mneia pickup expects at least ${MIN_HANDOFF_REFERENCE_LENGTH} characters of a handoff id, such as 66666666 or a full uuid; got ${positional[0] ?? ''}`,
    );
  }
  return value;
}

function readLimit(flags: CommandInvocation['flags']): number {
  const raw = flags.limit;
  if (raw === undefined) {
    return DEFAULT_INBOX_LIMIT;
  }
  if (typeof raw !== 'string') {
    throw usageError('--limit needs a number of handoffs');
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`--limit expects a positive whole number of handoffs; got ${raw}`);
  }
  if (parsed > MAX_INBOX_LIMIT) {
    throw usageError(`--limit is capped at ${MAX_INBOX_LIMIT} handoffs; got ${raw}`);
  }
  return parsed;
}

const projectLabel = (config: ProjectConfig): string => `${config.workspace}/${config.project}`;

const utcMinute = (value: Date): string => value.toISOString().replace('T', ' ').slice(0, 16);

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

const waiting = (inbox: HandoffInbox): readonly Handoff[] => [...inbox.addressed, ...inbox.open];

function actorFor(inbox: HandoffInbox, id: Uuid | null): Actor | null {
  if (id === null) {
    return null;
  }
  return inbox.actors.find((actor) => actor.id === id) ?? null;
}

export function describeSender(inbox: HandoffInbox, handoff: Handoff): string {
  const actor = actorFor(inbox, handoff.fromActor);
  if (actor === null) {
    return `an actor outside this workspace roster (${handoff.fromActor})`;
  }
  return describeActorAttribution(actor, actor.id);
}

function handoffLine(
  handoff: Handoff,
  inbox: HandoffInbox,
  shortIds: ReadonlyMap<Uuid, string>,
): string {
  return [
    `  [${shortIds.get(handoff.id) ?? handoff.id}]  ${utcMinute(handoff.createdAt)} UTC · from ${describeSender(inbox, handoff)}`,
    `      ${handoff.nextAction}`,
  ].join('\n');
}

function group(
  heading: string,
  handoffs: readonly Handoff[],
  inbox: HandoffInbox,
  shortIds: ReadonlyMap<Uuid, string>,
): readonly string[] {
  if (handoffs.length === 0) {
    return [];
  }
  return [
    [
      `${heading} (${handoffs.length})`,
      ...handoffs.map((handoff) => handoffLine(handoff, inbox, shortIds)),
    ].join('\n'),
  ];
}

function renderEmptyInbox(config: ProjectConfig): string {
  return [
    `Nothing is waiting on ${projectLabel(config)} — no handoff is addressed to you, and none is open.`,
    '',
    'Someone creates one with: mneia handoff "<next action>" --to <name>',
    '',
  ].join('\n');
}

export function renderInbox(inbox: HandoffInbox, config: ProjectConfig): string {
  const all = waiting(inbox);
  if (all.length === 0) {
    return renderEmptyInbox(config);
  }

  const shortIds = shortenItemIds(all.map((handoff) => handoff.id));
  const first = inbox.addressed[0] ?? inbox.open[0];
  const example = first === undefined ? '<handoff-id>' : (shortIds.get(first.id) ?? first.id);

  const header = [
    `${projectLabel(config)} — ${countOf(all.length, 'handoff')} you can pick up`,
    `${inbox.addressed.length} addressed to you · ${inbox.open.length} open · times in UTC`,
  ].join('\n');

  return `${[
    header,
    ...group('addressed to you', inbox.addressed, inbox, shortIds),
    ...group('open — anyone may pick it up', inbox.open, inbox, shortIds),
    `Pick one up with: mneia pickup ${example}`,
  ].join('\n\n')}\n`;
}

function renderReceived(handoff: Handoff, inbox: HandoffInbox): string {
  return [
    handoff.rendered.trim(),
    '',
    '---',
    `received: ${handoff.receivedAt === null ? 'unknown' : handoff.receivedAt.toISOString()}`,
    `handed over by: ${describeSender(inbox, handoff)}`,
    '',
  ].join('\n');
}

function toJsonHandoff(handoff: Handoff, inbox: HandoffInbox) {
  return {
    id: handoff.id,
    projectId: handoff.projectId,
    fromActor: toJsonActor(handoff.fromActor, actorFor(inbox, handoff.fromActor)),
    toActor: toJsonActor(handoff.toActor, actorFor(inbox, handoff.toActor)),
    addressedToYou: handoff.toActor === inbox.viewerId,
    createdAt: handoff.createdAt.toISOString(),
    receivedAt: handoff.receivedAt === null ? null : handoff.receivedAt.toISOString(),
    nextAction: handoff.nextAction,
    rendered: handoff.rendered,
  };
}

function renderInboxJson(inbox: HandoffInbox, config: ProjectConfig, limit: number): string {
  const payload = {
    project: projectLabel(config),
    viewerId: inbox.viewerId,
    limit,
    count: waiting(inbox).length,
    addressedToYou: inbox.addressed.map((handoff) => toJsonHandoff(handoff, inbox)),
    open: inbox.open.map((handoff) => toJsonHandoff(handoff, inbox)),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderReceivedJson(handoff: Handoff, inbox: HandoffInbox): string {
  return `${JSON.stringify(toJsonHandoff(handoff, inbox), null, 2)}\n`;
}

function referenceUnknown(reference: string, inbox: HandoffInbox): CliError {
  const all = waiting(inbox);
  return new CliError(
    'usage',
    `mneia pickup found no handoff matching ${reference} among the ${all.length} ${all.length === 1 ? 'handoff' : 'handoffs'} addressed to you or open on this project — it may be addressed to somebody else, or already received`,
    'run mneia pickup with no id to see the inbox, then pass one of the ids it prints in [brackets]',
  );
}

export function resolveInboxHandoff(reference: string, inbox: HandoffInbox): Handoff {
  const all = waiting(inbox);
  const matches = matchItemIds(
    all.map((handoff) => handoff.id),
    reference,
  );

  if (matches.length > 1) {
    throw new CliError(
      'usage',
      `mneia pickup matched ${matches.length} handoffs for ${reference}: ${matches.join(', ')}`,
      'pass more characters of the id, or the full uuid',
    );
  }

  const matched = matches[0];
  if (matched === undefined) {
    throw referenceUnknown(reference, inbox);
  }

  const handoff = all.find((candidate) => candidate.id === matched);
  if (handoff === undefined) {
    throw referenceUnknown(reference, inbox);
  }

  if (handoff.toActor !== null && handoff.toActor !== inbox.viewerId) {
    throw new CliError(
      'failed',
      `handoff ${handoff.id} is addressed to another actor (${handoff.toActor}), so it is not yours to receive`,
      'ask them to receive it, or ask the sender to re-issue it open with mneia handoff "<next action>"',
    );
  }

  return handoff;
}

export function createPickupCommand(deps: PickupDeps): CommandDefinition {
  return {
    name: 'pickup',
    summary: 'Receive a handoff addressed to you, or list what is waiting when no id is given.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      const reference = readReference(invocation);
      const limit = readLimit(invocation.flags);
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);

      const inbox = await callApi(config.endpoint, 'pickup', () =>
        deps.api.inbox({ config, limit }),
      );

      if (reference === null) {
        invocation.io.stdout(
          invocation.json ? renderInboxJson(inbox, config, limit) : renderInbox(inbox, config),
        );
        return EXIT_OK;
      }

      const target = resolveInboxHandoff(reference, inbox);
      const handoff = await callApi(config.endpoint, 'pickup', () =>
        deps.api.receive({ config, id: target.id }),
      );

      invocation.io.stdout(
        invocation.json ? renderReceivedJson(handoff, inbox) : renderReceived(handoff, inbox),
      );
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

export const pickupCommand: CommandDefinition = createPickupCommand({
  api: httpHandoffApi,
  loadConfig: defaultLoadConfig,
});
