import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CheckpointProposeWireSchema,
  DEFAULT_MAX_CHARS,
  MAX_TRAJECTORY_TURNS,
  readTrajectoryFile,
  reduceTrajectory,
} from '@mneia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from './config.js';
import {
  httpCheckpointApi,
  httpInitApi,
  httpStatusApi,
  MAX_UPLOAD_BYTES,
  uploadableFrom,
} from './http-api.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const ACTOR_ID = '00000000-0000-4000-8000-000000000003';

const TURN_CHARS = 40_000;
const TURN_COUNT = 60;

const config: ProjectConfig = {
  workspace: 'acme',
  project: 'checkout',
  endpoint: 'https://app.mneia.dev',
  configPath: '/repo/.mneia/config.json',
  repoRoot: '/repo',
};

async function trajectoryFile(count: number, chars: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mne265-'));
  const path = join(dir, 'session.jsonl');
  const lines = Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      ref: `t${index}`,
      role: index % 2 === 0 ? 'assistant' : 'user',
      kind: 'text',
      text: `turn-${index} ${'x'.repeat(chars)}`,
      at: new Date(Date.UTC(2026, 7, 16, 0, 0, index)).toISOString(),
    }),
  );
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

interface FakeServer {
  readonly seen: Set<string>;
  readonly uploads: number[];
  readonly requests: () => number;
  readonly rejections: string[];
  readonly turns: { readonly ref: string; readonly text: string }[];
}

