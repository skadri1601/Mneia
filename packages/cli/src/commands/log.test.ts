import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor, ContextItem, Uuid } from '@mneia/core';
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
  createLogCommand,
  DEFAULT_LOG_LIMIT,
  type LogApi,
  type LogChainPage,
  type LogChainRequest,
  type LogPage,
  type LogRequest,
  matchItemIds,
} from './log.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

const NEW_DECISION_ID = '4f3a1b2c-0000-4000-8000-000000000001';
const OLD_DECISION_ID = '9c2d0e5a-0000-4000-8000-000000000002';
const CONSTRAINT_ID = '7b1e33aa-0000-4000-8000-000000000003';
const ROOT_DECISION_ID = '1a2b3c4d-0000-4000-8000-000000000004';

const PRIYA: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  workspaceId: WORKSPACE_ID,
  kind: 'human',
  displayName: 'Priya Raman',
  externalRef: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
};

const AGENT: Actor = {
  id: '44444444-4444-4444-8444-444444444444',
  workspaceId: WORKSPACE_ID,
  kind: 'agent',
  displayName: 'claude-code',
  externalRef: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
};

const DAN: Actor = {
  id: '55555555-5555-4555-8555-555555555555',
  workspaceId: WORKSPACE_ID,
  kind: 'human',
  displayName: 'Dan Okafor',
  externalRef: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
};

const CONFIG: ProjectConfig = {
  workspace: 'acme',
  project: 'checkout',
  endpoint: 'https://api.mneia.dev',
  configPath: '/repo/.mneia/config.json',
  repoRoot: '/repo',
};

function contextItem(overrides: Partial<ContextItem>): ContextItem {
  const assertedAt = overrides.assertedAt ?? new Date('2026-07-31T14:22:00.000Z');
  return {
    id: NEW_DECISION_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    kind: 'decision',
    title: 'A decision',
    body: null,
    status: 'active',
    assertedBy: PRIYA.id,
    assertedAt,
    sourceSessionId: null,
    sourceRef: null,
    confidence: 0.9,
    humanConfirmed: true,
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
    supersedeReason: null,
    ...overrides,
  };
}

const newDecision = contextItem({
  id: NEW_DECISION_ID,
  kind: 'decision',
  title: 'Adopt Postgres row-level security for tenant isolation',
  assertedAt: new Date('2026-07-31T14:22:00.000Z'),
  confidence: 0.95,
  humanConfirmed: true,
  loadBearing: true,
  supersedesId: OLD_DECISION_ID,
});

const billingConstraint = contextItem({
  id: CONSTRAINT_ID,
  kind: 'constraint',
  title: 'Stripe is the billing provider',
  assertedBy: AGENT.id,
  assertedAt: new Date('2026-07-31T09:05:00.000Z'),
  confidence: 0.72,
  humanConfirmed: false,
});

const oldDecision = contextItem({
  id: OLD_DECISION_ID,
  kind: 'decision',
  title: 'Schema-per-tenant isolation',
  status: 'superseded',
  assertedAt: new Date('2026-07-28T16:40:00.000Z'),
  validTo: new Date('2026-07-31T14:22:00.000Z'),
  supersededById: NEW_DECISION_ID,
});

const page = (
  items: readonly ContextItem[],
  actors: readonly Actor[] = [PRIYA, AGENT],
): LogPage => ({
  projectId: PROJECT_ID,
  items,
  actors,
});

const TIMELINE = page([oldDecision, newDecision, billingConstraint]);

const chainRoot = contextItem({
  id: ROOT_DECISION_ID,
  kind: 'decision',
  title: 'Isolate tenants with one database per tenant',
  status: 'superseded',
  assertedAt: new Date('2026-07-20T09:15:00.000Z'),
  validTo: new Date('2026-07-28T16:40:00.000Z'),
  supersededById: OLD_DECISION_ID,
});

const chainMiddle = contextItem({
  id: OLD_DECISION_ID,
  kind: 'decision',
  title: 'Schema-per-tenant isolation',
  status: 'superseded',
  assertedAt: new Date('2026-07-28T16:40:00.000Z'),
  validTo: new Date('2026-07-31T14:22:00.000Z'),
  supersedesId: ROOT_DECISION_ID,
  supersededById: NEW_DECISION_ID,
  supersedeReason: 'a database per tenant exhausted the connection pool past 200 tenants',
});

