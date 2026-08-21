import { randomUUID } from 'node:crypto';
import type { ContextItem, Embedding, Project, Uuid } from '../domain/types.js';
import type { ScopedStore } from '../store/adapter/types.js';
import type { ItemKind, ItemStatus } from '../store/schema.js';
import { DEFAULT_KIND_QUOTAS, packSlice } from './pack.js';
import { renderSlice } from './render.js';
import { DEFAULT_SCORING_WEIGHTS, scoreItems } from './score.js';
import type { Slice } from './types.js';

export const MANDATORY_ITEM_LIMIT = 1000;
export const RECENT_SUPERSEDED_LIMIT = 5;
export const MAX_CANDIDATES = 200;

const CANDIDATES_PER_1K_TOKENS = 40;
const MIN_CANDIDATES = 60;
const ACTIVE_STATUSES: readonly ItemStatus[] = ['active'];
const SUPERSEDED_STATUSES: readonly ItemStatus[] = ['superseded'];
const MANDATORY_KINDS: readonly ItemKind[] = ['constraint'];
const SUPERSEDED_KINDS: readonly ItemKind[] = ['decision', 'constraint'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssembleSliceRequest {
  readonly store: ScopedStore;
  readonly project: Project;
  readonly task: string;
  readonly tokenBudget: number;
  readonly now: Date;
  readonly taskEmbedding?: Embedding | null | undefined;
  readonly embeddingModel?: string | null | undefined;
  readonly onStoreCall?: (<T>(operation: string, call: () => Promise<T>) => Promise<T>) | undefined;
}

export function candidateLimitFor(tokenBudget: number): number {
  const scaled = Math.ceil((tokenBudget / 1000) * CANDIDATES_PER_1K_TOKENS);
  return Math.min(MAX_CANDIDATES, Math.max(MIN_CANDIDATES, scaled));
}

export function mergeCandidates(
  ...groups: readonly (readonly ContextItem[])[]
): readonly ContextItem[] {
  const byId = new Map<Uuid, ContextItem>();
  for (const group of groups) {
    for (const item of group) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  }
  return [...byId.values()];
}

export async function resolveProject(store: ScopedStore, project: string): Promise<Project | null> {
  return UUID_PATTERN.test(project) ? store.getProject(project) : store.getProjectBySlug(project);
}

export interface AssembledSlice {
  readonly slice: Slice;
  readonly mandatoryItemIds: readonly Uuid[];
  readonly droppedItemIds: readonly Uuid[];
}

export async function assembleSlice(request: AssembleSliceRequest): Promise<AssembledSlice> {
  const { store, project, task, tokenBudget, now } = request;
  const through = request.onStoreCall ?? ((_operation, call) => call());

  const taskEmbedding = request.taskEmbedding ?? null;
  const embeddingModel = request.embeddingModel ?? null;
  const semantic = taskEmbedding !== null && embeddingModel !== null;

  let candidates: readonly ContextItem[];
  let mandatory: readonly ContextItem[];
  let superseded: readonly ContextItem[];
  let relevance: ReadonlyMap<Uuid, number> | undefined;

  const selectRehydrationCandidates = store.selectRehydrationCandidates;
  if (selectRehydrationCandidates !== undefined) {
    const groups = await through('selectRehydrationCandidates', () =>
      selectRehydrationCandidates.call(store, {
        projectId: project.id,
        asOf: now,
        candidateLimit: candidateLimitFor(tokenBudget),
        mandatoryLimit: MANDATORY_ITEM_LIMIT,
        supersededLimit: RECENT_SUPERSEDED_LIMIT,
        ...(semantic && taskEmbedding !== null && embeddingModel !== null
          ? { embedding: taskEmbedding, embeddingModel }
          : {}),
      }),
    );
    ({ candidates, mandatory, superseded } = groups);
    relevance = groups.relevance;
  } else {
    [candidates, mandatory, superseded] = await Promise.all([
      through('searchContextItems', () =>
        store.searchContextItems({
          projectId: project.id,
          statuses: ACTIVE_STATUSES,
          asOf: now,
          limit: candidateLimitFor(tokenBudget),
          ...(semantic && taskEmbedding !== null && embeddingModel !== null
            ? { embedding: taskEmbedding, embeddingModel, withEmbedding: true }
            : {}),
        }),
      ),
      through('listContextItems for load-bearing constraints', () =>
        store.listContextItems({
          projectId: project.id,
          kinds: MANDATORY_KINDS,
          statuses: ACTIVE_STATUSES,
          loadBearing: true,
          asOf: now,
          limit: MANDATORY_ITEM_LIMIT,
        }),
      ),
      through('listContextItems for recently superseded items', () =>
        store.listContextItems({
          projectId: project.id,
          kinds: SUPERSEDED_KINDS,
          statuses: SUPERSEDED_STATUSES,
          limit: RECENT_SUPERSEDED_LIMIT,
        }),
      ),
    ]);
  }

  const scored = scoreItems({
    items: mergeCandidates(mandatory, superseded, candidates),
    taskEmbedding,
    now,
    weights: DEFAULT_SCORING_WEIGHTS,
    ...(relevance === undefined ? {} : { relevance }),
  });

  const packed = packSlice({ scored, tokenBudget, quotas: DEFAULT_KIND_QUOTAS });

  const slice: Slice = {
    id: randomUUID(),
    projectId: project.id,
    task,
    items: packed.items,
    tokensUsed: packed.tokensUsed,
    tokenBudget: packed.tokenBudget,
    renderedMarkdown: renderSlice({ task, packed, generatedAt: now }),
    generatedAt: now,
  };

  return {
    slice,
    mandatoryItemIds: packed.mandatoryItemIds,
    droppedItemIds: packed.droppedItemIds,
  };
}
