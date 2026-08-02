export const VERSION = '0.0.0';

export type {
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
  Team,
  TeamMember,
  Uuid,
  Workspace,
} from './domain/types.js';
export type {
  CheckpointWrite,
  CheckpointWriteItem,
  CheckpointWriteResult,
  ConflictResolutionInput,
  ContextItemFilter,
  ContextItemSearch,
  NewCheckpoint,
  NewConflict,
  NewContextItem,
  NewHandoff,
  ScopedStore,
  StoreAdapter,
  WorkspaceScope,
} from './store/adapter/types.js';
export type {
  TelemetryContext,
  TelemetryEmitter,
  TelemetryEvent,
  TelemetryEventName,
  TelemetrySink,
} from './telemetry/types.js';
export { TELEMETRY_EVENT_NAMES } from './telemetry/types.js';
export type {
  KindQuotas,
  PackRequest,
  PackedSlice,
  ScoreComponents,
  ScoredItem,
  ScoringInput,
  ScoringWeights,
  Slice,
  SliceRequest,
} from './rehydrate/types.js';
export { DEFAULT_SCORING_WEIGHTS, scoreItems } from './rehydrate/score.js';
export type { TokenCounter } from './rehydrate/tokens.js';
export {
  countItemTokens,
  heuristicTokenCounter,
  truncateToTokens,
} from './rehydrate/tokens.js';
export type { PackOptions } from './rehydrate/pack.js';
export { DEFAULT_KIND_QUOTAS, isMandatoryItem, packSlice, sliceOverflow } from './rehydrate/pack.js';
export type { RenderSliceInput } from './rehydrate/render.js';
export { SLICE_SECTION_HEADINGS, renderSlice, shortenItemIds } from './rehydrate/render.js';
export type {
  SupersedeBlockedOutcome,
  SupersedeOutcome,
  SupersedeRequest,
  SupersedeVerdict,
} from './policy/index.js';
export {
  SupersedeNotAllowedError,
  assertSupersedeAllowed,
  evaluateSupersede,
} from './policy/index.js';
export type {
  JsonlSinkOptions,
  MemorySinkOptions,
  MemoryTelemetrySink,
  TelemetryEmitterOptions,
} from './telemetry/index.js';
export {
  TelemetrySinkError,
  TelemetryValidationError,
  TelemetryWriteError,
  createJsonlSink,
  createMemorySink,
  createNoopEmitter,
  createTelemetryEmitter,
  redactEvent,
  telemetryEnabledIn,
} from './telemetry/index.js';
export type { MigrationDriver, SqlExecutor, SqlResult, SqlValue } from './store/driver.js';
export type {
  PostgresConnectionSource,
  PostgresSession,
  SqlRow,
} from './store/adapter/index.js';
export { toActor, toTeam, toTeamMember, toWorkspace } from './store/adapter/index.js';
export type { MigrateOptions, MigrateResult } from './store/migrate.js';
export {
  BOOKKEEPING_TABLE,
  ensureBookkeepingTable,
  migrate,
  readAppliedMigrations,
} from './store/migrate.js';
export type { AppliedMigration, Migration } from './store/migrations/index.js';
export { MIGRATIONS } from './store/migrations/index.js';
export type { MigrationErrorCode, MigrationPlan } from './store/plan.js';
export type {
  AccessScope,
  ActorKind,
  BillingStatus,
  CheckpointAction,
  CheckpointTrigger,
  ConflictResolution,
  CoreEntityTable,
  ItemKind,
  ItemStatus,
  TeamFunction,
  TeamRole,
  WorkspacePlan,
} from './store/schema.js';
export {
  ACCESS_SCOPE_ORDER,
  ACCESS_SCOPES,
  ACTOR_KINDS,
  BILLING_STATUSES,
  CHECKPOINT_ACTIONS,
  CHECKPOINT_TRIGGERS,
  CONFLICT_RESOLUTIONS,
  CORE_ENTITY_TABLES,
  EMBEDDING_DIMENSIONS,
  IDENTITY_SUBJECT_SETTING,
  ITEM_KINDS,
  ITEM_STATUSES,
  TEAM_FUNCTIONS,
  TEAM_ROLES,
  WORKSPACE_PLANS,
  WORKSPACE_SETTING,
} from './store/schema.js';
export type { RlsGuardErrorCode, RlsPosture } from './store/rls-guard.js';
export {
  RLS_BYPASS_ESCAPE_HATCH,
  RLS_POSTURE_SQL,
  RlsGuardError,
  assertConnectionEnforcesRls,
  assertRlsEnforced,
  inspectRlsPosture,
} from './store/rls-guard.js';
export {
  MigrationError,
  checksumOf,
  planMigrations,
  validateMigrationList,
} from './store/plan.js';
