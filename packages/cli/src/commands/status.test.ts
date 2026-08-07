import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContextItem } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import type { CommandDefinition, CommandIo } from '../command.js';
import {
  CliError,
  EXIT_AUTH,
  EXIT_FAILED,
  EXIT_NETWORK,
  EXIT_NOT_CONFIGURED,
  EXIT_OK,
  EXIT_USAGE,
} from '../command.js';
import { requireProjectConfig } from '../config.js';
import type { ProjectConfig } from './brief.js';
import {
  classifyStatus,
  createStatusCommand,
  decayWindow,
  type StatusApi,
  type StatusReport,
  type StatusRequest,
} from './status.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-08-01T00:00:00.000Z');

const CONFIG: ProjectConfig = {
  workspace: 'acme',
  project: 'checkout',
  endpoint: 'https://api.mneia.dev',
  configPath: '/repo/.mneia/config.json',
  repoRoot: '/repo',
};

function contextItem(overrides: Partial<ContextItem>): ContextItem {
  const assertedAt = overrides.assertedAt ?? new Date('2026-07-01T00:00:00.000Z');
  return {
    id: 'aa11bb22-0000-4000-8000-000000000001',
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    kind: 'fact',
    title: 'A fact',
    body: null,
    status: 'active',
    assertedBy: ACTOR_ID,
    assertedAt,
    sourceSessionId: null,
    sourceRef: null,
    confidence: 0.8,
    humanConfirmed: false,
    loadBearing: false,
    lastVerifiedAt: null,
    decayAfter: null,
    validFrom: assertedAt,
    validTo: null,
    supersedesId: null,
    supersededById: null,
    accessScope: 'project',
    embedding: null,
    embeddingModel: null,
    ...overrides,
  };
}

const stalePooling = contextItem({
  id: 'aa11bb22-0000-4000-8000-000000000001',
  kind: 'fact',
  title: 'Postgres connection pooling limits',
  assertedAt: new Date('2026-05-01T00:00:00.000Z'),
  lastVerifiedAt: new Date('2026-06-01T00:00:00.000Z'),
  decayAfter: 30 * DAY_MS,
});

const evergreenRuling = contextItem({
  id: 'bb22cc33-0000-4000-8000-000000000002',
  kind: 'decision',
  title: 'Shared schema with row-level security, ruled once and for all',
  assertedAt: new Date('2020-01-01T00:00:00.000Z'),
  humanConfirmed: true,
  loadBearing: true,
  decayAfter: null,
});

const disputedBilling = contextItem({
  id: 'cc33dd44-0000-4000-8000-000000000003',
  kind: 'constraint',
  title: 'Billing provider is Stripe',
  status: 'disputed',
  assertedAt: new Date('2026-07-20T00:00:00.000Z'),
  loadBearing: true,
});

const oldQuestion = contextItem({
  id: 'dd44ee55-0000-4000-8000-000000000004',
  kind: 'open_question',
  title: 'Do we support SSO at launch?',
  assertedAt: new Date('2026-07-20T00:00:00.000Z'),
});

const recentQuestion = contextItem({
  id: 'ee55ff66-0000-4000-8000-000000000005',
  kind: 'open_question',
  title: 'Which region hosts the EU workspace?',
  assertedAt: new Date('2026-07-30T00:00:00.000Z'),
});

const staleLoadBearing = contextItem({
  id: 'ff66aa77-0000-4000-8000-000000000006',
  kind: 'constraint',
  title: 'The p95 rehydrate budget is 300ms',
  assertedAt: new Date('2026-07-20T00:00:00.000Z'),
  loadBearing: true,
  humanConfirmed: true,
  decayAfter: 7 * DAY_MS,
});

const supersededAndAncient = contextItem({
  id: 'ab99cd88-0000-4000-8000-000000000007',
  kind: 'decision',
  title: 'Schema-per-tenant isolation',
  status: 'superseded',
  assertedAt: new Date('2026-01-01T00:00:00.000Z'),
  decayAfter: DAY_MS,
  supersededById: 'bb22cc33-0000-4000-8000-000000000002',
});

const PROJECT_ITEMS: readonly ContextItem[] = [
  stalePooling,
  evergreenRuling,
  disputedBilling,
  oldQuestion,
  recentQuestion,
  staleLoadBearing,
  supersededAndAncient,
];

const report = (items: readonly ContextItem[]): StatusReport => ({ projectId: PROJECT_ID, items });

interface RecordingApi extends StatusApi {
  readonly requests: StatusRequest[];
}

function recordingApi(result: StatusReport): RecordingApi {
  const requests: StatusRequest[] = [];
  return {
    requests,
    status: (request) => {
      requests.push(request);
      return Promise.resolve(result);
    },
  };
}

const rejectingApi = (error: unknown): StatusApi => ({
  status: () => Promise.reject(error),
});

const loadConfig = (): ProjectConfig => CONFIG;

