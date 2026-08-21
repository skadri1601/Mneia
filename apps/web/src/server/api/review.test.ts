import type {
  Checkpoint,
  ContextItemReviewOutcome,
  PendingReviewItem,
  ReviewCapableStore,
  ReviewPendingItemsInput,
  TelemetryEmitter,
  TelemetryEvent,
} from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { handleListPendingReview, handleReviewPendingItems, listPendingReview, reviewPendingItems } =
  await import('./review.js');

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const REVIEWER = '44444444-4444-4444-8444-444444444444';
const CHECKPOINT = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-08-08T12:00:00.000Z');

const checkpoint: Checkpoint = {
  id: CHECKPOINT,
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  sessionId: null,
  actorId: REVIEWER,
  trigger: 'manual',
  createdAt: NOW,
  summary: null,
};

interface Harness {
  readonly store: ReviewCapableStore;
  readonly events: TelemetryEvent[];
  readonly telemetry: TelemetryEmitter;
  readonly calls: ReviewPendingItemsInput[];
  readonly filters: unknown[];
}

const harness = (
  outcomes: readonly ContextItemReviewOutcome[],
  pending: readonly PendingReviewItem[] = [],
): Harness => {
  const events: TelemetryEvent[] = [];
  const calls: ReviewPendingItemsInput[] = [];
  const filters: unknown[] = [];

  const store = {
    scope: { workspaceId: WORKSPACE, actorId: REVIEWER },
    async listPendingReviewItems(filter: unknown) {
      filters.push(filter);
      return pending;
    },
    async reviewPendingItems(input: ReviewPendingItemsInput) {
      calls.push(input);
      return { checkpoint, outcomes };
    },
  } as unknown as ReviewCapableStore;

  const telemetry = {
    emit: async (event: TelemetryEvent) => {
      events.push(event);
    },
  } as unknown as TelemetryEmitter;

  return { store, events, telemetry, calls, filters };
};

const deps = (telemetry: TelemetryEmitter) => ({ telemetry, now: () => NOW });

describe('reviewPendingItems telemetry', () => {
  it('emits one §17 event per item, matching the outcome the store reported', async () => {
    const sink = harness([
      { itemId: 'item-a', outcome: 'confirmed', fieldsChanged: [] },
      { itemId: 'item-b', outcome: 'edited', fieldsChanged: ['title', 'loadBearing'] },
      { itemId: 'item-c', outcome: 'rejected', fieldsChanged: [] },
    ]);

    await reviewPendingItems(
      sink.store,
      {
        projectId: PROJECT,
        reviews: [
          { itemId: 'item-a', decision: 'accept' },
          { itemId: 'item-b', decision: 'accept', title: 'edited title' },
          { itemId: 'item-c', decision: 'reject' },
        ],
      },
      deps(sink.telemetry),
    );

    expect(sink.events.map((event) => event.name)).toEqual([
      'checkpoint.item_confirmed',
      'checkpoint.item_edited',
      'checkpoint.item_rejected',
    ]);
  });

  it('carries the checkpoint the review created, so the arbitration example is attributable', async () => {
    const sink = harness([{ itemId: 'item-a', outcome: 'confirmed', fieldsChanged: [] }]);

    await reviewPendingItems(
      sink.store,
      { projectId: PROJECT, reviews: [{ itemId: 'item-a', decision: 'accept' }] },
      deps(sink.telemetry),
    );

    expect(sink.events[0]).toMatchObject({
      checkpointId: CHECKPOINT,
      itemId: 'item-a',
      workspaceId: WORKSPACE,
      actorId: REVIEWER,
      projectId: PROJECT,
    });
  });

  it('records which fields a reviewer changed, because that is the training signal', async () => {
    const sink = harness([
      { itemId: 'item-b', outcome: 'edited', fieldsChanged: ['title', 'body'] },
    ]);

    await reviewPendingItems(
      sink.store,
      { projectId: PROJECT, reviews: [{ itemId: 'item-b', decision: 'accept', body: 'new' }] },
      deps(sink.telemetry),
    );

    expect(sink.events[0]).toMatchObject({ fieldsChanged: ['title', 'body'] });
  });

  it('carries no item body into the event payload', async () => {
    const sink = harness([{ itemId: 'item-b', outcome: 'edited', fieldsChanged: ['body'] }]);

    await reviewPendingItems(
      sink.store,
      {
        projectId: PROJECT,
        reviews: [{ itemId: 'item-b', decision: 'accept', body: 'a secret rationale' }],
      },
      deps(sink.telemetry),
    );

    expect(JSON.stringify(sink.events)).not.toContain('a secret rationale');
  });

  it('still returns the result when the telemetry sink throws', async () => {
    const sink = harness([{ itemId: 'item-a', outcome: 'confirmed', fieldsChanged: [] }]);
    const failing = {
      emit: async () => {
        throw new Error('sink is down');
      },
    } as unknown as TelemetryEmitter;

    const { result } = await reviewPendingItems(
      sink.store,
      { projectId: PROJECT, reviews: [{ itemId: 'item-a', decision: 'accept' }] },
      deps(failing),
    );

    expect(result.checkpoint.id).toBe(CHECKPOINT);
  });

  it('passes the reviews straight through to the store', async () => {
    const sink = harness([]);

    await reviewPendingItems(
      sink.store,
      {
        projectId: PROJECT,
        reviews: [{ itemId: 'item-a', decision: 'reject' }],
        summary: 'reviewed the overnight run',
      },
      deps(sink.telemetry),
    );

    expect(sink.calls[0]).toEqual({
      projectId: PROJECT,
      reviews: [{ itemId: 'item-a', decision: 'reject' }],
      summary: 'reviewed the overnight run',
    });
  });
});