const chainHead = contextItem({
  id: NEW_DECISION_ID,
  kind: 'decision',
  title: 'Adopt Postgres row-level security for tenant isolation',
  assertedAt: new Date('2026-07-31T14:22:00.000Z'),
  confidence: 0.95,
  loadBearing: true,
  supersedesId: OLD_DECISION_ID,
  supersedeReason: 'row-level security keeps one connection pool and one migration path',
});

const chainPage = (
  revisions: readonly ContextItem[],
  itemId: Uuid = NEW_DECISION_ID,
  actors: readonly Actor[] = [PRIYA, AGENT, DAN],
): LogChainPage => ({
  projectId: PROJECT_ID,
  itemId,
  revisions,
  actors,
  truncated: false,
});

const CHAIN = chainPage([chainRoot, chainMiddle, chainHead]);

interface RecordingApi extends LogApi {
  readonly requests: LogRequest[];
  readonly chainRequests: LogChainRequest[];
}

function recordingApi(result: LogPage, chainResult?: LogChainPage): RecordingApi {
  const requests: LogRequest[] = [];
  const chainRequests: LogChainRequest[] = [];
  return {
    requests,
    chainRequests,
    log: (request) => {
      requests.push(request);
      return Promise.resolve(result);
    },
    chain: (request) => {
      chainRequests.push(request);
      return chainResult === undefined
        ? Promise.reject(new Error('this test stubbed no chain'))
        : Promise.resolve(chainResult);
    },
  };
}

const chainApi = (result: LogChainPage): RecordingApi => recordingApi(TIMELINE, result);

const rejectingApi = (error: unknown): LogApi => ({
  log: () => Promise.reject(error),
  chain: () => Promise.reject(error),
});

const loadConfig = (): ProjectConfig => CONFIG;

interface RunOptions {
  readonly args?: readonly string[];
  readonly flags?: Readonly<Record<string, string | boolean>>;
  readonly json?: boolean;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
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
    env: options.env ?? {},
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
  throw new Error('expected mneia log to fail, but it succeeded');
}

const commandWith = (api: LogApi, now?: Date): CommandDefinition =>
  now === undefined
    ? createLogCommand({ api, loadConfig })
    : createLogCommand({ api, loadConfig, now: () => now });

