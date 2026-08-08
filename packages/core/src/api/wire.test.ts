import { describe, expect, it } from 'vitest';
import type { ContextItem } from '../domain/types.js';
import {
  ContextItemWireSchema,
  NewContextItemWireSchema,
  decodeContextItem,
  encodeContextItem,
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
});
