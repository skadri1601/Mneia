import { describe, expect, it } from 'vitest';
import type { TelemetryEvent } from './types.js';
import { summarizeExtractorQuality } from './quality.js';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const CHECKPOINT_A = '44444444-4444-4444-8444-44444444444a';
const CHECKPOINT_B = '44444444-4444-4444-8444-44444444444b';

const at = (iso: string): Date => new Date(iso);

const base = (occurredAt: string) => ({
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  actorId: ACTOR,
  sessionId: null,
  occurredAt: at(occurredAt),
});

const extracted = (itemId: string, checkpointId: string, occurredAt: string): TelemetryEvent => ({
  ...base(occurredAt),
  name: 'checkpoint.item_extracted',
  checkpointId,
  itemId,
  kind: 'decision',
  confidence: 0.9,
  loadBearing: false,
  trigger: 'task_boundary',
});

const confirmed = (itemId: string, checkpointId: string, occurredAt: string): TelemetryEvent => ({
  ...base(occurredAt),
  name: 'checkpoint.item_confirmed',
  checkpointId,
  itemId,
});

const edited = (
  itemId: string,
  checkpointId: string,
  occurredAt: string,
  fieldsChanged: readonly string[],
): TelemetryEvent => ({
  ...base(occurredAt),
  name: 'checkpoint.item_edited',
  checkpointId,
  itemId,
  fieldsChanged,
});

const rejected = (itemId: string, checkpointId: string, occurredAt: string): TelemetryEvent => ({
  ...base(occurredAt),
  name: 'checkpoint.item_rejected',
  checkpointId,
  itemId,
  reason: 'not durable',
});

describe('summarizeExtractorQuality', () => {
  it('reports the fraction of reviewed items that survived without an edit', () => {
    const summary = summarizeExtractorQuality([
      extracted('item-1', CHECKPOINT_A, '2026-08-01T09:00:00.000Z'),
      extracted('item-2', CHECKPOINT_A, '2026-08-01T09:00:01.000Z'),
      extracted('item-3', CHECKPOINT_A, '2026-08-01T09:00:02.000Z'),
      extracted('item-4', CHECKPOINT_A, '2026-08-01T09:00:03.000Z'),
      confirmed('item-1', CHECKPOINT_A, '2026-08-01T10:00:00.000Z'),
      confirmed('item-2', CHECKPOINT_A, '2026-08-01T10:00:01.000Z'),
      edited('item-3', CHECKPOINT_A, '2026-08-01T10:00:02.000Z', ['title']),
      rejected('item-4', CHECKPOINT_A, '2026-08-01T10:00:03.000Z'),
    ]);

    expect(summary.extracted).toBe(4);
    expect(summary.confirmed).toBe(2);
    expect(summary.edited).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.reviewed).toBe(4);
    expect(summary.survivalRate).toBe(0.5);
  });

  it('leaves the rate null rather than reporting zero when nothing has been reviewed', () => {
    const summary = summarizeExtractorQuality([
      extracted('item-1', CHECKPOINT_A, '2026-08-01T09:00:00.000Z'),
    ]);

    expect(summary.extracted).toBe(1);
    expect(summary.reviewed).toBe(0);
    expect(summary.survivalRate).toBeNull();
  });

  it('reports the metric per checkpoint, oldest first', () => {
    const summary = summarizeExtractorQuality([
      extracted('item-1', CHECKPOINT_B, '2026-08-02T09:00:00.000Z'),
      edited('item-1', CHECKPOINT_B, '2026-08-02T10:00:00.000Z', ['body']),
      extracted('item-2', CHECKPOINT_A, '2026-08-01T09:00:00.000Z'),
      confirmed('item-2', CHECKPOINT_A, '2026-08-01T10:00:00.000Z'),
    ]);

    expect(summary.checkpoints.map((entry) => entry.checkpointId)).toEqual([
      CHECKPOINT_A,
      CHECKPOINT_B,
    ]);
    expect(summary.checkpoints[0]?.survivalRate).toBe(1);
    expect(summary.checkpoints[1]?.survivalRate).toBe(0);
  });

  it('reports a trend by day so a prompt change can be told from noise', () => {
    const summary = summarizeExtractorQuality([
      extracted('item-1', CHECKPOINT_A, '2026-08-01T09:00:00.000Z'),
      confirmed('item-1', CHECKPOINT_A, '2026-08-01T09:30:00.000Z'),
      extracted('item-2', CHECKPOINT_B, '2026-08-03T09:00:00.000Z'),
      edited('item-2', CHECKPOINT_B, '2026-08-03T09:30:00.000Z', ['title']),
    ]);

    expect(summary.trend.map((point) => point.day)).toEqual(['2026-08-01', '2026-08-03']);
    expect(summary.trend[0]?.survivalRate).toBe(1);
    expect(summary.trend[1]?.survivalRate).toBe(0);
  });

  it('counts an item once when its review is recorded more than once, keeping the latest', () => {
    const summary = summarizeExtractorQuality([
      extracted('item-1', CHECKPOINT_A, '2026-08-01T09:00:00.000Z'),
      confirmed('item-1', CHECKPOINT_A, '2026-08-01T10:00:00.000Z'),
      edited('item-1', CHECKPOINT_A, '2026-08-01T11:00:00.000Z', ['title']),
    ]);

    expect(summary.reviewed).toBe(1);
    expect(summary.confirmed).toBe(0);
    expect(summary.edited).toBe(1);
    expect(summary.survivalRate).toBe(0);
  });

  it('counts an item once when it is extracted more than once', () => {
    const summary = summarizeExtractorQuality([
      extracted('item-1', CHECKPOINT_A, '2026-08-01T09:00:00.000Z'),
      extracted('item-1', CHECKPOINT_A, '2026-08-01T09:00:05.000Z'),
    ]);

    expect(summary.extracted).toBe(1);
  });

  it('names the fields editors actually change, most edited first', () => {
    const summary = summarizeExtractorQuality([
      edited('item-1', CHECKPOINT_A, '2026-08-01T10:00:00.000Z', ['title', 'body']),
      edited('item-2', CHECKPOINT_A, '2026-08-01T10:00:01.000Z', ['title']),
      edited('item-3', CHECKPOINT_A, '2026-08-01T10:00:02.000Z', ['loadBearing']),
    ]);

    expect(summary.editedFields).toEqual([
      ['title', 2],
      ['body', 1],
      ['loadBearing', 1],
    ]);
  });

  it('ignores events that say nothing about extraction quality', () => {
    const summary = summarizeExtractorQuality([
      {
        ...base('2026-08-01T09:00:00.000Z'),
        name: 'rehydration.item_referenced',
        sliceId: CHECKPOINT_A,
        itemId: 'item-1',
      } as TelemetryEvent,
    ]);

    expect(summary.extracted).toBe(0);
    expect(summary.reviewed).toBe(0);
    expect(summary.checkpoints).toHaveLength(0);
  });

  it('returns an empty summary for no events at all', () => {
    const summary = summarizeExtractorQuality([]);

    expect(summary.survivalRate).toBeNull();
    expect(summary.trend).toHaveLength(0);
    expect(summary.editedFields).toHaveLength(0);
  });
});
