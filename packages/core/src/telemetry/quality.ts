import type { Uuid } from '../domain/types.js';
import type { TelemetryEvent } from './types.js';

export type ReviewOutcome = 'confirmed' | 'edited' | 'rejected';

export interface QualityCounts {
  readonly extracted: number;
  readonly confirmed: number;
  readonly edited: number;
  readonly rejected: number;
  readonly reviewed: number;
  readonly survivalRate: number | null;
}

export interface CheckpointQuality extends QualityCounts {
  readonly checkpointId: Uuid;
  readonly firstSeenAt: Date;
}

export interface QualityTrendPoint extends QualityCounts {
  readonly day: string;
}

export interface ExtractorQualitySummary extends QualityCounts {
  readonly checkpoints: readonly CheckpointQuality[];
  readonly trend: readonly QualityTrendPoint[];
  readonly editedFields: readonly (readonly [string, number])[];
}

interface Reviewed {
  readonly outcome: ReviewOutcome;
  readonly occurredAt: Date;
  readonly checkpointId: Uuid;
  readonly day: string;
  readonly fieldsChanged: readonly string[];
}

interface Extracted {
  readonly checkpointId: Uuid;
  readonly occurredAt: Date;
  readonly day: string;
}

const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

const rateOf = (confirmed: number, reviewed: number): number | null =>
  reviewed === 0 ? null : Number((confirmed / reviewed).toFixed(4));

class Tally {
  extracted = 0;
  confirmed = 0;
  edited = 0;
  rejected = 0;

  add(outcome: ReviewOutcome): void {
    if (outcome === 'confirmed') {
      this.confirmed += 1;
      return;
    }
    if (outcome === 'edited') {
      this.edited += 1;
      return;
    }
    this.rejected += 1;
  }

  counts(): QualityCounts {
    const reviewed = this.confirmed + this.edited + this.rejected;
    return {
      extracted: this.extracted,
      confirmed: this.confirmed,
      edited: this.edited,
      rejected: this.rejected,
      reviewed,
      survivalRate: rateOf(this.confirmed, reviewed),
    };
  }
}

const outcomeFor = (name: TelemetryEvent['name']): ReviewOutcome | null => {
  if (name === 'checkpoint.item_confirmed') {
    return 'confirmed';
  }
  if (name === 'checkpoint.item_edited') {
    return 'edited';
  }
  if (name === 'checkpoint.item_rejected') {
    return 'rejected';
  }
  return null;
};

function collect(events: readonly TelemetryEvent[]): {
  reviews: Map<Uuid, Reviewed>;
  extractions: Map<Uuid, Extracted>;
} {
  const reviews = new Map<Uuid, Reviewed>();
  const extractions = new Map<Uuid, Extracted>();

  for (const event of events) {
    if (event.name === 'checkpoint.item_extracted') {
      const seen = extractions.get(event.itemId);
      if (seen === undefined || event.occurredAt < seen.occurredAt) {
        extractions.set(event.itemId, {
          checkpointId: event.checkpointId,
          occurredAt: event.occurredAt,
          day: dayOf(event.occurredAt),
        });
      }
      continue;
    }

    const outcome = outcomeFor(event.name);
    if (outcome === null) {
      continue;
    }

    const itemId = (event as { itemId: Uuid }).itemId;
    const seen = reviews.get(itemId);
    if (seen !== undefined && seen.occurredAt >= event.occurredAt) {
      continue;
    }

    reviews.set(itemId, {
      outcome,
      occurredAt: event.occurredAt,
      checkpointId: (event as { checkpointId: Uuid }).checkpointId,
      day: dayOf(event.occurredAt),
      fieldsChanged:
        outcome === 'edited'
          ? ((event as { fieldsChanged?: readonly string[] }).fieldsChanged ?? [])
          : [],
    });
  }

  return { reviews, extractions };
}

const tallyIn = <TKey>(map: Map<TKey, Tally>, key: TKey): Tally => {
  const found = map.get(key);
  if (found !== undefined) {
    return found;
  }
  const created = new Tally();
  map.set(key, created);
  return created;
};

export function summarizeExtractorQuality(
  events: readonly TelemetryEvent[],
): ExtractorQualitySummary {
  const { reviews, extractions } = collect(events);

  const overall = new Tally();
  const byCheckpoint = new Map<Uuid, Tally>();
  const byDay = new Map<string, Tally>();
  const firstSeen = new Map<Uuid, Date>();
  const fields = new Map<string, number>();

  for (const [, extracted] of extractions) {
    overall.extracted += 1;
    tallyIn(byCheckpoint, extracted.checkpointId).extracted += 1;
    tallyIn(byDay, extracted.day).extracted += 1;
    const seen = firstSeen.get(extracted.checkpointId);
    if (seen === undefined || extracted.occurredAt < seen) {
      firstSeen.set(extracted.checkpointId, extracted.occurredAt);
    }
  }

  for (const [, review] of reviews) {
    overall.add(review.outcome);
    tallyIn(byCheckpoint, review.checkpointId).add(review.outcome);
    tallyIn(byDay, review.day).add(review.outcome);
    const seen = firstSeen.get(review.checkpointId);
    if (seen === undefined || review.occurredAt < seen) {
      firstSeen.set(review.checkpointId, review.occurredAt);
    }
    for (const field of review.fieldsChanged) {
      fields.set(field, (fields.get(field) ?? 0) + 1);
    }
  }

  const checkpoints = [...byCheckpoint.entries()]
    .map(([checkpointId, tally]) => ({
      checkpointId,
      firstSeenAt: firstSeen.get(checkpointId) ?? new Date(0),
      ...tally.counts(),
    }))
    .sort(
      (left, right) =>
        left.firstSeenAt.getTime() - right.firstSeenAt.getTime() ||
        left.checkpointId.localeCompare(right.checkpointId),
    );

  const trend = [...byDay.entries()]
    .map(([day, tally]) => ({ day, ...tally.counts() }))
    .sort((left, right) => left.day.localeCompare(right.day));

  const editedFields = [...fields.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );

  return { ...overall.counts(), checkpoints, trend, editedFields };
}
