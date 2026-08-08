import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../../../../server/current-account.js', () => ({ getCurrentAccount: vi.fn() }));
vi.mock('../../../../server/review-runtime.js', () => ({ submitReview: vi.fn() }));

const { readReviews } = await import('./parse.js');

const formOf = (entries: readonly (readonly [string, string])[]): FormData => {
  const form = new FormData();
  for (const [key, value] of entries) {
    form.append(key, value);
  }
  return form;
};

describe('readReviews', () => {
  it('reads one decision per item, keyed by item id', () => {
    const reviews = readReviews(
      formOf([
        ['itemId', 'a'],
        ['itemId', 'b'],
        ['decision:a', 'accept'],
        ['decision:b', 'reject'],
        ['title:a', 'Use Postgres as the only store'],
        ['title:b', 'Something discarded'],
      ]),
    );

    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({ itemId: 'a', decision: 'accept' });
    expect(reviews[1]).toMatchObject({ itemId: 'b', decision: 'reject' });
  });

  it('skips an item with no decision rather than guessing one', () => {
    const reviews = readReviews(
      formOf([
        ['itemId', 'a'],
        ['itemId', 'b'],
        ['decision:a', 'accept'],
      ]),
    );

    expect(reviews.map((review) => review.itemId)).toEqual(['a']);
  });

  it('refuses a decision value that is neither accept nor reject', () => {
    const reviews = readReviews(
      formOf([
        ['itemId', 'a'],
        ['decision:a', 'maybe'],
      ]),
    );

    expect(reviews).toHaveLength(0);
  });

  it('carries an edited title and body so the store can report what changed', () => {
    const reviews = readReviews(
      formOf([
        ['itemId', 'a'],
        ['decision:a', 'accept'],
        ['title:a', 'A corrected title'],
        ['body:a', 'A corrected rationale'],
      ]),
    );

    expect(reviews[0]).toMatchObject({
      title: 'A corrected title',
      body: 'A corrected rationale',
    });
  });

  it('treats a cleared body as null rather than an empty string', () => {
    const reviews = readReviews(
      formOf([
        ['itemId', 'a'],
        ['decision:a', 'accept'],
        ['body:a', '   '],
      ]),
    );

    expect(reviews[0]?.body).toBeNull();
  });

  it('omits an emptied title, so the stored one is kept rather than blanked', () => {
    const reviews = readReviews(
      formOf([
        ['itemId', 'a'],
        ['decision:a', 'accept'],
        ['title:a', '   '],
      ]),
    );

    expect(reviews[0]).not.toHaveProperty('title');
  });

  it('reads the load-bearing checkbox, including when the reviewer clears it', () => {
    const checked = readReviews(
      formOf([
        ['itemId', 'a'],
        ['decision:a', 'accept'],
        ['loadBearing:a', 'on'],
      ]),
    );
    const cleared = readReviews(
      formOf([
        ['itemId', 'a'],
        ['decision:a', 'accept'],
      ]),
    );

    expect(checked[0]?.loadBearing).toBe(true);
    expect(cleared[0]?.loadBearing).toBe(false);
  });

  it('does not confuse two items whose ids share a prefix', () => {
    const reviews = readReviews(
      formOf([
        ['itemId', 'a'],
        ['itemId', 'ab'],
        ['decision:a', 'accept'],
        ['decision:ab', 'reject'],
        ['title:a', 'first'],
        ['title:ab', 'second'],
      ]),
    );

    expect(reviews.find((review) => review.itemId === 'a')?.title).toBe('first');
    expect(reviews.find((review) => review.itemId === 'ab')?.title).toBe('second');
  });
});
