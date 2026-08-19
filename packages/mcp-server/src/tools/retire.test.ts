import type { ScopedStore } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import { retireTool } from './retire.js';
import type { ToolContext } from './types.js';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const ITEM = '00000000-0000-4000-8000-000000000002';
const CHECKPOINT = '00000000-0000-4000-8000-000000000003';

const WORKSPACE = '00000000-0000-4000-8000-000000000009';
const ACTOR = '00000000-0000-4000-8000-000000000008';

const contextWith = (store: Record<string, unknown> = {}): ToolContext =>
  ({
    store: {
      scope: { workspaceId: WORKSPACE, actorId: ACTOR },
      ...store,
    } as unknown as ScopedStore,
    now: () => new Date('2026-08-19T00:00:00.000Z'),
    defaultProject: 'mneia',
  }) as unknown as ToolContext;

const valid = {
  projectId: PROJECT,
  itemId: ITEM,
  reason: 'a table row from CLAUDE.md, never a rule',
};

describe('mneia_retire', () => {
  it('refuses a reason that says nothing, because the record has to survive the author', () => {
    expect(() => retireTool.parse({ ...valid, reason: '   ' })).toThrow(/reason must say why/);
  });

  it('refuses an item id that is not an id, rather than sending it to the store', () => {
    expect(() => retireTool.parse({ ...valid, itemId: 'the vercel one' })).toThrow(
      /itemId must be a context item id/,
    );
  });

  it('retires the item and reports the checkpoint that recorded it', async () => {
    const retireContextItem = vi.fn(async () => ({
      checkpoint: { id: CHECKPOINT, projectId: PROJECT },
      item: { id: ITEM, kind: 'constraint', title: '**Vercel** — deploys, build logs' },
    }));
    const context = contextWith({ retireContextItem });

    const result = await retireTool.run(retireTool.parse(valid), context);

    expect(result.isError).toBeUndefined();
    expect(retireContextItem).toHaveBeenCalledWith(valid);
    expect(result.structuredContent).toMatchObject({
      status: 'retired',
      itemId: ITEM,
      checkpointId: CHECKPOINT,
      reason: valid.reason,
    });
  });

  it('says the item still binds when the store refuses, rather than implying it is gone', async () => {
    const retireContextItem = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const context = contextWith({ retireContextItem });

    const result = await retireTool.run(retireTool.parse(valid), context);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Nothing was written — the item still binds/);
  });

  it('names the upgrade path when the bound store cannot retire at all', async () => {
    const context = contextWith();

    const result = await retireTool.run(retireTool.parse(valid), context);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'unsupported' } });
  });
});
