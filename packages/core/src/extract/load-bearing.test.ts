import { describe, expect, it } from 'vitest';
import type { ItemKind } from '../store/schema.js';
import {
  detectLoadBearingSignal,
  explainLoadBearingSignal,
  LOAD_BEARING_SCAN_LIMIT,
  LOAD_BEARING_SIGNALS,
  suggestLoadBearing,
} from './load-bearing.js';

const input = (kind: ItemKind, title: string, body: string | null = null, loadBearing = false) => ({
  kind,
  title,
  body,
  loadBearing,
});

describe('suggestLoadBearing', () => {
  it.each([
    ['a prohibition', 'constraint', 'Never log user content in a telemetry event', 'prohibition'],
    ['a requirement', 'constraint', 'Every write path must emit its §17 event', 'prohibition'],
    [
      'a security rule',
      'constraint',
      'API keys live in repository secrets, not on the droplet',
      'security_or_privacy',
    ],
    [
      'an irreversible act',
      'decision',
      'A migration is applied before the deploy gate runs',
      'irreversible',
    ],
    ['a numeric budget', 'constraint', 'Rehydration p95 stays under 300ms', 'threshold'],
    [
      'a rejected alternative',
      'decision',
      'Use Postgres for the store rather than adding Redis',
      'rejected_alternative',
    ],
  ] as const)('reads %s as %s', (_label, kind, title, signal) => {
    const suggestion = suggestLoadBearing(input(kind, title));

    expect(suggestion.suggested).toBe(true);
    expect(suggestion.signal).toBe(signal);
    expect(suggestion.explanation.length).toBeGreaterThan(20);
  });

  it('leaves an ordinary fact alone', () => {
    const suggestion = suggestLoadBearing(input('fact', 'The staging database runs Postgres 18'));

    expect(suggestion.suggested).toBe(false);
    expect(suggestion.signal).toBe('none');
  });

  it('never promotes an open_question or an artifact_ref, whatever words they carry', () => {
    for (const kind of ['open_question', 'artifact_ref'] as const) {
      const suggestion = suggestLoadBearing(
        input(kind, 'We must never let p95 exceed 300ms without encryption'),
      );
      expect(suggestion.signal).toBe('none');
      expect(suggestion.suggested).toBe(false);
    }
  });

  it('keeps the extraction\'s "true" but names it as the weaker signal', () => {
    const suggestion = suggestLoadBearing(
      input('fact', 'The billing dashboard lives at /projects/billing', null, true),
    );

    expect(suggestion.suggested).toBe(true);
    expect(suggestion.signal).toBe('model_only');
  });

  it('never demotes what the extraction marked, only ever adds to it', () => {
    for (const kind of [
      'decision',
      'constraint',
      'fact',
      'open_question',
      'artifact_ref',
    ] as const) {
      expect(
        suggestLoadBearing(input(kind, 'A perfectly ordinary title here', null, true)).suggested,
      ).toBe(true);
    }
  });

  it('reads the body as well as the title', () => {
    const suggestion = suggestLoadBearing(
      input('constraint', 'The reducer is disabled on the server', 'It must never trim a chunk.'),
    );

    expect(suggestion.signal).toBe('prohibition');
  });

  it('stops reading after the scan limit, so a long body cannot make it expensive', () => {
    const filler = 'a'.repeat(LOAD_BEARING_SCAN_LIMIT + 500);
    const suggestion = suggestLoadBearing(
      input('constraint', 'The reducer keeps every turn', `${filler} must never trim a chunk`),
    );

    expect(suggestion.signal).toBe('none');
  });

  it('is deterministic, so the client and the server agree without plumbing', () => {
    const subject = input('decision', 'Use Neon rather than RDS', 'Chosen for branching.');

    expect(suggestLoadBearing(subject)).toEqual(suggestLoadBearing(subject));
  });

  it('explains every signal it can report', () => {
    for (const signal of LOAD_BEARING_SIGNALS) {
      expect(explainLoadBearingSignal(signal).length).toBeGreaterThan(20);
    }
  });

  it('reports no deterministic signal when nothing in the text fires', () => {
    expect(
      detectLoadBearingSignal(input('decision', 'Name the reader after its client')),
    ).toBeNull();
  });
});
