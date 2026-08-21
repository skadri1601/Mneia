import type { ActorKind, ProjectSessionSummary, Uuid } from '@mneia/core';
import { callApi } from '../api.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpSessionsApi } from '../http-api.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';

export interface SessionsRequest {
  readonly config: ProjectConfig;
  readonly limit: number;
}

export interface SessionsReport {
  readonly projectId: Uuid;
  readonly viewerId: Uuid;
  readonly sessions: readonly ProjectSessionSummary[];
}

export interface SessionsApi {
  readonly sessions: (request: SessionsRequest) => Promise<SessionsReport>;
}

export interface SessionsDeps {
  readonly api: SessionsApi;
  readonly loadConfig: ProjectConfigLoader;
}

export const DEFAULT_SESSIONS_LIMIT = 20;
export const MAX_SESSIONS_LIMIT = 200;

const USAGE = 'mneia sessions [--limit <count>] [--json]';

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function assertNoPositionals(args: readonly string[]): void {
  if (args.length === 0) {
    return;
  }
  throw usageError(`mneia sessions takes no positional arguments; got ${args.join(' ')}`);
}

function readLimit(flags: CommandInvocation['flags']): number {
  const raw = flags.limit;
  if (raw === undefined) {
    return DEFAULT_SESSIONS_LIMIT;
  }
  if (typeof raw !== 'string') {
    throw usageError('--limit needs a number of sessions');
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`--limit expects a positive whole number of sessions; got ${raw}`);
  }
  if (parsed > MAX_SESSIONS_LIMIT) {
    throw usageError(`--limit is capped at ${MAX_SESSIONS_LIMIT} sessions; got ${raw}`);
  }
  return parsed;
}

const projectLabel = (config: ProjectConfig): string => `${config.workspace}/${config.project}`;

const utcStamp = (at: Date): string => at.toISOString().replace('T', ' ').slice(0, 16);

const utcTime = (at: Date): string => at.toISOString().slice(11, 16);

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

export function orderSessions(
  sessions: readonly ProjectSessionSummary[],
): readonly ProjectSessionSummary[] {
  return [...sessions].sort((left, right) => {
    const delta = right.session.startedAt.getTime() - left.session.startedAt.getTime();
    return delta !== 0 ? delta : left.session.id.localeCompare(right.session.id);
  });
}

