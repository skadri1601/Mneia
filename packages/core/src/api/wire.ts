import { z } from 'zod';
import { isStorableText, NULL_BYTE_ERROR } from '../domain/text.js';
import {
  type Actor,
  type Checkpoint,
  type CheckpointItem,
  CONTEXT_ITEM_PROVENANCE_FIELDS,
  type Conflict,
  type ContextItem,
  deriveContextItemProvenance,
  type Handoff,
  type Project,
  type Session,
} from '../domain/types.js';
import type { ScoredItem, Slice } from '../rehydrate/types.js';
import type { CheckpointWriteResult } from '../store/adapter/types.js';
import {
  ACCESS_SCOPES,
  ACTOR_KINDS,
  CHECKPOINT_ACTIONS,
  CHECKPOINT_TRIGGERS,
  CONFLICT_RESOLUTIONS,
  ITEM_KINDS,
  ITEM_STATUSES,
} from '../store/schema.js';
import { TRAJECTORY_SOURCES, TURN_KINDS, TURN_ROLES } from '../trajectory/types.js';

export const MAX_ITEM_LIMIT = 1000;
export const MAX_TITLE_LENGTH = 300;
export const MAX_BODY_LENGTH = 8000;
export const MAX_SOURCE_REF_LENGTH = 500;
export const MAX_CHECKPOINT_ITEMS = 50;
export const MIN_TOKEN_BUDGET = 500;
export const MAX_TOKEN_BUDGET = 32_000;

const uuid = z.string().min(1);
const isoDate = z.iso.datetime({ offset: true });
const NO_NULL_BYTE = { error: NULL_BYTE_ERROR } as const;

const toDate = (value: string): Date => new Date(value);
const toNullableDate = (value: string | null): Date | null =>
  value === null ? null : new Date(value);

const ContextItemProvenanceWireSchema = z
  .object({
    actorId: uuid,
    actorKind: z.enum(ACTOR_KINDS),
    actorDisplayName: z.string(),
    sourceSessionId: uuid.nullable(),
    sessionTool: z.string().nullable(),
    clientName: z.string().nullable(),
    clientVersion: z.string().nullable(),
    clientSessionRef: z.string().nullable(),
    clientSessionName: z.string().nullable(),
    clientSessionUrl: z.string().nullable(),
    status: z.enum(['complete', 'partial']),
    missingFields: z.array(z.enum(CONTEXT_ITEM_PROVENANCE_FIELDS)).readonly(),
  })
  .transform(deriveContextItemProvenance);

export const ContextItemWireSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  projectId: uuid,
  kind: z.enum(ITEM_KINDS),
  title: z.string(),
  body: z.string().nullable(),
  status: z.enum(ITEM_STATUSES),
  assertedBy: uuid,
  assertedAt: isoDate,
  sourceSessionId: uuid.nullable(),
  sourceRef: z.string().nullable(),
  confidence: z.number(),
  humanConfirmed: z.boolean(),
  loadBearing: z.boolean(),
  lastVerifiedAt: isoDate.nullable(),
  decayAfter: z.number().nullable(),
  validFrom: isoDate,
  validTo: isoDate.nullable(),
  supersedesId: uuid.nullable(),
  supersededById: uuid.nullable(),
  supersedeReason: z.string().nullable().optional(),
  accessScope: z.enum(ACCESS_SCOPES),
  provenance: ContextItemProvenanceWireSchema.optional(),
});

export type ContextItemWire = z.infer<typeof ContextItemWireSchema>;

export const encodeContextItem = (item: ContextItem): ContextItemWire => ({
  id: item.id,
  workspaceId: item.workspaceId,
  projectId: item.projectId,
  kind: item.kind,
  title: item.title,
  body: item.body,
  status: item.status,
  assertedBy: item.assertedBy,
  assertedAt: item.assertedAt.toISOString(),
  sourceSessionId: item.sourceSessionId,
  sourceRef: item.sourceRef,
  confidence: item.confidence,
  humanConfirmed: item.humanConfirmed,
  loadBearing: item.loadBearing,
  lastVerifiedAt: item.lastVerifiedAt?.toISOString() ?? null,
  decayAfter: item.decayAfter,
  validFrom: item.validFrom.toISOString(),
  validTo: item.validTo?.toISOString() ?? null,
  supersedesId: item.supersedesId,
  supersededById: item.supersededById,
  supersedeReason: item.supersedeReason,
  accessScope: item.accessScope,
  ...(item.provenance === undefined
    ? {}
    : { provenance: deriveContextItemProvenance(item.provenance) }),
});

