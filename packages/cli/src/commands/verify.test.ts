import type { ActorKind, ContextItem, ContextItemProvenance, Uuid } from '@mneia/core';
import { ApiError, deriveContextItemProvenance } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import type { CommandDefinition, CommandIo } from '../command.js';
import { CliError, EXIT_FAILED, EXIT_OK, EXIT_USAGE } from '../command.js';
import type { ProjectConfig } from './brief.js';
import {
  createVerifyCommand,
  type StaleEntry,
  type StaleList,
  type StaleListRequest,
  type VerifyApi,
  type VerifyOutcome,
  type VerifyRequest,
} from './verify.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const PRIYA_ID = '44444444-4444-4444-8444-444444444444';
const EXTRACTOR_ID = '66666666-6666-4666-8666-666666666666';
const CHECKPOINT_ID = '77777777-7777-4777-8777-777777777777';

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
const EXTRACTOR = provenanceOf(EXTRACTOR_ID, 'agent', 'Claude Code');

function contextItem(overrides: Partial<ContextItem>): ContextItem {
  const assertedAt = overrides.assertedAt ?? new Date('2026-06-01T00:00:00.000Z');
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
    decayAfter: 14 * DAY_MS,
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

const pooling = contextItem({
  id: 'aa11bb22-0000-4000-8000-000000000001',
  kind: 'fact',
  title: 'Postgres connection pooling limits',
  assertedAt: new Date('2026-05-01T00:00:00.000Z'),
  lastVerifiedAt: new Date('2026-06-01T00:00:00.000Z'),
  decayAfter: 30 * DAY_MS,
  assertedBy: EXTRACTOR_ID,
  provenance: EXTRACTOR,
});

const budget = contextItem({
  id: 'bb22cc33-0000-4000-8000-000000000002',
  kind: 'decision',
  title: 'Rehydrate stays under 300ms',
  assertedAt: new Date('2026-01-01T00:00:00.000Z'),
  loadBearing: true,
  humanConfirmed: true,
  decayAfter: 365 * DAY_MS,
  assertedBy: PRIYA_ID,
  provenance: PRIYA,
});

const disputedRegion = contextItem({
  id: 'cc33dd44-0000-4000-8000-000000000003',
  kind: 'fact',
  title: 'The EU workspace runs in Frankfurt',
  status: 'disputed',
  assertedAt: new Date('2026-05-01T00:00:00.000Z'),
  humanConfirmed: true,
  assertedBy: PRIYA_ID,
  provenance: PRIYA,
});

const entryFor = (item: ContextItem, staleSince: Date): StaleEntry => ({
  item,
  staleSince,
  staleForMs: NOW.getTime() - staleSince.getTime(),
});

const DUE: readonly StaleEntry[] = [
  entryFor(pooling, new Date('2026-07-01T00:00:00.000Z')),
  entryFor(budget, new Date('2026-07-25T00:00:00.000Z')),
];

const list = (entries: readonly StaleEntry[]): StaleList => ({ projectId: PROJECT_ID, entries });

interface RecordingApi extends VerifyApi {
  readonly staleRequests: StaleListRequest[];
  readonly verifyRequests: VerifyRequest[];
}

function recordingApi(
  entries: readonly StaleEntry[],
  outcome?: VerifyOutcome | Error,
): RecordingApi {
  const staleRequests: StaleListRequest[] = [];
  const verifyRequests: VerifyRequest[] = [];

  return {
    staleRequests,
    verifyRequests,
    stale: (request) => {
      staleRequests.push(request);
      return Promise.resolve(list(entries));
    },
    verify: (request) => {
      verifyRequests.push(request);
      if (outcome === undefined) {
        return Promise.reject(new Error('no verification outcome was configured for this test'));
      }
      if (outcome instanceof Error) {
        return Promise.reject(outcome);
      }
      return Promise.resolve(outcome);
    },
  };
}

const confirmedOutcome: VerifyOutcome = {
  checkpointId: CHECKPOINT_ID,
  verification: 'confirmed',
  previousLastVerifiedAt: new Date('2026-06-01T00:00:00.000Z'),
  item: contextItem({
    id: pooling.id,
    kind: 'fact',
    title: pooling.title,
    humanConfirmed: true,
    lastVerifiedAt: NOW,
    decayAfter: 30 * DAY_MS,
    assertedBy: EXTRACTOR_ID,
    provenance: EXTRACTOR,
  }),
};

const deniedOutcome: VerifyOutcome = {
  checkpointId: CHECKPOINT_ID,
  verification: 'denied',
  previousLastVerifiedAt: null,
  item: contextItem({
    id: budget.id,
    kind: 'decision',
    title: budget.title,
    status: 'retired',
    loadBearing: true,
    humanConfirmed: true,
    lastVerifiedAt: NOW,
    decayAfter: 365 * DAY_MS,
    assertedBy: PRIYA_ID,
    provenance: PRIYA,
  }),
};

const loadConfig = (): ProjectConfig => CONFIG;

interface RunOptions {
  readonly args?: readonly string[];
  readonly flags?: Readonly<Record<string, string | boolean>>;
  readonly json?: boolean;
}

interface RunResult {
  readonly code: number;
  readonly out: string;
}

async function run(command: CommandDefinition, options: RunOptions = {}): Promise<RunResult> {
  const out: string[] = [];
  const io: CommandIo = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: () => undefined,
    cwd: '/repo',
    env: {},
  };

  const code = await command.run({
    args: options.args ?? [],
    flags: options.flags ?? {},
    json: options.json ?? false,
    io,
  });

  return { code, out: out.join('') };
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
  throw new Error('expected mneia verify to fail, but it succeeded');
}

