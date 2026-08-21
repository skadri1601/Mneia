import { describe, expect, it } from 'vitest';
import { numericLiterals, stanceMarkersIn, stanceOf, subjectTokens } from './similarity.js';

describe('stanceOf', () => {
  it('reads a bare prohibition as a negation', () => {
    expect(stanceOf('Never create a new git worktree')).toBe('negate');
  });

  it('reads the same prohibition in an inflected verb as a negation', () => {
    for (const title of [
      'The guard hook refuses any attempt to create a new git worktree',
      'The policy job rejects a commit with no ticket',
      'The lane guard forbids a direct push to main',
      'The reducer drops nothing from an oversized transcript',
      'The publish check prohibits a broken manifest',
    ]) {
      expect(stanceOf(title), title).toBe('negate');
    }
  });

  it('leaves an ordinary assertion affirmative', () => {
    expect(stanceOf('Publish the client packages to npm when a version PR merges')).toBe('affirm');
  });

  it('reports which markers it found', () => {
    expect(stanceMarkersIn('Never log user content, and never store it without redaction')).toEqual(
      ['never', 'without'],
    );
  });
});

describe('subjectTokens', () => {
  it('drops stopwords, negation markers, and numeric literals', () => {
    expect([...subjectTokens('Rehydrate p95 stays under 300ms')].sort()).toEqual([
      'p95',
      'rehydrate',
      'stays',
      'under',
    ]);
  });

  it('keeps an inflected negation marker out of the subject', () => {
    expect(subjectTokens('The guard refuses a new worktree').has('refuses')).toBe(false);
  });
});

describe('numericLiterals', () => {
  it('returns the distinct values in a stable order', () => {
    expect(numericLiterals('Waitlist addresses are deleted within 30 days, 30 days only')).toEqual([
      '30',
    ]);
  });

  it('returns nothing for text carrying no value', () => {
    expect(numericLiterals('Bound the concurrency when embedding items')).toEqual([]);
  });
});
