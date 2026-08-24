import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClaudeCodeReader, projectSlug } from './claude-code.js';
import { discoverTrajectorySessions } from './discover.js';

const CWD = 'C:\\repo\\project';
const PARENT_REF = '082a3f76-164d-46f8-9e58-996dcc032a03';
const CHILD_REF = 'agent-a0ff22758c2053ca7';
const SIBLING_REF = 'agent-a1a5fb1c269dfe293';

/**
 * Both files record `sessionId: PARENT_REF`, because Claude Code writes the root session's
 * id onto every line of a sub-agent transcript too. That is the trap this suite exists for:
 * a reader that takes the ref from the contents gives parent and child one identity, and
 * discovery then deduplicates one of them away.
 */
const transcript = (refs: { readonly cwd: string; readonly at: string }): string =>
  [
    JSON.stringify({
      type: 'user',
      uuid: 'u1',
      sessionId: PARENT_REF,
      cwd: refs.cwd,
      timestamp: refs.at,
      message: { role: 'user', content: 'Find every caller of listJsonlFiles.' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      sessionId: PARENT_REF,
      cwd: refs.cwd,
      timestamp: refs.at,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Three, all in core.' }] },
    }),
  ].join('\n');

describe('Claude Code sub-agent transcripts', () => {
  let root: string;
  let projectsRoot: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mneia-subagents-'));
    projectsRoot = join(root, 'projects');

    const project = join(projectsRoot, projectSlug(CWD));
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, `${PARENT_REF}.jsonl`),
      transcript({ cwd: CWD, at: '2026-08-01T10:00:00.000Z' }),
      'utf8',
    );

    const subagents = join(project, PARENT_REF, 'subagents');
    await mkdir(subagents, { recursive: true });
    await writeFile(
      join(subagents, `${CHILD_REF}.jsonl`),
      transcript({ cwd: CWD, at: '2026-08-01T10:05:00.000Z' }),
      'utf8',
    );
    await writeFile(
      join(subagents, `${SIBLING_REF}.jsonl`),
      transcript({ cwd: CWD, at: '2026-08-01T10:06:00.000Z' }),
      'utf8',
    );
    // Metadata Claude Code writes beside each transcript, and a sibling directory of
    // unrelated files. Neither is a transcript, and sweeping either in would report
    // sessions that do not exist.
    await writeFile(
      join(subagents, `${CHILD_REF}.meta.json`),
      JSON.stringify({ agentType: 'general-purpose', spawnDepth: 1 }),
      'utf8',
    );
    const toolResults = join(project, PARENT_REF, 'tool-results');
    await mkdir(toolResults, { recursive: true });
    await writeFile(
      join(toolResults, 'captured-output.jsonl'),
      transcript({
        cwd: CWD,
        at: '2026-08-01T10:07:00.000Z',
      }),
      'utf8',
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists the sub-agent transcripts a flat readdir misses, and names their parent', async () => {
    const listed = await createClaudeCodeReader({ projectsRoot }).list({ cwd: CWD });

    expect(listed.map((entry) => entry.sessionRef).sort()).toEqual(
      [PARENT_REF, CHILD_REF, SIBLING_REF].sort(),
    );

    const byRef = new Map(listed.map((entry) => [entry.sessionRef, entry]));
    expect(byRef.get(PARENT_REF)?.parentSessionRef).toBeNull();
    expect(byRef.get(CHILD_REF)?.parentSessionRef).toBe(PARENT_REF);
    expect(byRef.get(SIBLING_REF)?.parentSessionRef).toBe(PARENT_REF);
  });

  it('descends into subagents only, so files beside a transcript are not read as sessions', async () => {
    const listed = await createClaudeCodeReader({ projectsRoot }).list({ cwd: CWD });
    expect(listed.map((entry) => entry.sessionRef)).not.toContain('captured-output');
    expect(listed.map((entry) => entry.sessionRef)).not.toContain(`${CHILD_REF}.meta`);
  });

  it('takes a child ref from its filename, never from the parent sessionId inside it', async () => {
    const reader = createClaudeCodeReader({ projectsRoot });

    const child = await reader.read(CHILD_REF);
    expect(child.sessionRef).toBe(CHILD_REF);
    expect(child.parentSessionRef).toBe(PARENT_REF);

    const parent = await reader.read(PARENT_REF);
    expect(parent.sessionRef).toBe(PARENT_REF);
    expect(parent.parentSessionRef).toBeNull();

    // The turns are byte-identical, so nothing but the ref keeps the two sessions apart.
    expect(child.sessionRef).not.toBe(parent.sessionRef);
  });

  it('keeps parent and child distinct through discovery, which deduplicates on the ref', async () => {
    const { sessions } = await discoverTrajectorySessions({ cwd: CWD }, [
      createClaudeCodeReader({ projectsRoot }),
    ]);

    expect(sessions).toHaveLength(3);
    expect(sessions.filter((entry) => entry.parentSessionRef === PARENT_REF)).toHaveLength(2);
  });

  it('reports no sub-agents for a project that has none', async () => {
    const bare = join(root, 'bare');
    const project = join(bare, projectSlug(CWD));
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, 'lone-session.jsonl'),
      transcript({ cwd: CWD, at: '2026-08-01T11:00:00.000Z' }),
      'utf8',
    );

    const listed = await createClaudeCodeReader({ projectsRoot: bare }).list({ cwd: CWD });
    expect(listed.map((entry) => entry.parentSessionRef)).toEqual([null]);
  });
});