const commandWith = (api: VerifyApi): CommandDefinition =>
  createVerifyCommand({ api, loadConfig, now: () => NOW });

describe('mneia verify — the list', () => {
  it('lists what is due for re-verification with the window that made it due', async () => {
    const result = await run(commandWith(recordingApi(DUE)));

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('acme/checkout — 2 items due for re-verification');
    expect(result.out).toContain('Postgres connection pooling limits');
    expect(result.out).toContain('last verified 2026-06-01');
    expect(result.out).toContain('due since 2026-07-01');
    expect(result.out).toContain('overdue by 31 days');
  });

  it('names who asserted each item, whether human or agent, and whether it is confirmed', async () => {
    const result = await run(commandWith(recordingApi(DUE)));

    expect(result.out).toContain('by Claude Code (agent)');
    expect(result.out).toContain('not human-confirmed');
    expect(result.out).toContain('by Priya Raman (human)');
    expect(result.out).toContain('human-confirmed');
    expect(result.out).toContain('load-bearing');
  });

  it('carries meaning in the text rather than colour, so piped output still reads', async () => {
    const result = await run(commandWith(recordingApi(DUE)));

    expect(result.out).not.toContain(String.fromCharCode(27));
    expect(result.out).toContain('load-bearing');
  });

  it('says nothing is due, and why constraints never appear, when the list is empty', async () => {
    const result = await run(commandWith(recordingApi([])));

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('Nothing in acme/checkout is due for re-verification.');
    expect(result.out).toContain('Constraints never go stale');
  });

  it('asks the API for the window the caller chose', async () => {
    const api = recordingApi(DUE);
    await run(commandWith(api), { flags: { limit: '5' } });

    expect(api.staleRequests).toHaveLength(1);
    expect(api.staleRequests[0]?.limit).toBe(5);
    expect(api.staleRequests[0]?.asOf).toEqual(NOW);
  });

  it('emits the same facts as machine-readable json', async () => {
    const result = await run(commandWith(recordingApi(DUE)), { json: true });
    const payload: unknown = JSON.parse(result.out);

    expect(payload).toMatchObject({
      project: 'acme/checkout',
      projectId: PROJECT_ID,
      count: 2,
    });
    expect(JSON.stringify(payload)).toContain('"staleSince":"2026-07-01T00:00:00.000Z"');
    expect(JSON.stringify(payload)).toContain('"kind":"agent"');
  });
});

