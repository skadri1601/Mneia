import { describe, expect, it } from 'vitest';
import type { TrajectoryTurn } from '../trajectory/types.js';
import {
  applyPrecisionFilter,
  DEFAULT_CONFIDENCE_FLOOR,
  DEFAULT_MAX_CANDIDATES,
} from './filter.js';
import {
  buildExtractionPrompt,
  EXISTING_ITEMS_HEADING,
  EXTRACTION_SYSTEM_PROMPT,
  TRANSCRIPT_HEADING,
} from './prompt.js';
import type { ExtractionCandidate } from './schema.js';
import { ExtractionError, parseExtractionOutput } from './schema.js';

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

const turn = (ref: string, text: string): TrajectoryTurn => ({
  ref,
  role: 'user',
  kind: 'text',
  text,
  toolName: null,
  at: null,
});

describe('parseExtractionOutput', () => {
  it('accepts a fully specified candidate and returns it typed', () => {
    const output = parseExtractionOutput({
      candidates: [
        {
          kind: 'constraint',
          title: 'Rehydration p95 stays under 300ms',
          body: 'Measured at the MCP tool boundary, not inside the ranker.',
          rationale: 'A slow rehydrate is never called, so the product fails.',
          confidence: 0.9,
          loadBearing: true,
          accessScope: 'workspace',
          sourceRef: 'turn-7',
        },
      ],
    });

    expect(output.candidates).toHaveLength(1);
    expect(output.candidates[0]).toEqual({
      kind: 'constraint',
      title: 'Rehydration p95 stays under 300ms',
      body: 'Measured at the MCP tool boundary, not inside the ranker.',
      rationale: 'A slow rehydrate is never called, so the product fails.',
      confidence: 0.9,
      loadBearing: true,
      accessScope: 'workspace',
      sourceRef: 'turn-7',
    });
  });

  it('fills the optional fields with their defaults rather than leaving them absent', () => {
    const output = parseExtractionOutput({
      candidates: [{ kind: 'fact', title: 'Staging runs Postgres 18 with pgvector' }],
    });

    expect(output.candidates[0]).toMatchObject({
      body: null,
      rationale: null,
      sourceRef: null,
      confidence: 0.5,
      loadBearing: false,
      accessScope: 'project',
    });
  });

  it('accepts an empty candidate list, because most sessions hold nothing worth keeping', () => {
    expect(parseExtractionOutput({ candidates: [] })).toEqual({ candidates: [] });
  });

  it('parses a JSON string response as well as an already-decoded value', () => {
    const output = parseExtractionOutput(
      JSON.stringify({ candidates: [{ kind: 'fact', title: 'The store is Postgres only' }] }),
    );

    expect(output.candidates[0]?.title).toBe('The store is Postgres only');
  });

  it('throws not_json when the model wrapped its answer in prose', () => {
    let thrown: unknown;
    try {
      parseExtractionOutput('Sure! Here are the candidates I found:');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ExtractionError);
    expect(thrown).toMatchObject({ code: 'not_json' });
    expect((thrown as ExtractionError).message).toContain('candidates');
    expect((thrown as ExtractionError).message).toContain('Discard the entire response');
  });

  it('throws invalid_shape and returns nothing when one candidate in a batch is malformed', () => {
    const raw = {
      candidates: [
        { kind: 'decision', title: 'Use Postgres for the store rather than adding Redis' },
        { kind: 'reminder', title: 'Not one of the five kinds' },
      ],
    };

    let thrown: unknown;
    let returned: unknown;
    try {
      returned = parseExtractionOutput(raw);
    } catch (error) {
      thrown = error;
    }

    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(ExtractionError);
    expect(thrown).toMatchObject({ code: 'invalid_shape' });
    expect((thrown as ExtractionError).message).toContain('candidates.1.kind');
  });

  it.each([
    ['a missing candidates key', {}],
    ['candidates that is not an array', { candidates: 'none' }],
    ['a null response', null],
    ['a candidate with no title', { candidates: [{ kind: 'fact' }] }],
    ['a candidate with an empty title', { candidates: [{ kind: 'fact', title: '   ' }] }],
    [
      'a candidate with an over-long title',
      { candidates: [{ kind: 'fact', title: 'x'.repeat(301) }] },
    ],
    [
      'a confidence outside 0..1',
      { candidates: [{ kind: 'fact', title: 'A perfectly fine title', confidence: 1.4 }] },
    ],
    [
      'an unknown access scope',
      { candidates: [{ kind: 'fact', title: 'A perfectly fine title', accessScope: 'everyone' }] },
    ],
    [
      'a non-boolean loadBearing',
      { candidates: [{ kind: 'fact', title: 'A perfectly fine title', loadBearing: 'yes' }] },
    ],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseExtractionOutput(raw)).toThrow(ExtractionError);
  });

  it('names what was expected, what was received, and what to do', () => {
    try {
      parseExtractionOutput({ candidates: 'none' });
      expect.unreachable('parseExtractionOutput should have thrown');
    } catch (error) {
      const message = (error as ExtractionError).message;
      expect(message).toContain('Expected');
      expect(message).toContain('received');
      expect(message).toMatch(/run the extraction again|Discard the entire response/);
    }
  });
});