export const decodeContextItem = (wire: ContextItemWire): ContextItem => ({
  id: wire.id,
  workspaceId: wire.workspaceId,
  projectId: wire.projectId,
  kind: wire.kind,
  title: wire.title,
  body: wire.body,
  status: wire.status,
  assertedBy: wire.assertedBy,
  assertedAt: toDate(wire.assertedAt),
  sourceSessionId: wire.sourceSessionId,
  sourceRef: wire.sourceRef,
  confidence: wire.confidence,
  humanConfirmed: wire.humanConfirmed,
  loadBearing: wire.loadBearing,
  lastVerifiedAt: toNullableDate(wire.lastVerifiedAt),
  decayAfter: wire.decayAfter,
  validFrom: toDate(wire.validFrom),
  validTo: toNullableDate(wire.validTo),
  supersedesId: wire.supersedesId,
  supersededById: wire.supersededById,
  supersedeReason: wire.supersedeReason ?? null,
  accessScope: wire.accessScope,
  embedding: null,
  embeddingModel: null,
  ...(wire.provenance === undefined ? {} : { provenance: wire.provenance }),
});

export const ActorWireSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  kind: z.enum(ACTOR_KINDS),
  displayName: z.string(),
  externalRef: z.string().nullable(),
  createdAt: isoDate,
});

export type ActorWire = z.infer<typeof ActorWireSchema>;

export const encodeActor = (actor: Actor): ActorWire => ({
  id: actor.id,
  workspaceId: actor.workspaceId,
  kind: actor.kind,
  displayName: actor.displayName,
  externalRef: actor.externalRef,
  createdAt: actor.createdAt.toISOString(),
});

export const decodeActor = (wire: ActorWire): Actor => ({
  id: wire.id,
  workspaceId: wire.workspaceId,
  kind: wire.kind,
  displayName: wire.displayName,
  externalRef: wire.externalRef,
  createdAt: toDate(wire.createdAt),
});

export const ProjectWireSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  teamId: uuid.nullable(),
  slug: z.string(),
  repoUrl: z.string().nullable(),
  createdAt: isoDate,
});

export type ProjectWire = z.infer<typeof ProjectWireSchema>;

export const encodeProject = (project: Project): ProjectWire => ({
  id: project.id,
  workspaceId: project.workspaceId,
  teamId: project.teamId,
  slug: project.slug,
  repoUrl: project.repoUrl,
  createdAt: project.createdAt.toISOString(),
});

export const decodeProject = (wire: ProjectWire): Project => ({
  id: wire.id,
  workspaceId: wire.workspaceId,
  teamId: wire.teamId,
  slug: wire.slug,
  repoUrl: wire.repoUrl,
  createdAt: toDate(wire.createdAt),
});

const ScoreComponentsWireSchema = z.object({
  semanticRelevance: z.number(),
  recencyDecay: z.number(),
  confidence: z.number(),
  humanConfirmed: z.number(),
  loadBearing: z.number(),
  freshness: z.number(),
  disputed: z.number(),
});

export const ScoredItemWireSchema = z.object({
  item: ContextItemWireSchema,
  score: z.number(),
  components: ScoreComponentsWireSchema,
});

export type ScoredItemWire = z.infer<typeof ScoredItemWireSchema>;

export const encodeScoredItem = (scored: ScoredItem): ScoredItemWire => ({
  item: encodeContextItem(scored.item),
  score: scored.score,
  components: scored.components,
});

export const decodeScoredItem = (wire: ScoredItemWire): ScoredItem => ({
  item: decodeContextItem(wire.item),
  score: wire.score,
  components: wire.components,
});

export const SliceWireSchema = z.object({
  id: uuid,
  projectId: uuid,
  task: z.string(),
  items: z.array(ScoredItemWireSchema),
  tokensUsed: z.number(),
  tokenBudget: z.number(),
  renderedMarkdown: z.string(),
  generatedAt: isoDate,
});

