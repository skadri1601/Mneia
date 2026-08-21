import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGeminiReader, geminiTurns, parseGeminiSession } from './gemini.js';
import { TrajectoryError, type TrajectoryUnavailable } from './types.js';

const LEGACY_PROJECT = 'a'.repeat(64);
const CWD = 'c:\\users\\ada\\billing';

const legacySession = JSON.stringify({
  sessionId: 'legacy-1',
  projectHash: LEGACY_PROJECT,
  startTime: '2026-08-01T10:00:00.000Z',
  lastUpdated: '2026-08-01T10:30:00.000Z',
  messages: [
    {
      id: 'm1',
      timestamp: '2026-08-01T10:00:00.000Z',
      type: 'user',
      content: 'Why did we drop the schema-per-tenant plan?',
    },
    {
      id: 'm2',
      timestamp: '2026-08-01T10:01:00.000Z',
      type: 'gemini',
      content: 'Shared schema with row-level security was ruled instead.',
    },
    { id: 'm3', timestamp: '2026-08-01T10:02:00.000Z', type: 'system', content: 'ignored' },
    { id: 'm4', timestamp: '2026-08-01T10:03:00.000Z', type: 'user', content: '   ' },
  ],
});

const currentSession = [
  JSON.stringify({
    sessionId: 'current-1',
    projectHash: 'unused',
    startTime: '2026-08-20T09:00:00.000Z',
    lastUpdated: '2026-08-20T09:00:00.000Z',
    kind: 'main',
  }),
  JSON.stringify({
    $set: {
      lastUpdated: '2026-08-20T09:05:00.000Z',
      messages: [
        {
          id: 'c1',
          timestamp: '2026-08-20T09:00:00.000Z',
          type: 'user',
          content: [{ text: 'Ship the review queue' }, { text: 'before the milestone closes' }],
        },
      ],
    },
  }),
  JSON.stringify({
    $set: {
      lastUpdated: '2026-08-20T09:09:00.000Z',
      messages: [
        {
          id: 'c2',
          timestamp: '2026-08-20T09:06:00.000Z',
          type: 'gemini',
          content: [{ text: 'The queue needs a human confirmation step.' }],
        },
      ],
    },
  }),
].join('\n');

let home = '';

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'mne100-gemini-'));

  await mkdir(join(home, 'tmp', 'billing', 'chats'), { recursive: true });
  await mkdir(join(home, 'tmp', LEGACY_PROJECT, 'chats'), { recursive: true });

  await writeFile(join(home, 'tmp', 'billing', 'chats', 'session-current.jsonl'), currentSession);
  await writeFile(join(home, 'tmp', LEGACY_PROJECT, 'chats', 'session-legacy.json'), legacySession);
  await writeFile(join(home, 'tmp', 'billing', 'chats', 'notes.txt'), 'not a session');
  await writeFile(
    join(home, 'projects.json'),
    JSON.stringify({ projects: { [CWD]: 'billing', 'c:\\users\\ada\\other': 'absent' } }),
  );
});

describe('parseGeminiSession', () => {
  it('reads the single-object layout an older Gemini CLI wrote', () => {
    const session = parseGeminiSession(legacySession, 'session-legacy.json');

    expect(session.sessionId).toBe('legacy-1');
    expect(session.startedAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    expect(session.lastActivityAt?.toISOString()).toBe('2026-08-01T10:30:00.000Z');
    expect(session.messages).toHaveLength(4);
  });

  it('folds the $set deltas the current line-per-object layout writes', () => {
    const session = parseGeminiSession(currentSession, 'session-current.jsonl');

    expect(session.sessionId).toBe('current-1');
    expect(session.messages.map((message) => message.id)).toEqual(['c1', 'c2']);
    expect(session.lastActivityAt?.toISOString()).toBe('2026-08-20T09:09:00.000Z');
  });

  it('lets a later delta replace a message it repeats rather than duplicating it', () => {
    const session = parseGeminiSession(
      [
        JSON.stringify({ sessionId: 's', startTime: '2026-08-20T09:00:00.000Z' }),
        JSON.stringify({ $set: { messages: [{ id: 'x', type: 'gemini', content: 'draft' }] } }),
        JSON.stringify({ $set: { messages: [{ id: 'x', type: 'gemini', content: 'final' }] } }),
      ].join('\n'),
      'session.jsonl',
    );

    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]?.content).toBe('final');
  });

  it('names the file when it holds neither JSON nor one object per line', () => {
    expect(() => parseGeminiSession('not json at all', 'session-broken.json')).toThrow(
      TrajectoryError,
    );
    expect(() => parseGeminiSession('   ', 'session-empty.json')).toThrow(/the file is empty/);
  });
});

describe('geminiTurns', () => {
  it('keeps user and model turns, and drops the ones with nothing in them', () => {
    const turns = geminiTurns(parseGeminiSession(legacySession, 'session-legacy.json'));

    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(turns[1]?.text).toBe('Shared schema with row-level security was ruled instead.');
    expect(turns[0]?.at?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
  });

  it('joins the content parts the current layout splits a message into', () => {
    const turns = geminiTurns(parseGeminiSession(currentSession, 'session-current.jsonl'));

    expect(turns[0]?.text).toBe('Ship the review queue\nbefore the milestone closes');
  });

  it('gives every turn a ref of its own even when the ids repeat', () => {
    const turns = geminiTurns({
      sessionId: 's',
      startedAt: null,
      lastActivityAt: null,
      messages: [
        { id: 'same', type: 'user', content: 'first' },
        { id: 'same', type: 'gemini', content: 'second' },
      ],
    });

    expect(new Set(turns.map((turn) => turn.ref)).size).toBe(2);
  });
});

describe('createGeminiReader', () => {
  it('attributes a current-layout session to the directory projects.json names', async () => {
    const summaries = await createGeminiReader(home).list({ cwd: 'C:\\Users\\Ada\\Billing' });

    expect(summaries.map((summary) => summary.sessionRef)).toEqual([
      'billing/session-current.jsonl',
    ]);
    expect(summaries[0]?.cwd).toBe(CWD);
    expect(summaries[0]?.lastActivityAt?.toISOString()).toBe('2026-08-20T09:09:00.000Z');
  });

  it('never invents a directory for a legacy hashed session, and says where they went', async () => {
    const unavailable: TrajectoryUnavailable[] = [];
    const summaries = await createGeminiReader(home).list({
      cwd: CWD,
      onUnavailable: (failure) => unavailable.push(failure),
    });

    expect(summaries.every((summary) => !summary.sessionRef.startsWith(LEGACY_PROJECT))).toBe(true);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.reason).toContain('--session');
  });

  it('reads a legacy session anyway when it is named outright', async () => {
    const trajectory = await createGeminiReader(home).read(`${LEGACY_PROJECT}/session-legacy.json`);

    expect(trajectory.source).toBe('gemini');
    expect(trajectory.cwd).toBeNull();
    expect(trajectory.turns).toHaveLength(2);
  });

  it('ignores files beside the sessions that are not sessions', async () => {
    const summaries = await createGeminiReader(home).list();

    expect(summaries.some((summary) => summary.sessionRef.endsWith('notes.txt'))).toBe(false);
  });

  it('names the ref it could not find rather than returning nothing', async () => {
    await expect(createGeminiReader(home).read('billing/session-absent.jsonl')).rejects.toThrow(
      /session-absent\.jsonl/,
    );
  });

  it('says Gemini CLI has never run here rather than reporting no sessions', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'mne100-gemini-empty-'));

    await expect(createGeminiReader(empty).list()).rejects.toThrow(/run Gemini CLI at least once/);
  });
});
