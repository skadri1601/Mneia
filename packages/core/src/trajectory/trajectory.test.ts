import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClaudeCodeReader, parseClaudeCodeJsonl, projectSlug } from './claude-code.js';
import { createClaudeDesktopReader, findProjectsRoots } from './claude-desktop.js';
import { createCodexReader, parseCodexRollout } from './codex.js';
import { readTrajectoryFile } from './jsonl.js';
import { matchesCwd } from './paths.js';
import { createRefFactory } from './refs.js';
import { TrajectoryError, turnsSince } from './types.js';
import { parseWarpConversation } from './warp.js';

const CWD = 'C:\\repo\\project';

const claudeCodeLine = (record: Record<string, unknown>): string => JSON.stringify(record);

const CLAUDE_CODE_TRANSCRIPT = [
  claudeCodeLine({ type: 'mode', mode: 'normal' }),
  claudeCodeLine({ type: 'file-history-snapshot', snapshot: {} }),
  claudeCodeLine({
    type: 'user',
    uuid: 'u1',
    cwd: CWD,
    timestamp: '2026-08-01T10:00:00.000Z',
    message: { role: 'user', content: 'We will use Postgres, not Mongo.' },
  }),
  claudeCodeLine({
    type: 'user',
    uuid: 'u2',
    isMeta: true,
    timestamp: '2026-08-01T10:00:01.000Z',
    message: { role: 'user', content: 'MODE SWITCH: injected noise' },
  }),
  claudeCodeLine({
    type: 'assistant',
    uuid: 'a1',
    timestamp: '2026-08-01T10:00:02.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Mongo lacks the transactional guarantees.' },
        { type: 'text', text: 'Agreed, Postgres it is.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'psql -c "select 1"' } },
      ],
    },
  }),
  claudeCodeLine({
    type: 'user',
    uuid: 'u3',
    timestamp: '2026-08-01T10:00:03.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', content: '1 row' }] },
  }),
  claudeCodeLine({ type: 'attachment', attachment: { hookName: 'noise' } }),
].join('\n');

const CODEX_ROLLOUT = [
  JSON.stringify({
    timestamp: '2026-08-01T10:00:00.000Z',
    type: 'session_meta',
    payload: { id: 'codex-session-1', cwd: CWD, originator: 'codex_cli' },
  }),
  JSON.stringify({
    timestamp: '2026-08-01T10:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      id: 'm1',
      content: [{ type: 'input_text', text: 'Cache the slice for 60 seconds.' }],
    },
  }),
  JSON.stringify({
    timestamp: '2026-08-01T10:00:02.000Z',
    type: 'response_item',
    payload: {
      type: 'reasoning',
      id: 'r1',
      summary: [{ type: 'summary_text', text: 'Weighing TTL.' }],
    },
  }),
  JSON.stringify({
    timestamp: '2026-08-01T10:00:03.000Z',
    type: 'response_item',
    payload: { type: 'function_call', id: 'f1', name: 'shell', arguments: '{"command":["ls"]}' },
  }),
  JSON.stringify({
    timestamp: '2026-08-01T10:00:04.000Z',
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'f1', output: 'README.md' },
  }),
  JSON.stringify({
    timestamp: '2026-08-01T10:00:05.000Z',
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'duplicate of the response_item stream' },
  }),
].join('\n');

describe('projectSlug', () => {
  it('replaces each non-alphanumeric character rather than collapsing runs', () => {
    expect(projectSlug('C:\\Users\\kadri\\stealth-startup')).toBe('C--Users-kadri-stealth-startup');
  });
});

describe('matchesCwd', () => {
  it('matches the directory itself and anything beneath it', () => {
    expect(matchesCwd(CWD, CWD)).toBe(true);
    expect(matchesCwd(`${CWD}\\.claude\\worktrees\\branch`, CWD)).toBe(true);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    expect(matchesCwd(`${CWD}-other`, CWD)).toBe(false);
  });

  it('treats an unknown directory as a non-match, and no filter as a match', () => {
    expect(matchesCwd(null, CWD)).toBe(false);
    expect(matchesCwd(null, undefined)).toBe(true);
  });
});