describe('applyPrecisionFilter', () => {
  it('keeps a substantive candidate untouched when no load-bearing signal fires', () => {
    const item = candidate({ title: 'Embeddings are written one row per model identity' });
    const result = applyPrecisionFilter([item]);

    expect(result.kept).toEqual([item]);
    expect(result.kept[0]).toBe(item);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects candidates below the confidence floor and keeps those on it', () => {
    const below = candidate({
      title: 'Might switch the queue to SQS at some point',
      confidence: 0.2,
    });
    const atFloor = candidate({
      title: 'Embeddings live in context_item_embedding, one row per model',
      confidence: DEFAULT_CONFIDENCE_FLOOR,
    });

    const result = applyPrecisionFilter([below, atFloor]);

    expect(result.kept).toEqual([atFloor]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.candidate).toBe(below);
    expect(result.rejected[0]?.reason).toContain('below');
  });

  it('honours a caller-supplied confidence floor', () => {
    const item = candidate({ title: 'Ship the migration runner before the CLI', confidence: 0.5 });

    expect(applyPrecisionFilter([item], { confidenceFloor: 0.6 }).kept).toHaveLength(0);
    expect(applyPrecisionFilter([item], { confidenceFloor: 0.4 }).kept).toHaveLength(1);
  });

  it('caps the queue and keeps the highest-confidence candidates in their original order', () => {
    const items = [
      candidate({ title: 'Decision number one about the storage layer', confidence: 0.4 }),
      candidate({ title: 'Decision number two about the ranking weights', confidence: 0.9 }),
      candidate({ title: 'Decision number three about the telemetry spine', confidence: 0.7 }),
    ];

    const result = applyPrecisionFilter(items, { maxCandidates: 2 });

    expect(result.kept.map((item) => item.title)).toEqual([
      'Decision number two about the ranking weights',
      'Decision number three about the telemetry spine',
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.candidate.confidence).toBe(0.4);
    expect(result.rejected[0]?.reason).toContain('2');
  });

  it('defaults the cap to the documented maximum', () => {
    const items = Array.from({ length: DEFAULT_MAX_CANDIDATES + 5 }, (_value, index) =>
      candidate({ title: `Distinct durable decision number ${index} about the store` }),
    );

    const result = applyPrecisionFilter(items);

    expect(result.kept).toHaveLength(DEFAULT_MAX_CANDIDATES);
    expect(result.rejected).toHaveLength(5);
  });

  it.each([
    ['a pleasantry', 'Thanks for all the help today'],
    ['an acknowledgement', 'Sounds good, that works for me'],
    ['narration of the conversation', 'The user said hello and asked how things were going'],
    ['a conversational filler opener', 'Okay, moving on to the next thing now'],
    ['a summary label', 'Discussion about the database schema changes'],
    ['a title too short to read cold', 'Use Redis'],
    ['a title with no words in it', '!!! ??? ...'],
  ])('rejects %s as filler', (_label, title) => {
    const result = applyPrecisionFilter([candidate({ title })]);

    expect(result.kept).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason.length).toBeGreaterThan(0);
  });

  it('rejects a near-duplicate of a candidate it already kept', () => {
    const first = candidate({ title: 'Use Postgres for the store rather than adding Redis' });
    const second = candidate({ title: 'Use Postgres for the store, rather than adding Redis.' });

    const result = applyPrecisionFilter([first, second]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.title).toBe(first.title);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.candidate).toBe(second);
    expect(result.rejected[0]?.reason).toContain('duplicates');
  });

  it('drops a decision that arrives without its rationale', () => {
    const result = applyPrecisionFilter([
      candidate({ title: 'Reject Redis and keep Postgres as the only store', rationale: null }),
      candidate({ title: 'Reject Redis and keep Postgres as the only store', rationale: '   ' }),
    ]);

    expect(result.kept).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]?.reason).toMatch(/rationale/);
  });

  it('requires a rationale only of decisions, not of the other four kinds', () => {
    const result = applyPrecisionFilter([
      candidate({ kind: 'constraint', title: 'Rehydrate p95 stays under 300ms', rationale: null }),
      candidate({ kind: 'fact', title: 'The store is Neon Postgres 18', rationale: null }),
      candidate({ kind: 'open_question', title: 'Who owns the Warp reader?', rationale: null }),
    ]);

    expect(result.kept).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);
  });

  it('can be told not to require a rationale, for a caller that wants recall', () => {
    const result = applyPrecisionFilter(
      [candidate({ title: 'Reject Redis and keep Postgres as the only store', rationale: null })],
      { requireDecisionRationale: false },
    );

    expect(result.kept).toHaveLength(1);
  });

  it('does not treat two different decisions as duplicates', () => {
    const result = applyPrecisionFilter([
      candidate({ title: 'Use Postgres for the store rather than adding Redis' }),
      candidate({ title: 'Use pgvector with an HNSW index rather than ivfflat' }),
    ]);

    expect(result.kept).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it('suggests load_bearing on a kept candidate the extraction left false', () => {
    const item = candidate({
      kind: 'constraint',
      title: 'Rehydration p95 must stay under 300ms',
      loadBearing: false,
    });

    const result = applyPrecisionFilter([item]);

    expect(result.kept[0]?.loadBearing).toBe(true);
    expect(item.loadBearing).toBe(false);
  });

  it('never demotes a candidate the extraction marked load-bearing', () => {
    const item = candidate({
      kind: 'fact',
      title: 'The billing dashboard lives under /projects',
      loadBearing: true,
    });

    expect(applyPrecisionFilter([item]).kept[0]?.loadBearing).toBe(true);
  });

  it("can be told to leave the extraction's own answer alone", () => {
    const item = candidate({
      kind: 'constraint',
      title: 'Rehydration p95 must stay under 300ms',
      loadBearing: false,
    });

    expect(applyPrecisionFilter([item], { suggestLoadBearing: false }).kept[0]?.loadBearing).toBe(
      false,
    );
  });

  it('refuses nonsensical options rather than silently correcting them', () => {
    expect(() => applyPrecisionFilter([], { confidenceFloor: 1.5 })).toThrow(ExtractionError);
    expect(() => applyPrecisionFilter([], { maxCandidates: 0 })).toThrow(ExtractionError);
    expect(() => applyPrecisionFilter([], { maxCandidates: 2.5 })).toThrow(ExtractionError);
  });
});

