import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActorKind, ContextItem, ContextItemProvenance, Uuid } from '@mneia/core';
import { deriveContextItemProvenance } from '@mneia/core';
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
import type { UsageSnapshot } from '../usage.js';
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
const PRIYA_ID = '44444444-4444-4444-8444-444444444444';
const DEVI_ID = '55555555-5555-4555-8555-555555555555';
const EXTRACTOR_ID = '66666666-6666-4666-8666-666666666666';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-08-01T00:00:00.000Z');

const CONFIG: ProjectConfig = {
  workspace: 'acme',
  project: 'checkout',
  endpoint: 'https://api.mneia.dev',
  configPath: '/repo/.mneia/config.json',
  repoRoot: '/repo',
};

function provenanceOf(
  actorId: Uuid,
  actorKind: ActorKind,
  actorDisplayName: string,
): ContextItemProvenance {
  return deriveContextItemProvenance({
    actorId,
    actorKind,
    actorDisplayName,
    sourceSessionId: null,
    sessionTool: null,
    clientName: null,
    clientVersion: null,
    clientSessionRef: null,
    clientSessionName: null,
    clientSessionUrl: null,
  });
}

const PRIYA = provenanceOf(PRIYA_ID, 'human', 'Priya Raman');
const DEVI = provenanceOf(DEVI_ID, 'human', 'Devi Okonkwo');
const EXTRACTOR = provenanceOf(EXTRACTOR_ID, 'agent', 'Claude Code');

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
    supersedeReason: null,
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
  assertedBy: EXTRACTOR_ID,
  provenance: EXTRACTOR,
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
  humanConfirmed: true,
  assertedBy: PRIYA_ID,
  provenance: PRIYA,
});

const oldQuestion = contextItem({
  id: 'dd44ee55-0000-4000-8000-000000000004',
  kind: 'open_question',
  title: 'Do we support SSO at launch?',
  assertedAt: new Date('2026-07-20T00:00:00.000Z'),
  assertedBy: EXTRACTOR_ID,
  provenance: EXTRACTOR,
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
  assertedBy: PRIYA_ID,
  provenance: PRIYA,
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

const disputedLongStanding = contextItem({
  id: 'ba11cd22-0000-4000-8000-000000000008',
  kind: 'fact',
  title: 'The EU workspace runs in Frankfurt',
  status: 'disputed',
  assertedAt: new Date('2026-05-01T00:00:00.000Z'),
  humanConfirmed: true,
  assertedBy: DEVI_ID,
  provenance: DEVI,
});

const disputedRecent = contextItem({
  id: 'ca22de33-0000-4000-8000-000000000009',
  kind: 'fact',
  title: 'Checkout retries three times',
  status: 'disputed',
  assertedAt: new Date('2026-07-28T00:00:00.000Z'),
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
    // Null is what an older deployment produces: no meter, and no complaint about it either.
    usage: () => Promise.resolve(null),
  };
}

const rejectingApi = (error: unknown): StatusApi => ({
  status: () => Promise.reject(error),
  usage: () => Promise.resolve(null),
});

const usageSnapshot = (overrides: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  plan: 'team',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-09-01T00:00:00.000Z',
  turns: { used: 380, allowance: 1000, fraction: 0.38 },
  extractions: { used: 12, allowance: 100, fraction: 0.12 },
  checkpoints: 142,
  percentUsed: 38,
  warn: false,
  ...overrides,
});

const meteredApi = (usage: UsageSnapshot | null): StatusApi => ({
  status: () => Promise.resolve(report(PROJECT_ITEMS)),
  usage: () => Promise.resolve(usage),
});

const meterFailingApi = (error: unknown): StatusApi => ({
  status: () => Promise.resolve(report(PROJECT_ITEMS)),
  usage: () => Promise.reject(error),
});

const unreachable = (): TypeError =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  });

