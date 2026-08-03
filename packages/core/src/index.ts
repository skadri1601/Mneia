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
  SupersedeBlockedOutcome,
  SupersedeOutcome,
  SupersedeRequest,
  SupersedeVerdict,
} from './policy/index.js';
export {
  assertSupersedeAllowed,
  evaluateSupersede,
  SupersedeNotAllowedError,
} from './policy/index.js';
export type { PackOptions } from './rehydrate/pack.js';
export {
  DEFAULT_KIND_QUOTAS,
  isMandatoryItem,
  packSlice,
  sliceOverflow,
} from './rehydrate/pack.js';
export type { RenderSliceInput } from './rehydrate/render.js';
export { renderSlice, SLICE_SECTION_HEADINGS, shortenItemIds } from './rehydrate/render.js';
export { DEFAULT_SCORING_WEIGHTS, scoreItems } from './rehydrate/score.js';
export type { TokenCounter } from './rehydrate/tokens.js';
export {
  countItemTokens,
  heuristicTokenCounter,
  truncateToTokens,
} from './rehydrate/tokens.js';
export type {
  KindQuotas,
  PackedSlice,
  PackRequest,
  ScoreComponents,
  ScoredItem,
  ScoringInput,
  ScoringWeights,
  Slice,
  SliceRequest,
} from './rehydrate/types.js';
export type {
  PostgresConnectionSource,
  PostgresSession,
  SqlRow,
  StoreErrorCode,
} from './store/adapter/index.js';
export {
  PostgresStoreAdapter,
  StoreError,
  toActor,
  toTeam,
  toTeamMember,
  toWorkspace,
} from './store/adapter/index.js';
export type {
  CheckpointWrite,
  CheckpointWriteItem,
  CheckpointWriteResult,
  ConfirmContextItemInput,
  ConflictResolutionInput,
  ContextItemFilter,
  ContextItemSearch,
  NewCheckpoint,
  NewConflict,
  NewContextItem,
  NewHandoff,
  NewProject,
  ScopedStore,
  StoreAdapter,
  WorkspaceScope,
} from './store/adapter/types.js';
export type { MigrationDriver, SqlExecutor, SqlResult, SqlValue } from './store/driver.js';
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
export {
  checksumOf,
  MigrationError,
  planMigrations,
  validateMigrationList,
} from './store/plan.js';
export type { RlsGuardErrorCode, RlsPosture } from './store/rls-guard.js';
export {
  assertConnectionEnforcesRls,
  assertRlsEnforced,
  inspectRlsPosture,
  RLS_BYPASS_ESCAPE_HATCH,
  RLS_POSTURE_SQL,
  RlsGuardError,
} from './store/rls-guard.js';
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
  DeviceAuthorizationStatus,
  TeamFunction,
  TeamRole,
  WorkspacePlan,
} from './store/schema.js';
export {
  ACCESS_SCOPE_ORDER,
  ACCESS_SCOPES,
  ACTOR_KINDS,
  API_TOKEN_HASH_SETTING,
  BILLING_STATUSES,
  CHECKPOINT_ACTIONS,
  CHECKPOINT_TRIGGERS,
  CONFLICT_RESOLUTIONS,
  CORE_ENTITY_TABLES,
  DEVICE_AUTHORIZATION_STATUSES,
  DEVICE_CODE_HASH_SETTING,
  DEVICE_USER_CODE_SETTING,
  EMBEDDING_DIMENSIONS,
  IDENTITY_SUBJECT_SETTING,
  ITEM_KINDS,
  ITEM_STATUSES,
  TEAM_FUNCTIONS,
  TEAM_ROLES,
  WORKSPACE_PLANS,
  WORKSPACE_SETTING,
} from './store/schema.js';
export type {
  JsonlSinkOptions,
  MemorySinkOptions,
  MemoryTelemetrySink,
  TelemetryEmitterOptions,
} from './telemetry/index.js';
export {
  createJsonlSink,
  createMemorySink,
  createNoopEmitter,
  createTelemetryEmitter,
  redactEvent,
  TelemetrySinkError,
  TelemetryValidationError,
  TelemetryWriteError,
  telemetryEnabledIn,
} from './telemetry/index.js';
export type {
  TelemetryContext,
  TelemetryEmitter,
  TelemetryEvent,
  TelemetryEventName,
  TelemetrySink,
} from './telemetry/types.js';
export { TELEMETRY_EVENT_NAMES } from './telemetry/types.js';
