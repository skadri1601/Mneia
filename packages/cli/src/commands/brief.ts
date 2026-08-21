import type { ActorKind, ItemKind, ItemStatus, ScoredItem, Slice } from '@mneia/core';
import { callApi } from '../api.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpBriefApi } from '../http-api.js';

type ConfigModule = typeof import('../config.js');

export type ProjectConfig = Awaited<ReturnType<ConfigModule['requireProjectConfig']>>;

export type ProjectConfigLoader = (
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
) => Promise<ProjectConfig> | ProjectConfig;

export interface BriefRequest {
  readonly config: ProjectConfig;
  readonly task: string;
  readonly tokenBudget: number;
}

export interface BriefApi {
  readonly rehydrate: (request: BriefRequest) => Promise<Slice>;
}

export interface BriefDeps {
  readonly api: BriefApi;
  readonly loadConfig: ProjectConfigLoader;
}

export const DEFAULT_TOKEN_BUDGET = 4000;

const USAGE = 'mneia brief "<task>" [--budget <tokens>] [--json]';

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function readTask(invocation: CommandInvocation): string {
  const positional = invocation.args.join(' ').trim();
  const flag = invocation.flags.task;
  if (flag === true) {
    throw usageError('--task needs a value');
  }
  const flagged = typeof flag === 'string' ? flag.trim() : '';
  if (positional.length > 0 && flagged.length > 0) {
    throw usageError('the task was given twice, positionally and with --task');
  }
  const task = positional.length > 0 ? positional : flagged;
  if (task.length === 0) {
    throw usageError('mneia brief needs the task you are about to work on');
  }
  return task;
}

function readBudget(flags: CommandInvocation['flags']): number {
  const raw = flags.budget;
  if (raw === undefined) {
    return DEFAULT_TOKEN_BUDGET;
  }
  if (typeof raw !== 'string') {
    throw usageError('--budget needs a token count');
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`--budget expects a positive whole number of tokens; got ${raw}`);
  }
  return parsed;
}

function loadBearingCount(items: readonly ScoredItem[]): number {
  return items.filter((scored) => scored.item.loadBearing).length;
}

function taskOf(slice: Slice, requested: string): string {
  return slice.task.trim().length > 0 ? slice.task : requested;
}

function renderHuman(slice: Slice, requested: string): string {
  if (slice.items.length === 0) {
    return [
      'No context recorded for this project yet, so the brief is empty.',
      '',
      'Run mneia checkpoint after your next task to start the record.',
      '',
    ].join('\n');
  }
  const lines: string[] = [];
  const body = slice.renderedMarkdown.trim();
  if (body.length > 0) {
    lines.push(body, '');
  }
  const counts = `items: ${slice.items.length} (${loadBearingCount(slice.items)} load-bearing)`;
  const budget = `tokens: ${slice.tokensUsed}/${slice.tokenBudget}`;
  lines.push('---');
  lines.push(`task: ${taskOf(slice, requested)}`);
  lines.push(`${counts} · ${budget} · generated: ${slice.generatedAt.toISOString()}`);
  return `${lines.join('\n')}\n`;
}

interface BriefJsonActor {
  readonly id: string;
  readonly displayName: string | null;
  readonly kind: ActorKind | null;
}

interface BriefJsonItem {
  readonly id: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body: string | null;
  readonly status: ItemStatus;
  readonly confidence: number;
  readonly humanConfirmed: boolean;
  readonly loadBearing: boolean;
  readonly assertedAt: string;
  readonly assertedBy: BriefJsonActor;
  readonly score: number;
}

function toJsonItem(scored: ScoredItem): BriefJsonItem {
  const item = scored.item;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    status: item.status,
    confidence: item.confidence,
    humanConfirmed: item.humanConfirmed,
    loadBearing: item.loadBearing,
    assertedAt: item.assertedAt.toISOString(),
    assertedBy: {
      id: item.assertedBy,
      displayName: item.provenance?.actorDisplayName ?? null,
      kind: item.provenance?.actorKind ?? null,
    },
    score: scored.score,
  };
}

function renderJson(slice: Slice, requested: string): string {
  const payload = {
    sliceId: slice.id,
    projectId: slice.projectId,
    task: taskOf(slice, requested),
    generatedAt: slice.generatedAt.toISOString(),
    tokenBudget: slice.tokenBudget,
    tokensUsed: slice.tokensUsed,
    renderedMarkdown: slice.renderedMarkdown,
    items: slice.items.map(toJsonItem),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function createBriefCommand(deps: BriefDeps): CommandDefinition {
  return {
    name: 'brief',
    summary: 'Print the rehydrated context slice for a stated task.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      const task = readTask(invocation);
      const tokenBudget = readBudget(invocation.flags);
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);
      const slice = await callApi(config.endpoint, 'brief', () =>
        deps.api.rehydrate({ config, task, tokenBudget }),
      );
      invocation.io.stdout(invocation.json ? renderJson(slice, task) : renderHuman(slice, task));
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

export const briefCommand: CommandDefinition = createBriefCommand({
  api: httpBriefApi,
  loadConfig: defaultLoadConfig,
});