describe('mneia verify — confirming and denying', () => {
  it('confirms an item named by the short id the list printed', async () => {
    const api = recordingApi(DUE, confirmedOutcome);
    const result = await run(commandWith(api), { args: ['aa11'], flags: { confirm: true } });

    expect(result.code).toBe(EXIT_OK);
    expect(api.verifyRequests).toEqual([
      { config: CONFIG, itemId: pooling.id, verification: 'confirmed', reason: null },
    ]);
    expect(result.out).toContain('Confirmed "Postgres connection pooling limits"');
    expect(result.out).toContain('Next due 2026-08-31.');
    expect(result.out).toContain(`Recorded in checkpoint ${CHECKPOINT_ID}`);
  });

  it('accepts a full uuid without reading the stale list first', async () => {
    const api = recordingApi(DUE, confirmedOutcome);
    await run(commandWith(api), { args: [pooling.id], flags: { confirm: true } });

    expect(api.staleRequests).toHaveLength(0);
    expect(api.verifyRequests[0]?.itemId).toBe(pooling.id);
  });

  it('denies an item with the reason the record keeps', async () => {
    const api = recordingApi(DUE, deniedOutcome);
    const result = await run(commandWith(api), {
      args: ['bb22'],
      flags: { deny: true, reason: 'the budget moved to 500ms in the M2 review' },
    });

    expect(result.code).toBe(EXIT_OK);
    expect(api.verifyRequests).toEqual([
      {
        config: CONFIG,
        itemId: budget.id,
        verification: 'denied',
        reason: 'the budget moved to 500ms in the M2 review',
      },
    ]);
    expect(result.out).toContain('Retired "Rehydrate stays under 300ms"');
    expect(result.out).toContain('stays in the record as retired rather than being deleted');
  });

  it('refuses a denial with no reason, before it reaches the API', async () => {
    const api = recordingApi(DUE, deniedOutcome);
    const error = await failure(commandWith(api), { args: ['bb22'], flags: { deny: true } });

    expect(error.kind).toBe('usage');
    expect(error.exitCode).toBe(EXIT_USAGE);
    expect(error.message).toContain('--reason');
    expect(api.verifyRequests).toHaveLength(0);
  });

  it('reports a denial the store refused as an error rather than crashing', async () => {
    const api = recordingApi(
      DUE,
      new ApiError(
        'invalid_request',
        'expected input.reason to say why the item no longer holds; received none',
        400,
      ),
    );
    const error = await failure(commandWith(api), {
      args: ['bb22'],
      flags: { deny: true, reason: 'stale' },
    });

    expect(error.exitCode).toBe(EXIT_FAILED);
    expect(error.message).toContain('expected input.reason');
    expect(error.fix.length).toBeGreaterThan(0);
  });

  it('never sends human_confirmed or asserted_by, because the server decides those', async () => {
    const api = recordingApi(DUE, confirmedOutcome);
    await run(commandWith(api), { args: ['aa11'], flags: { confirm: true } });

    const sent = JSON.stringify(api.verifyRequests[0] ?? {});
    expect(sent).not.toContain('humanConfirmed');
    expect(sent).not.toContain('assertedBy');
    expect(Object.keys(api.verifyRequests[0] ?? {}).sort()).toEqual([
      'config',
      'itemId',
      'reason',
      'verification',
    ]);
  });

  it('refuses --confirm and --deny together', async () => {
    const error = await failure(commandWith(recordingApi(DUE)), {
      args: ['aa11'],
      flags: { confirm: true, deny: true, reason: 'both' },
    });

    expect(error.kind).toBe('usage');
    expect(error.message).toContain('exactly one');
  });

  it('asks for a decision when an id is given with neither flag', async () => {
    const error = await failure(commandWith(recordingApi(DUE)), { args: ['aa11'] });

    expect(error.kind).toBe('usage');
    expect(error.message).toContain('--confirm');
    expect(error.message).toContain('--deny');
  });

  it('says which ids an ambiguous reference matched', async () => {
    const api = recordingApi([
      entryFor(contextItem({ id: 'ab000000-0000-4000-8000-000000000001' }), NOW),
      entryFor(contextItem({ id: 'ab000000-0000-4000-8000-000000000002' }), NOW),
    ]);
    const error = await failure(commandWith(api), { args: ['ab00'], flags: { confirm: true } });

    expect(error.kind).toBe('usage');
    expect(error.message).toContain('matched 2 items');
    expect(api.verifyRequests).toHaveLength(0);
  });

  it('says what to run when the reference matches nothing due', async () => {
    const api = recordingApi(DUE);
    const error = await failure(commandWith(api), { args: ['ffff'], flags: { confirm: true } });

    expect(error.kind).toBe('usage');
    expect(error.message).toContain('found no item matching ffff');
    expect(error.fix).toContain('mneia verify');
  });
});

describe('mneia verify — human versus human', () => {
  it('marks a disputed item as unsettled rather than offering it as verifiable', async () => {
    const result = await run(commandWith(recordingApi([entryFor(disputedRegion, NOW)])));

    expect(result.out).toContain('disputed — Mneia does not pick a winner here');
    expect(result.out).toContain('§10.4');
  });

  it('refuses to settle a disputed item through a re-verification answer', async () => {
    const api = recordingApi([entryFor(disputedRegion, NOW)], confirmedOutcome);
    const error = await failure(commandWith(api), { args: ['cc33'], flags: { confirm: true } });

    expect(error.message).toContain('disputed');
    expect(error.fix).toContain('§10.4');
    expect(api.verifyRequests).toHaveLength(0);
  });
});