describe('mneia log', () => {
  it('reads as a history: newest first, grouped by the day the decision was asserted', async () => {
    const result = await run(commandWith(recordingApi(TIMELINE)));

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('acme/checkout — decision history, newest first');
    expect(result.out).toContain('3 entries · limit 20 · times in UTC');
    expect(result.out).toContain('2026-07-31');
    expect(result.out).toContain('2026-07-28');

    const newest = result.out.indexOf('Adopt Postgres row-level security');
    const middle = result.out.indexOf('Stripe is the billing provider');
    const oldest = result.out.indexOf('Schema-per-tenant isolation  [');
    expect(newest).toBeGreaterThan(-1);
    expect(newest).toBeLessThan(middle);
    expect(middle).toBeLessThan(oldest);
  });

  it('shows who asserted each item and how confident it was', async () => {
    const result = await run(commandWith(recordingApi(TIMELINE)));

    expect(result.out).toContain(
      'by Priya Raman (human) · human-confirmed · load-bearing · confidence 0.95',
    );
    expect(result.out).toContain('by claude-code (agent) · confidence 0.72');
  });

  it('shows a superseded decision alongside what replaced it', async () => {
    const result = await run(commandWith(recordingApi(TIMELINE)));

    expect(result.out).toContain('Schema-per-tenant isolation  [9c2d0e5a]  — superseded');
    expect(result.out).toContain(
      'superseded by "Adopt Postgres row-level security for tenant isolation" [4f3a1b2c] on 2026-07-31',
    );
    expect(result.out).toContain('replaces "Schema-per-tenant isolation" [9c2d0e5a]');
  });

  it('names the replacement by id when it falls outside the returned page', async () => {
    const result = await run(commandWith(recordingApi(page([oldDecision]))));

    expect(result.out).toContain('superseded by an item outside this page [4f3a1b2c]');
  });

  it('surfaces valid_from when it differs from asserted_at', async () => {
    const scheduled = contextItem({
      id: CONSTRAINT_ID,
      title: 'Rate limiting goes live with the public API',
      assertedAt: new Date('2026-07-31T14:22:00.000Z'),
      validFrom: new Date('2026-08-15T00:00:00.000Z'),
    });

    const result = await run(commandWith(recordingApi(page([scheduled]))));

    expect(result.out).toContain('effective from 2026-08-15');
  });

  it('emits the timeline and its supersession links with --json', async () => {
    const result = await run(commandWith(recordingApi(TIMELINE)), { json: true });
    const payload: unknown = JSON.parse(result.out);

    expect(payload).toMatchObject({
      project: 'acme/checkout',
      projectId: PROJECT_ID,
      limit: DEFAULT_LOG_LIMIT,
      since: null,
      count: 3,
    });

    const entries = (payload as { entries: readonly Record<string, unknown>[] }).entries;
    expect(entries[0]).toMatchObject({
      id: NEW_DECISION_ID,
      kind: 'decision',
      status: 'active',
      loadBearing: true,
      assertedBy: { id: PRIYA.id, displayName: 'Priya Raman', kind: 'human' },
      supersedes: { id: OLD_DECISION_ID, title: 'Schema-per-tenant isolation' },
      supersededBy: null,
    });
    expect(entries[2]).toMatchObject({
      id: OLD_DECISION_ID,
      status: 'superseded',
      validTo: '2026-07-31T14:22:00.000Z',
      supersededBy: {
        id: NEW_DECISION_ID,
        title: 'Adopt Postgres row-level security for tenant isolation',
      },
    });
  });

  it('defaults to the newest 20 entries with no since window', async () => {
    const api = recordingApi(TIMELINE);
    await run(commandWith(api));

    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.limit).toBe(DEFAULT_LOG_LIMIT);
    expect(api.requests[0]?.since).toBeNull();
    expect(api.requests[0]?.config).toBe(CONFIG);
  });

  it('passes --limit and a relative --since through to the API', async () => {
    const api = recordingApi(TIMELINE);
    await run(commandWith(api, new Date('2026-08-01T00:00:00.000Z')), {
      flags: { limit: '5', since: '7d' },
    });

    expect(api.requests[0]?.limit).toBe(5);
    expect(api.requests[0]?.since?.toISOString()).toBe('2026-07-25T00:00:00.000Z');
  });

  it('accepts hours, weeks, and an absolute date for --since', async () => {
    const now = new Date('2026-08-01T00:00:00.000Z');

    const hours = recordingApi(TIMELINE);
    await run(commandWith(hours, now), { flags: { since: '24h' } });
    expect(hours.requests[0]?.since?.toISOString()).toBe('2026-07-31T00:00:00.000Z');

    const weeks = recordingApi(TIMELINE);
    await run(commandWith(weeks, now), { flags: { since: '2w' } });
    expect(weeks.requests[0]?.since?.toISOString()).toBe('2026-07-18T00:00:00.000Z');

    const absolute = recordingApi(TIMELINE);
    await run(commandWith(absolute, now), { flags: { since: '2026-07-01' } });
    expect(absolute.requests[0]?.since?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('rejects a --limit that is not a positive whole number', async () => {
    const command = commandWith(recordingApi(TIMELINE));

    for (const limit of ['0', '-3', 'ten', '2.5', '']) {
      const error = await failure(command, { flags: { limit } });
      expect(error.kind).toBe('usage');
      expect(error.exitCode).toBe(EXIT_USAGE);
    }

    const missingValue = await failure(command, { flags: { limit: true } });
    expect(missingValue.message).toContain('--limit needs a number of entries');
  });

  it('caps --limit rather than silently asking the API for everything', async () => {
    const error = await failure(commandWith(recordingApi(TIMELINE)), { flags: { limit: '5000' } });

    expect(error.exitCode).toBe(EXIT_USAGE);
    expect(error.message).toContain('capped at 500');
  });

  it('names the accepted forms when --since cannot be understood', async () => {
    const error = await failure(commandWith(recordingApi(TIMELINE)), {
      flags: { since: 'yesterday' },
    });

    expect(error.kind).toBe('usage');
    expect(error.message).toContain('30m, 24h, 7d, 2w');
    expect(error.message).toContain('2026-07-01');
    expect(error.fix).toContain('mneia log');
  });

  it('rejects positional arguments and points at --limit', async () => {
    const error = await failure(commandWith(recordingApi(TIMELINE)), { args: ['5'] });

    expect(error.exitCode).toBe(EXIT_USAGE);
    expect(error.message).toContain('--limit 5');
  });

  it('points an unbound machine at login and init, not at a repo-only script', async () => {
    const command = createLogCommand({
      api: recordingApi(TIMELINE),
      loadConfig: (cwd, env) => requireProjectConfig(cwd, env),
    });

    const home = await mkdtemp(join(tmpdir(), 'mneia-log-home-'));
    const error = await failure(command, {
      cwd: await mkdtemp(join(tmpdir(), 'mneia-log-repo-')),
      env: { MNEIA_HOME: home },
    });

    expect(error.kind).toBe('not_configured');
    expect(error.exitCode).toBe(EXIT_NOT_CONFIGURED);
    expect(error.fix).toContain('mneia login');
    expect(error.fix).toContain('mneia init');
    expect(error.fix).not.toContain('pnpm');
  });

  it('does not tell a developer whose wifi dropped that their token is invalid', async () => {
    const unreachable = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), {
        code: 'ECONNREFUSED',
      }),
    });

    const network = await failure(commandWith(rejectingApi(unreachable)));

    expect(network.kind).toBe('network');
    expect(network.exitCode).toBe(EXIT_NETWORK);
    expect(network.message).toContain('https://api.mneia.dev');
    expect(network.message).toContain('could not be reached');
    expect(network.fix).toContain('your token is fine');
  });

  it('separates an unreachable API, a rejected token, and a real failure by exit code', async () => {
    const unreachable = await failure(
      commandWith(rejectingApi(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }))),
    );
    const rejectedToken = await failure(
      commandWith(
        rejectingApi(
          new CliError('auth', 'the Mneia API rejected this token', 'run mneia login again'),
        ),
      ),
    );
    const broken = await failure(commandWith(rejectingApi(new Error('500 Internal Server Error'))));

    expect(unreachable.exitCode).toBe(EXIT_NETWORK);
    expect(rejectedToken.exitCode).toBe(EXIT_AUTH);
    expect(broken.exitCode).toBe(EXIT_FAILED);
    expect(new Set([unreachable.exitCode, rejectedToken.exitCode, broken.exitCode]).size).toBe(3);
  });

  it('treats an empty project as a state to explain, not a failure', async () => {
    const result = await run(commandWith(recordingApi(page([], []))));

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('No decisions recorded for acme/checkout yet.');
    expect(result.out).toContain('Run mneia checkpoint after your next task');
  });

  it('explains an empty window separately from an empty project', async () => {
    const result = await run(
      commandWith(recordingApi(page([], [])), new Date('2026-08-01T00:00:00.000Z')),
      {
        flags: { since: '7d' },
      },
    );

    expect(result.out).toContain('since 2026-07-25T00:00:00.000Z');
    expect(result.out).toContain('Widen the window with --since');
  });

  it('emits an empty timeline as valid JSON', async () => {
    const result = await run(commandWith(recordingApi(page([], []))), { json: true });
    const payload: unknown = JSON.parse(result.out);

    expect(payload).toMatchObject({ count: 0, entries: [] });
  });
});

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

