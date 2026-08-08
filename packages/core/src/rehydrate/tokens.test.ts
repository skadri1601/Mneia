import { describe, expect, it } from 'vitest';
import type { ContextItem } from '../domain/types.js';
import {
  countItemTokens,
  defaultTokenCounter,
  heuristicTokenCounter,
  ITEM_MARKUP_TOKENS,
  type TokenCounter,
  TRUNCATION_MARKER,
  truncateToTokens,
} from './tokens.js';

const count = (text: string): number => heuristicTokenCounter.count(text);
const defaultCount = (text: string): number => defaultTokenCounter.count(text);

const PROSE = 'The quick brown fox jumps over the lazy dog.';

const CODE = [
  'export function packSlice(items: readonly ScoredItem[], budget: number): PackedSlice {',
  '  const kept = [];',
  '  for (const scored of items) {',
  '    if (used + scored.tokens <= budget) { kept.push(scored); }',
  '  }',
  '  return { items: kept, tokensUsed: used };',
  '}',
].join('\n');

const MARKDOWN = [
  '## Constraints (do not violate)',
  '',
  '- [human - confirmed 2026-07-14] No downtime window. Cutover must be online.',
  '- [agent - unconfirmed] Stripe webhook ordering is not guaranteed.',
].join('\n');

const PROSE_TOKENS = 10;
const CODE_TOKENS = 75;
const MARKDOWN_TOKENS = 45;

const REFERENCE_COUNTS: readonly (readonly [string, number])[] = [
  [PROSE, PROSE_TOKENS],
  ['hello', 1],
  ['Mneia keeps project memory across sessions and agents.', 11],
  [CODE, CODE_TOKENS],
  [MARKDOWN, MARKDOWN_TOKENS],
  ['a3f1c9e2b7d40518aa6c39e2b1d7f04c8e5a9b23', 17],
  ['SGVsbG8gd29ybGQsIHRoaXMgaXMgYmFzZTY0IGRhdGE=', 15],
  ['const total = 1234567 + 89;', 9],
  ['https://mneia.dev/docs/rehydrate?budget=4000&task=migration', 22],
  ['决定采用 Postgres 与 pgvector 作为唯一存储引擎。', 20],
  ['shipped 🚀 and the team said 🎉🎉', 14],
  ['\t\tif (x) { return; }', 9],
];

const BASE_ITEM: ContextItem = {
  id: '00000000-0000-4000-8000-000000000000',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  kind: 'decision',
  title: 'Postgres advisory locks over Redis for the cutover lock',
  body: null,
  status: 'active',
  assertedBy: '33333333-3333-4333-8333-333333333333',
  assertedAt: new Date('2026-08-01T12:00:00.000Z'),
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.8,
  humanConfirmed: true,
  loadBearing: false,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: new Date('2026-08-01T12:00:00.000Z'),
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope: 'project',
  embedding: null,
  embeddingModel: null,
};

const item = (overrides: Partial<ContextItem> = {}): ContextItem => ({
  ...BASE_ITEM,
  ...overrides,
});

const wordCounter: TokenCounter = {
  name: 'test-words',
  count: (text) => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length),
};

