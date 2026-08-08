import type {
  ActorWire,
  ApiErrorCode,
  CheckpointWriteResultWire,
  CheckpointWriteWire,
  ContextItemFilterWire,
  ContextItemSearchWire,
  ContextItemWire,
  Embedding,
  EmbeddingProvider,
  NewProjectWire,
  ProjectWire,
  RehydrateRequestWire,
  ScopedStore,
  SessionWire,
  SliceWire,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';
import {
  assembleSlice,
  embeddableText,
  encodeActor,
  encodeCheckpointWriteResult,
  encodeContextItem,
  encodeProject,
  encodeSession,
  encodeSlice,
  resolveProject,
} from '@mneia/core';

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

const emitQuietly = async (telemetry: TelemetryEmitter, event: TelemetryEvent): Promise<void> => {
  try {
    await telemetry.emit(event);
  } catch {
    return;
  }
};

export const handleGetActor = async (
  store: ScopedStore,
  id: Uuid,
): Promise<{ actor: ActorWire | null }> => {
  const actor = await store.getActor(id);
  return { actor: actor === null ? null : encodeActor(actor) };
};

export const handleGetProject = async (
  store: ScopedStore,
  id: Uuid,
): Promise<{ project: ProjectWire | null }> => {
  const project = await store.getProject(id);
  return { project: project === null ? null : encodeProject(project) };
};

export const handleCreateProject = async (
  store: ScopedStore,
  input: NewProjectWire,
): Promise<{ project: ProjectWire; created: boolean }> => {
  const existing = await store.getProjectBySlug(input.slug);
  if (existing !== null) {
    return { project: encodeProject(existing), created: false };
  }

  try {
    const project = await store.createProject({
      slug: input.slug,
      displayName: input.displayName,
      repoUrl: input.repoUrl ?? null,
    });
    return { project: encodeProject(project), created: true };
  } catch (error) {
    const raced = await store.getProjectBySlug(input.slug);
    if (raced === null) {
      throw error;
    }
    return { project: encodeProject(raced), created: false };
  }
};

export const handleGetProjectBySlug = async (
  store: ScopedStore,
  slug: string,
): Promise<{ project: ProjectWire | null }> => {
  const project = await store.getProjectBySlug(slug);
  return { project: project === null ? null : encodeProject(project) };
};

export const handleCreateSession = async (
  store: ScopedStore,
  input: { readonly projectId: Uuid; readonly tool: string | null },
): Promise<{ session: SessionWire }> => {
  const session = await store.createSession(input.projectId, input.tool);
  return { session: encodeSession(session) };
};

export const handleGetItem = async (
  store: ScopedStore,
  id: Uuid,
): Promise<{ item: ContextItemWire | null }> => {
  const item = await store.getContextItem(id);
  return { item: item === null ? null : encodeContextItem(item) };
};

const decodeFilter = (wire: ContextItemFilterWire) => ({
  projectId: wire.projectId,
  ...(wire.kinds === undefined ? {} : { kinds: wire.kinds }),
  ...(wire.statuses === undefined ? {} : { statuses: wire.statuses }),
  ...(wire.loadBearing === undefined ? {} : { loadBearing: wire.loadBearing }),
  ...(wire.asOf === undefined ? {} : { asOf: new Date(wire.asOf) }),
  ...(wire.limit === undefined ? {} : { limit: wire.limit }),
});

export const handleListItems = async (
  store: ScopedStore,
  filter: ContextItemFilterWire,
): Promise<{ items: readonly ContextItemWire[] }> => {
  const items = await store.listContextItems(decodeFilter(filter));
  return { items: items.map(encodeContextItem) };
};

export const handleSearchItems = async (
  store: ScopedStore,
  search: ContextItemSearchWire,
): Promise<{ items: readonly ContextItemWire[] }> => {
  const items = await store.searchContextItems({
    ...decodeFilter(search),
    ...(search.text === undefined ? {} : { text: search.text }),
  });
  return { items: items.map(encodeContextItem) };
};

export interface RehydrateDependencies {
  readonly telemetry: TelemetryEmitter;
  readonly now: () => Date;
  readonly monotonicMs: () => number;
  readonly embeddings?: EmbeddingProvider | null | undefined;
}

const embedOne = async (
  provider: EmbeddingProvider | null | undefined,
  text: string,
): Promise<{ embedding: Embedding | null; model: string | null }> => {
  if (provider === null || provider === undefined || text.trim().length === 0) {
    return { embedding: null, model: null };
  }
  try {
    const [embedding] = await provider.embed([text]);
    return embedding === undefined
      ? { embedding: null, model: null }
      : { embedding, model: provider.model };
  } catch {
    return { embedding: null, model: null };
  }
};

export const handleRehydrate = async (
  store: ScopedStore,
  input: RehydrateRequestWire,
  deps: RehydrateDependencies,
): Promise<{ slice: SliceWire }> => {
  const project = await resolveProject(store, input.project);
  if (project === null) {
    throw new ApiRequestError(
      'not_found',
      `expected project "${input.project}" to name a project visible in this workspace; found none — check the slug with mneia status`,
    );
  }

  const now = deps.now();
  const startedAt = deps.monotonicMs();
  const task = await embedOne(deps.embeddings, input.task);
  const { slice } = await assembleSlice({
    store,
    project,
    task: input.task,
    tokenBudget: input.tokenBudget,
    now,
    taskEmbedding: task.embedding,
    embeddingModel: task.model,
  });
  const durationMs = deps.monotonicMs() - startedAt;

  await emitQuietly(deps.telemetry, {
    name: 'rehydration.slice_shown',
    workspaceId: store.scope.workspaceId,
    projectId: project.id,
    actorId: store.scope.actorId,
    sessionId: null,
    occurredAt: now,
    sliceId: slice.id,
    itemIds: slice.items.map((scored) => scored.item.id),
    tokensUsed: slice.tokensUsed,
    tokenBudget: slice.tokenBudget,
    durationMs,
  });

  return { slice: encodeSlice(slice) };
};

export interface CheckpointDependencies {
  readonly telemetry: TelemetryEmitter;
  readonly now: () => Date;
  readonly embeddings?: EmbeddingProvider | null | undefined;
}

const embedItems = async (
  provider: EmbeddingProvider | null | undefined,
  texts: readonly string[],
): Promise<{ vectors: readonly (Embedding | null)[]; model: string | null }> => {
  if (provider === null || provider === undefined || texts.length === 0) {
    return { vectors: texts.map(() => null), model: null };
  }
  try {
    const vectors = await provider.embed(texts);
    return { vectors, model: provider.model };
  } catch {
    return { vectors: texts.map(() => null), model: null };
  }
};

export const handleWriteCheckpoint = async (
  store: ScopedStore,
  input: CheckpointWriteWire,
  deps: CheckpointDependencies,
): Promise<{ result: CheckpointWriteResultWire }> => {
  const actor = await store.getActor(store.scope.actorId);
  if (actor === null) {
    throw new ApiRequestError(
      'invalid_token',
      `expected the token's actor ${store.scope.actorId} to exist in workspace ${store.scope.workspaceId}; found none — re-authenticate with mneia login`,
    );
  }

  const now = deps.now();

  const embedded = await embedItems(
    deps.embeddings,
    input.items.map((entry) => embeddableText(entry.item.title, entry.item.body ?? null)),
  );

  const result = await store.writeCheckpoint({
    checkpoint: {
      projectId: input.checkpoint.projectId,
      sessionId: input.checkpoint.sessionId ?? null,
      actorId: actor.id,
      trigger: input.checkpoint.trigger,
      summary: input.checkpoint.summary ?? null,
      source: input.checkpoint.source ?? null,
      sourceSessionRef: input.checkpoint.sourceSessionRef ?? null,
      sourceWatermark: input.checkpoint.sourceWatermark ?? null,
    },
    items: input.items.map((entry, index) => ({
      action: entry.action,
      item: {
        projectId: entry.item.projectId,
        kind: entry.item.kind,
        title: entry.item.title,
        body: entry.item.body ?? null,
        sourceSessionId: entry.item.sourceSessionId ?? null,
        sourceRef: entry.item.sourceRef ?? null,
        confidence: entry.item.confidence ?? 0.5,
        loadBearing: entry.item.loadBearing ?? false,
        accessScope: entry.item.accessScope ?? 'project',
        supersedesId: entry.item.supersedesId ?? null,
        decayAfter: entry.item.decayAfter ?? null,
        embedding: embedded.vectors[index] ?? null,
        embeddingModel: embedded.vectors[index] == null ? null : embedded.model,
      },
      conflictsWith: entry.conflictsWith ?? null,
    })),
  });

  for (const written of result.written) {
    await emitQuietly(deps.telemetry, {
      name: 'checkpoint.item_extracted',
      workspaceId: store.scope.workspaceId,
      projectId: written.projectId,
      actorId: actor.id,
      sessionId: input.checkpoint.sessionId ?? null,
      occurredAt: now,
      checkpointId: result.checkpoint.id,
      itemId: written.id,
      kind: written.kind,
      confidence: written.confidence,
      loadBearing: written.loadBearing,
      trigger: input.checkpoint.trigger,
    });

    if (written.supersedesId !== null) {
      await emitQuietly(deps.telemetry, {
        name: 'item.superseded',
        workspaceId: store.scope.workspaceId,
        projectId: written.projectId,
        actorId: actor.id,
        sessionId: input.checkpoint.sessionId ?? null,
        occurredAt: now,
        previousItemId: written.supersedesId,
        nextItemId: written.id,
      });
    }
  }

  const writtenById = new Map(result.written.map((item) => [item.id, item]));

  for (const conflict of result.conflicts) {
    await emitQuietly(deps.telemetry, {
      name: 'conflict.detected',
      workspaceId: store.scope.workspaceId,
      projectId: conflict.projectId,
      actorId: actor.id,
      sessionId: input.checkpoint.sessionId ?? null,
      occurredAt: now,
      conflictId: conflict.id,
      itemA: conflict.itemA,
      itemB: conflict.itemB,
      loadBearing: writtenById.get(conflict.itemB)?.loadBearing ?? false,
    });
  }

  return { result: encodeCheckpointWriteResult(result) };
};
