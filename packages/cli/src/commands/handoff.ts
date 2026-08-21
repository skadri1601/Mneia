import type { Actor, ActorKind, Handoff, Uuid } from '@mneia/core';
import { callApi } from '../api.js';
import { describeActorAttribution } from '../attribution.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpHandoffApi, httpTeamApi } from '../http-api.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';
import { resolveActorReference, shortActorId, shortActorIds, type TeamApi } from './team.js';

export interface CreateHandoffRequest {
  readonly config: ProjectConfig;
  readonly nextAction: string;
  readonly toActor: string | null;
  readonly supersededWindowDays: number | undefined;
}

export interface PickupRequest {
  readonly config: ProjectConfig;
  readonly id: string;
}

export interface InboxRequest {
  readonly config: ProjectConfig;
  readonly limit: number;
}

export interface HandoffInbox {
  readonly viewerId: Uuid;
  readonly addressed: readonly Handoff[];
  readonly open: readonly Handoff[];
  readonly actors: readonly Actor[];
}

export interface HandoffApi {
  readonly create: (request: CreateHandoffRequest) => Promise<Handoff>;
  readonly receive: (request: PickupRequest) => Promise<Handoff>;
  readonly inbox: (request: InboxRequest) => Promise<HandoffInbox>;
}

export interface HandoffDeps {
  readonly api: HandoffApi;
  readonly team: TeamApi;
  readonly loadConfig: ProjectConfigLoader;
}

export const RECIPIENT_ROSTER_LIMIT = 500;

const USAGE = 'mneia handoff "<next action>" [--to <name|email|id>] [--window <days>] [--json]';

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function readNextAction(invocation: CommandInvocation): string {
  const positional = invocation.args.join(' ').trim();
  if (positional.length === 0) {
    throw usageError(
      'mneia handoff needs the one concrete thing the receiver should do next — "Wire the retry path in charges/worker.rb to the new idempotency key" transfers work; "continue the migration" does not',
    );
  }
  return positional;
}

export function readRecipientReference(flags: CommandInvocation['flags']): string | null {
  const raw = flags.to;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw usageError(
      '--to needs the name, email, or id of somebody in this workspace, as mneia team prints them; omit it to leave the handoff open',
    );
  }
  return raw.trim();
}

function readWindow(flags: CommandInvocation['flags']): number | undefined {
  const raw = flags.window;
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw usageError('--window needs a number of days');
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`--window expects a positive whole number of days; got ${raw}`);
  }
  return parsed;
}

export function describeRecipient(handoff: Handoff, recipient: Actor | null): string {
  if (handoff.toActor === null) {
    return 'open — anyone may pick it up';
  }
  if (recipient === null || recipient.id !== handoff.toActor) {
    return `an actor outside this workspace roster (${handoff.toActor})`;
  }
  const shortIds = shortActorIds([recipient]);
  return `${describeActorAttribution(recipient, recipient.id)} [${shortActorId(recipient, shortIds)}]`;
}

function renderCreated(handoff: Handoff, recipient: Actor | null): string {
  return [
    handoff.rendered.trim(),
    '',
    '---',
    `handoff: ${handoff.id}`,
    `to: ${describeRecipient(handoff, recipient)}`,
    `frozen at: ${handoff.createdAt.toISOString()}`,
    '',
    `The receiver runs: mneia pickup ${handoff.id}`,
    '',
  ].join('\n');
}

export interface HandoffJsonActor {
  readonly id: Uuid;
  readonly displayName: string | null;
  readonly kind: ActorKind | null;
  readonly human: boolean | null;
}

export function toJsonActor(id: Uuid | null, actor: Actor | null): HandoffJsonActor | null {
  if (id === null) {
    return null;
  }
  const resolved = actor !== null && actor.id === id ? actor : null;
  return {
    id,
    displayName: resolved?.displayName ?? null,
    kind: resolved?.kind ?? null,
    human: resolved === null ? null : resolved.kind === 'human',
  };
}

function renderJson(handoff: Handoff, recipient: Actor | null): string {
  return `${JSON.stringify(
    {
      id: handoff.id,
      projectId: handoff.projectId,
      fromActor: handoff.fromActor,
      toActor: toJsonActor(handoff.toActor, recipient),
      createdAt: handoff.createdAt.toISOString(),
      receivedAt: handoff.receivedAt === null ? null : handoff.receivedAt.toISOString(),
      nextAction: handoff.nextAction,
      rendered: handoff.rendered,
    },
    null,
    2,
  )}\n`;
}

export function createHandoffCommand(deps: HandoffDeps): CommandDefinition {
  return {
    name: 'handoff',
    summary: 'Freeze a receivable handoff artifact for whoever picks the work up next.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      const nextAction = readNextAction(invocation);
      const reference = readRecipientReference(invocation.flags);
      const supersededWindowDays = readWindow(invocation.flags);
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);

      let recipient: Actor | null = null;

      if (reference !== null) {
        const roster = await callApi(config.endpoint, 'handoff', () =>
          deps.team.roster({ config, limit: RECIPIENT_ROSTER_LIMIT }),
        );
        recipient = resolveActorReference(reference, roster, '--to');
      }

      const handoff = await callApi(config.endpoint, 'handoff', () =>
        deps.api.create({
          config,
          nextAction,
          toActor: recipient === null ? null : recipient.id,
          supersededWindowDays,
        }),
      );

      invocation.io.stdout(
        invocation.json ? renderJson(handoff, recipient) : renderCreated(handoff, recipient),
      );
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

export const handoffCommand: CommandDefinition = createHandoffCommand({
  api: httpHandoffApi,
  team: httpTeamApi,
  loadConfig: defaultLoadConfig,
});
