import type { ScopedStore, Session, SessionClientProvenance, Uuid } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { checkpointSourceFor, createWriteSessionResolver } from './session-provenance.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const LEGACY_ID = '22222222-2222-4222-8222-222222222222';

interface Created {
  readonly id: Uuid;
  readonly projectId: Uuid;
  readonly tool: string | null;
  readonly provenance: SessionClientProvenance;
}

function harness(
  options: {
    readonly fail?: boolean;
    readonly client?: { readonly name: string; readonly version: string };
  } = {},
) {
  const created: Created[] = [];
  const ended: Uuid[] = [];
  const warnings: string[] = [];
  const store = {
    createSession: async (
      projectId: Uuid,
      tool: string | null,
      provenance: SessionClientProvenance = {},
    ) => {
      if (options.fail === true) {
        throw new Error('session endpoint unavailable');
      }
      const id =
        `${String(created.length + 3).repeat(8)}-${String(created.length + 3).repeat(4)}-4${String(created.length + 3).repeat(3)}-8${String(created.length + 3).repeat(3)}-${String(created.length + 3).repeat(12)}` as Uuid;
      created.push({ id, projectId, tool, provenance });
      return { id, projectId } as Session;
    },
    endSession: async (id: Uuid) => {
      ended.push(id);
      return { id } as Session;
    },
  } as ScopedStore;
  const resolver = createWriteSessionResolver({
    client: () => options.client,
    warn: (message) => warnings.push(message),
  });
  return { resolver, store, created, ended, warnings };
}

describe('write session provenance', () => {
  it('reuses a conversation ref and separates different refs in one process', async () => {
    const { resolver, store, created } = harness({ client: { name: 'codex', version: '1.2.3' } });

    const first = await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-a' }, null);
    const reused = await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-a' }, null);
    const second = await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-b' }, null);

    expect(reused.sessionId).toBe(first.sessionId);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      tool: 'mcp',
      provenance: {
        clientName: 'codex',
        clientVersion: '1.2.3',
      },
    });
    expect(created.map((entry) => entry.provenance.clientSessionRef)).toEqual([
      'conversation-a',
      'conversation-b',
    ]);
  });

  it('uses one process-scoped session per project and client when the ref is missing', async () => {
    const { resolver, store, created } = harness({ client: { name: 'cursor', version: '2.0.0' } });

    const first = await resolver.resolve(store, PROJECT_ID, { name: 'first label' }, null);
    const second = await resolver.resolve(store, PROJECT_ID, { name: 'changed label' }, null);

    expect(second.sessionId).toBe(first.sessionId);
    expect(created).toHaveLength(1);
    expect(resolver.sessionIdFor(PROJECT_ID)).toBe(first.sessionId);
  });

  it('creates partial provenance when client metadata is unavailable', async () => {
    const { resolver, store, created } = harness();

    const result = await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-a' }, null);

    expect(result.checkpointSource).toBeNull();
    expect(created[0]?.provenance).toEqual({ clientSessionRef: 'conversation-a' });
  });

  it('warns and preserves the legacy id when session creation fails', async () => {
    const { resolver, store, warnings } = harness({
      fail: true,
      client: { name: 'codex', version: '1.2.3' },
    });

    const result = await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-a' }, LEGACY_ID);

    expect(result).toMatchObject({
      sessionId: LEGACY_ID,
      checkpointSource: 'codex',
      sourceSessionRef: 'conversation-a',
    });
    expect(warnings.join(' ')).toContain('session endpoint unavailable');
    expect(warnings.join(' ')).toContain('continuing the write');
  });

  it('passes a sub-agent parent ref through to the store, for it to resolve', async () => {
    const { resolver, store, created } = harness({
      client: { name: 'claude-code', version: '2.1.239' },
    });

    await resolver.resolve(store, PROJECT_ID, { ref: 'agent-a0ff2275', parentRef: 'root-1' }, null);

    expect(created[0]?.provenance).toMatchObject({
      clientSessionRef: 'agent-a0ff2275',
      parentClientSessionRef: 'root-1',
    });
  });

  it('opens one session per parent, so two sub-agents are not merged into one row', async () => {
    // Two sub-agents can agree on client, version and even label; only the parent separates
    // them. Leaving parentRef out of the cache key attributed the second one's writes to the
    // first one's parent.
    const { resolver, store, created } = harness({
      client: { name: 'claude-code', version: '2.1.239' },
    });

    const first = await resolver.resolve(store, PROJECT_ID, { parentRef: 'root-1' }, null);
    const second = await resolver.resolve(store, PROJECT_ID, { parentRef: 'root-2' }, null);
    const reused = await resolver.resolve(store, PROJECT_ID, { parentRef: 'root-1' }, null);

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(reused.sessionId).toBe(first.sessionId);
    expect(created).toHaveLength(2);
  });

  it('records no parentage for a root session', async () => {
    const { resolver, store, created } = harness({
      client: { name: 'claude-code', version: '2.1.239' },
    });

    await resolver.resolve(store, PROJECT_ID, { ref: 'root-1' }, null);

    expect(created[0]?.provenance.parentClientSessionRef).toBeUndefined();
  });

  it('closes every locally opened session best-effort', async () => {
    const { resolver, store, ended } = harness({ client: { name: 'codex', version: '1.2.3' } });
    await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-a' }, null);
    await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-b' }, null);

    await resolver.close(store);

    expect(ended).toHaveLength(2);
  });
});

// TRAJECTORY_SOURCES is what the hosted API validates checkpoint.source against, and the names
// clients actually put in the MCP initialize handshake do not match it. Only Claude Code matched,
// by coincidence. Every write from Cursor or Codex was rejected outright — which is why production
// had only ever seen claude-code write. Found 2026-08-23 by driving mneia_assert from Cursor.
describe('checkpointSourceFor', () => {
  it('accepts the name Claude Code sends, which already is a source', () => {
    expect(checkpointSourceFor({ name: 'claude-code', version: '2.1.239' })).toBe('claude-code');
  });

  it('maps the capitalised name Cursor sends', () => {
    // Captured from Cursor Agent 2026.08.11: clientInfo.name is "Cursor".
    expect(checkpointSourceFor({ name: 'Cursor', version: '1.0.0' })).toBe('cursor');
  });

  it('maps the name Codex sends, which lower-casing alone does not fix', () => {
    // Captured from Codex CLI 0.149.0: clientInfo.name is "codex-mcp-client". This is the case a
    // naive toLowerCase() misses, leaving Codex writes unattributed.
    expect(checkpointSourceFor({ name: 'codex-mcp-client', version: '0.149.0' })).toBe('codex');
  });

  it('normalizes whitespace and case together', () => {
    expect(checkpointSourceFor({ name: '  Gemini CLI  ', version: '1' })).toBe('gemini');
  });

  it('returns null for an unknown client rather than guessing', () => {
    // Recording a wrong source is worse than recording none, and the column is nullable.
    expect(checkpointSourceFor({ name: 'some-new-editor', version: '1' })).toBeNull();
  });

  it('returns null when no client identified itself', () => {
    expect(checkpointSourceFor(undefined)).toBeNull();
  });
});
