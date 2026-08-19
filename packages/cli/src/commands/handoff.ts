import type { Handoff } from '@mneia/core';
import { callApi } from '../api.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpHandoffApi } from '../http-api.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';

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

export interface ListOpenHandoffsRequest {
  readonly config: ProjectConfig;
}

export interface HandoffApi {
  readonly create: (request: CreateHandoffRequest) => Promise<Handoff>;
  readonly receive: (request: PickupRequest) => Promise<Handoff>;
  readonly listOpen: (request: ListOpenHandoffsRequest) => Promise<readonly Handoff[]>;
}

export interface HandoffDeps {
  readonly api: HandoffApi;
  readonly loadConfig: ProjectConfigLoader;
}

const USAGE = 'mneia handoff "<next action>" [--to <actor-id>] [--window <days>] [--json]';

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

function readToActor(flags: CommandInvocation['flags']): string | null {
  const raw = flags.to;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw usageError('--to needs an actor id, or omit it to leave the handoff open');
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

function renderCreated(handoff: Handoff): string {
  const recipient = handoff.toActor === null ? 'open — anyone may pick it up' : handoff.toActor;
  return [
    handoff.rendered.trim(),
    '',
    '---',
    `handoff: ${handoff.id}`,
    `to: ${recipient}`,
    `frozen at: ${handoff.createdAt.toISOString()}`,
    '',
    `The receiver runs: mneia pickup ${handoff.id}`,
    '',
  ].join('\n');
}

function renderJson(handoff: Handoff): string {
  return `${JSON.stringify(
    {
      id: handoff.id,
      projectId: handoff.projectId,
      fromActor: handoff.fromActor,
      toActor: handoff.toActor,
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
      const toActor = readToActor(invocation.flags);
      const supersededWindowDays = readWindow(invocation.flags);
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);

      const handoff = await callApi(config.endpoint, 'handoff', () =>
        deps.api.create({ config, nextAction, toActor, supersededWindowDays }),
      );

      invocation.io.stdout(invocation.json ? renderJson(handoff) : renderCreated(handoff));
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
  loadConfig: defaultLoadConfig,
});