export type SliceWire = z.infer<typeof SliceWireSchema>;

export const encodeSlice = (slice: Slice): SliceWire => ({
  id: slice.id,
  projectId: slice.projectId,
  task: slice.task,
  items: slice.items.map(encodeScoredItem),
  tokensUsed: slice.tokensUsed,
  tokenBudget: slice.tokenBudget,
  renderedMarkdown: slice.renderedMarkdown,
  generatedAt: slice.generatedAt.toISOString(),
});

export const decodeSlice = (wire: SliceWire): Slice => ({
  id: wire.id,
  projectId: wire.projectId,
  task: wire.task,
  items: wire.items.map(decodeScoredItem),
  tokensUsed: wire.tokensUsed,
  tokenBudget: wire.tokenBudget,
  renderedMarkdown: wire.renderedMarkdown,
  generatedAt: toDate(wire.generatedAt),
});

export const SessionWireSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  projectId: uuid,
  actorId: uuid,
  tool: z.string().nullable(),
  clientName: z.string().nullable().optional(),
  clientVersion: z.string().nullable().optional(),
  clientSessionRef: z.string().nullable().optional(),
  clientSessionName: z.string().nullable().optional(),
  clientSessionUrl: z.string().nullable().optional(),
  startedAt: isoDate,
  endedAt: isoDate.nullable(),
});

export type SessionWire = z.infer<typeof SessionWireSchema>;

export const encodeSession = (session: Session): SessionWire => ({
  id: session.id,
  workspaceId: session.workspaceId,
  projectId: session.projectId,
  actorId: session.actorId,
  tool: session.tool,
  clientName: session.clientName,
  clientVersion: session.clientVersion,
  clientSessionRef: session.clientSessionRef,
  clientSessionName: session.clientSessionName,
  clientSessionUrl: session.clientSessionUrl,
  startedAt: session.startedAt.toISOString(),
  endedAt: session.endedAt?.toISOString() ?? null,
});

export const decodeSession = (wire: SessionWire): Session => ({
  id: wire.id,
  workspaceId: wire.workspaceId,
  projectId: wire.projectId,
  actorId: wire.actorId,
  tool: wire.tool,
  clientName: wire.clientName ?? null,
  clientVersion: wire.clientVersion ?? null,
  clientSessionRef: wire.clientSessionRef ?? null,
  clientSessionName: wire.clientSessionName ?? null,
  clientSessionUrl: wire.clientSessionUrl ?? null,
  startedAt: toDate(wire.startedAt),
  endedAt: toNullableDate(wire.endedAt),
});

export const CheckpointWireSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  projectId: uuid,
  sessionId: uuid.nullable(),
  actorId: uuid,
  trigger: z.enum(CHECKPOINT_TRIGGERS),
  createdAt: isoDate,
  summary: z.string().nullable(),
});

export type CheckpointWire = z.infer<typeof CheckpointWireSchema>;

export const encodeCheckpoint = (checkpoint: Checkpoint): CheckpointWire => ({
  id: checkpoint.id,
  workspaceId: checkpoint.workspaceId,
  projectId: checkpoint.projectId,
  sessionId: checkpoint.sessionId,
  actorId: checkpoint.actorId,
  trigger: checkpoint.trigger,
  createdAt: checkpoint.createdAt.toISOString(),
  summary: checkpoint.summary,
});

export const decodeCheckpoint = (wire: CheckpointWire): Checkpoint => ({
  id: wire.id,
  workspaceId: wire.workspaceId,
  projectId: wire.projectId,
  sessionId: wire.sessionId,
  actorId: wire.actorId,
  trigger: wire.trigger,
  createdAt: toDate(wire.createdAt),
  summary: wire.summary,
});

export const CheckpointItemWireSchema = z.object({
  workspaceId: uuid,
  checkpointId: uuid,
  itemId: uuid,
  action: z.enum(CHECKPOINT_ACTIONS),
});

export type CheckpointItemWire = z.infer<typeof CheckpointItemWireSchema>;

export const RetireContextItemWireSchema = z.object({
  projectId: uuid,
  itemId: uuid,
  reason: z.string().min(1).max(1000),
});