describe('createRefFactory', () => {
  it('disambiguates repeated identities so every ref is unique', () => {
    const ref = createRefFactory();
    expect([ref('a'), ref('a'), ref('b'), ref('a')]).toEqual(['a', 'a~1', 'b', 'a~2']);
  });
});

describe('parseClaudeCodeJsonl', () => {
  const parsed = parseClaudeCodeJsonl(CLAUDE_CODE_TRANSCRIPT, 'session-1');

  it('reads the working directory and keeps every content block as its own turn', () => {
    expect(parsed.cwd).toBe(CWD);
    expect(parsed.turns.map((turn) => `${turn.role}:${turn.kind}`)).toEqual([
      'user:text',
      'assistant:thinking',
      'assistant:text',
      'assistant:tool_call',
      'user:tool_result',
    ]);
  });

  it('drops injected meta turns and infrastructure lines', () => {
    expect(parsed.turns.some((turn) => turn.text.includes('injected noise'))).toBe(false);
    expect(parsed.turns.some((turn) => turn.text.includes('hookName'))).toBe(false);
  });

  it('carries the tool name and a unique ordered ref for every turn', () => {
    expect(parsed.turns.find((turn) => turn.kind === 'tool_call')?.toolName).toBe('Bash');
    expect(new Set(parsed.turns.map((turn) => turn.ref)).size).toBe(parsed.turns.length);
  });
});

describe('parseCodexRollout', () => {
  const parsed = parseCodexRollout(CODEX_ROLLOUT, 'fallback');

  it('takes the session id and working directory from session_meta', () => {
    expect(parsed.sessionRef).toBe('codex-session-1');
    expect(parsed.cwd).toBe(CWD);
  });

  it('maps response_item payloads and ignores the duplicate event stream', () => {
    expect(parsed.turns.map((turn) => `${turn.role}:${turn.kind}`)).toEqual([
      'user:text',
      'assistant:thinking',
      'assistant:tool_call',
      'user:tool_result',
    ]);
    expect(parsed.turns.some((turn) => turn.text.includes('duplicate of the response_item'))).toBe(
      false,
    );
  });
});