const usageLine = (out: string): string =>
  out.split('\n').find((line) => line.trimStart().startsWith('Usage')) ?? '';

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
      loadConfig: (cwd, env) => requireProjectConfig(cwd, env),
      now: () => NOW,
    });

    const home = await mkdtemp(join(tmpdir(), 'mneia-status-home-'));
    const error = await failure(command, {
      cwd: await mkdtemp(join(tmpdir(), 'mneia-status-repo-')),
      env: { MNEIA_HOME: home },
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

  it('reports how long each disputed item has stood unresolved', async () => {
    const result = await run(commandWith(recordingApi(report(PROJECT_ITEMS))));

    expect(result.out).toContain('unresolved · 12 days old · asserted 2026-07-20');
    expect(classifyStatus(PROJECT_ITEMS, NOW).disputed[0]?.ageMs).toBe(12 * DAY_MS);
  });

  it('puts a load-bearing dispute first, then the longest-standing', () => {
    const sections = classifyStatus([disputedRecent, disputedLongStanding, disputedBilling], NOW);

    expect(sections.disputed.map((entry) => entry.item.id)).toEqual([
      disputedBilling.id,
      disputedLongStanding.id,
      disputedRecent.id,
    ]);
    expect(sections.disputed.map((entry) => entry.ageMs)).toEqual([
      12 * DAY_MS,
      92 * DAY_MS,
      4 * DAY_MS,
    ]);
  });

  it('never renders a dispute between humans as resolved', async () => {
    const result = await run(
      commandWith(recordingApi(report([disputedLongStanding, disputedBilling]))),
    );

    expect(result.out).toContain('disputed (2) — conflicting assertions; a human decides');
    expect(result.out).toContain('by Devi Okonkwo (human) · unresolved');
    expect(result.out).toContain('by Priya Raman (human) · unresolved');
    expect(result.out).toContain('human-confirmed');
    expect(result.out).not.toMatch(/\bresolved\b/);
    expect(result.out).not.toMatch(/auto-resolv/i);
    expect(result.out).not.toContain('is clean');
    expect(result.out).not.toMatch(/\bwins\b|supersed|overrul/i);
  });

  it('names who asserted every item it renders, and whether a human confirmed it', async () => {
    const result = await run(commandWith(recordingApi(report(PROJECT_ITEMS))));

    expect(result.out).toContain('by Priya Raman (human) · asserted 2026-07-20, never re-verified');
    expect(result.out).toContain('by Claude Code (agent) · last verified 2026-06-01');
    expect(result.out).toContain('by Priya Raman (human) · unresolved');
    expect(result.out).toContain('by Claude Code (agent) · open 12 days');

    const rendered = result.out.split('\n').filter((line) => line.startsWith('    by '));

    expect(rendered).toHaveLength(
      classifyStatus(PROJECT_ITEMS, NOW).stale.length +
        classifyStatus(PROJECT_ITEMS, NOW).disputed.length +
        classifyStatus(PROJECT_ITEMS, NOW).unanswered.length,
    );
    expect(result.out).toContain('The p95 rehydrate budget is 300ms  [ff66aa77]');
    expect(result.out).toContain('load-bearing · human-confirmed');
  });

  it('falls back to the asserting actor id when the API returns no provenance', async () => {
    const orphaned = contextItem({
      id: 'fa77bc88-0000-4000-8000-000000000011',
      kind: 'open_question',
      title: 'Who owns the retention policy?',
      assertedAt: new Date('2026-07-25T00:00:00.000Z'),
      assertedBy: '99999999-9999-4999-8999-999999999999',
    });

    const result = await run(commandWith(recordingApi(report([orphaned]))));

    expect(result.out).toContain('by an unnamed actor (kind unknown, 99999999) · open 7 days');
    expect(result.out).not.toContain('undefined');
  });

  it('carries assertedBy in --json for every section', async () => {
    const result = await run(commandWith(recordingApi(report(PROJECT_ITEMS))), { json: true });
    const payload = JSON.parse(result.out) as {
      stale: readonly Record<string, unknown>[];
      disputed: readonly Record<string, unknown>[];
      unanswered: readonly Record<string, unknown>[];
    };

    expect(payload.stale[0]).toMatchObject({
      assertedBy: { id: PRIYA_ID, displayName: 'Priya Raman', kind: 'human' },
    });
    expect(payload.stale[1]).toMatchObject({
      assertedBy: { id: EXTRACTOR_ID, displayName: 'Claude Code', kind: 'agent' },
    });
    expect(payload.disputed[0]).toMatchObject({
      assertedBy: { id: PRIYA_ID, kind: 'human' },
      humanConfirmed: true,
    });
    expect(payload.unanswered[0]).toMatchObject({
      assertedBy: { id: EXTRACTOR_ID, kind: 'agent' },
    });

    const withoutProvenance = await run(
      commandWith(
        recordingApi(report([contextItem({ status: 'disputed', assertedBy: ACTOR_ID })])),
      ),
      { json: true },
    );

    expect(
      (JSON.parse(withoutProvenance.out) as { disputed: readonly Record<string, unknown>[] })
        .disputed[0],
    ).toMatchObject({ assertedBy: { id: ACTOR_ID, displayName: null, kind: null } });
  });

  it('counts a disputed open question as disputed, not as unanswered', () => {
    const contested = contextItem({
      id: 'da33ef44-0000-4000-8000-000000000010',
      kind: 'open_question',
      title: 'Do we ship SSO at launch?',
      status: 'disputed',
      assertedAt: new Date('2026-07-11T00:00:00.000Z'),
    });

    const sections = classifyStatus([contested], NOW);

    expect(sections.disputed.map((entry) => entry.item.id)).toEqual([contested.id]);
    expect(sections.disputed[0]?.ageMs).toBe(21 * DAY_MS);
    expect(sections.unanswered).toHaveLength(0);
  });

  it('carries an age for every disputed item in --json', async () => {
    const result = await run(
      commandWith(recordingApi(report([...PROJECT_ITEMS, disputedLongStanding]))),
      { json: true },
    );
    const payload = JSON.parse(result.out) as {
      counts: Record<string, number>;
      disputed: readonly Record<string, unknown>[];
    };

    expect(payload.counts.disputed).toBe(2);
    expect(payload.disputed[0]).toMatchObject({
      id: disputedBilling.id,
      status: 'disputed',
      loadBearing: true,
      ageMs: 12 * DAY_MS,
    });
    expect(payload.disputed[1]).toMatchObject({
      id: disputedLongStanding.id,
      humanConfirmed: true,
      ageMs: 92 * DAY_MS,
    });
  });
});

