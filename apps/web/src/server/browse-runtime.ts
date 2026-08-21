import 'server-only';

import type {
  ContextItem,
  Handoff,
  HandoffItem,
  ItemKind,
  ItemStatus,
  Project,
  Uuid,
} from '@mneia/core';
import { withWorkspaceScope } from './store-runtime.js';

export const BROWSE_LIMIT = 200;

export interface BrowseScope {
  readonly workspaceId: Uuid;
  readonly actorId: Uuid;
}

export interface DecisionBrowseQuery {
  readonly projectId: Uuid;
  readonly kinds?: readonly ItemKind[] | undefined;
  readonly statuses?: readonly ItemStatus[] | undefined;
  readonly loadBearing?: boolean | undefined;
  readonly text?: string | undefined;
}

export interface DecisionBrowseResult {
  readonly project: Project | null;
  readonly items: readonly ContextItem[];
  readonly truncated: boolean;
}

export const browseDecisions = (
  scope: BrowseScope,
  query: DecisionBrowseQuery,
): Promise<DecisionBrowseResult> =>
  withWorkspaceScope(scope, async (store) => {
    const project = await store.getProject(query.projectId);
    if (project === null) {
      return { project: null, items: [], truncated: false };
    }

    const items = await store.searchContextItems({
      projectId: query.projectId,
      limit: BROWSE_LIMIT,
      ...(query.kinds === undefined ? {} : { kinds: query.kinds }),
      ...(query.statuses === undefined ? {} : { statuses: query.statuses }),
      ...(query.loadBearing === undefined ? {} : { loadBearing: query.loadBearing }),
      ...(query.text === undefined ? {} : { text: query.text }),
    });

    return { project, items, truncated: items.length === BROWSE_LIMIT };
  });

export interface TimelineQuery {
  readonly projectId: Uuid;
  readonly asOf: Date;
}

export interface TimelineResult {
  readonly project: Project | null;
  readonly believedThen: readonly ContextItem[];
  readonly believedNow: readonly ContextItem[];
  readonly truncated: boolean;
}

export const readTimeline = (scope: BrowseScope, query: TimelineQuery): Promise<TimelineResult> =>
  withWorkspaceScope(scope, async (store) => {
    const project = await store.getProject(query.projectId);
    if (project === null) {
      return { project: null, believedThen: [], believedNow: [], truncated: false };
    }

    const believedThen = await store.listContextItems({
      projectId: query.projectId,
      asOf: query.asOf,
      limit: BROWSE_LIMIT,
    });

    const believedNow = await store.listContextItems({
      projectId: query.projectId,
      statuses: ['active'],
      limit: BROWSE_LIMIT,
    });

    return {
      project,
      believedThen,
      believedNow,
      truncated: believedThen.length === BROWSE_LIMIT || believedNow.length === BROWSE_LIMIT,
    };
  });

export interface HandoffView {
  readonly handoff: Handoff | null;
  readonly project: Project | null;
  readonly items: readonly HandoffItem[];
}

export const browseHandoff = (scope: BrowseScope, handoffId: Uuid): Promise<HandoffView> =>
  withWorkspaceScope(scope, async (store) => {
    const handoff = await store.getHandoff(handoffId);
    if (handoff === null) {
      return { handoff: null, project: null, items: [] };
    }

    const [project, items] = await Promise.all([
      store.getProject(handoff.projectId),
      store.listHandoffItems(handoff.id),
    ]);

    return { handoff, project, items };
  });

export interface HandoffInboxEntry {
  readonly handoff: Handoff;
  readonly addressedToYou: boolean;
  readonly fromName: string;
}

export interface HandoffInboxView {
  readonly project: Project | null;
  readonly addressed: readonly HandoffInboxEntry[];
  readonly open: readonly HandoffInboxEntry[];
  readonly truncated: boolean;
}

export const browseHandoffInbox = (
  scope: BrowseScope,
  projectId: Uuid,
): Promise<HandoffInboxView> =>
  withWorkspaceScope(scope, async (store) => {
    const project = await store.getProject(projectId);
    if (project === null) {
      return { project: null, addressed: [], open: [], truncated: false };
    }

    const [waiting, actors] = await Promise.all([
      store.listInboxHandoffs({ projectId, limit: BROWSE_LIMIT }),
      store.listWorkspaceActors({ limit: BROWSE_LIMIT }),
    ]);

    const names = new Map(actors.map((actor) => [actor.id, actor.displayName]));
    const entries = waiting.map((handoff) => ({
      handoff,
      addressedToYou: handoff.toActor === scope.actorId,
      fromName: names.get(handoff.fromActor) ?? handoff.fromActor.slice(0, 8),
    }));

    return {
      project,
      addressed: entries.filter((entry) => entry.addressedToYou),
      open: entries.filter((entry) => entry.handoff.toActor === null),
      truncated: waiting.length === BROWSE_LIMIT,
    };
  });
