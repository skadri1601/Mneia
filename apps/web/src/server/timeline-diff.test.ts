import type { ContextItem } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { diffBeliefs, parseAsOf } from './timeline-diff.js';

const NOW = new Date('2026-08-08T12:00:00.000Z');

const item = (id: string): ContextItem =>
  ({
    id,
    kind: 'decision',
    title: `decision ${id}`,
    body: null,
    status: 'active',
    loadBearing: false,
    humanConfirmed: false,
    confidence: 0.8,
    assertedAt: new Date('2026-08-01T00:00:00.000Z'),
    validTo: null,
  }) as unknown as ContextItem;

describe('parseAsOf', () => {
  it('falls back to now when no date is given', () => {
    expect(parseAsOf(undefined, NOW)).toEqual({ at: NOW, invalid: false });
    expect(parseAsOf('', NOW)).toEqual({ at: NOW, invalid: false });
  });

  it('reads a plain date as the end of that day, so the whole day counts', () => {
    const parsed = parseAsOf('2026-08-03', NOW);

    expect(parsed.invalid).toBe(false);
    expect(parsed.at.toISOString()).toBe('2026-08-03T23:59:59.999Z');
  });

  it('reports a malformed date rather than silently reading a different day', () => {
    for (const raw of ['3rd August', '2026-8-3', '2026-08-03T10:00:00Z', 'yesterday']) {
      const parsed = parseAsOf(raw, NOW);
      expect(parsed.invalid, raw).toBe(true);
      expect(parsed.at, raw).toBe(NOW);
    }
  });

  it('reports a well-formed but impossible date as invalid', () => {
    expect(parseAsOf('2026-13-45', NOW).invalid).toBe(true);
  });
});

describe('diffBeliefs', () => {
  it('marks what was believed then and no longer holds', () => {
    const diff = diffBeliefs([item('a'), item('b')], [item('b')]);

    expect(diff.then.map((entry) => [entry.item.id, entry.changed])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(diff.noLongerHolds).toBe(1);
  });

  it('lists what has been believed since, which nobody working that day could have known', () => {
    const diff = diffBeliefs([item('a')], [item('a'), item('c')]);

    expect(diff.since.map((entry) => entry.item.id)).toEqual(['c']);
    expect(diff.noLongerHolds).toBe(0);
  });

  it('reports nothing changed when the two sets match', () => {
    const diff = diffBeliefs([item('a'), item('b')], [item('b'), item('a')]);

    expect(diff.noLongerHolds).toBe(0);
    expect(diff.since).toHaveLength(0);
  });

  it('treats a date before the project existed as nothing believed and everything since', () => {
    const diff = diffBeliefs([], [item('a'), item('b')]);

    expect(diff.then).toHaveLength(0);
    expect(diff.since.map((entry) => entry.item.id)).toEqual(['a', 'b']);
  });

  it('keeps the order it was given, so the page does not reshuffle rows', () => {
    const diff = diffBeliefs([item('c'), item('a'), item('b')], []);

    expect(diff.then.map((entry) => entry.item.id)).toEqual(['c', 'a', 'b']);
    expect(diff.noLongerHolds).toBe(3);
  });
});