describe('the mneia status usage meter', () => {
  it('renders the allowance, the checkpoint count, and the reset date on one labelled row', async () => {
    const result = await run(commandWith(meteredApi(usageSnapshot())));

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain(
      "  Usage      38% of this month's allowance · 142 checkpoints · resets 2026-09-01",
    );
    // Directly under the headline, in the same block as the counts it qualifies.
    expect(result.out.split('\n')[1]).toBe(usageLine(result.out));
  });

  it('says there is no cap rather than printing null% on an uncapped plan', async () => {
    const uncapped = usageSnapshot({
      plan: 'enterprise',
      turns: { used: 91_000, allowance: null, fraction: null },
      extractions: { used: 640, allowance: null, fraction: null },
      percentUsed: null,
    });

    const result = await run(commandWith(meteredApi(uncapped)));

    expect(usageLine(result.out)).toBe(
      '  Usage      no allowance cap on the enterprise plan · 142 checkpoints · resets 2026-09-01',
    );
    expect(result.out).not.toContain('null');
    expect(result.out).not.toContain('NaN');
  });

  it('reads sensibly for a workspace that has never checkpointed', async () => {
    const fresh = usageSnapshot({
      plan: 'solo',
      turns: { used: 0, allowance: 1000, fraction: 0 },
      extractions: { used: 0, allowance: 100, fraction: 0 },
      checkpoints: 0,
      percentUsed: 0,
    });

    const result = await run(commandWith(meteredApi(fresh)));

    expect(usageLine(result.out)).toBe(
      "  Usage      0% of this month's allowance · no checkpoints yet · resets 2026-09-01",
    );
  });

  it('warns in words at the threshold, and names the dial that is binding', async () => {
    const warning = usageSnapshot({
      turns: { used: 800, allowance: 1000, fraction: 0.8 },
      percentUsed: 80,
      warn: true,
    });

    const result = await run(commandWith(meteredApi(warning)));

    expect(usageLine(result.out)).toBe(
      "  Usage      warning: 80% of this month's allowance (turns) · 142 checkpoints · resets 2026-09-01",
    );
    // Carried by the text, not by colour: nothing here needs a terminal that renders escapes.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the absence of ANSI escapes
    expect(result.out).not.toMatch(/\u001b\[/);
  });

  it('does not warn below the threshold, and warns anyway if the server forgets to', async () => {
    const under = await run(
      commandWith(
        meteredApi(
          usageSnapshot({
            turns: { used: 790, allowance: 1000, fraction: 0.79 },
            percentUsed: 79,
            warn: false,
          }),
        ),
      ),
    );
    const forgotten = await run(
      commandWith(
        meteredApi(
          usageSnapshot({
            turns: { used: 850, allowance: 1000, fraction: 0.85 },
            percentUsed: 85,
            warn: false,
          }),
        ),
      ),
    );

    expect(usageLine(under.out)).not.toContain('warning:');
    expect(usageLine(forgotten.out)).toContain('warning:');
  });

  it('says a workspace is over its allowance rather than parking it on 100%', async () => {
    const over = usageSnapshot({
      turns: { used: 1240, allowance: 1000, fraction: 1.24 },
      percentUsed: 100,
      warn: true,
    });

    const result = await run(commandWith(meteredApi(over)));

    expect(usageLine(result.out)).toBe(
      "  Usage      warning: over this month's allowance (1240 of 1000 turns) · 142 checkpoints · resets 2026-09-01",
    );
    expect(result.out).not.toContain("100% of this month's allowance");
  });

  it('prints no meter at all when the server is older than the usage route', async () => {
    const result = await run(commandWith(meteredApi(null)));

    expect(result.code).toBe(EXIT_OK);
    expect(usageLine(result.out)).toBe('');
    expect(result.out).toContain('acme/checkout — 2 stale · 1 disputed · 2 unanswered');
    expect(result.out).toContain('stale (2) — past their decay window');
  });

  it('still reports everything else when the usage route cannot be reached', async () => {
    const result = await run(commandWith(meterFailingApi(unreachable())));

    expect(result.code).toBe(EXIT_OK);
    expect(usageLine(result.out)).toContain('unavailable - the Mneia API at https://api.mneia.dev');
    expect(usageLine(result.out)).toContain('ECONNREFUSED');
    expect(result.out).toContain('your token is fine');
    expect(result.out).toContain('stale (2) — past their decay window');
    expect(result.out).toContain('The p95 rehydrate budget is 300ms');
  });

  it('does not fail the command when the usage route rejects the token', async () => {
    const result = await run(
      commandWith(
        meterFailingApi(
          new CliError('auth', 'the Mneia API rejected these credentials', 'run mneia login again'),
        ),
      ),
    );

    expect(result.code).toBe(EXIT_OK);
    expect(usageLine(result.out)).toContain(
      'unavailable - the Mneia API rejected these credentials',
    );
    expect(result.out).toContain('run mneia login again');
  });

  it('carries the raw dials, the percentage, and the binding dial in --json', async () => {
    const result = await run(commandWith(meteredApi(usageSnapshot())), { json: true });
    const payload = JSON.parse(result.out) as { usage: Record<string, unknown> };

    expect(payload.usage).toMatchObject({
      state: 'ready',
      plan: 'team',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      percentUsed: 38,
      warn: false,
      warnAtPercent: 80,
      overAllowance: false,
      binding: 'turns',
      checkpoints: 142,
      dials: {
        turns: { used: 380, allowance: 1000, fraction: 0.38 },
        extractions: { used: 12, allowance: 100, fraction: 0.12 },
      },
    });
    // Recorded so cost is computable, never rendered to a customer - and --json is a customer
    // surface.
    expect(Object.keys(payload.usage.dials as object)).toEqual(['turns', 'extractions']);
  });

  it('names extractions as the binding dial when extractions are the fuller one', async () => {
    const result = await run(
      commandWith(
        meteredApi(
          usageSnapshot({
            turns: { used: 100, allowance: 1000, fraction: 0.1 },
            extractions: { used: 91, allowance: 100, fraction: 0.91 },
            percentUsed: 91,
            warn: true,
          }),
        ),
      ),
      { json: true },
    );

    expect((JSON.parse(result.out) as { usage: Record<string, unknown> }).usage).toMatchObject({
      binding: 'extractions',
      warn: true,
    });
  });

  it('stays parseable in --json when the meter is unavailable or unsupported', async () => {
    const failed = await run(commandWith(meterFailingApi(unreachable())), { json: true });
    const older = await run(commandWith(meteredApi(null)), { json: true });

    expect(failed.code).toBe(EXIT_OK);
    expect(failed.err).toBe('');
    const failedPayload = JSON.parse(failed.out) as {
      usage: Record<string, unknown>;
      counts: Record<string, number>;
    };
    expect(failedPayload.usage.state).toBe('unavailable');
    expect(failedPayload.usage.reason).toContain('could not be reached (ECONNREFUSED)');
    expect(failedPayload.usage.fix).toContain('mneia status');
    expect(failedPayload.counts).toMatchObject({ stale: 2, disputed: 1, unanswered: 2 });

    expect(JSON.parse(older.out)).toMatchObject({ usage: { state: 'unsupported' } });
  });

  it('reports over-allowance in --json without waiting for a human to read the sentence', async () => {
    const result = await run(
      commandWith(
        meteredApi(
          usageSnapshot({
            turns: { used: 1240, allowance: 1000, fraction: 1.24 },
            percentUsed: 100,
            warn: true,
          }),
        ),
      ),
      { json: true },
    );

    expect((JSON.parse(result.out) as { usage: Record<string, unknown> }).usage).toMatchObject({
      overAllowance: true,
      percentUsed: 100,
      binding: 'turns',
    });
  });

  it('reports usage as null-shaped on an uncapped plan rather than inventing a percentage', async () => {
    const result = await run(
      commandWith(
        meteredApi(
          usageSnapshot({
            plan: 'enterprise',
            turns: { used: 91_000, allowance: null, fraction: null },
            extractions: { used: 640, allowance: null, fraction: null },
            percentUsed: null,
          }),
        ),
      ),
      { json: true },
    );

    expect((JSON.parse(result.out) as { usage: Record<string, unknown> }).usage).toMatchObject({
      percentUsed: null,
      binding: null,
      warn: false,
      overAllowance: false,
    });
  });

  it('shows the meter on a clean project and on an empty one', async () => {
    const clean: StatusApi = {
      status: () => Promise.resolve(report([evergreenRuling])),
      usage: () => Promise.resolve(usageSnapshot()),
    };
    const empty: StatusApi = {
      status: () => Promise.resolve(report([])),
      usage: () => Promise.resolve(usageSnapshot({ checkpoints: 0, percentUsed: 0 })),
    };

    const cleanResult = await run(commandWith(clean));
    const emptyResult = await run(commandWith(empty));

    expect(cleanResult.out).toBe(
      [
        'acme/checkout is clean — nothing stale, disputed, or unanswered across 1 item.',
        "  Usage      38% of this month's allowance · 142 checkpoints · resets 2026-09-01",
        '',
      ].join('\n'),
    );
    expect(emptyResult.out).toBe(
      [
        'No context recorded for acme/checkout yet, so there is nothing to review.',
        "  Usage      0% of this month's allowance · no checkpoints yet · resets 2026-09-01",
        '',
        'Run mneia checkpoint after your next task to start the record.',
        '',
      ].join('\n'),
    );
  });
});