describe('buildExtractionPrompt', () => {
  const existingItems = [
    { id: 'item-1', title: 'The store is Postgres with pgvector, hosted' },
    { id: 'item-2', title: 'Rehydration p95 stays under 300ms' },
  ];

  it('puts the stable existing-items block before the volatile transcript', () => {
    const prompt = buildExtractionPrompt({
      turns: [turn('turn-1', 'We are going to drop the Redis idea.')],
      existingItems,
    });

    const existingAt = prompt.user.indexOf(EXISTING_ITEMS_HEADING);
    const transcriptAt = prompt.user.indexOf(TRANSCRIPT_HEADING);

    expect(existingAt).toBe(0);
    expect(transcriptAt).toBeGreaterThan(existingAt);
    expect(prompt.user.indexOf('item-2')).toBeLessThan(transcriptAt);
    expect(prompt.user.indexOf('drop the Redis idea')).toBeGreaterThan(transcriptAt);
  });

  it('keeps the cacheable prefix byte-identical when only the trajectory changes', () => {
    const first = buildExtractionPrompt({
      turns: [turn('turn-1', 'First session content.')],
      existingItems,
    });
    const second = buildExtractionPrompt({
      turns: [turn('turn-9', 'Entirely different session content.')],
      existingItems,
    });

    expect(second.system).toBe(first.system);
    expect(second.system).toBe(EXTRACTION_SYSTEM_PROMPT);

    const prefixOf = (user: string): string => user.slice(0, user.indexOf(TRANSCRIPT_HEADING));
    expect(prefixOf(second.user)).toBe(prefixOf(first.user));
  });

  it('renders every turn with its ref so a candidate can be attributed', () => {
    const prompt = buildExtractionPrompt({
      turns: [turn('turn-1', 'alpha'), turn('turn-2', 'beta')],
      existingItems: [],
    });

    expect(prompt.user).toContain('ref="turn-1"');
    expect(prompt.user).toContain('ref="turn-2"');
    expect(prompt.user.indexOf('turn-1')).toBeLessThan(prompt.user.indexOf('turn-2'));
  });

  it('still emits a stable prefix when the project has no recorded items', () => {
    const prompt = buildExtractionPrompt({ turns: [], existingItems: [] });

    expect(prompt.user.startsWith(EXISTING_ITEMS_HEADING)).toBe(true);
    expect(prompt.user).toContain(TRANSCRIPT_HEADING);
  });

  it('carries the instructions the two tickets turn on', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"rationale"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('supersedes');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('Precision beats recall');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"loadBearing"');
    for (const cue of [
      'prohibition or requirement',
      'security or privacy rule',
      'irreversible',
      'numeric budget or limit',
      'rejected alternative',
    ]) {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain(cue);
    }
    for (const kind of ['decision', 'constraint', 'open_question', 'fact', 'artifact_ref']) {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain(`"${kind}"`);
    }
  });
});