function fakeServer(): FakeServer {
  const seen = new Set<string>();
  const uploads: number[] = [];
  const rejections: string[] = [];
  const turns: { ref: string; text: string }[] = [];
  let watermark: string | null = null;
  let requests = 0;

  vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
    if (url.endsWith('/api/me')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            actor: { id: ACTOR_ID, display_name: 'Ada', kind: 'human' },
            workspace: { id: WORKSPACE_ID, slug: 'acme', display_name: 'Acme' },
            team: { id: '00000000-0000-4000-8000-000000000004', display_name: 'Core' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }

    requests += 1;
    const raw = init?.body ?? '{}';
    uploads.push(Buffer.byteLength(raw, 'utf8'));
    // Validate with the schema the real route validates with. A fake that accepts an
    // upload the API would refuse hides exactly the class of defect MNE-100 was.
    const parsed = CheckpointProposeWireSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      rejections.push(parsed.error.message);
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: 'invalid_request', message: parsed.error.message } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    const body = parsed.data;

    const at = watermark;
    const index = at === null ? -1 : body.turns.findIndex((turn) => turn.ref === at);
    const pending =
      at === null ? body.turns : index >= 0 ? body.turns.slice(index + 1) : body.turns;

    for (const turn of pending) {
      seen.add(turn.ref);
      turns.push({ ref: turn.ref, text: turn.text });
    }
    const last = pending.at(-1);
    if (last !== undefined) {
      watermark = last.ref;
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          proposal: {
            workspaceId: WORKSPACE_ID,
            projectId: PROJECT_ID,
            actorId: ACTOR_ID,
            candidates: [],
            rejectedCount: 0,
            watermark,
            consumedTurns: pending.length,
            model: 'gpt-5.6-luna',
            pendingTurns: 0,
            incompleteReason: null,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  });

  return { seen, uploads, requests: () => requests, rejections, turns };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('uploadableFrom', () => {
  it('stops before the byte budget rather than after it', async () => {
    const trajectory = await readTrajectoryFile(await trajectoryFile(TURN_COUNT, TURN_CHARS));

    const taken = uploadableFrom(trajectory.turns, 0);
    const bytes = taken.reduce((total, turn) => total + Buffer.byteLength(turn.text, 'utf8'), 0);

    expect(taken.length).toBeGreaterThan(0);
    expect(taken.length).toBeLessThan(TURN_COUNT);
    expect(bytes).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(taken[0]?.ref).toBe('t0');
  });

  it('always takes at least one turn, so an oversized turn cannot stall the loop', async () => {
    const trajectory = await readTrajectoryFile(await trajectoryFile(3, 2_000_000));

    const taken = uploadableFrom(trajectory.turns, 0, 1_000);

    expect(taken).toHaveLength(1);
  });

  it('resumes from an offset rather than always from the start', async () => {
    const trajectory = await readTrajectoryFile(await trajectoryFile(TURN_COUNT, TURN_CHARS));

    expect(uploadableFrom(trajectory.turns, 30)[0]?.ref).toBe('t30');
  });

  it('stops at the turn-count cap, which a chatty session reaches before the byte budget', async () => {
    // 6000 short turns are well under 900KB, so only the byte budget was consulted and the
    // upload went out over the schema's 5000-turn limit - refused in full, every run, for
    // the life of the session.
    const trajectory = await readTrajectoryFile(await trajectoryFile(6_000, 10));

    const taken = uploadableFrom(trajectory.turns, 0);

    expect(trajectory.turns).toHaveLength(6_000);
    expect(taken).toHaveLength(MAX_TRAJECTORY_TURNS);
  });
});

describe('the upload the API will actually accept', () => {
  const turnFile = async (text: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'mne100-'));
    const path = join(dir, 'session.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        ref: 'huge',
        role: 'user',
        kind: 'text',
        text,
        at: '2026-08-16T00:00:00.000Z',
      })}\n`,
      'utf8',
    );
    return path;
  };

  it('trims a turn past the wire limit instead of shipping one the server must refuse', async () => {
    // A pasted file or a long generated block puts a single text turn over
    // MAX_TURN_TEXT_LENGTH. Nothing reduces a text turn - reduceTrajectory caps tool
    // output only - so the whole request failed validation, and it failed again on every
    // later run because the same turn is still there.
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const server = fakeServer();

    const proposal = await httpCheckpointApi.propose({
      config,
      trigger: 'manual',
      fromFile: await turnFile('z'.repeat(400_000)),
    });

    expect(server.rejections).toEqual([]);
    expect(server.seen.has('huge')).toBe(true);
    expect(proposal.pendingTurns).toBe(0);
  });

  it('says how much of the turn it left behind rather than trimming silently', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const server = fakeServer();

    await httpCheckpointApi.propose({
      config,
      trigger: 'manual',
      fromFile: await turnFile('z'.repeat(400_000)),
    });

    const uploaded = server.turns.find((turn) => turn.ref === 'huge');

    expect(uploaded?.text.length).toBeLessThanOrEqual(200_000);
    expect(uploaded?.text).toMatch(/truncated by mneia, \d+ more characters$/);
  });
});

describe('httpCheckpointApi.propose over a session larger than one request', () => {
  it('is a fixture the old client cap would have silently truncated', async () => {
    const trajectory = await readTrajectoryFile(await trajectoryFile(TURN_COUNT, TURN_CHARS));

    const capped = reduceTrajectory(trajectory);

    expect(capped.droppedTurns).toBeGreaterThan(0);
    expect(TURN_CHARS * TURN_COUNT).toBeGreaterThan(DEFAULT_MAX_CHARS);
  });

  it('reaches every turn across repeated runs, and never reports one as dropped', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const path = await trajectoryFile(TURN_COUNT, TURN_CHARS);
    const server = fakeServer();

    let runs = 0;
    let pending = 1;
    while (pending > 0 && runs < 20) {
      const proposal = await httpCheckpointApi.propose({
        config,
        trigger: 'manual',
        fromFile: path,
      });
      expect(proposal.droppedBeforeUpload).toBe(0);
      pending = proposal.pendingTurns;
      runs += 1;
    }

    const expected = Array.from({ length: TURN_COUNT }, (_, index) => `t${index}`);

    expect([...server.seen].sort()).toEqual([...expected].sort());
    expect(pending).toBe(0);
    expect(runs).toBeGreaterThan(1);
    expect(Math.max(...server.uploads)).toBeLessThanOrEqual(1_048_576);
  });

  it('holds the remainder as pending rather than losing it, on the first run', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const path = await trajectoryFile(TURN_COUNT, TURN_CHARS);
    fakeServer();

    const proposal = await httpCheckpointApi.propose({ config, trigger: 'manual', fromFile: path });

    expect(proposal.droppedBeforeUpload).toBe(0);
    expect(proposal.pendingTurns).toBeGreaterThan(0);
  });

  it('probes for the watermark before it uploads anything', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const path = await trajectoryFile(5, 100);
    const server = fakeServer();

    const proposal = await httpCheckpointApi.propose({ config, trigger: 'manual', fromFile: path });

    expect(server.requests()).toBe(2);
    expect(server.uploads[0]).toBeLessThan(server.uploads[1] ?? 0);
    expect(proposal.pendingTurns).toBe(0);
    expect(server.seen.size).toBe(5);
  });

  it('uploads nothing at all for a session the server has already consumed', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const path = await trajectoryFile(5, 100);
    const server = fakeServer();

    await httpCheckpointApi.propose({ config, trigger: 'manual', fromFile: path });
    const afterFirst = server.requests();
    const probeSize = server.uploads[0] ?? 0;

    await httpCheckpointApi.propose({ config, trigger: 'manual', fromFile: path });

    expect(server.requests()).toBe(afterFirst + 1);
    expect(server.uploads.at(-1)).toBe(probeSize);
  });

  it('still truncates oversized tool output and redacts, which are not the lossy part', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mne265-tool-'));
    const path = join(dir, 'session.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        ref: 'tool0',
        role: 'assistant',
        kind: 'tool_result',
        text: 'y'.repeat(50_000),
        at: '2026-08-16T00:00:00.000Z',
      })}\n`,
      'utf8',
    );

    const reduced = reduceTrajectory(await readTrajectoryFile(path), {
      maxChars: Number.MAX_SAFE_INTEGER,
    });

    expect(reduced.droppedTurns).toBe(0);
    expect(reduced.truncatedTurns).toBe(1);
    expect(reduced.trajectory.turns[0]?.text.length).toBeLessThan(50_000);
  });
});