export type RetireContextItemWire = z.infer<typeof RetireContextItemWireSchema>;

export const encodeCheckpointItem = (item: CheckpointItem): CheckpointItemWire => ({
  workspaceId: item.workspaceId,
  checkpointId: item.checkpointId,
  itemId: item.itemId,
  action: item.action,
});

export const decodeCheckpointItem = (wire: CheckpointItemWire): CheckpointItem => ({
  workspaceId: wire.workspaceId,
  checkpointId: wire.checkpointId,
  itemId: wire.itemId,
  action: wire.action,
});

export const ConflictWireSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  projectId: uuid,
  itemA: uuid,
  itemB: uuid,
  detectedAt: isoDate,
  resolvedAt: isoDate.nullable(),
  resolvedBy: uuid.nullable(),
  resolution: z.enum(CONFLICT_RESOLUTIONS).nullable(),
  rationale: z.string().nullable(),
});

export type ConflictWire = z.infer<typeof ConflictWireSchema>;

export const encodeConflict = (conflict: Conflict): ConflictWire => ({
  id: conflict.id,
  workspaceId: conflict.workspaceId,
  projectId: conflict.projectId,
  itemA: conflict.itemA,
  itemB: conflict.itemB,
  detectedAt: conflict.detectedAt.toISOString(),
  resolvedAt: conflict.resolvedAt === null ? null : conflict.resolvedAt.toISOString(),
  resolvedBy: conflict.resolvedBy,
  resolution: conflict.resolution,
  rationale: conflict.rationale,
});

export const decodeConflict = (wire: ConflictWire): Conflict => ({
  id: wire.id,
  workspaceId: wire.workspaceId,
  projectId: wire.projectId,
  itemA: wire.itemA,
  itemB: wire.itemB,
  detectedAt: toDate(wire.detectedAt),
  resolvedAt: wire.resolvedAt === null ? null : toDate(wire.resolvedAt),
  resolvedBy: wire.resolvedBy,
  resolution: wire.resolution,
  rationale: wire.rationale,
});

export const CheckpointWriteResultWireSchema = z.object({
  checkpoint: CheckpointWireSchema,
  items: z.array(CheckpointItemWireSchema),
  written: z.array(ContextItemWireSchema),
  conflicts: z.array(ConflictWireSchema).default([]),
});

export type CheckpointWriteResultWire = z.infer<typeof CheckpointWriteResultWireSchema>;

export const encodeCheckpointWriteResult = (
  result: CheckpointWriteResult,
): CheckpointWriteResultWire => ({
  checkpoint: encodeCheckpoint(result.checkpoint),
  items: result.items.map(encodeCheckpointItem),
  written: result.written.map(encodeContextItem),
  conflicts: result.conflicts.map(encodeConflict),
});

export const decodeCheckpointWriteResult = (
  wire: CheckpointWriteResultWire,
): CheckpointWriteResult => ({
  checkpoint: decodeCheckpoint(wire.checkpoint),
  items: wire.items.map(decodeCheckpointItem),
  written: wire.written.map(decodeContextItem),
  conflicts: wire.conflicts.map(decodeConflict),
});

export const ContextItemFilterWireSchema = z.object({
  projectId: uuid,
  kinds: z.array(z.enum(ITEM_KINDS)).optional(),
  statuses: z.array(z.enum(ITEM_STATUSES)).optional(),
  loadBearing: z.boolean().optional(),
  asOf: isoDate.optional(),
  limit: z.number().int().positive().max(MAX_ITEM_LIMIT).optional(),
});

export type ContextItemFilterWire = z.infer<typeof ContextItemFilterWireSchema>;

export const ContextItemSearchWireSchema = ContextItemFilterWireSchema.extend({
  text: z.string().optional(),
});

export type ContextItemSearchWire = z.infer<typeof ContextItemSearchWireSchema>;

export const NewContextItemWireSchema = z.object({
  projectId: uuid,
  kind: z.enum(ITEM_KINDS),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).refine(isStorableText, NO_NULL_BYTE),
  body: z.string().max(MAX_BODY_LENGTH).refine(isStorableText, NO_NULL_BYTE).nullable().optional(),
  sourceSessionId: uuid.nullable().optional(),
  sourceRef: z
    .string()
    .max(MAX_SOURCE_REF_LENGTH)
    .refine(isStorableText, NO_NULL_BYTE)
    .nullable()
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  loadBearing: z.boolean().optional(),
  accessScope: z.enum(ACCESS_SCOPES).optional(),
  supersedesId: uuid.nullable().optional(),
  decayAfter: z.number().nullable().optional(),
});