describe('heuristicTokenCounter', () => {
  it('is named so a stored count can be attributed to the counter that produced it', () => {
    expect(heuristicTokenCounter.name).toBe('heuristic-v1');
  });

  it('counts the empty string as zero and any non-empty string as at least one', () => {
    expect(count('')).toBe(0);
    expect(count(' ')).toBeGreaterThanOrEqual(1);
    expect(count('a')).toBeGreaterThanOrEqual(1);
    expect(count('\n')).toBeGreaterThanOrEqual(1);
  });

  it('never yields fewer tokens as text grows, over every prefix', () => {
    const sample = `${PROSE}\n\n${CODE}\n\n决定 🚀 a3f1c9e2b7d4`;

    let previous = 0;
    for (let end = 0; end <= sample.length; end += 1) {
      const current = count(sample.slice(0, end));
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('never yields fewer tokens when text is appended', () => {
    const parts = [PROSE, CODE, MARKDOWN, '决定采用 Postgres', '🚀'];

    let accumulated = '';
    let previous = 0;
    for (const part of parts) {
      accumulated += part;
      const current = count(accumulated);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('never undercounts a representative corpus', () => {
    for (const [text, reference] of REFERENCE_COUNTS) {
      expect(count(text)).toBeGreaterThanOrEqual(reference);
    }
  });

  it('keeps the safety bias on ASCII content below 2x so it stays a margin, not a tax', () => {
    expect(count(PROSE)).toBeLessThan(2 * PROSE_TOKENS);
    expect(count(CODE)).toBeLessThan(2 * CODE_TOKENS);
    expect(count(MARKDOWN)).toBeLessThan(2 * MARKDOWN_TOKENS);
  });

  it('charges non-ASCII text by its utf-8 byte length', () => {
    expect(count('决')).toBe(3);
    expect(count('é')).toBe(2);
    expect(count('🚀')).toBe(4);
  });

  it('treats a single separating space as free but charges longer whitespace runs', () => {
    expect(count('alpha beta')).toBe(count('alpha') + count('beta'));
    expect(count('alpha          beta')).toBeGreaterThan(count('alpha beta'));
  });

  it('charges high-entropy alphanumeric runs more per character than prose words', () => {
    expect(count('a3f1c9e2b7d40518')).toBeGreaterThan(count('participation'));
  });
});

describe('countItemTokens', () => {
  it('accounts for the title, the body, and the markup the renderer adds', () => {
    const withBody = item({ body: 'Rationale: we already page on Postgres.' });
    const bare = item({ body: null });

    expect(countItemTokens(bare)).toBe(ITEM_MARKUP_TOKENS + defaultCount(bare.title));
    expect(countItemTokens(withBody)).toBeGreaterThan(countItemTokens(bare));
    expect(countItemTokens(withBody)).toBeGreaterThan(defaultCount(withBody.body ?? ''));
  });

  it('grows with the body it will have to render', () => {
    const short = item({ body: 'short note' });
    const long = item({ body: `${'a longer body sentence. '.repeat(20)}` });

    expect(countItemTokens(long)).toBeGreaterThan(countItemTokens(short));
  });

  it('uses an injected counter so a real tokenizer can replace the heuristic', () => {
    const injected = item({ title: 'one two three', body: 'four five' });

    expect(countItemTokens(injected, wordCounter)).toBe(ITEM_MARKUP_TOKENS + 5);
  });
});

describe('truncateToTokens', () => {
  it('returns the text unchanged when it already fits', () => {
    expect(truncateToTokens(PROSE, 1000)).toBe(PROSE);
  });

  it('returns an empty string for a non-positive budget', () => {
    expect(truncateToTokens(PROSE, 0)).toBe('');
    expect(truncateToTokens(PROSE, -5)).toBe('');
  });

  it('produces a result that fits the requested budget', () => {
    const text = `${PROSE} ${PROSE} ${PROSE}`;

    for (const budget of [1, 2, 3, 5, 8, 13, 21, 34]) {
      expect(defaultCount(truncateToTokens(text, budget))).toBeLessThanOrEqual(budget);
    }
  });

  it('marks the result as truncated', () => {
    const truncated = truncateToTokens(`${PROSE} ${PROSE}`, 12);

    expect(truncated.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it('cuts on a word boundary and never mid-word', () => {
    const text = `${PROSE} ${PROSE}`;
    const truncated = truncateToTokens(text, 12);
    const kept = truncated.slice(0, truncated.length - TRUNCATION_MARKER.length);

    expect(kept.length).toBeGreaterThan(0);
    expect(text.startsWith(kept)).toBe(true);
    expect(text.slice(kept.length, kept.length + 1)).toMatch(/\s/);
  });

  it('cuts on a line boundary when the budget lands mid-document', () => {
    const truncated = truncateToTokens(CODE, 40);
    const kept = truncated.slice(0, truncated.length - TRUNCATION_MARKER.length);

    expect(CODE.startsWith(kept)).toBe(true);
    expect(defaultCount(truncated)).toBeLessThanOrEqual(40);
  });

  it('falls back to the marker alone rather than splitting an unbroken run', () => {
    const unbroken = 'a3f1c9e2b7d40518aa6c39e2b1d7f04c8e5a9b23'.repeat(4);
    const truncated = truncateToTokens(unbroken, 8);

    expect(truncated).toBe(TRUNCATION_MARKER.trim());
    expect(defaultCount(truncated)).toBeLessThanOrEqual(8);
  });

  it('honours an injected counter', () => {
    const text = 'one two three four five six seven eight';

    expect(truncateToTokens(text, 4, wordCounter).startsWith('one two')).toBe(true);
    expect(wordCounter.count(truncateToTokens(text, 4, wordCounter))).toBeLessThanOrEqual(4);
  });
});

describe('the default token counter is a real tokenizer (MNE-70)', () => {
  it('is the BPE counter, not the heuristic', () => {
    expect(defaultTokenCounter.name).toBe('cl100k_base');
    expect(defaultTokenCounter).not.toBe(heuristicTokenCounter);
  });

  it('counts exactly, where the heuristic only bounded', () => {
    const cases: readonly (readonly [string, number])[] = [
      ['we retry with an idempotency key', 8],
      ['Ελληνικά και 日本語 mixed with English text for good measure.', 14],
    ];

    for (const [text, expected] of cases) {
      expect(defaultTokenCounter.count(text)).toBe(expected);
      expect(heuristicTokenCounter.count(text)).toBeGreaterThan(expected);
    }
  });

  it('counts the empty string as zero, like the heuristic', () => {
    expect(defaultTokenCounter.count('')).toBe(0);
  });
});
