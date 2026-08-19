import type { Handoff } from '@mneia/core';
import { callApi } from '../api.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpHandoffApi } from '../http-api.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';
import type { HandoffApi } from './handoff.js';

export interface PickupDeps {
  readonly api: HandoffApi;
  readonly loadConfig: ProjectConfigLoader;
}

const USAGE = 'mneia pickup [<handoff-id>] [--json]';

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function readId(invocation: CommandInvocation): string | null {
  const positional = invocation.args.filter((arg) => arg.trim().length > 0);
  if (positional.length === 0) {
    return null;
  }
  if (positional.length > 1) {
    throw usageError(`mneia pickup takes one handoff id; got ${positional.length}`);
  }
  return (positional[0] ?? '').trim();
}

const utcMinute = (value: Date): string => value.toISOString().replace('T', ' ').slice(0, 16);

function renderOpen(handoffs: readonly Handoff[]): string {
  if (handoffs.length === 0) {
    return [
      'No open handoff on this project.',
      '',
      'Someone creates one with: mneia handoff "<next action>"',
      '',
    ].join('\n');
  }

  const lines = [
    handoffs.length === 1
      ? '1 open handoff. Pick it up by id:'
      : `${handoffs.length} open handoffs. Pick one up by id:`,
    '',
  ];

  for (const handoff of handoffs) {
    lines.push(`  ${handoff.id}  ${utcMinute(handoff.createdAt)} UTC`);
    lines.push(`    ${handoff.nextAction}`);
  }

  lines.push('', `  mneia pickup ${handoffs[0]?.id ?? '<handoff-id>'}`, '');
  return lines.join('\n');
}

function renderReceived(handoff: Handoff): string {
  return [
    handoff.rendered.trim(),
    '',
    '---',
    `received: ${handoff.receivedAt === null ? 'unknown' : handoff.receivedAt.toISOString()}`,
    `handed over by: ${handoff.fromActor}`,
    '',
  ].join('\n');
}

function renderJson(value: Handoff | readonly Handoff[]): string {
  const one = (handoff: Handoff) => ({
    id: handoff.id,
    projectId: handoff.projectId,
    fromActor: handoff.fromActor,
    toActor: handoff.toActor,
    createdAt: handoff.createdAt.toISOString(),
    receivedAt: handoff.receivedAt === null ? null : handoff.receivedAt.toISOString(),
    nextAction: handoff.nextAction,
    rendered: handoff.rendered,
  });

  return `${JSON.stringify(
    Array.isArray(value) ? { handoffs: value.map(one) } : one(value as Handoff),
    null,
    2,
  )}\n`;
}

export function createPickupCommand(deps: PickupDeps): CommandDefinition {
  return {
    name: 'pickup',
    summary: 'Receive a handoff, or list the open ones when no id is given.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      const id = readId(invocation);
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);

      if (id === null) {
        const open = await callApi(config.endpoint, 'pickup', () => deps.api.listOpen({ config }));
        invocation.io.stdout(invocation.json ? renderJson(open) : renderOpen(open));
        return EXIT_OK;
      }

      const handoff = await callApi(config.endpoint, 'pickup', () =>
        deps.api.receive({ config, id }),
      );
      invocation.io.stdout(invocation.json ? renderJson(handoff) : renderReceived(handoff));
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
