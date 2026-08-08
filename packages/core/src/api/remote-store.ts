import { z } from 'zod';
import type {
  Actor,
  Checkpoint,
  Conflict,
  ContextItem,
  Handoff,
  Project,
  Session,
  Uuid,
} from '../domain/types.js';
import type { Slice } from '../rehydrate/types.js';
import type {
  CheckpointWrite,
  CheckpointWriteResult,
  ConfirmContextItemInput,
  ContextItemFilter,
  ContextItemSearch,
  NewContextItem,
  NewProject,
  ScopedStore,
  WorkspaceScope,
} from '../store/adapter/types.js';
import { ApiError, type HttpTransport } from './http.js';
import {
  ActorWireSchema,
  CheckpointWriteResultWireSchema,
  ContextItemWireSchema,
  decodeActor,
  decodeCheckpointWriteResult,
  decodeContextItem,
  decodeProject,
  decodeSession,
  decodeSlice,
  type NewContextItemWire,
  ProjectWireSchema,
  SessionWireSchema,
  SliceWireSchema,
} from './wire.js';

const nullable = <T>(schema: z.ZodType<T>): z.ZodType<T | null> => schema.nullable();

const ActorEnvelope = z.object({ actor: nullable(ActorWireSchema) });
const ProjectEnvelope = z.object({ project: nullable(ProjectWireSchema) });
const CreatedProjectEnvelope = z.object({ project: ProjectWireSchema });
const SessionEnvelope = z.object({ session: SessionWireSchema });
const ContextItemEnvelope = z.object({ item: nullable(ContextItemWireSchema) });
const ContextItemsEnvelope = z.object({ items: z.array(ContextItemWireSchema) });
const CheckpointWriteEnvelope = z.object({ result: CheckpointWriteResultWireSchema });
const SliceEnvelope = z.object({ slice: SliceWireSchema });

export interface RemoteStoreOptions {
  readonly transport: HttpTransport;
  readonly scope: WorkspaceScope;
}

export interface RemoteRehydrateRequest {
  readonly project: string;
  readonly task: string;
  readonly tokenBudget: number;
}

export interface RemoteStore extends ScopedStore {
  rehydrate(request: RemoteRehydrateRequest): Promise<Slice>;
}

const encodeNewItem = (item: NewContextItem): NewContextItemWire => ({
  projectId: item.projectId,
  kind: item.kind,
  title: item.title,
  body: item.body ?? null,
  sourceSessionId: item.sourceSessionId ?? null,
  sourceRef: item.sourceRef ?? null,
  confidence: item.confidence ?? 0.5,
  loadBearing: item.loadBearing ?? false,
  accessScope: item.accessScope ?? 'project',
  supersedesId: item.supersedesId ?? null,
  decayAfter: item.decayAfter ?? null,
});

const encodeFilter = (filter: ContextItemFilter): Record<string, unknown> => ({
  projectId: filter.projectId,
  ...(filter.kinds === undefined ? {} : { kinds: filter.kinds }),
  ...(filter.statuses === undefined ? {} : { statuses: filter.statuses }),
  ...(filter.loadBearing === undefined ? {} : { loadBearing: filter.loadBearing }),
  ...(filter.asOf === undefined ? {} : { asOf: filter.asOf.toISOString() }),
  ...(filter.limit === undefined ? {} : { limit: filter.limit }),
});

function unsupported<T>(method: string, milestone: string): Promise<T> {
  return Promise.reject(
    new ApiError(
      'unsupported',
      `${method} is not served by the hosted API yet; it lands with ${milestone}. Run the server against a Postgres store directly if you need it before then.`,
      501,
    ),
  );
}

