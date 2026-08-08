import { describe, expect, it } from 'vitest';
import { defaultTokenCounter } from '../rehydrate/tokens.js';
import type { TrajectoryTurn } from '../trajectory/types.js';
import { chunkTurns } from './chunk.js';
import { renderTurn } from './prompt.js';
import { ExtractionError } from './schema.js';

const turn = (ref: string, text: string): TrajectoryTurn => ({
  ref,
  role: 'assistant',
  kind: 'text',
  text,
  toolName: null,
  at: null,
});

const words = (count: number): string => Array.from({ length: count }, () => 'settled').join(' ');

describe('chunkTurns', () => {
  it('keeps everything in one chunk when it fits', () => {
    const turns = [turn('a', words(10)), turn('b', words(10))];
    const { chunks } = chunkTurns(turns, { budgetTokens: 10_000 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.turns.map((t) => t.ref)).toEqual(['a', 'b']);
  });

  it('never skips a turn, however many chunks it takes', () => {
    const turns = Array.from({ length: 60 }, (_, index) => turn(`t${index}`, words(40)));
    const { chunks } = chunkTurns(turns, { budgetTokens: 200 });

    expect(chunks.length).toBeGreaterThan(1);

    const seen = chunks.flatMap((chunk) => chunk.turns.map((t) => t.ref));
    expect(seen).toEqual(turns.map((t) => t.ref));
  });

  it('preserves chronological order across chunks', () => {
    const turns = Array.from({ length: 30 }, (_, index) => turn(`t${index}`, words(50)));
    const { chunks } = chunkTurns(turns, { budgetTokens: 300 });

    const seen = chunks.flatMap((chunk) => chunk.turns.map((t) => t.ref));
    expect(seen).toEqual([...seen].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it('holds every chunk inside the budget', () => {
    const turns = Array.from({ length: 40 }, (_, index) => turn(`t${index}`, words(30)));
    const budget = 500;
    const { chunks } = chunkTurns(turns, { budgetTokens: budget });

    for (const chunk of chunks) {
      const actual = chunk.turns.reduce(
        (total, t) => total + defaultTokenCounter.count(renderTurn(t)),
        0,
      );
      expect(actual).toBeLessThanOrEqual(budget);
    }
  });

  it('splits a single turn too large for the budget instead of truncating it away', () => {
    const body = words(5000);
    const turns = [turn('small', words(5)), turn('huge', body), turn('after', words(5))];
    const { chunks, splitTurns } = chunkTurns(turns, { budgetTokens: 400 });

    expect(splitTurns).toBe(1);

    const parts = chunks
      .flatMap((chunk) => chunk.turns)
      .filter((t) => t.ref === 'huge')
      .map((t) => t.text);
    expect(parts.length).toBeGreaterThan(1);

    const rejoined = parts.map((text) => text.replace(/\n… this turn continues.*$/, '')).join('');
    expect(rejoined).toBe(body);
  });

  it('never lets a chunk that ends mid-turn carry that turn as complete', () => {
    const turns = [turn('a', words(5)), turn('huge', words(5000)), turn('b', words(5))];
    const { chunks } = chunkTurns(turns, { budgetTokens: 400 });

    const midTurn = chunks.filter((chunk) => chunk.endsMidTurn);
    expect(midTurn.length).toBeGreaterThan(0);

    const hugeIndex = 1;
    for (const chunk of midTurn) {
      expect(chunk.completedThrough).toBeLessThan(hugeIndex);
    }

    const final = chunks[chunks.length - 1];
    expect(final?.endsMidTurn).toBe(false);
    expect(final?.completedThrough).toBe(2);
  });

  it('reports completedThrough as the last whole turn in every chunk', () => {
    const turns = Array.from({ length: 20 }, (_, index) => turn(`t${index}`, words(40)));
    const { chunks } = chunkTurns(turns, { budgetTokens: 400 });

    let previous = -1;
    for (const chunk of chunks) {
      expect(chunk.completedThrough).toBeGreaterThanOrEqual(previous);
      const last = chunk.turns[chunk.turns.length - 1];
      expect(turns[chunk.completedThrough]?.ref).toBe(last?.ref);
      previous = chunk.completedThrough;
    }

    expect(chunks[chunks.length - 1]?.completedThrough).toBe(turns.length - 1);
  });

  it('returns no chunks for no turns', () => {
    expect(chunkTurns([], { budgetTokens: 1000 }).chunks).toEqual([]);
  });

  it('refuses a budget that is not a positive number', () => {
    expect(() => chunkTurns([turn('a', 'x')], { budgetTokens: 0 })).toThrow(ExtractionError);
    expect(() => chunkTurns([turn('a', 'x')], { budgetTokens: Number.NaN })).toThrow(
      ExtractionError,
    );
  });
});
