import { describe, expect, it } from 'vitest';
import type { ContextItem, Embedding, Project } from '../domain/types.js';
import type { ContextItemSearch, ScopedStore } from '../store/adapter/types.js';
import { EMBEDDING_DIMENSIONS } from '../store/schema.js';
import { assembleSlice } from './assemble.js';

const NOW = new Date('2026-08-08T00:00:00.000Z');

const PROJECT: Project = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  teamId: null,
  slug: 'mneia',
  repoUrl: null,
  createdAt: NOW,
};

const vector = (seed: number): Embedding =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === seed ? 1 : 0));

const item = (id: string, title: string, embedding: Embedding | null): ContextItem => ({
  id,
  workspaceId: PROJECT.workspaceId,
  projectId: PROJECT.id,
  kind: 'decision',
  title,
  body: null,
  status: 'active',
  assertedBy: '33333333-3333-4333-8333-333333333333',
  assertedAt: NOW,
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.8,
  humanConfirmed: false,
  loadBearing: false,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: NOW,
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope: 'project',
  embedding,
  embeddingModel: embedding === null ? null : 'openai:text-embedding-3-small',
  supersedeReason: null,
});

interface Recorded {
  readonly searches: ContextItemSearch[];
}

const storeWith = (items: readonly ContextItem[], recorded: Recorded): ScopedStore =>
  ({
    scope: { workspaceId: PROJECT.workspaceId, actorId: '44444444-4444-4444-8444-444444444444' },
    async searchContextItems(search: ContextItemSearch) {
      recorded.searches.push(search);
      return items;
    },
    async listContextItems() {
      return [];
    },
  }) as unknown as ScopedStore;

describe('assembleSlice semantic ranking', () => {
  it('does not ask the store for vectors when there is no task embedding', async () => {
    const recorded: Recorded = { searches: [] };
    const store = storeWith([item('a', 'Use Postgres as the only store', null)], recorded);

    await assembleSlice({ store, project: PROJECT, task: 'anything', tokenBudget: 4000, now: NOW });

    expect(recorded.searches[0]?.withEmbedding).toBeUndefined();
    expect(recorded.searches[0]?.embedding).toBeUndefined();
  });

  it('passes the task embedding to the store so ranking happens against real vectors', async () => {
    const recorded: Recorded = { searches: [] };
    const store = storeWith([item('a', 'Use Postgres as the only store', vector(0))], recorded);
    const taskEmbedding = vector(0);

    await assembleSlice({
      store,
      project: PROJECT,
      task: 'which database did we pick',
      tokenBudget: 4000,
      now: NOW,
      taskEmbedding,
      embeddingModel: 'openai:text-embedding-3-small',
    });

    expect(recorded.searches[0]?.withEmbedding).toBe(true);
    expect(recorded.searches[0]?.embeddingModel).toBe('openai:text-embedding-3-small');
    expect(recorded.searches[0]?.embedding).toBe(taskEmbedding);
  });

  it('scores a semantically close item above a distant one, which is inert without an embedding', async () => {
    const near = item('near', 'The database decision, which is Postgres', vector(0));
    const far = item('far', 'The colour of the marketing site header', vector(7));

    const withoutEmbedding = await assembleSlice({
      store: storeWith([far, near], { searches: [] }),
      project: PROJECT,
      task: 'which database did we pick',
      tokenBudget: 4000,
      now: NOW,
    });

    const withEmbedding = await assembleSlice({
      store: storeWith([far, near], { searches: [] }),
      project: PROJECT,
      task: 'which database did we pick',
      tokenBudget: 4000,
      now: NOW,
      taskEmbedding: vector(0),
      embeddingModel: 'openai:text-embedding-3-small',
    });

    const scoreOf = (slice: Awaited<ReturnType<typeof assembleSlice>>, id: string): number =>
      slice.slice.items.find((scored) => scored.item.id === id)?.score ?? 0;

    expect(scoreOf(withoutEmbedding, 'near')).toBeCloseTo(scoreOf(withoutEmbedding, 'far'), 5);
    expect(scoreOf(withEmbedding, 'near')).toBeGreaterThan(scoreOf(withEmbedding, 'far'));
  });
});
