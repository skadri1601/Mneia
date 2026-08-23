import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWarpReader } from './warp.js';

let directory: string;
let databasePath: string;

const CWD = process.platform === 'win32' ? 'C:\\repo\\payments' : '/repo/payments';

/**
 * A Warp database holding one conversation: started in May, last touched in August.
 *
 * agent_conversations records only last_modified_at, so this is the shape that made a
 * months-old conversation look new — the case the checkpoint eligibility gate turns on.
 */
const seed = (): void => {
  const database = new DatabaseSync(databasePath);
  database.exec(
    'CREATE TABLE agent_conversations (conversation_id TEXT, last_modified_at TEXT, conversation_data TEXT)',
  );
  database.exec(
    'CREATE TABLE ai_queries (conversation_id TEXT, working_directory TEXT, start_ts TEXT, input TEXT, output TEXT)',
  );
  database
    .prepare('INSERT INTO agent_conversations VALUES (?, ?, ?)')
    .run('conv-1', '2026-08-20T10:00:00.000Z', '{}');
  database
    .prepare('INSERT INTO ai_queries VALUES (?, ?, ?, ?, ?)')
    .run('conv-1', CWD, '2026-05-02T09:00:00.000Z', 'first', 'answer');
  database
    .prepare('INSERT INTO ai_queries VALUES (?, ?, ?, ?, ?)')
    .run('conv-1', CWD, '2026-08-20T09:59:00.000Z', 'later', 'answer');
  database.close();
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mneia-warp-'));
  databasePath = join(directory, 'warp.sqlite');
  seed();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('the warp reader', () => {
  it('reports when a conversation began, not when it was last touched', async () => {
    const reader = createWarpReader({ databasePath });

    const [summary] = await reader.list({ cwd: CWD });

    expect(summary?.sessionRef).toBe('conv-1');
    expect(summary?.lastActivityAt?.toISOString()).toBe('2026-08-20T10:00:00.000Z');
    expect(summary?.startedAt?.toISOString()).toBe('2026-05-02T09:00:00.000Z');
  });

  // The gate asks whether a session began before the repo was bound. With startedAt null it
  // fell back to last activity, so a conversation opened in May and answered once in August
  // passed as eligible and uploaded its whole pre-binding transcript.
  it('takes the earliest query, so a later reply cannot make an old conversation look new', async () => {
    const reader = createWarpReader({ databasePath });

    const [summary] = await reader.list({ cwd: CWD });
    const boundAt = new Date('2026-08-01T00:00:00.000Z');

    const startedAt = summary?.startedAt ?? null;

    expect(startedAt).not.toBeNull();
    expect(startedAt === null ? Number.NaN : startedAt.getTime()).toBeLessThan(boundAt.getTime());
  });
});
