import type {
  Checkpoint,
  ContextItemReviewOutcome,
  ReviewCapableStore,
  ReviewPendingItemsInput,
  TelemetryEmitter,
  TelemetryEvent,
} from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { listPendingReview, reviewPendingItems } = await import('./review.js');

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
}

const harness = (outcomes: readonly ContextItemReviewOutcome[]): Harness => {
  const events: TelemetryEvent[] = [];
  const calls: ReviewPendingItemsInput[] = [];

  const store = {
    scope: { workspaceId: WORKSPACE, actorId: REVIEWER },
    async listPendingReviewItems() {
      return [];
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

  return { store, events, telemetry, calls };
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
