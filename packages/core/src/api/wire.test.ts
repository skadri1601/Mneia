import { describe, expect, it } from 'vitest';
import type { ContextItem, Session } from '../domain/types.js';
import type { PendingReviewItem } from '../store/adapter/types.js';
import {
  CheckpointProposalWireSchema,
  CheckpointProposeWireSchema,
  CheckpointWriteWireSchema,
  ContextItemWireSchema,
  decodeContextItem,
  decodePendingReviewItem,
  decodeSession,
  ExtractionCoverageWireSchema,
  encodeContextItem,
  encodePendingReviewItem,
  encodeSession,
  NewContextItemWireSchema,
  PendingReviewFilterWireSchema,
  PendingReviewItemWireSchema,
  ReviewPendingItemsWireSchema,
} from './wire.js';

const item: ContextItem = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  kind: 'constraint',
  title: 'never auto-supersede a human-confirmed item',
  body: 'vision.md §10.1',
  status: 'active',
  assertedBy: '44444444-4444-4444-8444-444444444444',
  assertedAt: new Date('2026-08-01T10:00:00.000Z'),
  sourceSessionId: null,
  sourceRef: 'MNE-63',
  confidence: 0.9,
  humanConfirmed: true,
  loadBearing: true,
  lastVerifiedAt: new Date('2026-08-02T10:00:00.000Z'),
  decayAfter: 86_400_000,
  validFrom: new Date('2026-08-01T10:00:00.000Z'),
  validTo: null,
  supersedesId: null,
  supersededById: null,
  supersedeReason: null,
  accessScope: 'workspace',
  embedding: [0.1, 0.2, 0.3],
  embeddingModel: 'openai:text-embedding-3-small',
};

describe('context item wire format', () => {
  it('round-trips every field the client reads', () => {
    const decoded = decodeContextItem(encodeContextItem(item));

    expect(decoded).toEqual({ ...item, embedding: null, embeddingModel: null });
    expect(decoded.assertedAt.toISOString()).toBe(item.assertedAt.toISOString());
    expect(decoded.decayAfter).toBe(item.decayAfter);
  });

  it('never puts the embedding on the wire', () => {
    const encoded = encodeContextItem(item);

    expect(encoded).not.toHaveProperty('embedding');
    expect(Object.keys(JSON.parse(JSON.stringify(encoded)))).not.toContain('embedding');
    expect(ContextItemWireSchema.parse(encoded)).not.toHaveProperty('embedding');
    expect(decodeContextItem(encoded).embedding).toBeNull();
  });

  it('drops the embedding model with the vector, so the §9 pairing survives decoding', () => {
    const encoded = encodeContextItem(item);
    const decoded = decodeContextItem(encoded);

    expect(encoded).not.toHaveProperty('embeddingModel');
    expect(decoded.embeddingModel).toBeNull();
    expect(decoded.embedding === null).toBe(decoded.embeddingModel === null);
  });

  it('normalizes contradictory partial provenance from the wire', () => {
    const parsed = ContextItemWireSchema.parse({
      ...encodeContextItem(item),
      provenance: {
        actorId: item.assertedBy,
        actorKind: 'agent',
        actorDisplayName: 'Codex',
        sourceSessionId: null,
        sessionTool: null,
        clientName: null,
        clientVersion: null,
        clientSessionRef: null,
        clientSessionName: null,
        clientSessionUrl: null,
        status: 'complete',
        missingFields: [],
      },
    });

    expect(parsed.provenance?.status).toBe('partial');
    expect(parsed.provenance?.missingFields).toEqual([
      'sourceSessionId',
      'sessionTool',
      'clientName',
      'clientVersion',
      'clientSessionRef',
      'clientSessionName',
      'clientSessionUrl',
    ]);
  });

  it('normalizes contradictory complete provenance from the wire', () => {
    const parsed = ContextItemWireSchema.parse({
      ...encodeContextItem(item),
      provenance: {
        actorId: item.assertedBy,
        actorKind: 'agent',
        actorDisplayName: 'Codex',
        sourceSessionId: '55555555-5555-4555-8555-555555555555',
        sessionTool: 'mcp',
        clientName: 'codex',
        clientVersion: '1.2.3',
        clientSessionRef: '019c-session',
        clientSessionName: 'MNE-86 dogfood',
        clientSessionUrl: 'https://example.invalid/sessions/019c-session',
        status: 'partial',
        missingFields: ['clientSessionUrl'],
      },
    });

    expect(parsed.provenance?.status).toBe('complete');
    expect(parsed.provenance?.missingFields).toEqual([]);
  });
});

