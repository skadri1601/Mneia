import type {
  AccessScope,
  ActorKind,
  BillingStatus,
  CheckpointAction,
  CheckpointTrigger,
  ConflictResolution,
  ItemKind,
  ItemStatus,
  TeamFunction,
  TeamRole,
  WorkspacePlan,
} from '../store/schema.js';

export type Uuid = string;

export type IntervalMs = number;

export type Embedding = readonly number[];

export interface Workspace {
  readonly id: Uuid;
  readonly slug: string;
  readonly displayName: string;
  readonly plan: WorkspacePlan;
  readonly billingStatus: BillingStatus;
  readonly billingCustomerRef: string | null;
  readonly seatsPurchased: number | null;
  readonly checkpointAllowance: number | null;
  readonly trialEndsAt: Date | null;
  readonly createdAt: Date;
}

export interface Actor {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly kind: ActorKind;
  readonly displayName: string;
  readonly externalRef: string | null;
  readonly createdAt: Date;
}

export interface Team {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly slug: string;
  readonly displayName: string;
  readonly function: TeamFunction;
  readonly createdAt: Date;
}

export interface TeamMember {
  readonly workspaceId: Uuid;
  readonly teamId: Uuid;
  readonly actorId: Uuid;
  readonly role: TeamRole;
  readonly addedAt: Date;
}

export interface Project {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly teamId: Uuid | null;
  readonly slug: string;
  readonly repoUrl: string | null;
  readonly createdAt: Date;
}

export interface Session {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly actorId: Uuid;
  /** The session that spawned this one — a sub-agent's delegator. Null for a root session. */
  readonly parentSessionId?: Uuid | null;
  readonly tool: string | null;
  readonly clientName?: string | null;
  readonly clientVersion?: string | null;
  readonly clientSessionRef?: string | null;
  readonly clientSessionName?: string | null;
  readonly clientSessionUrl?: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export const CONTEXT_ITEM_PROVENANCE_FIELDS = [
  'sourceSessionId',
  'sessionTool',
  'clientName',
  'clientVersion',
  'clientSessionRef',
  'clientSessionName',
  'clientSessionUrl',
] as const;

export type ContextItemProvenanceField = (typeof CONTEXT_ITEM_PROVENANCE_FIELDS)[number];

export interface ContextItemProvenance {
  readonly actorId: Uuid;
  readonly actorKind: ActorKind;
  readonly actorDisplayName: string;
  readonly sourceSessionId: Uuid | null;
  readonly sessionTool: string | null;
  readonly clientName: string | null;
  readonly clientVersion: string | null;
  readonly clientSessionRef: string | null;
  readonly clientSessionName: string | null;
  readonly clientSessionUrl: string | null;
  readonly status: 'complete' | 'partial';
  readonly missingFields: readonly ContextItemProvenanceField[];
}

export type ContextItemProvenanceValues = Omit<ContextItemProvenance, 'status' | 'missingFields'>;

export const deriveContextItemProvenance = (
  values: ContextItemProvenanceValues,
): ContextItemProvenance => {
  const missingFields = CONTEXT_ITEM_PROVENANCE_FIELDS.filter((field) => values[field] === null);
  return {
    ...values,
    status: missingFields.length === 0 ? 'complete' : 'partial',
    missingFields,
  };
};

export interface ContextItem {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body: string | null;
  readonly status: ItemStatus;

  readonly assertedBy: Uuid;
  readonly assertedAt: Date;
  readonly sourceSessionId: Uuid | null;
  readonly sourceRef: string | null;

  readonly confidence: number;
  readonly humanConfirmed: boolean;
  readonly loadBearing: boolean;
  readonly lastVerifiedAt: Date | null;
  readonly decayAfter: IntervalMs | null;

  readonly validFrom: Date;
  readonly validTo: Date | null;
  readonly supersedesId: Uuid | null;
  readonly supersededById: Uuid | null;

  readonly accessScope: AccessScope;
  readonly embedding: Embedding | null;
  readonly embeddingModel: string | null;
  readonly supersedeReason: string | null;
  readonly provenance?: ContextItemProvenance;
}

export interface Checkpoint {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly sessionId: Uuid | null;
  readonly actorId: Uuid;
  readonly trigger: CheckpointTrigger;
  readonly createdAt: Date;
  readonly summary: string | null;
}

export interface CheckpointItem {
  readonly workspaceId: Uuid;
  readonly checkpointId: Uuid;
  readonly itemId: Uuid;
  readonly action: CheckpointAction;
}

export interface Handoff {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly fromActor: Uuid;
  readonly toActor: Uuid | null;
  readonly createdAt: Date;
  readonly receivedAt: Date | null;
  readonly nextAction: string;
  readonly rendered: string;
}

export interface Conflict {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly itemA: Uuid;
  readonly itemB: Uuid;
  readonly detectedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: Uuid | null;
  readonly resolution: ConflictResolution | null;
  readonly rationale: string | null;
}