describe('mneia log --chain', () => {
  it('reconstructs the whole chain oldest first, with the rationale for each replacement', async () => {
    const result = await run(commandWith(chainApi(CHAIN)), { flags: { chain: '4f3a1b2c' } });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain(
      'acme/checkout — supersede chain for "Adopt Postgres row-level security for tenant isolation"',
    );
    expect(result.out).toContain('3 revisions · oldest first · times in UTC');

    const root = result.out.indexOf('Isolate tenants with one database per tenant');
    const middle = result.out.indexOf('Schema-per-tenant isolation');
    const head = result.out.indexOf('Adopt Postgres row-level security for tenant isolation  [');
    expect(root).toBeGreaterThan(-1);
    expect(root).toBeLessThan(middle);
    expect(middle).toBeLessThan(head);

    expect(result.out).toContain('first recorded revision — it replaced nothing');
    expect(result.out).toContain(
      'because: a database per tenant exhausted the connection pool past 200 tenants',
    );
    expect(result.out).toContain(
      'because: row-level security keeps one connection pool and one migration path',
    );
  });

  it('dates each replacement and names what replaced it', async () => {
    const result = await run(commandWith(chainApi(CHAIN)), { flags: { chain: '4f3a1b2c' } });

    expect(result.out).toContain('2026-07-20 09:15');
    expect(result.out).toContain('superseded on 2026-07-28 by "Schema-per-tenant isolation"');
    expect(result.out).toContain(
      'superseded on 2026-07-31 by "Adopt Postgres row-level security for tenant isolation"',
    );
  });

  it('carries provenance on every revision, not just the newest', async () => {
    const agentRoot = contextItem({
      ...chainRoot,
      assertedBy: AGENT.id,
      humanConfirmed: false,
      confidence: 0.72,
    });
    const result = await run(
      commandWith(chainApi(chainPage([agentRoot, chainMiddle, chainHead]))),
      { flags: { chain: '4f3a1b2c' } },
    );

    expect(occurrences(result.out, 'by claude-code (agent)')).toBe(1);
    expect(occurrences(result.out, 'by Priya Raman (human)')).toBe(2);
    expect(occurrences(result.out, 'human-confirmed')).toBe(2);
    expect(occurrences(result.out, 'confidence ')).toBe(3);
    expect(result.out).not.toContain('flagged:');
  });

  it('says so plainly when a replacement recorded no rationale', async () => {
    const silent = contextItem({ ...chainHead, supersedeReason: null });
    const result = await run(commandWith(chainApi(chainPage([chainMiddle, silent]))), {
      flags: { chain: '4f3a1b2c' },
    });

    expect(result.out).toContain('no rationale recorded for this replacement');
  });

  it('calls the newest revision in force only when nothing in the chain is unsettled', async () => {
    const result = await run(commandWith(chainApi(CHAIN)), { flags: { chain: '4f3a1b2c' } });

    expect(result.out).toContain('— in force');
    expect(occurrences(result.out, '— superseded')).toBe(2);
  });

  it('never implies a winner when the chain holds a human-versus-human dispute', async () => {
    const priyaSide = contextItem({ ...chainMiddle, status: 'disputed' });
    const danSide = contextItem({
      ...chainHead,
      status: 'disputed',
      assertedBy: DAN.id,
      humanConfirmed: true,
    });

    const result = await run(commandWith(chainApi(chainPage([priyaSide, danSide]))), {
      flags: { chain: '4f3a1b2c' },
    });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).not.toContain('in force');
    expect(occurrences(result.out, '— disputed')).toBe(2);
    expect(result.out).toContain('by Priya Raman (human)');
    expect(result.out).toContain('by Dan Okafor (human)');
    expect(result.out).toContain('Mneia does not choose between them');
    expect(result.out).toContain('§10.4');
  });

  it('reports the dispute in JSON too, with no revision marked in force', async () => {
    const disputedHead = contextItem({ ...chainHead, status: 'disputed', assertedBy: DAN.id });
    const result = await run(commandWith(chainApi(chainPage([chainMiddle, disputedHead]))), {
      json: true,
      flags: { chain: '4f3a1b2c' },
    });
    const payload: unknown = JSON.parse(result.out);

    expect(payload).toMatchObject({ settled: false, count: 2 });
    const revisions = (payload as { revisions: readonly Record<string, unknown>[] }).revisions;
    expect(revisions.every((revision) => revision.inForce === false)).toBe(true);
  });

  it('flags a replacement that overruled a human-confirmed decision without human confirmation', async () => {
    const agentHead = contextItem({
      ...chainHead,
      assertedBy: AGENT.id,
      humanConfirmed: false,
      confidence: 0.61,
    });

    const result = await run(commandWith(chainApi(chainPage([chainMiddle, agentHead]))), {
      flags: { chain: '4f3a1b2c' },
    });

    expect(result.out).toContain('by claude-code (agent)');
    expect(result.out).toContain(
      'flagged: this replaced a human-confirmed decision without human confirmation',
    );
    expect(result.out).toContain('§10.1');
    expect(result.out).not.toContain('in force');
  });

  it('leaves an ordinary agent revision unflagged', async () => {
    const agentRoot = contextItem({
      ...chainMiddle,
      assertedBy: AGENT.id,
      humanConfirmed: false,
      supersedesId: null,
      supersedeReason: null,
    });
    const agentHead = contextItem({
      ...chainHead,
      assertedBy: AGENT.id,
      humanConfirmed: false,
    });

    const result = await run(commandWith(chainApi(chainPage([agentRoot, agentHead]))), {
      flags: { chain: '4f3a1b2c' },
    });

    expect(result.out).not.toContain('flagged:');
    expect(result.out).toContain('— in force');
  });

  it('marks which revision the caller asked for', async () => {
    const result = await run(
      commandWith(chainApi(chainPage([chainRoot, chainMiddle, chainHead], OLD_DECISION_ID))),
      {
        flags: { chain: '9c2d0e5a' },
      },
    );

    expect(occurrences(result.out, 'this is the revision you asked for')).toBe(1);
    expect(result.out).toContain('supersede chain for "Schema-per-tenant isolation"');
  });

  it('says a decision has never been superseded rather than pretending it has history', async () => {
    const alone = contextItem({ ...chainHead, supersedesId: null, supersedeReason: null });
    const result = await run(commandWith(chainApi(chainPage([alone]))), {
      flags: { chain: '4f3a1b2c' },
    });

    expect(result.out).toContain('1 revision · oldest first');
    expect(result.out).toContain('This decision has never been superseded.');
    expect(result.out).not.toContain('this is the revision you asked for');
  });

  it('emits the chain, its rationale, and its provenance as JSON', async () => {
    const result = await run(commandWith(chainApi(CHAIN)), {
      json: true,
      flags: { chain: '4f3a1b2c' },
    });
    const payload: unknown = JSON.parse(result.out);

    expect(payload).toMatchObject({
      project: 'acme/checkout',
      projectId: PROJECT_ID,
      chain: '4f3a1b2c',
      itemId: NEW_DECISION_ID,
      count: 3,
      truncated: false,
      settled: true,
    });

    const revisions = (payload as { revisions: readonly Record<string, unknown>[] }).revisions;
    expect(revisions[0]).toMatchObject({
      id: ROOT_DECISION_ID,
      supersedeReason: null,
      inForce: false,
      agentOverHumanConfirmed: false,
      assertedBy: { id: PRIYA.id, displayName: 'Priya Raman', kind: 'human' },
    });
    expect(revisions[2]).toMatchObject({
      id: NEW_DECISION_ID,
      supersedeReason: 'row-level security keeps one connection pool and one migration path',
      inForce: true,
      humanConfirmed: true,
      loadBearing: true,
    });
  });

  it('stops at a cycle instead of walking a corrupted chain forever', async () => {
    const left = contextItem({
      id: OLD_DECISION_ID,
      title: 'Left',
      supersedesId: NEW_DECISION_ID,
      supersededById: NEW_DECISION_ID,
    });
    const right = contextItem({
      id: NEW_DECISION_ID,
      title: 'Right',
      supersedesId: OLD_DECISION_ID,
      supersededById: OLD_DECISION_ID,
    });

    const result = await run(commandWith(chainApi(chainPage([left, right]))), {
      flags: { chain: '4f3a1b2c' },
    });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('2 revisions');
  });

  it('passes the reference through trimmed and lowercased', async () => {
    const api = chainApi(CHAIN);
    await run(commandWith(api), { flags: { chain: '  4F3A1B2C  ' } });

    expect(api.chainRequests).toHaveLength(1);
    expect(api.chainRequests[0]?.reference).toBe('4f3a1b2c');
    expect(api.chainRequests[0]?.config).toBe(CONFIG);
    expect(api.requests).toHaveLength(0);
  });

  it('accepts a full uuid as well as the short id mneia log prints', async () => {
    const api = chainApi(CHAIN);
    await run(commandWith(api), { flags: { chain: NEW_DECISION_ID } });

    expect(api.chainRequests[0]?.reference).toBe(NEW_DECISION_ID);
  });

  it('rejects a --chain that cannot be an item id', async () => {
    const command = commandWith(chainApi(CHAIN));

    const missingValue = await failure(command, { flags: { chain: true } });
    expect(missingValue.kind).toBe('usage');
    expect(missingValue.message).toContain('--chain needs the id of a decision');

    for (const chain of ['ab', '---', 'not-an-id', '']) {
      const error = await failure(command, { flags: { chain } });
      expect(error.exitCode).toBe(EXIT_USAGE);
      expect(error.message).toContain('at least 4 characters');
    }
  });

  it('refuses to narrow a single decision history with --limit or --since', async () => {
    const command = commandWith(chainApi(CHAIN));

    const withSince = await failure(command, { flags: { chain: '4f3a1b2c', since: '7d' } });
    expect(withSince.exitCode).toBe(EXIT_USAGE);
    expect(withSince.message).toContain('--since');

    const withLimit = await failure(command, { flags: { chain: '4f3a1b2c', limit: '5' } });
    expect(withLimit.message).toContain('--limit');
  });

  it('lets the API decide an unknown id, and keeps its exit code', async () => {
    const unknown = await failure(
      commandWith(
        rejectingApi(
          new CliError(
            'usage',
            'mneia log --chain found no item matching abcdef12 in this project',
            'run mneia log to see the ids it prints in [brackets], then pass one of those',
          ),
        ),
      ),
      { flags: { chain: 'abcdef12' } },
    );

    expect(unknown.exitCode).toBe(EXIT_USAGE);
    expect(unknown.fix).toContain('mneia log');
  });

  it('does not tell a developer whose wifi dropped that their token is invalid', async () => {
    const unreachable = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), {
        code: 'ECONNREFUSED',
      }),
    });

    const network = await failure(commandWith(rejectingApi(unreachable)), {
      flags: { chain: '4f3a1b2c' },
    });

    expect(network.exitCode).toBe(EXIT_NETWORK);
    expect(network.fix).toContain('your token is fine');
  });

  it('fails loudly if the API returns revisions without the item it resolved', async () => {
    const error = await failure(commandWith(chainApi(chainPage([chainRoot], NEW_DECISION_ID))), {
      flags: { chain: '4f3a1b2c' },
    });

    expect(error.exitCode).toBe(EXIT_FAILED);
    expect(error.message).toContain(NEW_DECISION_ID);
  });
});