describe('listPendingReview', () => {
  it('returns the queue for a project', async () => {
    const sink = harness([]);
    const { items } = await listPendingReview(sink.store, { projectId: PROJECT });
    expect(items).toEqual([]);
  });
});

const ITEM = '11111111-1111-4111-8111-111111111111';

const pendingItem: PendingReviewItem = {
  id: ITEM,
  projectId: PROJECT,
  kind: 'constraint',
  title: 'never auto-supersede a human-confirmed item',
  body: 'vision.md §10.1',
  confidence: 0.72,
  loadBearing: true,
  accessScope: 'project',
  assertedBy: '99999999-9999-4999-8999-999999999999',
  assertedByKind: 'agent',
  assertedByName: 'lane C agent',
  assertedAt: NOW,
  sourceRef: null,
  originCheckpointId: CHECKPOINT,
};

describe('the hosted review handlers', () => {
  it('serves the CLI the same queue the web page reads, through the same store call', async () => {
    const sink = harness([], [pendingItem]);

    const overWire = await handleListPendingReview(sink.store, { projectId: PROJECT, limit: 20 });
    const inProcess = await listPendingReview(sink.store, { projectId: PROJECT, limit: 20 });

    expect(sink.filters).toEqual([
      { projectId: PROJECT, limit: 20 },
      { projectId: PROJECT, limit: 20 },
    ]);
    expect(overWire.items).toEqual([{ ...pendingItem, assertedAt: NOW.toISOString() }]);
    expect(inProcess.items).toEqual([pendingItem]);
  });

  it('emits the same three §17 events for the CLI as the web app, because it is the same handler', async () => {
    const sink = harness([
      { itemId: 'item-a', outcome: 'confirmed', fieldsChanged: [] },
      { itemId: 'item-b', outcome: 'edited', fieldsChanged: ['title'] },
      { itemId: 'item-c', outcome: 'rejected', fieldsChanged: [] },
    ]);

    const { result } = await handleReviewPendingItems(
      sink.store,
      {
        projectId: PROJECT,
        reviews: [
          { itemId: 'item-a', decision: 'accept' },
          { itemId: 'item-b', decision: 'accept', title: 'edited title' },
          { itemId: 'item-c', decision: 'reject' },
        ],
        summary: '2 accepted, 1 rejected',
      },
      deps(sink.telemetry),
    );

    expect(sink.events.map((event) => event.name)).toEqual([
      'checkpoint.item_confirmed',
      'checkpoint.item_edited',
      'checkpoint.item_rejected',
    ]);
    expect(result.checkpoint.id).toBe(CHECKPOINT);
    expect(result.checkpoint.createdAt).toBe(NOW.toISOString());
    expect(result.outcomes).toEqual([
      { itemId: 'item-a', outcome: 'confirmed', fieldsChanged: [] },
      { itemId: 'item-b', outcome: 'edited', fieldsChanged: ['title'] },
      { itemId: 'item-c', outcome: 'rejected', fieldsChanged: [] },
    ]);
  });

  it('hands the store only the review fields, never a confirmation flag or an author', async () => {
    const sink = harness([{ itemId: ITEM, outcome: 'confirmed', fieldsChanged: [] }]);

    await handleReviewPendingItems(
      sink.store,
      { projectId: PROJECT, reviews: [{ itemId: ITEM, decision: 'accept' }] },
      deps(sink.telemetry),
    );

    expect(sink.calls[0]).toEqual({
      projectId: PROJECT,
      reviews: [{ itemId: ITEM, decision: 'accept' }],
    });
    expect(JSON.stringify(sink.calls[0])).not.toMatch(/human_?[Cc]onfirmed|asserted_?[Bb]y/);
  });
});