function sameDay(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

export function describeWindow(summary: ProjectSessionSummary): string {
  const { startedAt, endedAt } = summary.session;
  if (endedAt === null) {
    return `${utcStamp(startedAt)} → still open`;
  }
  return sameDay(startedAt, endedAt)
    ? `${utcStamp(startedAt)} → ${utcTime(endedAt)}`
    : `${utcStamp(startedAt)} → ${utcStamp(endedAt)}`;
}

export function describeClient(summary: ProjectSessionSummary): string {
  const { session } = summary;
  const name = session.clientName ?? session.tool;
  const version = session.clientVersion ?? null;
  const parts: string[] = [
    name === null || name === undefined || name.trim().length === 0
      ? 'client not recorded'
      : version === null || version.trim().length === 0
        ? name
        : `${name} ${version}`,
  ];

  const sessionName = session.clientSessionName ?? null;
  if (sessionName !== null && sessionName.trim().length > 0) {
    parts.push(`"${sessionName.trim()}"`);
  }

  const ref = session.clientSessionRef ?? null;
  parts.push(ref === null || ref.trim().length === 0 ? 'no session ref' : `ref ${ref.trim()}`);

  return parts.join(' · ');
}

function describeYield(summary: ProjectSessionSummary): string {
  const checkpoints =
    summary.checkpointCount === 0
      ? 'no checkpoints yet'
      : countOf(summary.checkpointCount, 'checkpoint');
  const items =
    summary.itemCount === 0 ? 'no context items' : countOf(summary.itemCount, 'context item');
  return `${checkpoints} · ${items}`;
}

function sessionBlock(summary: ProjectSessionSummary, viewerId: Uuid, windowWidth: number): string {
  const marks: string[] = [`${summary.actor.displayName} (${summary.actor.kind})`];
  if (summary.actor.id === viewerId) {
    marks.push('you');
  }

  return [
    `  ${describeWindow(summary).padEnd(windowWidth)}  ${marks.join(' · ')}`,
    `    ${describeClient(summary)}`,
    `    ${describeYield(summary)}`,
  ].join('\n');
}

function tally(sessions: readonly ProjectSessionSummary[]): string {
  const humans = sessions.filter((entry) => entry.actor.kind === 'human').length;
  const checkpoints = sessions.reduce((total, entry) => total + entry.checkpointCount, 0);
  const items = sessions.reduce((total, entry) => total + entry.itemCount, 0);
  return [
    countOf(sessions.length, 'session'),
    `${countOf(humans, 'human')} · ${countOf(sessions.length - humans, 'agent')}`,
    countOf(checkpoints, 'checkpoint'),
    countOf(items, 'context item'),
  ].join(' · ');
}

function renderEmpty(config: ProjectConfig): string {
  return [
    `No agent sessions have been recorded against ${projectLabel(config)} yet.`,
    '',
    'A session appears here once someone runs mneia checkpoint from one — run mneia checkpoint to add yours.',
    '',
  ].join('\n');
}

function renderHuman(report: SessionsReport, config: ProjectConfig, limit: number): string {
  if (report.sessions.length === 0) {
    return renderEmpty(config);
  }

  const ordered = orderSessions(report.sessions);
  const windowWidth = ordered.reduce(
    (widest, summary) => Math.max(widest, describeWindow(summary).length),
    0,
  );

  const header = [
    `${projectLabel(config)} — who has worked here, newest first`,
    `${tally(ordered)} · limit ${limit} · times in UTC`,
  ].join('\n');

  return `${[
    header,
    ...ordered.map((summary) => sessionBlock(summary, report.viewerId, windowWidth)),
  ].join('\n\n')}\n`;
}

interface SessionsJsonEntry {
  readonly id: Uuid;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly tool: string | null;
  readonly clientName: string | null;
  readonly clientVersion: string | null;
  readonly clientSessionRef: string | null;
  readonly clientSessionName: string | null;
  readonly clientSessionUrl: string | null;
  readonly actor: {
    readonly id: Uuid;
    readonly displayName: string;
    readonly kind: ActorKind;
    readonly human: boolean;
    readonly you: boolean;
  };
  readonly checkpointCount: number;
  readonly itemCount: number;
}

function toJsonEntry(summary: ProjectSessionSummary, viewerId: Uuid): SessionsJsonEntry {
  const { session, actor } = summary;
  return {
    id: session.id,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt === null ? null : session.endedAt.toISOString(),
    tool: session.tool ?? null,
    clientName: session.clientName ?? null,
    clientVersion: session.clientVersion ?? null,
    clientSessionRef: session.clientSessionRef ?? null,
    clientSessionName: session.clientSessionName ?? null,
    clientSessionUrl: session.clientSessionUrl ?? null,
    actor: {
      id: actor.id,
      displayName: actor.displayName,
      kind: actor.kind,
      human: actor.kind === 'human',
      you: actor.id === viewerId,
    },
    checkpointCount: summary.checkpointCount,
    itemCount: summary.itemCount,
  };
}

function renderJson(report: SessionsReport, config: ProjectConfig, limit: number): string {
  const ordered = orderSessions(report.sessions);
  const payload = {
    project: projectLabel(config),
    projectId: report.projectId,
    viewerId: report.viewerId,
    limit,
    count: ordered.length,
    sessions: ordered.map((summary) => toJsonEntry(summary, report.viewerId)),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function createSessionsCommand(deps: SessionsDeps): CommandDefinition {
  return {
    name: 'sessions',
    summary: 'Show who has worked on this project, from which client, and what it produced.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      assertNoPositionals(invocation.args);
      const limit = readLimit(invocation.flags);
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);
      const report = await callApi(config.endpoint, 'sessions', () =>
        deps.api.sessions({ config, limit }),
      );

      invocation.io.stdout(
        invocation.json ? renderJson(report, config, limit) : renderHuman(report, config, limit),
      );
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

export const sessionsCommand: CommandDefinition = createSessionsCommand({
  api: httpSessionsApi,
  loadConfig: defaultLoadConfig,
});