describe('matchItemIds', () => {
  const candidates: readonly Uuid[] = [NEW_DECISION_ID, OLD_DECISION_ID, ROOT_DECISION_ID];

  it('matches the short id mneia log prints in brackets', () => {
    expect(matchItemIds(candidates, '4f3a1b2c')).toEqual([NEW_DECISION_ID]);
  });

  it('matches a full uuid exactly, hyphens and all', () => {
    expect(matchItemIds(candidates, NEW_DECISION_ID)).toEqual([NEW_DECISION_ID]);
  });

  it('ignores hyphens and case in the reference', () => {
    expect(matchItemIds(candidates, '4F3A-1B2C')).toEqual([NEW_DECISION_ID]);
  });

  it('returns every candidate an ambiguous prefix could mean', () => {
    const ambiguous = matchItemIds([NEW_DECISION_ID, OLD_DECISION_ID], '');
    expect(ambiguous).toHaveLength(2);
  });

  it('returns nothing when no id starts with the reference', () => {
    expect(matchItemIds(candidates, 'deadbeef')).toEqual([]);
  });

  it('prefers an exact id over a prefix of a longer one', () => {
    const short = '4f3a1b2c';
    expect(matchItemIds([short, NEW_DECISION_ID], short)).toEqual([short]);
  });
});