describe('session wire format', () => {
  it('round-trips optional client provenance without breaking legacy nulls', () => {
    const session: Session = {
      id: '55555555-5555-4555-8555-555555555555',
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      actorId: item.assertedBy,
      tool: 'mcp',
      clientName: 'codex',
      clientVersion: '1.2.3',
      clientSessionRef: '019c-session',
      clientSessionName: 'MNE-86 dogfood',
      clientSessionUrl: 'https://example.invalid/sessions/019c-session',
      startedAt: new Date('2026-08-16T10:00:00.000Z'),
      endedAt: null,
    };

    expect(decodeSession(encodeSession(session))).toEqual(session);
  });
});

describe('new context item wire format', () => {
  it('gives a caller no way to claim provenance or human confirmation', () => {
    const parsed = NewContextItemWireSchema.parse({
      projectId: item.projectId,
      kind: 'decision',
      title: 'ship the hosted API',
      assertedBy: 'someone-else',
      humanConfirmed: true,
    });

    expect(parsed).not.toHaveProperty('assertedBy');
    expect(parsed).not.toHaveProperty('humanConfirmed');
  });

  it('rejects an empty title rather than storing an unreadable item', () => {
    const parsed = NewContextItemWireSchema.safeParse({
      projectId: item.projectId,
      kind: 'decision',
      title: '   ',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects a null byte, which Postgres cannot store, before it reaches the store', () => {
    const nullByte = String.fromCharCode(0);

    expect(
      NewContextItemWireSchema.safeParse({
        projectId: item.projectId,
        kind: 'decision',
        title: `ship${nullByte}it`,
      }).success,
    ).toBe(false);

    expect(
      NewContextItemWireSchema.safeParse({
        projectId: item.projectId,
        kind: 'decision',
        title: 'ship it',
        body: `why${nullByte}not`,
      }).success,
    ).toBe(false);
  });
});

describe('ExtractionCoverageWireSchema', () => {
  const coverage = {
    droppedTurns: 0,
    splitTurns: 2,
    pendingTurns: 40,
    consumedTurns: 12,
    incompleteCode: 'provider_failed' as const,
  };

  it('accepts the counts and a bounded failure code', () => {
    expect(ExtractionCoverageWireSchema.safeParse(coverage).success).toBe(true);
    expect(
      ExtractionCoverageWireSchema.safeParse({ ...coverage, incompleteCode: null }).success,
    ).toBe(true);
  });

  it('refuses a free-text reason, which is what would smuggle model output into telemetry', () => {
    expect(
      ExtractionCoverageWireSchema.safeParse({
        ...coverage,
        incompleteCode: 'gpt-5.6-luna returned {"candidates": [{"title": "a real decision"',
      }).success,
    ).toBe(false);
  });

  it('refuses an unknown field, so nothing can be smuggled alongside the counts', () => {
    expect(
      ExtractionCoverageWireSchema.safeParse({ ...coverage, providerMessage: 'boom' }).success,
    ).toBe(false);
  });

  it('refuses negative and fractional counts', () => {
    expect(ExtractionCoverageWireSchema.safeParse({ ...coverage, splitTurns: -1 }).success).toBe(
      false,
    );
    expect(ExtractionCoverageWireSchema.safeParse({ ...coverage, splitTurns: 1.5 }).success).toBe(
      false,
    );
  });

  it('is optional on a checkpoint write, so an older client still validates', () => {
    const checkpoint = {
      projectId: item.projectId,
      trigger: 'manual' as const,
    };
    const items = [
      {
        action: 'created' as const,
        item: { projectId: item.projectId, kind: 'decision' as const, title: 'ship it' },
      },
    ];

    expect(CheckpointWriteWireSchema.safeParse({ checkpoint, items }).success).toBe(true);
    expect(
      CheckpointWriteWireSchema.safeParse({ checkpoint: { ...checkpoint, coverage }, items })
        .success,
    ).toBe(true);
    expect(
      CheckpointWriteWireSchema.safeParse({
        checkpoint: { ...checkpoint, coverage: { ...coverage, incompleteCode: 'exploded' } },
        items,
      }).success,
    ).toBe(false);
  });

  it('is optional on a proposal, so the field can land before clients echo it', () => {
    const proposal = {
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      actorId: item.assertedBy,
      candidates: [],
      rejectedCount: 0,
      watermark: 't9',
      consumedTurns: 12,
      model: 'gpt-5.6-luna',
    };

    expect(CheckpointProposalWireSchema.safeParse(proposal).success).toBe(true);
    expect(CheckpointProposalWireSchema.safeParse({ ...proposal, coverage }).success).toBe(true);
  });
});

const pending: PendingReviewItem = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '33333333-3333-4333-8333-333333333333',
  kind: 'constraint',
  title: 'never auto-supersede a human-confirmed item',
  body: 'vision.md §10.1',
  confidence: 0.72,
  loadBearing: true,
  accessScope: 'project',
  assertedBy: '44444444-4444-4444-8444-444444444444',
  assertedByKind: 'agent',
  assertedByName: 'lane C agent',
  assertedAt: new Date('2026-08-20T09:00:00.000Z'),
  sourceRef: 'packages/core/src/store/adapter/postgres.ts',
  originCheckpointId: '66666666-6666-4666-8666-666666666666',
};

describe('the review queue wire contract', () => {
  it('round-trips a pending review item through the schema the CLI and the app both parse', () => {
    const encoded = encodePendingReviewItem(pending);

    expect(PendingReviewItemWireSchema.safeParse(encoded).success).toBe(true);
    expect(decodePendingReviewItem(encoded)).toEqual(pending);
  });

  it('carries no human_confirmed and no asserted_by on the way in, so the caller cannot set them', () => {
    const parsed = ReviewPendingItemsWireSchema.safeParse({
      projectId: pending.projectId,
      reviews: [
        {
          itemId: pending.id,
          decision: 'accept',
          humanConfirmed: true,
          assertedBy: '99999999-9999-4999-8999-999999999999',
        },
      ],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reviews[0]).toEqual({
      itemId: pending.id,
      decision: 'accept',
    });
  });

  it('refuses a submission that decides nothing, and a queue read with no project', () => {
    expect(
      ReviewPendingItemsWireSchema.safeParse({ projectId: pending.projectId, reviews: [] }).success,
    ).toBe(false);
    expect(PendingReviewFilterWireSchema.safeParse({ projectId: '' }).success).toBe(false);
    expect(
      PendingReviewFilterWireSchema.safeParse({ projectId: pending.projectId, limit: 0 }).success,
    ).toBe(false);
    expect(PendingReviewFilterWireSchema.safeParse({ projectId: pending.projectId }).success).toBe(
      true,
    );
  });
});

describe('CheckpointWriteWireSchema with no items', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';

  it('accepts an item-less checkpoint that carries a watermark', () => {
    // Extraction that read turns and kept nothing still has to record how far it got, or
    // the same turns are re-read and re-billed on every later run (MNE-100).
    const parsed = CheckpointWriteWireSchema.safeParse({
      checkpoint: {
        projectId,
        trigger: 'manual',
        source: 'claude-code',
        sourceSessionRef: 'session-1',
        sourceWatermark: 't41',
      },
      items: [],
    });

    expect(parsed.success).toBe(true);
  });

  it('refuses an item-less checkpoint with no watermark, which would record nothing', () => {
    const parsed = CheckpointWriteWireSchema.safeParse({
      checkpoint: { projectId, trigger: 'manual' },
      items: [],
    });

    expect(parsed.success).toBe(false);
  });
});

describe('CheckpointProposeWireSchema', () => {
  const probe = {
    project: 'acme/billing',
    source: 'claude-code' as const,
    sessionRef: 'session-1',
    trigger: 'manual' as const,
    turns: [],
  };

  it('accepts an upload of no turns, because that is how the watermark is asked for', () => {
    const parsed = CheckpointProposeWireSchema.safeParse(probe);
    expect(parsed.success).toBe(true);
  });

  it('accepts turns when there are some to send', () => {
    const parsed = CheckpointProposeWireSchema.safeParse({
      ...probe,
      turns: [
        {
          ref: 'turn-1',
          role: 'user',
          kind: 'text',
          text: 'ship the probe',
          at: '2026-08-21T00:00:00.000Z',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
