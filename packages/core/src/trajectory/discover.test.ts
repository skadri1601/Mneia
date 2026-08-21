import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClaudeCodeReader, projectSlug } from './claude-code.js';
import { discoverTrajectories, discoverTrajectorySessions } from './discover.js';
import {
  type ListTrajectoriesRequest,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySource,
  type TrajectorySummary,
} from './types.js';
import { TRANSCRIPT_WINDOW_BYTES } from './windows.js';

const CWD = 'C:\\repo\\project';
const OTHER_CWD = 'C:\\repo\\other';

const line = (record: Record<string, unknown>): string => JSON.stringify(record);

const transcript = (cwd: string, from: string, to: string, filler = 0): string => {
  const lines = [
    line({
      type: 'user',
      uuid: 'u1',
      cwd,
      timestamp: from,
      message: { role: 'user', content: 'We will use Postgres, not Mongo.' },
    }),
  ];
  for (let index = 0; index < filler; index += 1) {
    lines.push(
      line({
        type: 'assistant',
        uuid: `f${index}`,
        timestamp: from,
        message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(2048) }] },
      }),
    );
  }
  lines.push(
    line({
      type: 'assistant',
      uuid: 'a1',
      timestamp: to,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Agreed, Postgres it is.' }] },
    }),
  );
  return lines.join('\n');
};

const summary = (
  source: TrajectorySource,
  sessionRef: string,
  lastActivityAt: Date | null,
): TrajectorySummary => ({ source, sessionRef, cwd: CWD, startedAt: null, lastActivityAt });

const readerOf = (
  source: TrajectorySource,
  summaries: readonly TrajectorySummary[],
  onList?: (request: ListTrajectoriesRequest) => void,
): TrajectoryReader => ({
  source,
  async list(request: ListTrajectoriesRequest = {}) {
    onList?.(request);
    return summaries;
  },
  read(): Promise<Trajectory> {
    return Promise.reject(new TrajectoryError('not_found', source, 'not used in this test'));
  },
});

