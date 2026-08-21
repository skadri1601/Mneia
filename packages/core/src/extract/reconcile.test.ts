import { describe, expect, it } from 'vitest';
import type { ExistingItemSnapshot } from './reconcile.js';
import {
  DEFAULT_CONTRADICTION_SIMILARITY,
  DEFAULT_DUPLICATE_SIMILARITY,
  reconcileCandidates,
} from './reconcile.js';
import type { ExtractionCandidate } from './schema.js';
import { ExtractionError } from './schema.js';

const candidate = (
  overrides: Partial<ExtractionCandidate> & Pick<ExtractionCandidate, 'title'>,
): ExtractionCandidate => ({
  kind: 'decision',
  body: null,
  rationale: 'Recorded so the rejected option is not re-proposed.',
  confidence: 0.8,
  loadBearing: false,
  accessScope: 'project',
  sourceRef: null,
  ...overrides,
});

const existing = (
  overrides: Partial<ExistingItemSnapshot> & Pick<ExistingItemSnapshot, 'id' | 'title'>,
): ExistingItemSnapshot => ({
  kind: 'decision',
  body: null,
  ...overrides,
});

describe('reconcileCandidates', () => {
  it('treats a candidate with no near neighbour as novel', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ title: 'Ship the handoff artifact behind a feature flag' })],
      existing: [existing({ id: 'item-1', title: 'Use Postgres for the store rather than Redis' })],
    });

    expect(result.novel).toHaveLength(1);
    expect(result.duplicates).toHaveLength(0);
    expect(result.contradictions).toHaveLength(0);
    expect(result.novel[0]?.evidence).toBeNull();
  });

  it('rejects a re-assertion of an item already recorded as a duplicate', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ title: 'Use Postgres for the store rather than adding Redis' })],
      existing: [
        existing({ id: 'item-1', title: 'Use Postgres for the store rather than adding Redis' }),
      ],
    });

    expect(result.duplicates).toHaveLength(1);
    expect(result.novel).toHaveLength(0);
    const [entry] = result.duplicates;
    expect(entry?.evidence?.matchedItemId).toBe('item-1');
    expect(entry?.evidence?.subjectSimilarity).toBe(1);
    expect(entry?.reason).toContain('item-1');
  });

  it('produces no new items when an unchanged session is re-checkpointed', () => {
    const candidates = [
      candidate({ title: 'Use Postgres for the store rather than adding Redis' }),
      candidate({ kind: 'constraint', title: 'Rehydration p95 stays under 300ms' }),
      candidate({ kind: 'fact', title: 'The staging database runs Postgres 18' }),
    ];

    const result = reconcileCandidates({
      candidates,
      existing: candidates.map((entry, index) =>
        existing({ id: `item-${index}`, kind: entry.kind, title: entry.title }),
      ),
    });

    expect(result.novel).toHaveLength(0);
    expect(result.contradictions).toHaveLength(0);
    expect(result.duplicates).toHaveLength(3);
  });

  it('ignores an existing item of a different kind when looking for the nearest match', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ kind: 'fact', title: 'The staging database runs Postgres 18' })],
      existing: [
        existing({
          id: 'item-1',
          kind: 'decision',
          title: 'The staging database runs Postgres 18',
        }),
      ],
    });

    expect(result.novel).toHaveLength(1);
    expect(result.duplicates).toHaveLength(0);
  });

  it('flags a stance flip against a recorded prohibition as a contradiction', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ kind: 'constraint', title: 'Log user content for debugging' })],
      existing: [existing({ id: 'item-9', kind: 'constraint', title: 'Never log user content' })],
    });

    expect(result.contradictions).toHaveLength(1);
    const [entry] = result.contradictions;
    expect(entry?.evidence?.signal).toBe('stance_flip');
    expect(entry?.evidence?.candidateStance).toBe('affirm');
    expect(entry?.evidence?.existingStance).toBe('negate');
    expect(entry?.evidence?.matchedItemId).toBe('item-9');
    expect(entry?.reason).toContain('Contradicts context item item-9');
  });

  it('flags a differing value on the same subject as a contradiction rather than a duplicate', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ kind: 'constraint', title: 'Rehydration p95 stays under 500ms' })],
      existing: [
        existing({ id: 'item-4', kind: 'constraint', title: 'Rehydration p95 stays under 300ms' }),
      ],
    });

    expect(result.duplicates).toHaveLength(0);
    expect(result.contradictions).toHaveLength(1);
    const [entry] = result.contradictions;
    expect(entry?.evidence?.signal).toBe('value_conflict');
    expect(entry?.evidence?.candidateNumbers).toContain('500');
    expect(entry?.evidence?.existingNumbers).toContain('300');
    expect(entry?.evidence?.subjectSimilarity).toBe(1);
  });

  it('records the raw evidence behind every verdict', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ kind: 'constraint', title: 'Never log user content' })],
      existing: [
        existing({ id: 'item-9', kind: 'constraint', title: 'Never log user content anywhere' }),
      ],
    });

    const [entry] = result.all;
    expect(entry?.evidence?.sharedSubjectTokens).toEqual(['content', 'log', 'user']);
    expect(entry?.evidence?.subjectSimilarity).toBeGreaterThan(DEFAULT_CONTRADICTION_SIMILARITY);
  });

  it('leaves a weakly related candidate novel rather than guessing', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ title: 'Adopt Biome for formatting across the monorepo' })],
      existing: [existing({ id: 'item-1', title: 'Adopt Vitest for unit tests in packages' })],
    });

    expect(result.novel).toHaveLength(1);
  });

  it('picks the closest existing item when several share the kind', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ title: 'Use Postgres for the store rather than adding Redis' })],
      existing: [
        existing({ id: 'far', title: 'Adopt Biome for formatting across the monorepo' }),
        existing({ id: 'near', title: 'Use Postgres for the store rather than adding Redis' }),
      ],
    });

    expect(result.duplicates[0]?.evidence?.matchedItemId).toBe('near');
  });

  it('preserves the original candidate index on every verdict', () => {
    const result = reconcileCandidates({
      candidates: [
        candidate({ title: 'Ship the handoff artifact behind a feature flag' }),
        candidate({ title: 'Use Postgres for the store rather than adding Redis' }),
      ],
      existing: [
        existing({ id: 'item-1', title: 'Use Postgres for the store rather than adding Redis' }),
      ],
    });

    expect(result.novel[0]?.index).toBe(0);
    expect(result.duplicates[0]?.index).toBe(1);
    expect(result.all.map((entry) => entry.index)).toEqual([0, 1]);
  });

  it('treats an empty store as everything being new', () => {
    const result = reconcileCandidates({
      candidates: [candidate({ title: 'Use Postgres for the store rather than adding Redis' })],
      existing: [],
    });

    expect(result.novel).toHaveLength(1);
  });

  it('carries a same-title candidate whose body materially changed, rather than dropping it', () => {
    const result = reconcileCandidates({
      candidates: [
        candidate({
          title: 'Use Postgres for the store rather than adding Redis',
          body: 'Revised: pgvector covers the semantic search we thought needed a second engine.',
        }),
      ],
      existing: [
        existing({
          id: 'item-1',
          title: 'Use Postgres for the store rather than adding Redis',
          body: 'One dependency keeps the operational surface small.',
        }),
      ],
    });

    expect(result.duplicates).toHaveLength(0);
    expect(result.novel).toHaveLength(1);
  });

  it('still treats a same-title candidate with the same body as a duplicate', () => {
    const body = 'One dependency keeps the operational surface small.';
    const result = reconcileCandidates({
      candidates: [
        candidate({ title: 'Use Postgres for the store rather than adding Redis', body }),
      ],
      existing: [
        existing({
          id: 'item-1',
          title: 'Use Postgres for the store rather than adding Redis',
          body,
        }),
      ],
    });

    expect(result.duplicates).toHaveLength(1);
  });

  it('treats a candidate that merely omits the body as a duplicate, not an update', () => {
    const result = reconcileCandidates({
      candidates: [
        candidate({ title: 'Use Postgres for the store rather than adding Redis', body: null }),
      ],
      existing: [
        existing({
          id: 'item-1',
          title: 'Use Postgres for the store rather than adding Redis',
          body: 'One dependency keeps the operational surface small.',
        }),
      ],
    });

    expect(result.duplicates).toHaveLength(1);
    expect(result.novel).toHaveLength(0);
  });

  it('carries a candidate that adds a body where the recorded item had none', () => {
    const result = reconcileCandidates({
      candidates: [
        candidate({
          title: 'Use Postgres for the store rather than adding Redis',
          body: 'The reason, recorded at last: pgvector removes the need for a second engine.',
        }),
      ],
      existing: [
        existing({
          id: 'item-1',
          title: 'Use Postgres for the store rather than adding Redis',
          body: null,
        }),
      ],
    });

    expect(result.novel).toHaveLength(1);
  });

  it('flags a stance flip even when the candidate carries its own reasoning', () => {
    const result = reconcileCandidates({
      candidates: [
        candidate({
          kind: 'constraint',
          title: 'Put item content in a telemetry event for debugging',
          body: 'The redaction step hides the field we need when an extraction goes wrong.',
        }),
      ],
      existing: [
        existing({
          id: 'item-9',
          kind: 'constraint',
          title: 'Never put item content in a telemetry event',
          body: 'Redaction strips body text before the event is emitted.',
        }),
      ],
    });

    expect(result.novel).toHaveLength(0);
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.evidence?.signal).toBe('stance_flip');
  });

  it('treats a value arriving where the recorded item had none as new, not as a conflict', () => {
    const result = reconcileCandidates({
      candidates: [
        candidate({ kind: 'constraint', title: 'Bound the concurrency to 8 when embedding items' }),
      ],
      existing: [
        existing({
          id: 'item-3',
          kind: 'constraint',
          title: 'Bound the concurrency when embedding items',
        }),
      ],
    });

    expect(result.contradictions).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
    expect(result.novel).toHaveLength(1);
  });

  it('reads an inflected prohibition as agreeing with the recorded prohibition', () => {
    const result = reconcileCandidates({
      candidates: [
        candidate({
          kind: 'constraint',
          title: 'The worktree guard hook refuses any attempt to create a new git worktree',
        }),
      ],
      existing: [
        existing({ id: 'item-7', kind: 'constraint', title: 'Never create a new git worktree' }),
      ],
    });

    expect(result.contradictions).toHaveLength(0);
    expect(result.novel).toHaveLength(1);
  });

  it('refuses a contradiction threshold above the duplicate threshold', () => {
    expect(() =>
      reconcileCandidates({
        candidates: [],
        existing: [],
        options: { duplicateSimilarity: 0.5, contradictionSimilarity: 0.9 },
      }),
    ).toThrow(ExtractionError);
  });

  it('refuses a threshold outside the zero-to-one range', () => {
    expect(() =>
      reconcileCandidates({
        candidates: [],
        existing: [],
        options: { duplicateSimilarity: 1.4 },
      }),
    ).toThrow(/duplicateSimilarity must be a number above 0 and at most 1/);
  });

  it('exposes defaults that leave room between duplicate and contradiction', () => {
    expect(DEFAULT_CONTRADICTION_SIMILARITY).toBeLessThan(DEFAULT_DUPLICATE_SIMILARITY);
  });
});
