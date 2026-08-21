import type {
  ActorWire,
  ApiErrorCode,
  CheckpointWire,
  CheckpointWriteResultWire,
  CheckpointWriteWire,
  ContextItemFilterWire,
  ContextItemSearchWire,
  ContextItemWire,
  Embedding,
  EmbeddingProvider,
  ListProjectSessionsWire,
  ListWorkspaceActorsWire,
  NewProjectWire,
  ProjectSessionSummaryWire,
  ProjectWire,
  RehydrateRequestWire,
  RetireContextItemWire,
  ScopedStore,
  SessionWire,
  SliceWire,
  StaleContextItemFilterWire,
  StaleContextItemWire,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
  VerifyContextItemResultWire,
  VerifyContextItemWire,
} from '@mneia/core';
import {
  assembleSlice,
  embeddableText,
  encodeActor,
  encodeCheckpoint,
  encodeCheckpointWriteResult,
  encodeContextItem,
  encodeProject,
  encodeProjectSessionSummary,
  encodeSession,
  encodeSlice,
  encodeStaleContextItem,
  encodeVerifyContextItemResult,
  resolveProject,
} from '@mneia/core';
import { describeProjectLimit, projectLimit } from '../billing/limits.js';
import type { MembershipStore } from '../store/postgres-membership-store.js';
import type { PlanStore } from '../store/postgres-plan-store.js';

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

export interface CreateProjectDeps {
  readonly memberships: MembershipStore;
  readonly plans: PlanStore;
}

export const handleCreateProject = async (
  store: ScopedStore,
  input: NewProjectWire,
  deps: CreateProjectDeps,
): Promise<{ project: ProjectWire; created: boolean }> => {
  const existing = await store.getProjectBySlug(input.slug);
  if (existing !== null) {
    return { project: encodeProject(existing), created: false };
  }

  const role = await deps.memberships.defaultTeamRole(store.scope);
  if (role !== 'lead') {
    throw new ApiRequestError(
      'forbidden',
      `only a workspace lead can create a project, and this token belongs to a ${role ?? 'non-member'} — no project named "${input.slug}" exists yet. Ask a lead to create it, then run mneia init again to attach to it.`,
    );
  }

  const usage = await deps.plans.projectUsage(store.scope);
  const decision = projectLimit(usage.plan, usage.activeProjects);
  if (!decision.allowed) {
    throw new ApiRequestError('forbidden', describeProjectLimit(decision, input.slug, usage.slugs));
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
  input: {
    readonly projectId: Uuid;
    readonly tool: string | null;
    readonly clientName?: string | null | undefined;
    readonly clientVersion?: string | null | undefined;
    readonly clientSessionRef?: string | null | undefined;
    readonly clientSessionName?: string | null | undefined;
    readonly clientSessionUrl?: string | null | undefined;
  },
): Promise<{ session: SessionWire }> => {
  const session = await store.createSession(input.projectId, input.tool, {
    ...(input.clientName === undefined ? {} : { clientName: input.clientName }),
    ...(input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion }),
    ...(input.clientSessionRef === undefined ? {} : { clientSessionRef: input.clientSessionRef }),
    ...(input.clientSessionName === undefined
      ? {}
      : { clientSessionName: input.clientSessionName }),
    ...(input.clientSessionUrl === undefined ? {} : { clientSessionUrl: input.clientSessionUrl }),
  });
  return { session: encodeSession(session) };
};

export const handleListWorkspaceActors = async (
  store: ScopedStore,
  input: ListWorkspaceActorsWire,
): Promise<{ actors: readonly ActorWire[] }> => {
  const actors = await store.listWorkspaceActors(
    input.limit === undefined ? {} : { limit: input.limit },
  );
  return { actors: actors.map(encodeActor) };
};

export const handleListProjectSessions = async (
  store: ScopedStore,
  input: ListProjectSessionsWire,
): Promise<{ sessions: readonly ProjectSessionSummaryWire[] }> => {
  const project = await resolveProject(store, input.project);
  if (project === null) {
    throw new ApiRequestError(
      'not_found',
      `expected project "${input.project}" to name a project visible in this workspace; found none — check the slug with mneia status`,
    );
  }

  const sessions = await store.listProjectSessions({
    projectId: project.id,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  return { sessions: sessions.map(encodeProjectSessionSummary) };
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

export const handleRetireItem = async (
  store: ScopedStore,
  input: RetireContextItemWire,
  deps: { readonly telemetry: TelemetryEmitter; readonly now: () => Date },
): Promise<{ checkpoint: CheckpointWire; item: ContextItemWire }> => {
  const result = await store.retireContextItem({
    projectId: input.projectId,
    itemId: input.itemId,
    reason: input.reason,
  });

  await emitQuietly(deps.telemetry, {
    name: 'checkpoint.item_rejected',
    workspaceId: store.scope.workspaceId,
    projectId: input.projectId,
    actorId: store.scope.actorId,
    sessionId: null,
    occurredAt: deps.now(),
    checkpointId: result.checkpoint.id,
    itemId: result.item.id,
  });

  return {
    checkpoint: encodeCheckpoint(result.checkpoint),
    item: encodeContextItem(result.item),
  };
};

export const handleListStaleItems = async (
  store: ScopedStore,
  filter: StaleContextItemFilterWire,
): Promise<{ items: readonly StaleContextItemWire[] }> => {
  const stale = await store.listStaleContextItems({
    projectId: filter.projectId,
    ...(filter.asOf === undefined ? {} : { asOf: new Date(filter.asOf) }),
    ...(filter.limit === undefined ? {} : { limit: filter.limit }),
  });
  return { items: stale.map(encodeStaleContextItem) };
};

export const handleVerifyItem = async (
  store: ScopedStore,
  input: VerifyContextItemWire,
  deps: { readonly telemetry: TelemetryEmitter; readonly now: () => Date },
): Promise<VerifyContextItemResultWire> => {
  if (input.verification === 'denied' && (input.reason ?? '').trim() === '') {
    throw new ApiRequestError(
      'invalid_request',
      `expected a reason saying why item ${input.itemId} no longer holds; received none — a denial retires the item, and the reason is the labelled example §17 collects. Send reason with the denial.`,
    );
  }

  const result = await store.verifyContextItem({
    projectId: input.projectId,
    itemId: input.itemId,
    verification: input.verification,
    reason: input.reason ?? null,
  });

  await emitQuietly(deps.telemetry, {
    name:
      result.verification === 'confirmed'
        ? 'checkpoint.item_confirmed'
        : 'checkpoint.item_rejected',
    workspaceId: store.scope.workspaceId,
    projectId: input.projectId,
    actorId: store.scope.actorId,
    sessionId: null,
    occurredAt: deps.now(),
    checkpointId: result.checkpoint.id,
    itemId: result.item.id,
  });

  return encodeVerifyContextItemResult(result);
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
      coverage: input.checkpoint.coverage,
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
    const sides = await Promise.all(
      [conflict.itemA, conflict.itemB].map(async (itemId) => {
        const written = writtenById.get(itemId);
        if (written !== undefined) {
          return written.loadBearing;
        }
        const stored = await store.getContextItem(itemId);
        return stored?.loadBearing ?? false;
      }),
    );

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
      loadBearing: sides.some(Boolean),
    });
  }

  return { result: encodeCheckpointWriteResult(result) };
};
