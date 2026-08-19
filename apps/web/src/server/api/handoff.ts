import 'server-only';

import type {
  ContextItemWire,
  CreateHandoffWire,
  Handoff,
  HandoffWire,
  ListOpenHandoffsWire,
  ReceiveHandoffWire,
  ScopedStore,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';
import {
  assembleHandoff,
  encodeContextItem,
  encodeHandoff,
  resolveProject,
  StoreError,
} from '@mneia/core';
import { ApiRequestError } from './handlers.js';

export interface HandoffDependencies {
  readonly telemetry: TelemetryEmitter;
  readonly now: () => Date;
}

const emitQuietly = async (telemetry: TelemetryEmitter, event: TelemetryEvent): Promise<void> => {
  try {
    await telemetry.emit(event);
  } catch {
    return;
  }
};

const asApiError = (error: unknown): never => {
  if (error instanceof StoreError) {
    if (error.code === 'already_received') {
      throw new ApiRequestError('invalid_request', error.message);
    }
    if (error.code === 'wrong_receiver') {
      throw new ApiRequestError('forbidden', error.message);
    }
  }
  throw error;
};

export const handleCreateHandoff = async (
  store: ScopedStore,
  input: CreateHandoffWire,
  deps: HandoffDependencies,
): Promise<{ handoff: HandoffWire }> => {
  const project = await resolveProject(store, input.project);
  if (project === null) {
    throw new ApiRequestError(
      'not_found',
      `expected project "${input.project}" to name a project visible in this workspace; found none — check the slug with mneia status`,
    );
  }

  const now = deps.now();
  const assembled = await assembleHandoff(store, {
    projectId: project.id,
    toActor: input.toActor ?? null,
    nextAction: input.nextAction,
    ...(input.supersededWindowDays === undefined
      ? {}
      : { supersededWindowDays: input.supersededWindowDays }),
    now,
  });

  await emitQuietly(deps.telemetry, {
    name: 'handoff.created',
    workspaceId: store.scope.workspaceId,
    projectId: project.id,
    actorId: store.scope.actorId,
    occurredAt: now,
    handoffId: assembled.handoff.id,
    itemIds: assembled.itemIds,
    toActor: assembled.handoff.toActor,
  });

  return { handoff: encodeHandoff(assembled.handoff) };
};

export const handleReceiveHandoff = async (
  store: ScopedStore,
  input: ReceiveHandoffWire,
  deps: HandoffDependencies,
): Promise<{ handoff: HandoffWire }> => {
  let received: Handoff;
  try {
    received = await store.receiveHandoff(input.id, store.scope.actorId);
  } catch (error) {
    return asApiError(error);
  }

  await emitQuietly(deps.telemetry, {
    name: 'handoff.received',
    workspaceId: store.scope.workspaceId,
    projectId: received.projectId,
    actorId: store.scope.actorId,
    occurredAt: deps.now(),
    handoffId: received.id,
    receivedBy: store.scope.actorId,
  });

  return { handoff: encodeHandoff(received) };
};

export const handleGetHandoff = async (
  store: ScopedStore,
  id: Uuid,
): Promise<{ handoff: HandoffWire | null }> => {
  const handoff = await store.getHandoff(id);
  return { handoff: handoff === null ? null : encodeHandoff(handoff) };
};

export const handleListOpenHandoffs = async (
  store: ScopedStore,
  input: ListOpenHandoffsWire,
): Promise<{ handoffs: readonly HandoffWire[] }> => {
  const project = await resolveProject(store, input.project);
  if (project === null) {
    throw new ApiRequestError(
      'not_found',
      `expected project "${input.project}" to name a project visible in this workspace; found none — check the slug with mneia status`,
    );
  }

  const handoffs = await store.listOpenHandoffs(
    project.id,
    ...(input.limit === undefined ? [] : [input.limit]),
  );
  return { handoffs: handoffs.map(encodeHandoff) };
};

export const handleListHandoffItems = async (
  store: ScopedStore,
  handoffId: Uuid,
): Promise<{ items: readonly { section: string; item: ContextItemWire }[] }> => {
  const handoff = await store.getHandoff(handoffId);
  if (handoff === null) {
    throw new ApiRequestError(
      'not_found',
      `expected handoff ${handoffId} to be visible in this workspace; found none`,
    );
  }

  const items = await store.listHandoffItems(handoffId);
  return {
    items: items.map((entry) => ({ section: entry.section, item: encodeContextItem(entry.item) })),
  };
};
