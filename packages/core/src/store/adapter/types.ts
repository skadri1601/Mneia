import type {
  Actor,
  Checkpoint,
  CheckpointItem,
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
  ActorKind,
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
  readonly withEmbedding?: boolean;
}

export interface ContextItemSearch extends ContextItemFilter {
  readonly embedding?: Embedding;
  readonly embeddingModel?: string;
  readonly text?: string;
}

export interface RehydrationCandidateRequest {
  readonly projectId: Uuid;
  readonly asOf: Date;
  readonly candidateLimit: number;
  readonly mandatoryLimit: number;
  readonly supersededLimit: number;
  readonly embedding?: Embedding;
  readonly embeddingModel?: string;
}

export interface RehydrationCandidateGroups {
  readonly candidates: readonly ContextItem[];
  readonly mandatory: readonly ContextItem[];
  readonly superseded: readonly ContextItem[];
}

export interface NewContextItem {
  readonly id?: Uuid;
  readonly projectId: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body?: string | null;
  readonly sourceSessionId?: Uuid | null;
  readonly sourceRef?: string | null;
  readonly confidence?: number;
  readonly loadBearing?: boolean;
  readonly accessScope?: AccessScope;
  readonly embedding?: Embedding | null;
  readonly embeddingModel?: string | null;
  readonly supersedesId?: Uuid | null;
  readonly supersedeReason?: string | null;
  readonly decayAfter?: IntervalMs | null;
}

export interface NewProject {
  readonly id?: Uuid;
  readonly slug: string;
  readonly displayName: string;
  readonly teamId?: Uuid | null;
  readonly repoUrl?: string | null;
}

export interface SessionClientProvenance {
  readonly clientName?: string | null;
  readonly clientVersion?: string | null;
  readonly clientSessionRef?: string | null;
  readonly clientSessionName?: string | null;
  readonly clientSessionUrl?: string | null;
}

export interface ConfirmContextItemInput {
  readonly id: Uuid;
  readonly confirmedBy: Uuid;
  readonly loadBearing?: boolean;
  readonly accessScope?: AccessScope;
  readonly title?: string;
  readonly body?: string | null;
}

export interface PendingReviewFilter {
  readonly projectId: Uuid;
  readonly limit?: number;
}

export interface PendingReviewItem {
  readonly id: Uuid;
  readonly projectId: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body: string | null;
  readonly confidence: number;
  readonly loadBearing: boolean;
  readonly accessScope: AccessScope;
  readonly assertedBy: Uuid;
  readonly assertedByKind: ActorKind;
  readonly assertedByName: string;
  readonly assertedAt: Date;
  readonly sourceRef: string | null;
  readonly originCheckpointId: Uuid | null;
}

export type ContextItemReviewDecision = 'accept' | 'reject';

export type ContextItemReviewOutcomeKind = 'confirmed' | 'edited' | 'rejected';

export interface ContextItemReview {
  readonly itemId: Uuid;
  readonly decision: ContextItemReviewDecision;
  readonly title?: string;
  readonly body?: string | null;
  readonly loadBearing?: boolean;
  readonly accessScope?: AccessScope;
}

export interface ReviewPendingItemsInput {
  readonly projectId: Uuid;
  readonly reviews: readonly ContextItemReview[];
  readonly summary?: string | null;
}

export interface ContextItemReviewOutcome {
  readonly itemId: Uuid;
  readonly outcome: ContextItemReviewOutcomeKind;
  readonly fieldsChanged: readonly string[];
}

export interface ReviewPendingItemsResult {
  readonly checkpoint: Checkpoint;
  readonly outcomes: readonly ContextItemReviewOutcome[];
}

export interface NewCheckpoint {
  readonly id?: Uuid;
  readonly projectId: Uuid;
  readonly sessionId?: Uuid | null;
  readonly actorId: Uuid;
  readonly trigger: CheckpointTrigger;
  readonly summary?: string | null;
  readonly source?: string | null;
  readonly sourceSessionRef?: string | null;
  readonly sourceWatermark?: string | null;
}

export interface CheckpointWrite {
  readonly checkpoint: NewCheckpoint;
  readonly items: readonly CheckpointWriteItem[];
}

export interface CheckpointWriteItem {
  readonly action: CheckpointAction;
  readonly item: NewContextItem;
  readonly conflictsWith?: Uuid | null;
}

export interface CheckpointWriteResult {
  readonly checkpoint: Checkpoint;
  readonly items: readonly CheckpointItem[];
  readonly written: readonly ContextItem[];
  readonly conflicts: readonly Conflict[];
}

export interface NewHandoffItem {
  readonly itemId: Uuid;
  readonly section: string;
}

export interface NewHandoff {
  readonly id?: Uuid;
  readonly projectId: Uuid;
  readonly fromActor: Uuid;
  readonly toActor?: Uuid | null;
  readonly nextAction: string;
  readonly rendered: string;
  readonly items?: readonly NewHandoffItem[];
}

export interface HandoffItem {
  readonly section: string;
  readonly item: ContextItem;
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
  readonly rationale: string;
}

export interface ScopedStore {
  readonly scope: WorkspaceScope;

  getActor(id: Uuid): Promise<Actor | null>;
  getProjectBySlug(slug: string): Promise<Project | null>;
  getProject(id: Uuid): Promise<Project | null>;
  createProject(input: NewProject): Promise<Project>;
  createSession(
    projectId: Uuid,
    tool: string | null,
    provenance?: SessionClientProvenance,
  ): Promise<Session>;
  endSession(id: Uuid): Promise<Session>;

  getContextItem(id: Uuid): Promise<ContextItem | null>;
  listContextItems(filter: ContextItemFilter): Promise<readonly ContextItem[]>;
  searchContextItems(search: ContextItemSearch): Promise<readonly ContextItem[]>;
  selectRehydrationCandidates?(
    request: RehydrationCandidateRequest,
  ): Promise<RehydrationCandidateGroups>;
  insertContextItem(item: NewContextItem): Promise<ContextItem>;
  supersedeContextItem(previousId: Uuid, replacement: NewContextItem): Promise<ContextItem>;
  confirmContextItem(input: ConfirmContextItemInput): Promise<ContextItem>;

  writeCheckpoint(write: CheckpointWrite): Promise<CheckpointWriteResult>;
  getCheckpoint(id: Uuid): Promise<Checkpoint | null>;
  listCheckpoints(projectId: Uuid, limit?: number): Promise<readonly Checkpoint[]>;

  createHandoff(handoff: NewHandoff): Promise<Handoff>;
  receiveHandoff(id: Uuid, receivedBy: Uuid): Promise<Handoff>;
  getHandoff(id: Uuid): Promise<Handoff | null>;
  listOpenHandoffs(projectId: Uuid, limit?: number): Promise<readonly Handoff[]>;
  listHandoffItems(handoffId: Uuid): Promise<readonly HandoffItem[]>;

  recordConflict(conflict: NewConflict): Promise<Conflict>;
  listOpenConflicts(projectId: Uuid): Promise<readonly Conflict[]>;
  resolveConflict(input: ConflictResolutionInput): Promise<Conflict>;
}

export interface ReviewCapableStore extends ScopedStore {
  listPendingReviewItems(filter: PendingReviewFilter): Promise<readonly PendingReviewItem[]>;
  reviewPendingItems(input: ReviewPendingItemsInput): Promise<ReviewPendingItemsResult>;
}

export interface StoreAdapter {
  withScope<T>(scope: WorkspaceScope, run: (store: ReviewCapableStore) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
