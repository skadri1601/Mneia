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
  ITEM_KINDS,
  ITEM_STATUSES,
  TEAM_FUNCTIONS,
  TEAM_ROLES,
  WORKSPACE_PLANS,
  WORKSPACE_SETTING,
} from './store/schema.js';
export {
  MigrationError,
  checksumOf,
  planMigrations,
  validateMigrationList,
} from './store/plan.js';