export type NewContextItemWire = z.infer<typeof NewContextItemWireSchema>;

export const MAX_PROJECT_SLUG_LENGTH = 100;
export const MAX_PROJECT_DISPLAY_NAME_LENGTH = 128;
export const MAX_REPO_URL_LENGTH = 500;

export const NewProjectWireSchema = z.object({
  slug: z.string().trim().min(1).max(MAX_PROJECT_SLUG_LENGTH).refine(isStorableText, NO_NULL_BYTE),
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PROJECT_DISPLAY_NAME_LENGTH)
    .refine(isStorableText, NO_NULL_BYTE),
  repoUrl: z
    .string()
    .max(MAX_REPO_URL_LENGTH)
    .refine(isStorableText, NO_NULL_BYTE)
    .nullable()
    .optional(),
});

export type NewProjectWire = z.infer<typeof NewProjectWireSchema>;

export const EXTRACTION_INCOMPLETE_REASONS = ['provider_failed', 'invalid_output'] as const;

export type ExtractionIncompleteReason = (typeof EXTRACTION_INCOMPLETE_REASONS)[number];

export const ExtractionCoverageWireSchema = z.strictObject({
  droppedTurns: z.number().int().min(0),
  splitTurns: z.number().int().min(0),
  pendingTurns: z.number().int().min(0),
  consumedTurns: z.number().int().min(0),
  incompleteCode: z.enum(EXTRACTION_INCOMPLETE_REASONS).nullable(),
});

export type ExtractionCoverageWire = z.infer<typeof ExtractionCoverageWireSchema>;

export const CheckpointWriteWireSchema = z.object({
  checkpoint: z.object({
    projectId: uuid,
    sessionId: uuid.nullable().optional(),
    trigger: z.enum(CHECKPOINT_TRIGGERS),
    summary: z
      .string()
      .max(MAX_BODY_LENGTH)
      .refine(isStorableText, NO_NULL_BYTE)
      .nullable()
      .optional(),
    source: z.enum(TRAJECTORY_SOURCES).nullable().optional(),
    sourceSessionRef: z.string().max(300).nullable().optional(),
    sourceWatermark: z.string().max(300).nullable().optional(),
    coverage: ExtractionCoverageWireSchema.optional(),
  }),
  items: z
    .array(
      z.object({
        action: z.enum(CHECKPOINT_ACTIONS),
        item: NewContextItemWireSchema,
        conflictsWith: uuid.nullable().optional(),
      }),
    )
    .min(1)
    .max(MAX_CHECKPOINT_ITEMS),
});

export type CheckpointWriteWire = z.infer<typeof CheckpointWriteWireSchema>;

export const RehydrateRequestWireSchema = z.object({
  project: z.string().min(1),
  task: z.string(),
  tokenBudget: z.number().int().min(MIN_TOKEN_BUDGET).max(MAX_TOKEN_BUDGET),
});

export type RehydrateRequestWire = z.infer<typeof RehydrateRequestWireSchema>;

export const MAX_TRAJECTORY_TURNS = 5000;
export const MAX_TURN_TEXT_LENGTH = 200_000;

export const TrajectoryTurnWireSchema = z.object({
  ref: z.string().min(1).max(300),
  role: z.enum(TURN_ROLES),
  kind: z.enum(TURN_KINDS),
  text: z.string().max(MAX_TURN_TEXT_LENGTH).refine(isStorableText, NO_NULL_BYTE),
  toolName: z.string().max(200).refine(isStorableText, NO_NULL_BYTE).nullable().optional(),
  at: isoDate.nullable().optional(),
});

export type TrajectoryTurnWire = z.infer<typeof TrajectoryTurnWireSchema>;

export const CheckpointProposeWireSchema = z.object({
  project: z.string().min(1),
  source: z.enum(TRAJECTORY_SOURCES),
  sessionRef: z.string().min(1).max(300),
  trigger: z.enum(CHECKPOINT_TRIGGERS),
  turns: z.array(TrajectoryTurnWireSchema).min(1).max(MAX_TRAJECTORY_TURNS),
});

