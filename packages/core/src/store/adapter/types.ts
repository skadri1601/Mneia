import type {
  Actor,
  CheckpointItem,
  Checkpoint,
  Conflict,
  ContextItem,
  Embedding,
  Handoff,
  IntervalMs,
  Project,
  Session,
  Uuid,
} from '../../domain/types.js';
import type {
  AccessScope,
  CheckpointAction,
  CheckpointTrigger,
  ConflictResolution,
  ItemKind,
  ItemStatus,
} from '../schema.js';

export interface WorkspaceScope {
  readonly workspaceId: Uuid;
  readonly actorId: Uuid;
}

export interface ContextItemFilter {
  readonly projectId: Uuid;
  readonly kinds?: readonly ItemKind[];
  readonly statuses?: readonly ItemStatus[];
  readonly loadBearing?: boolean;
  readonly asOf?: Date;
  readonly limit?: number;
}

export interface ContextItemSearch extends ContextItemFilter {
  readonly embedding?: Embedding;
  readonly text?: string;
}

export interface NewContextItem {
  readonly id?: Uuid;
  readonly projectId: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body?: string | null;
  readonly assertedBy: Uuid;
  readonly sourceSessionId?: Uuid | null;
  readonly sourceRef?: string | null;
  readonly confidence?: number;
  readonly humanConfirmed?: boolean;
  readonly loadBearing?: boolean;
  readonly accessScope?: AccessScope;
  readonly embedding?: Embedding | null;
  readonly embeddingModel?: string | null;
  readonly supersedesId?: Uuid | null;
  readonly decayAfter?: IntervalMs | null;
}

export interface NewProject {
  readonly id?: Uuid;
  readonly slug: string;
  readonly displayName: string;
  readonly teamId?: Uuid | null;
  readonly repoUrl?: string | null;
}

export interface ConfirmContextItemInput {
  readonly id: Uuid;
  readonly confirmedBy: Uuid;
  readonly loadBearing?: boolean;
  readonly accessScope?: AccessScope;
  readonly title?: string;
  readonly body?: string | null;
}

export interface NewCheckpoint {
  readonly id?: Uuid;
  readonly projectId: Uuid;
  readonly sessionId?: Uuid | null;
  readonly actorId: Uuid;
  readonly trigger: CheckpointTrigger;
  readonly summary?: string | null;
}

export interface CheckpointWrite {
  readonly checkpoint: NewCheckpoint;
  readonly items: readonly CheckpointWriteItem[];
}

export interface CheckpointWriteItem {
  readonly action: CheckpointAction;
  readonly item: NewContextItem;
}

export interface CheckpointWriteResult {
  readonly checkpoint: Checkpoint;
  readonly items: readonly CheckpointItem[];
  readonly written: readonly ContextItem[];
}

export interface NewHandoff {
  readonly id?: Uuid;
  readonly projectId: Uuid;
  readonly fromActor: Uuid;
  readonly toActor?: Uuid | null;
  readonly nextAction: string;
  readonly rendered: string;
}

export interface NewConflict {
  readonly id?: Uuid;
  readonly projectId: Uuid;
  readonly itemA: Uuid;
  readonly itemB: Uuid;
}

export interface ConflictResolutionInput {
  readonly conflictId: Uuid;
  readonly resolvedBy: Uuid;
  readonly resolution: ConflictResolution;
}

export interface ScopedStore {
  readonly scope: WorkspaceScope;

  getActor(id: Uuid): Promise<Actor | null>;
  getProjectBySlug(slug: string): Promise<Project | null>;
  getProject(id: Uuid): Promise<Project | null>;
  createProject(input: NewProject): Promise<Project>;
  createSession(projectId: Uuid, tool: string | null): Promise<Session>;
  endSession(id: Uuid): Promise<Session>;

  getContextItem(id: Uuid): Promise<ContextItem | null>;
  listContextItems(filter: ContextItemFilter): Promise<readonly ContextItem[]>;
  searchContextItems(search: ContextItemSearch): Promise<readonly ContextItem[]>;
  insertContextItem(item: NewContextItem): Promise<ContextItem>;
  supersedeContextItem(previousId: Uuid, replacement: NewContextItem): Promise<ContextItem>;
  confirmContextItem(input: ConfirmContextItemInput): Promise<ContextItem>;

  writeCheckpoint(write: CheckpointWrite): Promise<CheckpointWriteResult>;
  getCheckpoint(id: Uuid): Promise<Checkpoint | null>;
  listCheckpoints(projectId: Uuid, limit?: number): Promise<readonly Checkpoint[]>;

  createHandoff(handoff: NewHandoff): Promise<Handoff>;
  receiveHandoff(id: Uuid, receivedBy: Uuid): Promise<Handoff>;
  getHandoff(id: Uuid): Promise<Handoff | null>;

  recordConflict(conflict: NewConflict): Promise<Conflict>;
  listOpenConflicts(projectId: Uuid): Promise<readonly Conflict[]>;
  resolveConflict(input: ConflictResolutionInput): Promise<Conflict>;
}

export interface StoreAdapter {
  withScope<T>(scope: WorkspaceScope, run: (store: ScopedStore) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