describe('httpInitApi imports constraints without conferring authority on them', () => {
  interface WrittenItem {
    readonly item: { readonly title: string; readonly loadBearing: boolean };
  }

  function fakeAttachServer(): { readonly items: WrittenItem[] } {
    const items: WrittenItem[] = [];

    vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
      const json = (payload: unknown, status = 200): Response =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        });

      if (url.endsWith('/api/me')) {
        return Promise.resolve(
          json({
            actor: { id: ACTOR_ID, display_name: 'Ada', kind: 'human' },
            workspace: { id: WORKSPACE_ID, slug: 'acme', display_name: 'Acme' },
            team: { id: '00000000-0000-4000-8000-000000000004', display_name: 'Core' },
          }),
        );
      }

      if (url.includes('/api/v1/projects')) {
        return Promise.resolve(
          json({
            project: {
              id: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
              teamId: null,
              slug: 'checkout',
              repoUrl: null,
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          }),
        );
      }

      const body = JSON.parse(init?.body ?? '{}') as { items?: readonly WrittenItem[] };
      items.push(...(body.items ?? []));

      return Promise.resolve(
        json({
          result: {
            checkpoint: {
              id: '00000000-0000-4000-8000-000000000005',
              workspaceId: WORKSPACE_ID,
              projectId: PROJECT_ID,
              sessionId: null,
              actorId: ACTOR_ID,
              trigger: 'manual',
              summary: null,
              createdAt: '2026-08-01T00:00:00.000Z',
            },
            items: [],
            written: (body.items ?? []).map((entry, index) => ({
              id: `00000000-0000-4000-8000-00000000010${index}`,
              workspaceId: WORKSPACE_ID,
              projectId: PROJECT_ID,
              kind: 'constraint',
              title: entry.item.title,
              body: null,
              status: 'active',
              assertedBy: ACTOR_ID,
              assertedAt: '2026-08-01T00:00:00.000Z',
              sourceSessionId: null,
              sourceRef: 'AGENTS.md:12',
              confidence: 0.5,
              humanConfirmed: true,
              loadBearing: entry.item.loadBearing,
              lastVerifiedAt: null,
              decayAfter: null,
              validFrom: '2026-08-01T00:00:00.000Z',
              validTo: null,
              supersedesId: null,
              supersededById: null,
              accessScope: 'project',
              supersedeReason: null,
              embedding: null,
              embeddingModel: null,
            })),
            superseded: [],
          },
        }),
      );
    });

    return { items };
  }

  it('writes a scraped bullet as not load-bearing, because a file scrape does not make a rule binding', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const server = fakeAttachServer();

    await httpInitApi.attach({
      workspace: 'acme',
      project: 'checkout',
      endpoint: config.endpoint,
      token: 'test-token',
      repoRoot: config.repoRoot,
      constraints: [{ title: 'Never commit secrets', body: null, sourceRef: 'AGENTS.md:12' }],
    });

    expect(server.items).toHaveLength(1);
    expect(server.items[0]?.item.loadBearing).toBe(false);
  });
});