describe('discoverTrajectorySessions', () => {
  it('returns every session across readers, newest first, not just the newest one', async () => {
    const { sessions } = await discoverTrajectorySessions({ cwd: CWD }, [
      readerOf('claude-code', [
        summary('claude-code', 'older', new Date('2026-08-01T10:00:00.000Z')),
        summary('claude-code', 'newest', new Date('2026-08-03T10:00:00.000Z')),
      ]),
      readerOf('codex', [summary('codex', 'middle', new Date('2026-08-02T10:00:00.000Z'))]),
    ]);

    expect(sessions.map((entry) => entry.sessionRef)).toEqual(['newest', 'middle', 'older']);
  });

  it('sorts a session with no recorded activity last rather than treating it as ancient-but-real', async () => {
    const { sessions } = await discoverTrajectorySessions({}, [
      readerOf('claude-code', [
        summary('claude-code', 'undated', null),
        summary('claude-code', 'dated', new Date('1971-01-01T00:00:00.000Z')),
      ]),
    ]);

    expect(sessions.map((entry) => entry.sessionRef)).toEqual(['dated', 'undated']);
  });

  it('deduplicates a session two readers report, keeping the more recent record', async () => {
    const { sessions } = await discoverTrajectorySessions({}, [
      readerOf('claude-code', [
        summary('claude-code', 'shared', new Date('2026-08-01T10:00:00.000Z')),
      ]),
      readerOf('claude-code', [
        summary('claude-code', 'shared', new Date('2026-08-04T10:00:00.000Z')),
      ]),
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.lastActivityAt?.toISOString()).toBe('2026-08-04T10:00:00.000Z');
  });

  it('keeps two sessions that share a ref across different clients', async () => {
    const { sessions } = await discoverTrajectorySessions({}, [
      readerOf('claude-code', [summary('claude-code', 'shared', new Date('2026-08-01T00:00:00Z'))]),
      readerOf('cursor', [summary('cursor', 'shared', new Date('2026-08-02T00:00:00Z'))]),
    ]);

    expect(sessions.map((entry) => entry.source)).toEqual(['cursor', 'claude-code']);
  });

  it('reports a reader that could not run at all, with the code it failed on', async () => {
    const broken: TrajectoryReader = {
      source: 'warp',
      list() {
        return Promise.reject(
          new TrajectoryError('unsupported_runtime', 'warp', 'needs node:sqlite'),
        );
      },
      read(): Promise<Trajectory> {
        return Promise.reject(new TrajectoryError('not_found', 'warp', 'not used'));
      },
    };

    const { sessions, unavailable } = await discoverTrajectorySessions({}, [
      readerOf('codex', [summary('codex', 'fine', new Date('2026-08-02T10:00:00.000Z'))]),
      broken,
    ]);

    expect(sessions.map((entry) => entry.sessionRef)).toEqual(['fine']);
    expect(unavailable).toEqual([
      {
        source: 'warp',
        sessionRef: null,
        code: 'unsupported_runtime',
        reason: 'needs node:sqlite',
      },
    ]);
  });

  it('collects a per-session failure a reader reports instead of losing it', async () => {
    const reader: TrajectoryReader = {
      source: 'claude-code',
      async list(request: ListTrajectoriesRequest = {}) {
        request.onUnavailable?.({
          source: 'claude-code',
          sessionRef: 'corrupt',
          code: 'unrecognised_format',
          reason: 'produced no turns',
        });
        return [summary('claude-code', 'fine', new Date('2026-08-02T10:00:00.000Z'))];
      },
      read(): Promise<Trajectory> {
        return Promise.reject(new TrajectoryError('not_found', 'claude-code', 'not used'));
      },
    };

    const { sessions, unavailable } = await discoverTrajectorySessions({}, [reader]);

    expect(sessions.map((entry) => entry.sessionRef)).toEqual(['fine']);
    expect(unavailable.map((entry) => entry.sessionRef)).toEqual(['corrupt']);
  });

  it('never truncates the readers with the caller limit, only the merged result', async () => {
    const seen: ListTrajectoriesRequest[] = [];
    const { sessions } = await discoverTrajectorySessions({ limit: 1 }, [
      readerOf(
        'claude-code',
        [
          summary('claude-code', 'a', new Date('2026-08-01T10:00:00.000Z')),
          summary('claude-code', 'b', new Date('2026-08-05T10:00:00.000Z')),
        ],
        (request) => seen.push(request),
      ),
    ]);

    expect(seen[0]?.limit).toBeUndefined();
    expect(sessions.map((entry) => entry.sessionRef)).toEqual(['b']);
  });
});

describe('discoverTrajectories', () => {
  it('keeps the usable sessions ahead of the failures so the first entry is readable', async () => {
    const broken: TrajectoryReader = {
      source: 'cursor',
      list() {
        return Promise.reject(new TrajectoryError('unreadable', 'cursor', 'database is locked'));
      },
      read(): Promise<Trajectory> {
        return Promise.reject(new TrajectoryError('not_found', 'cursor', 'not used'));
      },
    };

    const discovered = await discoverTrajectories({}, [
      broken,
      readerOf('codex', [summary('codex', 'fine', new Date('2026-08-02T10:00:00.000Z'))]),
    ]);

    expect(discovered[0]).toMatchObject({ sessionRef: 'fine', unavailable: null });
    expect(discovered[1]).toMatchObject({
      source: 'cursor',
      unavailable: 'database is locked',
      unavailableCode: 'unreadable',
    });
  });
});

describe('the Claude Code reader over many sessions', () => {
  let root: string;
  let projects: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mneia-discover-'));
    projects = join(root, 'projects');

    const mine = join(projects, projectSlug(CWD));
    await mkdir(mine, { recursive: true });
    await writeFile(
      join(mine, 'session-old.jsonl'),
      transcript(CWD, '2026-08-01T10:00:00.000Z', '2026-08-01T11:00:00.000Z'),
      'utf8',
    );
    await writeFile(
      join(mine, 'session-new.jsonl'),
      transcript(CWD, '2026-08-04T10:00:00.000Z', '2026-08-04T11:00:00.000Z'),
      'utf8',
    );
    await writeFile(
      join(mine, 'session-huge.jsonl'),
      transcript(
        CWD,
        '2026-08-05T10:00:00.000Z',
        '2026-08-05T18:00:00.000Z',
        Math.ceil((TRANSCRIPT_WINDOW_BYTES * 3) / 2048),
      ),
      'utf8',
    );
    await writeFile(join(mine, 'session-junk.jsonl'), 'this is not a transcript at all\n', 'utf8');

    const theirs = join(projects, projectSlug(OTHER_CWD));
    await mkdir(theirs, { recursive: true });
    await writeFile(
      join(theirs, 'session-elsewhere.jsonl'),
      transcript(OTHER_CWD, '2026-08-06T10:00:00.000Z', '2026-08-06T11:00:00.000Z'),
      'utf8',
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists every session on the working directory, newest first', async () => {
    const reader = createClaudeCodeReader({ projectsRoot: projects });
    const listed = await reader.list({ cwd: CWD });

    expect(listed.map((entry) => entry.sessionRef)).toEqual([
      'session-huge',
      'session-new',
      'session-old',
    ]);
  });

  it('reads the first and last turn of a transcript larger than one window', async () => {
    const reader = createClaudeCodeReader({ projectsRoot: projects });
    const listed = await reader.list({ cwd: CWD });
    const huge = listed.find((entry) => entry.sessionRef === 'session-huge');

    expect(huge?.startedAt?.toISOString()).toBe('2026-08-05T10:00:00.000Z');
    expect(huge?.lastActivityAt?.toISOString()).toBe('2026-08-05T18:00:00.000Z');
  });

  it('reports a transcript it could not recognise rather than dropping it silently', async () => {
    const failures: string[] = [];
    const reader = createClaudeCodeReader({ projectsRoot: projects });
    await reader.list({
      cwd: CWD,
      onUnavailable: (failure) => failures.push(`${failure.code} ${failure.sessionRef}`),
    });

    expect(failures).toContain('unrecognised_format session-junk');
  });

  it('does not open the transcripts of an unrelated working directory', async () => {
    const reader = createClaudeCodeReader({ projectsRoot: projects });
    const failures: string[] = [];
    const listed = await reader.list({
      cwd: CWD,
      onUnavailable: (failure) => failures.push(failure.sessionRef ?? ''),
    });

    expect(listed.map((entry) => entry.sessionRef)).not.toContain('session-elsewhere');
    expect(failures).not.toContain('session-elsewhere');
  });

  it('falls back to every directory when none of them looks like the working directory', async () => {
    const reader = createClaudeCodeReader({ projectsRoot: projects });
    const listed = await reader.list({ cwd: 'C:\\somewhere\\else' });

    expect(listed).toHaveLength(0);
  });
});
