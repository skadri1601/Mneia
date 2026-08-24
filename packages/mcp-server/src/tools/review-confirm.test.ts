import type { ActorKind, ContextItem, ItemStatus, ScopedStore } from '@mneia/core';
import { ApiError } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import { LINKED_TOOLS } from '../linked-tools.js';
import { SHIPPED_TOOL_NAMES, ToolRegistry } from '../registry.js';
import { MAX_REASON_LENGTH, reviewConfirmTool } from './review-confirm.js';
import type { ToolContext } from './types.js';

const WORKSPACE = '00000000-0000-4000-8000-000000000009';
const HUMAN = '00000000-0000-4000-8000-000000000008';
const AGENT = '00000000-0000-4000-8000-000000000006';
const PROJECT = '00000000-0000-4000-8000-000000000001';
const OTHER_PROJECT = '00000000-0000-4000-8000-000000000005';
const ITEM = '00000000-0000-4000-8000-000000000002';
const CHECKPOINT = '00000000-0000-4000-8000-000000000003';
const ASSERTER = '00000000-0000-4000-8000-000000000007';

const project = { id: PROJECT, slug: 'payments-migration' };

interface ItemOverrides {
  readonly projectId?: string;
  readonly humanConfirmed?: boolean;
  readonly status?: ItemStatus;
  readonly loadBearing?: boolean;
}

const contextItem = (overrides: ItemOverrides = {}): ContextItem =>
  ({
    id: ITEM,
    projectId: overrides.projectId ?? PROJECT,
    kind: 'constraint',
    title: 'Stripe is the only payment processor',
    body: 'Ruled by the founder on 2026-08-01.',
    confidence: 0.82,
    loadBearing: overrides.loadBearing ?? true,
    accessScope: 'project',
    status: overrides.status ?? 'active',
    humanConfirmed: overrides.humanConfirmed ?? false,
    assertedBy: ASSERTER,
    supersedesId: null,
    supersededById: null,
  }) as unknown as ContextItem;

interface StoreOverrides {
  readonly actorKind?: ActorKind;
  readonly actor?: unknown;
  readonly item?: ContextItem | null;
  readonly reviewPendingItems?: unknown;
  readonly getProjectBySlug?: unknown;
  readonly omitReviewPendingItems?: boolean;
}

const recordedReview = (outcome: 'confirmed' | 'edited' | 'rejected') =>
  vi.fn(async () => ({
    checkpoint: { id: CHECKPOINT },
    outcomes: [{ itemId: ITEM, outcome, fieldsChanged: [] }],
  }));

const contextWith = (overrides: StoreOverrides = {}): ToolContext => {
  const actorKind = overrides.actorKind ?? 'human';
  const store: Record<string, unknown> = {
    scope: { workspaceId: WORKSPACE, actorId: actorKind === 'human' ? HUMAN : AGENT },
    getActor: vi.fn(async () =>
      overrides.actor === undefined
        ? { id: actorKind === 'human' ? HUMAN : AGENT, kind: actorKind, displayName: 'Saad Kadri' }
        : overrides.actor,
    ),
    getProject: vi.fn(async () => project),
    getProjectBySlug: overrides.getProjectBySlug ?? vi.fn(async () => project),
    getContextItem: vi.fn(async () =>
      overrides.item === undefined ? contextItem() : overrides.item,
    ),
  };

  if (overrides.omitReviewPendingItems !== true) {
    store.reviewPendingItems = overrides.reviewPendingItems ?? recordedReview('confirmed');
  }

  return {
    store: store as unknown as ScopedStore,
    now: () => new Date('2026-08-23T00:00:00.000Z'),
    defaultProject: 'payments-migration',
  } as unknown as ToolContext;
};

