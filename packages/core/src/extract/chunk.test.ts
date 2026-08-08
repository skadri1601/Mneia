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

  it('truncates a single turn too large for the budget rather than dropping it', () => {
    const turns = [turn('small', words(5)), turn('huge', words(5000)), turn('after', words(5))];
    const { chunks, truncatedTurns } = chunkTurns(turns, { budgetTokens: 400 });

    expect(truncatedTurns).toBe(1);

    const seen = chunks.flatMap((chunk) => chunk.turns.map((t) => t.ref));
    expect(seen).toEqual(['small', 'huge', 'after']);

    const huge = chunks.flatMap((chunk) => chunk.turns).find((t) => t.ref === 'huge');
    expect(huge?.text).toContain('truncated by mneia');
    expect(defaultTokenCounter.count(huge?.text ?? '')).toBeLessThanOrEqual(400);
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