interface RunOptions {
  readonly args?: readonly string[];
  readonly flags?: Readonly<Record<string, string | boolean>>;
  readonly json?: boolean;
  readonly cwd?: string;
}

interface RunResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(command: CommandDefinition, options: RunOptions = {}): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIo = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    cwd: options.cwd ?? '/repo',
    env: {},
  };

  const code = await command.run({
    args: options.args ?? [],
    flags: options.flags ?? {},
    json: options.json ?? false,
    io,
  });

  return { code, out: out.join(''), err: err.join('') };
}

async function failure(command: CommandDefinition, options: RunOptions = {}): Promise<CliError> {
  try {
    await run(command, options);
  } catch (error) {
    if (error instanceof CliError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected mneia status to fail, but it succeeded');
}

const commandWith = (api: StatusApi): CommandDefinition =>
  createStatusCommand({ api, loadConfig, now: () => NOW });

describe('mneia status', () => {
  it('reports stale, disputed, and unanswered in three labelled sections', async () => {
    const result = await run(commandWith(recordingApi(report(PROJECT_ITEMS))));

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain(
      'acme/checkout — 2 stale · 1 disputed · 2 unanswered (7 items reviewed)',
    );
    expect(result.out).toContain('stale (2) — past their decay window; re-verify or supersede');
    expect(result.out).toContain('disputed (1) — conflicting assertions; a human decides');
    expect(result.out).toContain('unanswered (2) — open questions with no answer yet');
  });

  it('explains why each stale item is stale, in text rather than colour', async () => {
    const result = await run(commandWith(recordingApi(report(PROJECT_ITEMS))));

    expect(result.out).toContain(
      'last verified 2026-06-01 · decays after 30 days · overdue by 31 days',
    );
    expect(result.out).toContain(
      'asserted 2026-07-20, never re-verified · decays after 7 days · overdue by 5 days',
    );
    expect(result.out).toContain('open 12 days · asked 2026-07-20');
  });

  it('never reports an item with a null decayAfter as stale, however old it is', async () => {
    const sections = classifyStatus([evergreenRuling], NOW);

    expect(decayWindow(evergreenRuling)).toBeNull();
    expect(sections.stale).toHaveLength(0);

    const result = await run(commandWith(recordingApi(report([evergreenRuling]))));

    expect(result.out).not.toContain('stale (');
    expect(result.out).toContain('acme/checkout is clean');
  });

  it('prefers lastVerifiedAt over assertedAt when measuring the decay window', async () => {
    const reverified = contextItem({
      id: 'aa11bb22-0000-4000-8000-000000000001',
      assertedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastVerifiedAt: new Date('2026-07-20T00:00:00.000Z'),
      decayAfter: 30 * DAY_MS,
    });
    const neglected = contextItem({
      id: 'aa11bb22-0000-4000-8000-000000000001',
      assertedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastVerifiedAt: new Date('2026-06-01T00:00:00.000Z'),
      decayAfter: 30 * DAY_MS,
    });

    expect(classifyStatus([reverified], NOW).stale).toHaveLength(0);
    expect(classifyStatus([neglected], NOW).stale).toHaveLength(1);
    expect(decayWindow(reverified)?.staleAt.toISOString()).toBe('2026-08-19T00:00:00.000Z');
  });

  it('falls back to assertedAt when an item was never verified', () => {
    const never = contextItem({
      assertedAt: new Date('2026-07-01T00:00:00.000Z'),
      lastVerifiedAt: null,
      decayAfter: 10 * DAY_MS,
    });

    expect(decayWindow(never)?.verifiedAt.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(classifyStatus([never], NOW).stale).toHaveLength(1);
  });

  it('treats the moment the decay window closes as stale', () => {
    const item = contextItem({
      assertedAt: new Date('2026-07-25T00:00:00.000Z'),
      decayAfter: 7 * DAY_MS,
    });

    expect(classifyStatus([item], NOW).stale).toHaveLength(1);
    expect(classifyStatus([item], new Date(NOW.getTime() - 1)).stale).toHaveLength(0);
  });

  it('does not report a superseded item as stale — it is replaced, not rotten', () => {
    const sections = classifyStatus([supersededAndAncient], NOW);

    expect(sections.stale).toHaveLength(0);
    expect(sections.disputed).toHaveLength(0);
  });

  it('puts load-bearing staleness first, then the most overdue', async () => {
    const sections = classifyStatus(PROJECT_ITEMS, NOW);

    expect(sections.stale.map((entry) => entry.item.id)).toEqual([
      staleLoadBearing.id,
      stalePooling.id,
    ]);

    const result = await run(commandWith(recordingApi(report(PROJECT_ITEMS))));
    expect(result.out.indexOf('The p95 rehydrate budget is 300ms')).toBeLessThan(
      result.out.indexOf('Postgres connection pooling limits'),
    );
  });

  it('lists the oldest unanswered question first', () => {
    const sections = classifyStatus(PROJECT_ITEMS, NOW);

    expect(sections.unanswered.map((entry) => entry.item.id)).toEqual([
      oldQuestion.id,
      recentQuestion.id,
    ]);
  });

  it('prints a short confirmation for a clean project, not three empty headings', async () => {
    const result = await run(commandWith(recordingApi(report([evergreenRuling, disputedBilling]))));

    expect(result.out).toContain('disputed (1)');

    const clean = await run(commandWith(recordingApi(report([evergreenRuling]))));

    expect(clean.code).toBe(EXIT_OK);
    expect(clean.out).toBe(
      'acme/checkout is clean — nothing stale, disputed, or unanswered across 1 item.\n',
    );
    expect(clean.out).not.toContain('stale (');
    expect(clean.out).not.toContain('unanswered (');
  });

  it('distinguishes an empty project from a clean one', async () => {
    const result = await run(commandWith(recordingApi(report([]))));

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('No context recorded for acme/checkout yet');
    expect(result.out).toContain('Run mneia checkpoint after your next task');
  });

  it('emits the same three sections with --json', async () => {
    const result = await run(commandWith(recordingApi(report(PROJECT_ITEMS))), { json: true });
    const payload: unknown = JSON.parse(result.out);

    expect(payload).toMatchObject({
      project: 'acme/checkout',
      projectId: PROJECT_ID,
      generatedAt: NOW.toISOString(),
      clean: false,
      counts: { stale: 2, disputed: 1, unanswered: 2, reviewed: 7 },
    });

    const typed = payload as {
      stale: readonly Record<string, unknown>[];
      disputed: readonly Record<string, unknown>[];
      unanswered: readonly Record<string, unknown>[];
    };

    expect(typed.stale[0]).toMatchObject({
      id: staleLoadBearing.id,
      loadBearing: true,
      lastVerifiedAt: null,
      decayAfterMs: 7 * DAY_MS,
      staleAt: '2026-07-27T00:00:00.000Z',
      overdueMs: 5 * DAY_MS,
    });
    expect(typed.disputed[0]).toMatchObject({ id: disputedBilling.id, status: 'disputed' });
    expect(typed.unanswered[0]).toMatchObject({ id: oldQuestion.id, ageMs: 12 * DAY_MS });
    expect(typed.stale.map((entry) => entry.id)).not.toContain(evergreenRuling.id);
  });

  it('marks a clean project as clean in --json too', async () => {
    const result = await run(commandWith(recordingApi(report([evergreenRuling]))), { json: true });

    expect(JSON.parse(result.out)).toMatchObject({
      clean: true,
      counts: { stale: 0, disputed: 0, unanswered: 0, reviewed: 1 },
    });
  });

  it('points an unbound machine at login and init, not at a repo-only script', async () => {
    const command = createStatusCommand({
      api: recordingApi(report(PROJECT_ITEMS)),
      loadConfig: (cwd) => requireProjectConfig(cwd),
      now: () => NOW,
    });

    const error = await failure(command, {
      cwd: join(tmpdir(), 'mneia-status-not-configured-3f9c1a2b'),
    });

    expect(error.kind).toBe('not_configured');
    expect(error.exitCode).toBe(EXIT_NOT_CONFIGURED);
    expect(error.fix).toContain('mneia login');
    expect(error.fix).toContain('mneia init');
    expect(error.fix).not.toContain('pnpm');
  });

  it('separates an unreachable API, a rejected token, and a real failure by exit code', async () => {
    const unreachable = await failure(
      commandWith(
        rejectingApi(
          new TypeError('fetch failed', {
            cause: Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }),
          }),
        ),
      ),
    );
    const rejectedToken = await failure(
      commandWith(
        rejectingApi(
          new CliError('auth', 'the Mneia API rejected this token', 'run mneia login again'),
        ),
      ),
    );
    const broken = await failure(commandWith(rejectingApi(new Error('503 Service Unavailable'))));

    expect(unreachable.kind).toBe('network');
    expect(unreachable.exitCode).toBe(EXIT_NETWORK);
    expect(unreachable.message).toContain('https://api.mneia.dev');
    expect(unreachable.fix).toContain('your token is fine');
    expect(rejectedToken.exitCode).toBe(EXIT_AUTH);
    expect(broken.exitCode).toBe(EXIT_FAILED);
    expect(new Set([unreachable.exitCode, rejectedToken.exitCode, broken.exitCode]).size).toBe(3);
  });

  it('rejects positional arguments before it calls the API', async () => {
    const api = recordingApi(report(PROJECT_ITEMS));
    const error = await failure(commandWith(api), { args: ['stale'] });

    expect(error.kind).toBe('usage');
    expect(error.exitCode).toBe(EXIT_USAGE);
    expect(error.fix).toContain('mneia status');
    expect(api.requests).toHaveLength(0);
  });

  it('passes the resolved project config to the API', async () => {
    const api = recordingApi(report(PROJECT_ITEMS));
    await run(commandWith(api));

    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.config).toBe(CONFIG);
  });
});
