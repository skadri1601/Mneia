import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MAX_CHARS, readTrajectoryFile, reduceTrajectory } from '@mneia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from './config.js';
import { httpCheckpointApi } from './http-api.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const ACTOR_ID = '00000000-0000-4000-8000-000000000003';

const TURN_CHARS = 40_000;
const TURN_COUNT = 25;

const config: ProjectConfig = {
  workspace: 'acme',
  project: 'checkout',
  endpoint: 'https://app.mneia.dev',
  configPath: '/repo/.mneia/config.json',
  repoRoot: '/repo',
};

async function oversizedTrajectoryFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mne265-'));
  const path = join(dir, 'session.jsonl');
  const lines = Array.from({ length: TURN_COUNT }, (_, index) =>
    JSON.stringify({
      ref: `t${index}`,
      role: index % 2 === 0 ? 'assistant' : 'user',
      kind: 'text',
      text: `turn-${index} ${'x'.repeat(TURN_CHARS)}`,
      at: new Date(Date.UTC(2026, 7, 16, 0, index)).toISOString(),
    }),
  );
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

interface Uploaded {
  readonly turns: readonly { readonly ref: string }[];
}

function stubTransport(): { uploaded: () => Uploaded } {
  let body: Uploaded | null = null;

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

    body = JSON.parse(init?.body ?? '{}') as Uploaded;

    return Promise.resolve(
      new Response(
        JSON.stringify({
          proposal: {
            workspaceId: WORKSPACE_ID,
            projectId: PROJECT_ID,
            actorId: ACTOR_ID,
            candidates: [],
            rejectedCount: 0,
            watermark: `t${TURN_COUNT - 1}`,
            consumedTurns: TURN_COUNT,
            model: 'gpt-5.6-luna',
            pendingTurns: 0,
            incompleteReason: null,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  });

  return {
    uploaded: () => {
      if (body === null) {
        throw new Error('expected the propose request to have been sent');
      }
      return body;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('httpCheckpointApi.propose over a session larger than the old client cap', () => {
  it('is a fixture the old cap would actually have truncated', async () => {
    const path = await oversizedTrajectoryFile();
    const trajectory = await readTrajectoryFile(path);

    const capped = reduceTrajectory(trajectory);

    expect(trajectory.turns.length).toBe(TURN_COUNT);
    expect(capped.droppedTurns).toBeGreaterThan(0);
    expect(capped.trajectory.turns.length).toBeLessThan(TURN_COUNT);
    expect(TURN_CHARS * TURN_COUNT).toBeGreaterThan(DEFAULT_MAX_CHARS);
  });

  it('sends every turn, so nothing is lost before the server can chunk it', async () => {
    vi.stubEnv('MNEIA_TOKEN', 'test-token');
    const path = await oversizedTrajectoryFile();
    const transport = stubTransport();

    const proposal = await httpCheckpointApi.propose({
      config,
      trigger: 'manual',
      fromFile: path,
    });

    const sent = transport.uploaded().turns.map((turn) => turn.ref);
    const expected = Array.from({ length: TURN_COUNT }, (_, index) => `t${index}`);

    expect(sent).toEqual(expected);
    expect(proposal.droppedBeforeUpload).toBe(0);
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
    expect(reduced.trajectory.turns).toHaveLength(1);
    expect(reduced.trajectory.turns[0]?.text.length).toBeLessThan(50_000);
  });
});
