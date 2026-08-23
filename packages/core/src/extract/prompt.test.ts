import { describe, expect, it } from 'vitest';
import type { TrajectoryTurn } from '../trajectory/types.js';
import {
  buildExtractionPrompt,
  EXISTING_ITEMS_HEADING,
  EXTRACTION_SYSTEM_PROMPT,
  FOUND_SO_FAR_HEADING,
  SUMMARY_HEADING,
  TRANSCRIPT_HEADING,
} from './prompt.js';

const turn = (ref: string, text: string): TrajectoryTurn => ({
  ref,
  role: 'user',
  kind: 'text',
  text,
  toolName: null,
  at: null,
});

const TURNS = [turn('t1', 'We will use Postgres and not add Redis, because one store is enough.')];

const EXISTING = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Use Postgres for the store' },
];

describe('the extraction prompt', () => {
  it('carries the session summary, so every chunk of a long session knows its thesis', () => {
    const prompt = buildExtractionPrompt({
      turns: TURNS,
      existingItems: [],
      summary: 'migrating the ledger writes to the v2 schema',
    });

    expect(prompt.user).toContain(SUMMARY_HEADING);
    expect(prompt.user).toContain('migrating the ledger writes to the v2 schema');
  });

  it('omits the summary section when none was given, rather than rendering an empty heading', () => {
    const prompt = buildExtractionPrompt({ turns: TURNS, existingItems: [], summary: '   ' });

    expect(prompt.user).not.toContain(SUMMARY_HEADING);
  });

  it('carries what earlier chunks already proposed, so one decision is not missed by both', () => {
    const prompt = buildExtractionPrompt({
      turns: TURNS,
      existingItems: [],
      foundSoFar: ['Move ledger writes behind the v2 adapter'],
    });

    expect(prompt.user).toContain(FOUND_SO_FAR_HEADING);
    expect(prompt.user).toContain('Move ledger writes behind the v2 adapter');
  });

  it('keeps existing items first and the transcript last, so the cached prefix survives', () => {
    const prompt = buildExtractionPrompt({
      turns: TURNS,
      existingItems: EXISTING,
      summary: 'a summary',
      foundSoFar: ['an earlier candidate'],
    });

    const order = [
      prompt.user.indexOf(EXISTING_ITEMS_HEADING),
      prompt.user.indexOf(SUMMARY_HEADING),
      prompt.user.indexOf(FOUND_SO_FAR_HEADING),
      prompt.user.indexOf(TRANSCRIPT_HEADING),
    ];

    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(order[0]).toBe(0);
  });

  // The prefix is what prompt_cache_key bills against: identical for every checkpoint in a
  // project, and unchanged by which session is being extracted. If a per-session section
  // ever moves ahead of it, every request pays full input rate and nothing fails loudly.
  it('produces a byte-identical prefix for two different sessions in the same project', () => {
    const first = buildExtractionPrompt({
      turns: TURNS,
      existingItems: EXISTING,
      summary: 'one session',
    });
    const second = buildExtractionPrompt({
      turns: [turn('t9', 'Something else entirely happened here.')],
      existingItems: EXISTING,
      summary: 'a different session',
    });

    const prefixOf = (user: string) => user.slice(0, user.indexOf(SUMMARY_HEADING));

    expect(prefixOf(first.user)).toBe(prefixOf(second.user));
    expect(prefixOf(first.user).length).toBeGreaterThan(0);
  });

  describe('does not ask the model to do the deduplication reconcile already does', () => {
    // reconcileCandidates classifies every candidate against the project as novel,
    // duplicate, or contradiction, and propose.ts carries only novel + contradictions
    // forward. A duplicate the model withholds is not filtered — it is lost, along with
    // the contradiction it might have been.
    it('frames existing items as context rather than a prohibition', () => {
      const prompt = buildExtractionPrompt({ turns: TURNS, existingItems: EXISTING });

      expect(prompt.user).toContain(EXISTING_ITEMS_HEADING);
      expect(prompt.user).not.toMatch(/do not extract them again/i);
      expect(prompt.user).toMatch(/removes anything that merely repeats one of them/i);
    });

    it('tells the model to emit a restatement of something already recorded', () => {
      const prompt = buildExtractionPrompt({ turns: TURNS, existingItems: EXISTING });

      expect(prompt.user).toMatch(/settles, changes, or contradicts one of these, emit it/i);
    });

    it('no longer instructs the system prompt to skip what memory already records', () => {
      expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/Do not re-extract/i);
      expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/not a prohibition/i);
    });

    // Precision is enforced by the confidence floor, reconcile, and needsHuman — none of
    // which the model can see. Telling it that silence is the safe default is what turned
    // a 797-turn session into one item.
    it('does not tell the model that omitting a real item is the correct outcome', () => {
      expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/borderline item omitted is the correct/i);
      expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/withhold is not filtered, it is lost/i);
    });

    it('still rejects filler, which is the part of the bar that was always right', () => {
      expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/Reject conversational filler aggressively/i);
      expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/Reject work log entries/i);
    });
  });
});