export type CheckpointProposeWire = z.infer<typeof CheckpointProposeWireSchema>;

export const ContradictionEvidenceWireSchema = z.object({
  matchedItemId: uuid,
  matchedTitle: z.string(),
  matchedHumanConfirmed: z.boolean(),
  matchedLoadBearing: z.boolean(),
  subjectSimilarity: z.number().min(0).max(1),
  sharedSubjectTokens: z.array(z.string()),
  signal: z.enum(['stance_flip', 'value_conflict']),
  reason: z.string(),
});

export type ContradictionEvidenceWire = z.infer<typeof ContradictionEvidenceWireSchema>;

export const ProposedCandidateWireSchema = z.object({
  index: z.number().int().min(0),
  kind: z.enum(ITEM_KINDS),
  title: z.string(),
  body: z.string().nullable(),
  rationale: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  loadBearing: z.boolean(),
  accessScope: z.enum(ACCESS_SCOPES),
  sourceRef: z.string().nullable(),
  supersedesId: uuid.nullable().optional(),
  contradiction: ContradictionEvidenceWireSchema.nullable().optional(),
});

export type ProposedCandidateWire = z.infer<typeof ProposedCandidateWireSchema>;

export const CheckpointProposalWireSchema = z.object({
  workspaceId: uuid,
  projectId: uuid,
  actorId: uuid,
  candidates: z.array(ProposedCandidateWireSchema),
  rejectedCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0).optional(),
  watermark: z.string().nullable(),
  consumedTurns: z.number().int().min(0),
  model: z.string(),
  pendingTurns: z.number().int().min(0).default(0),
  incompleteReason: z.string().nullable().default(null),
  coverage: ExtractionCoverageWireSchema.optional(),
});

export type CheckpointProposalWire = z.infer<typeof CheckpointProposalWireSchema>;

export const HandoffWireSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  projectId: uuid,
  fromActor: uuid,
  toActor: uuid.nullable(),
  createdAt: isoDate,
  receivedAt: isoDate.nullable(),
  nextAction: z.string(),
  rendered: z.string(),
});

export type HandoffWire = z.infer<typeof HandoffWireSchema>;

export const encodeHandoff = (handoff: Handoff): HandoffWire => ({
  id: handoff.id,
  workspaceId: handoff.workspaceId,
  projectId: handoff.projectId,
  fromActor: handoff.fromActor,
  toActor: handoff.toActor,
  createdAt: handoff.createdAt.toISOString(),
  receivedAt: handoff.receivedAt === null ? null : handoff.receivedAt.toISOString(),
  nextAction: handoff.nextAction,
  rendered: handoff.rendered,
});

export const decodeHandoff = (wire: HandoffWire): Handoff => ({
  id: wire.id,
  workspaceId: wire.workspaceId,
  projectId: wire.projectId,
  fromActor: wire.fromActor,
  toActor: wire.toActor,
  createdAt: toDate(wire.createdAt),
  receivedAt: toNullableDate(wire.receivedAt),
  nextAction: wire.nextAction,
  rendered: wire.rendered,
});

export const MAX_NEXT_ACTION_LENGTH = 1000;

export const CreateHandoffWireSchema = z.object({
  project: z.string().min(1),
  toActor: uuid.nullable().optional(),
  nextAction: z.string().min(1).max(MAX_NEXT_ACTION_LENGTH).refine(isStorableText, NO_NULL_BYTE),
  supersededWindowDays: z.number().int().min(1).max(365).optional(),
});

export type CreateHandoffWire = z.infer<typeof CreateHandoffWireSchema>;

export const ReceiveHandoffWireSchema = z.object({
  id: uuid,
});

export type ReceiveHandoffWire = z.infer<typeof ReceiveHandoffWireSchema>;

export const ListOpenHandoffsWireSchema = z.object({
  project: z.string().min(1),
  limit: z.number().int().min(1).max(MAX_ITEM_LIMIT).optional(),
});

export type ListOpenHandoffsWire = z.infer<typeof ListOpenHandoffsWireSchema>;