describe('parseWarpConversation', () => {
  it('reads a conversation whose messages carry a role', () => {
    const data = JSON.stringify({
      messages: [
        {
          id: 'w1',
          role: 'user',
          content: 'Why did the deploy fail?',
          timestamp: 1_785_000_000_000,
        },
        { id: 'w2', role: 'assistant', content: [{ text: 'The migration had not run.' }] },
      ],
    });
    const parsed = parseWarpConversation(data, 'conv-1', CWD);
    expect(parsed.turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(parsed.turns[1]?.text).toBe('The migration had not run.');
  });

  it('fails loudly on an unrecognised blob rather than returning an empty trajectory', () => {
    expect(() => parseWarpConversation('{"unexpected":1}', 'conv-2', null)).toThrow(
      TrajectoryError,
    );
    expect(() => parseWarpConversation('not json', 'conv-3', null)).toThrow(
      /did not parse|report this/,
    );
  });
});

describe('turnsSince', () => {
  const parsed = parseClaudeCodeJsonl(CLAUDE_CODE_TRANSCRIPT, 'session-1');

  it('returns everything when there is no watermark', () => {
    const result = turnsSince(parsed.turns, null);
    expect(result.turns).toHaveLength(parsed.turns.length);
    expect(result.resolved).toBe(true);
  });

  it('returns only the turns after the watermark', () => {
    const watermark = parsed.turns[1]?.ref ?? null;
    const result = turnsSince(parsed.turns, watermark);
    expect(result.resolved).toBe(true);
    expect(result.turns).toHaveLength(parsed.turns.length - 2);
    expect(result.turns[0]?.ref).toBe(parsed.turns[2]?.ref);
  });

  it('re-reads everything when the watermark cannot be found, so no turn is skipped', () => {
    const result = turnsSince(parsed.turns, 'watermark-from-a-rotated-transcript');
    expect(result.resolved).toBe(false);
    expect(result.turns).toHaveLength(parsed.turns.length);
  });
});

describe('readers over a temporary filesystem', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mneia-trajectory-'));

    const claudeProjects = join(root, 'claude', 'projects', projectSlug(CWD));
    await mkdir(claudeProjects, { recursive: true });
    await writeFile(join(claudeProjects, 'session-1.jsonl'), CLAUDE_CODE_TRANSCRIPT, 'utf8');

    const codexDay = join(root, 'codex', '2026', '08', '01');
    await mkdir(codexDay, { recursive: true });
    await writeFile(
      join(codexDay, 'rollout-2026-08-01T10-00-00-codex-session-1.jsonl'),
      CODEX_ROLLOUT,
      'utf8',
    );

    const desktopProjects = join(
      root,
      'desktop',
      'a',
      'b',
      '.claude',
      'projects',
      projectSlug(CWD),
    );
    await mkdir(desktopProjects, { recursive: true });
    await writeFile(join(desktopProjects, 'session-2.jsonl'), CLAUDE_CODE_TRANSCRIPT, 'utf8');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists and reads a Claude Code session, filtered by working directory', async () => {
    const reader = createClaudeCodeReader({ projectsRoot: join(root, 'claude', 'projects') });
    const listed = await reader.list({ cwd: CWD });
    expect(listed.map((entry) => entry.sessionRef)).toEqual(['session-1']);

    const trajectory = await reader.read('session-1');
    expect(trajectory.source).toBe('claude-code');
    expect(trajectory.turns).toHaveLength(5);
  });

  it('reports a missing Claude Code session with a message naming the fix', async () => {
    const reader = createClaudeCodeReader({ projectsRoot: join(root, 'claude', 'projects') });
    await expect(reader.read('absent')).rejects.toThrow(/found none — check the session id/);
  });

  it('reads a Claude Desktop session through its per-session home root', async () => {
    const roots = await findProjectsRoots(join(root, 'desktop'));
    expect(roots).toHaveLength(1);

    const reader = createClaudeDesktopReader({ sessionsRoot: join(root, 'desktop') });
    const listed = await reader.list({ cwd: CWD });
    expect(listed.map((entry) => entry.sessionRef)).toEqual(['session-2']);

    const trajectory = await reader.read('session-2');
    expect(trajectory.source).toBe('claude-desktop');
    expect(trajectory.turns).toHaveLength(5);
  });

  it('lists and reads a Codex rollout', async () => {
    const reader = createCodexReader({ sessionsRoot: join(root, 'codex') });
    const listed = await reader.list({ cwd: CWD });
    expect(listed.map((entry) => entry.sessionRef)).toEqual(['codex-session-1']);

    const trajectory = await reader.read('codex-session-1');
    expect(trajectory.source).toBe('codex');
    expect(trajectory.turns).toHaveLength(4);
  });

  it('reduces every client to the same normalised shape', async () => {
    const claude = await createClaudeCodeReader({
      projectsRoot: join(root, 'claude', 'projects'),
    }).read('session-1');
    const desktop = await createClaudeDesktopReader({ sessionsRoot: join(root, 'desktop') }).read(
      'session-2',
    );
    const codex = await createCodexReader({ sessionsRoot: join(root, 'codex') }).read(
      'codex-session-1',
    );

    for (const trajectory of [claude, desktop, codex]) {
      expect(trajectory.cwd).toBe(CWD);
      for (const turn of trajectory.turns) {
        expect(['user', 'assistant']).toContain(turn.role);
        expect(['text', 'thinking', 'tool_call', 'tool_result']).toContain(turn.kind);
        expect(typeof turn.ref).toBe('string');
        expect(turn.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('reads a Claude Code transcript, a Codex rollout, and plain JSON Lines from a file path', async () => {
    const claudePath = join(root, 'claude', 'projects', projectSlug(CWD), 'session-1.jsonl');
    expect((await readTrajectoryFile(claudePath)).turns).toHaveLength(5);

    const plainPath = join(root, 'plain.jsonl');
    await writeFile(
      plainPath,
      [
        JSON.stringify({ role: 'user', text: 'Ship the reader.' }),
        JSON.stringify({ role: 'assistant', kind: 'text', text: 'Done.' }),
      ].join('\n'),
      'utf8',
    );
    const plain = await readTrajectoryFile(plainPath);
    expect(plain.source).toBe('file');
    expect(plain.turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
  });

  it('reads a Cursor conversation and maps it to the workspace folder', async () => {
    let DatabaseSync: new (
      path: string,
    ) => {
      exec(sql: string): void;
      prepare(sql: string): { run(...parameters: readonly unknown[]): unknown };
      close(): void;
    };
    try {
      ({ DatabaseSync } = (await import('node:sqlite')) as never);
    } catch {
      return;
    }

    const global = join(root, 'cursor-global');
    const workspaces = join(root, 'cursor-workspaces', 'ws1');
    await mkdir(global, { recursive: true });
    await mkdir(workspaces, { recursive: true });
    await writeFile(
      join(workspaces, 'workspace.json'),
      JSON.stringify({ folder: 'file:///c%3A/repo/project' }),
      'utf8',
    );

    const workspaceDb = new DatabaseSync(join(workspaces, 'state.vscdb'));
    workspaceDb.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
    workspaceDb
      .prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)')
      .run('composer.composerData', JSON.stringify({ allComposers: [{ composerId: 'c1' }] }));
    workspaceDb.close();

    const globalDb = new DatabaseSync(join(global, 'state.vscdb'));
    globalDb.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)');
    const insert = globalDb.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
    insert.run(
      'composerData:c1',
      JSON.stringify({
        composerId: 'c1',
        createdAt: 1_785_000_000_000,
        fullConversationHeadersOnly: [
          { bubbleId: 'b1', type: 1 },
          { bubbleId: 'b2', type: 2 },
        ],
      }),
    );
    insert.run(
      'bubbleId:c1:b1',
      JSON.stringify({ type: 1, text: 'Rank by embedding, not recency.' }),
    );
    insert.run(
      'bubbleId:c1:b2',
      JSON.stringify({
        type: 2,
        text: 'Understood.',
        thinking: { text: 'Cosine over the stored vector.' },
        toolFormerData: {
          name: 'read_file',
          rawArgs: '{"path":"score.ts"}',
          result: '{"ok":true}',
        },
      }),
    );
    globalDb.close();

    const { createCursorReader } = await import('./cursor.js');
    const reader = createCursorReader({
      globalStoragePath: join(global, 'state.vscdb'),
      workspaceStoragePath: join(root, 'cursor-workspaces'),
    });

    const listed = await reader.list({ cwd: CWD });
    expect(listed.map((entry) => entry.sessionRef)).toEqual(['c1']);

    const trajectory = await reader.read('c1');
    expect(trajectory.cwd).toBe(CWD);
    expect(trajectory.turns.map((turn) => `${turn.role}:${turn.kind}`)).toEqual([
      'user:text',
      'assistant:thinking',
      'assistant:text',
      'assistant:tool_call',
      'user:tool_result',
    ]);
    expect(trajectory.turns.find((turn) => turn.kind === 'tool_call')?.toolName).toBe('read_file');
  });

  it('refuses a file that is not a transcript', async () => {
    const notATranscript = join(root, 'log.txt');
    await writeFile(notATranscript, 'plain log line\nanother line\n', 'utf8');
    await expect(readTrajectoryFile(notATranscript)).rejects.toThrow(
      /none of those produced any turns/,
    );
  });
});