const storeOf = (context: ToolContext): Record<string, ReturnType<typeof vi.fn>> =>
  context.store as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('mneia_review_confirm', () => {
  it('is registered, so the server that links it can still start', () => {
    expect(SHIPPED_TOOL_NAMES).toContain('mneia_review_confirm');
    expect(LINKED_TOOLS.map((tool) => tool.name)).toContain('mneia_review_confirm');
    expect(() => new ToolRegistry(LINKED_TOOLS)).not.toThrow();
    expect(new ToolRegistry(LINKED_TOOLS).names()).toContain('mneia_review_confirm');
  });

  it('records an approval as a human confirmation against the bound project', async () => {
    const context = contextWith();

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(storeOf(context).reviewPendingItems).toHaveBeenCalledWith({
      projectId: PROJECT,
      reviews: [{ itemId: ITEM, decision: 'accept' }],
      summary: expect.stringContaining('1 confirmed, 0 rejected'),
    });
    expect(result.structuredContent).toMatchObject({
      status: 'recorded',
      itemId: ITEM,
      checkpointId: CHECKPOINT,
      decision: 'approve',
      outcome: 'confirmed',
      humanConfirmed: true,
      confirmedBy: { id: HUMAN, kind: 'human' },
    });
  });

  it('records a rejection with the reason the person gave', async () => {
    const context = contextWith({ reviewPendingItems: recordedReview('rejected') });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({
        itemId: ITEM,
        decision: 'reject',
        reason: 'the heading was scraped as a rule; it was never a rule',
      }),
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(storeOf(context).reviewPendingItems).toHaveBeenCalledWith({
      projectId: PROJECT,
      reviews: [{ itemId: ITEM, decision: 'reject' }],
      summary: expect.stringContaining('it was never a rule'),
    });
    expect(result.structuredContent).toMatchObject({
      outcome: 'rejected',
      humanConfirmed: false,
      reason: 'the heading was scraped as a rule; it was never a rule',
    });
    expect(result.content[0]?.text).toMatch(/Nothing was deleted/);
  });

  it('refuses a rejection with no reason, before anything is read or written', async () => {
    const context = contextWith();

    expect(() => reviewConfirmTool.parse({ itemId: ITEM, decision: 'reject' })).toThrow(
      /reason is required when decision is "reject"/,
    );
    expect(storeOf(context).reviewPendingItems).not.toHaveBeenCalled();
  });

  it('says on every answer that the decision was the person’s, not the agent’s', async () => {
    const context = contextWith();

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.content[0]?.text).toMatch(/Only a person may confirm, edit, or reject/);
    expect(result.content[0]?.text).toMatch(/not yours to make/);
  });

  it('GUARD (§10.1) refuses an agent actor rather than letting it confirm on a human behalf', async () => {
    const context = contextWith({ actorKind: 'agent' });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: 'not_a_human_actor', actorKind: 'agent' },
    });
    expect(storeOf(context).reviewPendingItems).not.toHaveBeenCalled();
  });

  it('GUARD (§10.1) takes the actor from the store, never from the arguments', () => {
    const schema = reviewConfirmTool.inputSchema as { properties?: Record<string, unknown> };
    const accepted = Object.keys(schema.properties ?? {});

    expect(accepted.sort()).toEqual(['decision', 'itemId', 'project', 'reason']);
    for (const forbidden of [
      'actorId',
      'actor',
      'assertedBy',
      'asserted_by',
      'humanConfirmed',
      'human_confirmed',
      'confirmedBy',
      'onBehalfOf',
    ]) {
      expect(accepted).not.toContain(forbidden);
    }
    expect(JSON.stringify(reviewConfirmTool.inputSchema)).not.toMatch(
      /humanConfirmed|human_confirmed|assertedBy|asserted_by|actorId/,
    );
  });

  it('refuses an item a person already confirmed, rather than overwriting them', async () => {
    const context = contextWith({ item: contextItem({ humanConfirmed: true }) });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'already_confirmed' } });
    expect(storeOf(context).reviewPendingItems).not.toHaveBeenCalled();
  });

  it('refuses an item that is no longer active, and says which status it is in', async () => {
    const context = contextWith({ item: contextItem({ status: 'retired' }) });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: 'item_not_pending', status: 'retired' },
    });
    expect(result.content[0]?.text).toMatch(/retired/);
  });

  it('refuses an item belonging to another project rather than filing the decision wrongly', async () => {
    const context = contextWith({ item: contextItem({ projectId: OTHER_PROJECT }) });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: 'project_mismatch', itemProjectId: OTHER_PROJECT },
    });
    expect(storeOf(context).reviewPendingItems).not.toHaveBeenCalled();
  });

  it('names the queue to re-read when the id is not visible in this workspace', async () => {
    const context = contextWith({ item: null });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'item_not_found' } });
    expect(result.content[0]?.text).toMatch(/mneia_review_queue/);
  });

  it('says which project it could not find rather than guessing one', async () => {
    const context = contextWith({ getProjectBySlug: vi.fn(async () => null) });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve', project: 'not-a-project' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'project_not_found' } });
  });

  it('names the store that cannot record a decision instead of failing opaquely', async () => {
    const context = contextWith({ omitReviewPendingItems: true });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'unsupported' } });
  });

  it('translates the API refusal of a non-human reviewer into the same actionable code', async () => {
    const context = contextWith({
      reviewPendingItems: vi.fn(async () => {
        throw new ApiError('forbidden', 'expected the reviewing actor to be of kind "human"', 403);
      }),
    });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'not_a_human_actor' } });
  });

  it('tells the caller nothing was written when the store fails, so the decision is not lost silently', async () => {
    const context = contextWith({
      reviewPendingItems: vi.fn(async () => {
        throw new Error('connection reset');
      }),
    });

    const result = await reviewConfirmTool.run(
      reviewConfirmTool.parse({ itemId: ITEM, decision: 'approve' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'store_unavailable' } });
    expect(result.content[0]?.text).toMatch(/their decision was not saved/);
  });

  it('rejects a decision that is neither approve nor reject before reaching the store', () => {
    expect(() => reviewConfirmTool.parse({ itemId: ITEM, decision: 'maybe' })).toThrow(
      /decision must be "approve" or "reject"/,
    );
    expect(() => reviewConfirmTool.parse({ decision: 'approve' })).toThrow(/itemId/);
    expect(() => reviewConfirmTool.parse({ itemId: 'not-a-uuid', decision: 'approve' })).toThrow(
      /itemId must be a context item id/,
    );
    expect(() =>
      reviewConfirmTool.parse({
        itemId: ITEM,
        decision: 'reject',
        reason: 'x'.repeat(MAX_REASON_LENGTH + 1),
      }),
    ).toThrow(/reason must be at most/);
  });
});
