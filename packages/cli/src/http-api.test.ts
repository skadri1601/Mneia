import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CheckpointProposeWireSchema,
  DEFAULT_MAX_CHARS,
  MAX_TRAJECTORY_TURNS,
  MAX_TURN_TEXT_LENGTH,
  readTrajectoryFile,
  reduceTrajectory,
} from '@mneia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodError } from 'zod';
import type { ProjectConfig } from './config.js';
import { httpCheckpointApi, httpInitApi, MAX_UPLOAD_BYTES, uploadableFrom } from './http-api.js';

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

interface WireTurn {
  readonly ref: string;
}

interface FakeServer {
  readonly seen: Set<string>;
  readonly uploads: number[];
  readonly requests: () => number;
  readonly rejected: string[];
}

const schemaRejection = (error: ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');

const badRequest = (message: string): Response =>
  new Response(JSON.stringify({ error: { code: 'invalid_request', message } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A fake that is no more permissive than the schema it stands in for.
 *
 * MNE-100 shipped because the earlier version of this was: it accepted any JSON, so the
 * `.min(1)` on `turns` made the watermark probe a 400 in production while every test here
 * stayed green. Validating with CheckpointProposeWireSchema is what makes a client that
 * sends something the API refuses fail here rather than in a customer's terminal.
 */
function fakeServer(): FakeServer {
  const seen = new Set<string>();
  const uploads: number[] = [];
  const rejected: string[] = [];
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

    const parsed = CheckpointProposeWireSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      const message = schemaRejection(parsed.error);
      rejected.push(message);
      return Promise.resolve(badRequest(message));
    }
    const body: { turns: readonly WireTurn[] } = parsed.data;

    const at = watermark;
    const index = at === null ? -1 : body.turns.findIndex((turn) => turn.ref === at);
    const pending =
      at === null ? body.turns : index >= 0 ? body.turns.slice(index + 1) : body.turns;

    for (const turn of pending) {
      seen.add(turn.ref);
    }
    // Known divergence from the real server, and the reason it is spelled out here: the
    // hosted API advances the stored watermark only when a checkpoint is *committed*, and
    // commit refuses a checkpoint with no items. So a proposal that yields no candidates
    // leaves the watermark where it was and the same turns are extracted, and billed,
    // again on the next run. Tests below that rely on progress across runs are exercising
    // this fake's optimism, not the product.
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

  return { seen, uploads, requests: () => requests, rejected };
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

  it('takes an oversized turn rather than stalling on it', async () => {
    const trajectory = await readTrajectoryFile(await trajectoryFile(3, 2_000_000));

    const taken = uploadableFrom(trajectory.turns, 0);

    expect(taken.length).toBeGreaterThan(0);
    expect(taken[0]?.ref).toBe('t0');
  });

  it('stops at the turn count the API accepts, not only at the byte budget', async () => {
    const trajectory = await readTrajectoryFile(
      await trajectoryFile(MAX_TRAJECTORY_TURNS + 20, 20),
    );

    const taken = uploadableFrom(trajectory.turns, 0);
    const bytes = taken.reduce(
      (total, turn) => total + Buffer.byteLength(JSON.stringify(turn), 'utf8'),
      0,
    );

    // The byte budget is nowhere near reached, so only the turn cap can be what stopped
    // it. Without that cap the request is a 400 and the session never checkpoints.
    expect(bytes).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(taken).toHaveLength(MAX_TRAJECTORY_TURNS);
  });

  it('resumes from an offset rather than always from the start', async () => {
    const trajectory = await readTrajectoryFile(await trajectoryFile(TURN_COUNT, TURN_CHARS));

    expect(uploadableFrom(trajectory.turns, 30)[0]?.ref).toBe('t30');
  });
});

describe('httpCheckpointApi.propose against what the API actually accepts', () => {
  it('uploads a turn longer than the wire limit instead of having it rejected whole', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const path = await trajectoryFile(2, MAX_TURN_TEXT_LENGTH * 3);
    const server = fakeServer();

    const proposal = await httpCheckpointApi.propose({ config, trigger: 'manual', fromFile: path });

    // reduceTrajectory caps tool output but not a text turn, and this client reduces with
    // an infinite maxChars — so before MNE-100 the full turn went on the wire and the API
    // refused the request, leaving the session permanently un-checkpointable.
    expect(server.rejected).toEqual([]);
    expect(proposal.droppedBeforeUpload).toBe(0);
    expect(server.seen.has('t0')).toBe(true);
  });

  it('keeps a session of many short turns inside the turn cap the API enforces', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const path = await trajectoryFile(MAX_TRAJECTORY_TURNS + 20, 20);
    const server = fakeServer();

    const first = await httpCheckpointApi.propose({ config, trigger: 'manual', fromFile: path });
    await httpCheckpointApi.propose({ config, trigger: 'manual', fromFile: path });

    expect(server.rejected).toEqual([]);
    expect(first.pendingTurns).toBeGreaterThan(0);
    expect(server.seen.size).toBe(MAX_TRAJECTORY_TURNS + 20);
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