describe('httpStatusApi.usage', () => {
  const REPORT = {
    plan: 'team',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    turns: { used: 380, allowance: 1000, fraction: 0.38 },
    extractions: { used: 12, allowance: 100, fraction: 0.12 },
    embeddingTokens: { used: 91_000, allowance: 500_000, fraction: 0.182 },
    checkpoints: 142,
    percentUsed: 38,
    warn: false,
  };

  interface UsageCall {
    readonly url: string;
    readonly method: string | undefined;
  }

  function fakeUsageServer(respond: () => Response): UsageCall[] {
    const calls: UsageCall[] = [];
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method });
      return Promise.resolve(respond());
    });
    return calls;
  }

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  it('reads the meter with one GET, and asks for no identity or project first', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const calls = fakeUsageServer(() => jsonResponse({ usage: REPORT }));

    const usage = await httpStatusApi.usage?.({ config });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://app.mneia.dev/api/v1/usage');
    expect(calls[0]?.method).toBe('GET');
    expect(usage).toMatchObject({ plan: 'team', percentUsed: 38, checkpoints: 142 });
  });

  it('drops embeddingTokens on the way in, so no customer surface can render it', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    fakeUsageServer(() => jsonResponse({ usage: REPORT }));

    const usage = await httpStatusApi.usage?.({ config });

    expect(usage).not.toBeNull();
    expect(usage).not.toHaveProperty('embeddingTokens');
  });

  it('accepts the report bare as well as enveloped', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    fakeUsageServer(() => jsonResponse(REPORT));

    expect(await httpStatusApi.usage?.({ config })).toMatchObject({ percentUsed: 38 });
  });

  it('reads a deployment with no usage route as no meter rather than as a failure', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    fakeUsageServer(() =>
      jsonResponse({ error: { code: 'not_found', message: 'no such route' } }, 404),
    );

    expect(await httpStatusApi.usage?.({ config })).toBeNull();
  });

  it('lets a rejected token through to the caller, which decides what to say about it', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    fakeUsageServer(() =>
      jsonResponse({ error: { code: 'invalid_token', message: 'expired' } }, 401),
    );

    await expect(httpStatusApi.usage?.({ config })).rejects.toThrow('expired');
  });

  it('refuses a body it cannot read rather than rendering a half-parsed meter', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    fakeUsageServer(() => jsonResponse({ usage: { ...REPORT, percentUsed: 'lots' } }));

    await expect(httpStatusApi.usage?.({ config })).rejects.toThrow(/cannot read/);
  });
});