export function createRemoteStore(options: RemoteStoreOptions): RemoteStore {
  const { transport, scope } = options;

  return {
    scope,

    async rehydrate(request: RemoteRehydrateRequest): Promise<Slice> {
      const { slice } = await transport.request('/api/v1/rehydrate', SliceEnvelope, request);
      return decodeSlice(slice);
    },

    async getActor(id: Uuid): Promise<Actor | null> {
      const { actor } = await transport.request(
        `/api/v1/actors/${encodeURIComponent(id)}`,
        ActorEnvelope,
      );
      return actor === null ? null : decodeActor(actor);
    },

    async getProject(id: Uuid): Promise<Project | null> {
      const { project } = await transport.request(
        `/api/v1/projects/${encodeURIComponent(id)}`,
        ProjectEnvelope,
      );
      return project === null ? null : decodeProject(project);
    },

    async getProjectBySlug(slug: string): Promise<Project | null> {
      const { project } = await transport.request(
        `/api/v1/projects?slug=${encodeURIComponent(slug)}`,
        ProjectEnvelope,
      );
      return project === null ? null : decodeProject(project);
    },

    async createSession(projectId: Uuid, tool: string | null): Promise<Session> {
      const { session } = await transport.request('/api/v1/sessions', SessionEnvelope, {
        projectId,
        tool,
      });
      return decodeSession(session);
    },

    async getContextItem(id: Uuid): Promise<ContextItem | null> {
      const { item } = await transport.request(
        `/api/v1/items/${encodeURIComponent(id)}`,
        ContextItemEnvelope,
      );
      return item === null ? null : decodeContextItem(item);
    },

    async listContextItems(filter: ContextItemFilter): Promise<readonly ContextItem[]> {
      const { items } = await transport.request(
        '/api/v1/items/list',
        ContextItemsEnvelope,
        encodeFilter(filter),
      );
      return items.map(decodeContextItem);
    },

    async searchContextItems(search: ContextItemSearch): Promise<readonly ContextItem[]> {
      const { items } = await transport.request('/api/v1/items/search', ContextItemsEnvelope, {
        ...encodeFilter(search),
        ...(search.text === undefined ? {} : { text: search.text }),
      });
      return items.map(decodeContextItem);
    },

    async writeCheckpoint(write: CheckpointWrite): Promise<CheckpointWriteResult> {
      const { result } = await transport.request('/api/v1/checkpoints', CheckpointWriteEnvelope, {
        checkpoint: {
          projectId: write.checkpoint.projectId,
          sessionId: write.checkpoint.sessionId ?? null,
          trigger: write.checkpoint.trigger,
          summary: write.checkpoint.summary ?? null,
        },
        items: write.items.map((entry) => ({
          action: entry.action,
          item: encodeNewItem(entry.item),
        })),
      });
      return decodeCheckpointWriteResult(result);
    },

    endSession(): Promise<Session> {
      return unsupported('endSession', 'M2');
    },
    async createProject(input: NewProject): Promise<Project> {
      const { project } = await transport.request('/api/v1/projects', CreatedProjectEnvelope, {
        slug: input.slug,
        displayName: input.displayName,
        repoUrl: input.repoUrl ?? null,
      });
      return decodeProject(project);
    },
    insertContextItem(_item: NewContextItem): Promise<ContextItem> {
      return unsupported('insertContextItem', 'M2');
    },
    supersedeContextItem(_previousId: Uuid, _replacement: NewContextItem): Promise<ContextItem> {
      return unsupported('supersedeContextItem', 'M2');
    },
    confirmContextItem(_input: ConfirmContextItemInput): Promise<ContextItem> {
      return unsupported('confirmContextItem', 'M2');
    },
    getCheckpoint(_id: Uuid): Promise<Checkpoint | null> {
      return unsupported('getCheckpoint', 'M2');
    },
    listCheckpoints(_projectId: Uuid): Promise<readonly Checkpoint[]> {
      return unsupported('listCheckpoints', 'M2');
    },
    createHandoff(): Promise<Handoff> {
      return unsupported('createHandoff', 'M2');
    },
    receiveHandoff(): Promise<Handoff> {
      return unsupported('receiveHandoff', 'M2');
    },
    getHandoff(): Promise<Handoff | null> {
      return unsupported('getHandoff', 'M2');
    },
    recordConflict(): Promise<Conflict> {
      return unsupported('recordConflict', 'M4');
    },
    listOpenConflicts(): Promise<readonly Conflict[]> {
      return unsupported('listOpenConflicts', 'M4');
    },
    resolveConflict(): Promise<Conflict> {
      return unsupported('resolveConflict', 'M4');
    },
  };
}
