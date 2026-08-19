import type { Actor, Embedding, Handoff, Uuid } from '../domain/types.js';
import { mergeCandidates } from '../rehydrate/assemble.js';
import { DEFAULT_KIND_QUOTAS, packSlice } from '../rehydrate/pack.js';
import { DEFAULT_SCORING_WEIGHTS, scoreItems } from '../rehydrate/score.js';
import type { ScopedStore } from '../store/adapter/types.js';
import type { ItemKind, ItemStatus } from '../store/schema.js';
import { handoffSectionFor, renderHandoff } from './render.js';

export const DEFAULT_SUPERSEDED_WINDOW_DAYS = 30;
export const DEFAULT_ITEM_LIMIT = 500;
export const DEFAULT_HANDOFF_TOKEN_BUDGET = 3000;
export const MANDATORY_ITEM_LIMIT = 1000;
export const HANDOFF_SUPERSEDED_LIMIT = 5;

const LIVE_STATUSES: readonly ItemStatus[] = ['active', 'disputed'];
const ACTIVE_STATUSES: readonly ItemStatus[] = ['active'];
const SUPERSEDED_STATUSES: readonly ItemStatus[] = ['superseded'];
const MANDATORY_KINDS: readonly ItemKind[] = ['constraint'];
const SUPERSEDED_KINDS: readonly ItemKind[] = ['decision', 'constraint'];

export interface AssembleHandoffInput {
  readonly projectId: Uuid;
  readonly toActor?: Uuid | null;
  readonly nextAction: string;
  readonly supersededWindowDays?: number;
  readonly itemLimit?: number;
  readonly tokenBudget?: number;
  readonly nextActionEmbedding?: Embedding | null | undefined;
  readonly now: Date;
}

export interface AssembledHandoff {
  readonly handoff: Handoff;
  readonly itemIds: readonly Uuid[];
  readonly mandatoryItemIds: readonly Uuid[];
  readonly droppedItemIds: readonly Uuid[];
}

const dayMs = 24 * 60 * 60 * 1000;

async function resolveActors(
  store: ScopedStore,
  ids: Iterable<Uuid>,
): Promise<ReadonlyMap<Uuid, Actor>> {
  const unique = [...new Set(ids)];
  const resolved = await Promise.all(unique.map((id) => store.getActor(id)));
  const actors = new Map<Uuid, Actor>();

  for (const [index, actor] of resolved.entries()) {
    const id = unique[index];
    if (actor !== null && id !== undefined) {
      actors.set(id, actor);
    }
  }

  return actors;
}

export async function assembleHandoff(
  store: ScopedStore,
  input: AssembleHandoffInput,
): Promise<AssembledHandoff> {
  const project = await store.getProject(input.projectId);
  if (project === null) {
    throw new Error(
      `expected project ${input.projectId} to be visible in workspace ${store.scope.workspaceId}; found none — check the project with mneia status`,
    );
  }

  const from = await store.getActor(store.scope.actorId);
  if (from === null) {
    throw new Error(
      `expected the scoped actor ${store.scope.actorId} to exist in workspace ${store.scope.workspaceId}; found none — the token identifies an actor that has been removed`,
    );
  }

  const toActorId = input.toActor ?? null;
  const to = toActorId === null ? null : await store.getActor(toActorId);
  if (toActorId !== null && to === null) {
    throw new Error(
      `expected handoff recipient ${toActorId} to be an actor in workspace ${store.scope.workspaceId}; found none — leave the recipient unset to create an open handoff`,
    );
  }

  const windowDays = input.supersededWindowDays ?? DEFAULT_SUPERSEDED_WINDOW_DAYS;
  const supersededSince = new Date(input.now.getTime() - windowDays * dayMs);
  const tokenBudget = input.tokenBudget ?? DEFAULT_HANDOFF_TOKEN_BUDGET;

  const [live, mandatory, superseded] = await Promise.all([
    store.listContextItems({
      projectId: input.projectId,
      statuses: LIVE_STATUSES,
      limit: input.itemLimit ?? DEFAULT_ITEM_LIMIT,
    }),
    store.listContextItems({
      projectId: input.projectId,
      kinds: MANDATORY_KINDS,
      statuses: ACTIVE_STATUSES,
      loadBearing: true,
      limit: MANDATORY_ITEM_LIMIT,
    }),
    store.listContextItems({
      projectId: input.projectId,
      kinds: SUPERSEDED_KINDS,
      statuses: SUPERSEDED_STATUSES,
      limit: HANDOFF_SUPERSEDED_LIMIT,
    }),
  ]);

  const scored = scoreItems({
    items: mergeCandidates(mandatory, live),
    taskEmbedding: input.nextActionEmbedding ?? null,
    now: input.now,
    weights: DEFAULT_SCORING_WEIGHTS,
  });

  const packed = packSlice({ scored, tokenBudget, quotas: DEFAULT_KIND_QUOTAS });

  const inWindow = superseded.filter(
    (item) => item.validTo === null || item.validTo.getTime() >= supersededSince.getTime(),
  );

  const items = mergeCandidates(
    packed.items.map((entry) => entry.item),
    inWindow,
  );

  const actors = await resolveActors(store, [
    from.id,
    ...(to === null ? [] : [to.id]),
    ...items.map((item) => item.assertedBy),
  ]);

  const renderInput = {
    project,
    from,
    to,
    createdAt: input.now,
    nextAction: input.nextAction,
    items,
    actors,
    supersededSince,
    budget: {
      tokensUsed: packed.tokensUsed,
      tokenBudget: packed.tokenBudget,
      omitted: packed.droppedItemIds.length,
    },
  };

  const rendered = renderHandoff(renderInput);

  const included = items.flatMap((item) => {
    const section = handoffSectionFor(item, renderInput);
    return section === null ? [] : [{ itemId: item.id, section }];
  });

  const handoff = await store.createHandoff({
    projectId: input.projectId,
    fromActor: from.id,
    toActor: toActorId,
    nextAction: input.nextAction.trim(),
    rendered,
    items: included,
  });

  return {
    handoff,
    itemIds: included.map((entry) => entry.itemId),
    mandatoryItemIds: packed.mandatoryItemIds,
    droppedItemIds: packed.droppedItemIds,
  };
}
