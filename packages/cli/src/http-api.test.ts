import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MAX_CHARS, readTrajectoryFile, reduceTrajectory } from '@mneia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from './config.js';
import { MAX_UPLOAD_BYTES, httpCheckpointApi, uploadableFrom } from './http-api.js';

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
}

function fakeServer(): FakeServer {
  const seen = new Set<string>();
  const uploads: number[] = [];
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
    const body = JSON.parse(raw) as { turns: readonly WireTurn[] };

    const at = watermark;
    const index = at === null ? -1 : body.turns.findIndex((turn) => turn.ref === at);
    const pending =
      at === null ? body.turns : index >= 0 ? body.turns.slice(index + 1) : body.turns;

    for (const turn of pending) {
      seen.add(turn.ref);
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

  return { seen, uploads, requests: () => requests };
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

    const taken = uploadableFrom(trajectory.turns, 0);

    expect(taken).toHaveLength(1);
  });

  it('resumes from an offset rather than always from the start', async () => {
    const trajectory = await readTrajectoryFile(await trajectoryFile(TURN_COUNT, TURN_CHARS));

    expect(uploadableFrom(trajectory.turns, 30)[0]?.ref).toBe('t30');
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

  it('sends a small session in a single request', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const path = await trajectoryFile(5, 100);
    const server = fakeServer();

    const proposal = await httpCheckpointApi.propose({ config, trigger: 'manual', fromFile: path });

    expect(server.requests()).toBe(1);
    expect(proposal.pendingTurns).toBe(0);
    expect(server.seen.size).toBe(5);
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
