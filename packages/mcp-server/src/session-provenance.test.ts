import type { ScopedStore, Session, SessionClientProvenance, Uuid } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { createWriteSessionResolver } from './session-provenance.js';

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

  it('closes every locally opened session best-effort', async () => {
    const { resolver, store, ended } = harness({ client: { name: 'codex', version: '1.2.3' } });
    await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-a' }, null);
    await resolver.resolve(store, PROJECT_ID, { ref: 'conversation-b' }, null);

    await resolver.close(store);

    expect(ended).toHaveLength(2);
  });
});
