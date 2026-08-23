export const VERSION = '0.14.1';

export * from './api/index.js';
export { sanitizeActorName, UNATTRIBUTED_ACTOR } from './domain/attribution.js';
export { isStorableText, NULL_BYTE_ERROR } from './domain/text.js';
export type {
  Actor,
  Checkpoint,
  CheckpointItem,
  Conflict,
  ContextItem,
  ContextItemProvenance,
  ContextItemProvenanceField,
  ContextItemProvenanceValues,
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
export {
  CONTEXT_ITEM_PROVENANCE_FIELDS,
  deriveContextItemProvenance,
} from './domain/types.js';
export type { EmbeddingErrorCode, EmbeddingProvider } from './embed/types.js';
export { assertEmbeddingDimensions, EmbeddingError, embeddableText } from './embed/types.js';
export type { ChunkedTurns, ChunkOptions, TrajectoryChunk } from './extract/chunk.js';
export { chunkTurns } from './extract/chunk.js';
export type {
  PrecisionFilterOptions,
  PrecisionFilterResult,
  RejectedCandidate,
} from './extract/filter.js';
export {
  applyPrecisionFilter,
  DEFAULT_CONFIDENCE_FLOOR,
  DEFAULT_MAX_CANDIDATES,
} from './extract/filter.js';
export {
  buildExtractionPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  renderTurn,
} from './extract/prompt.js';
export type {
  ContradictionSignal,
  ExistingItemSnapshot,
  ReconciledCandidate,
  ReconcileEvidence,
  ReconcileOptions,
  ReconcileRequest,
  ReconcileResult,
  ReconcileVerdict,
} from './extract/reconcile.js';
export {
  DEFAULT_CONTRADICTION_SIMILARITY,
  DEFAULT_DUPLICATE_SIMILARITY,
  reconcileCandidates,
} from './extract/reconcile.js';
export type {
  ExtractionCandidate,
  ExtractionErrorCode,
  ExtractionOutput,
} from './extract/schema.js';
export {
  ExtractionCandidateSchema,
  ExtractionError,
  ExtractionOutputSchema,
  parseExtractionOutput,
} from './extract/schema.js';
export type { Stance } from './extract/similarity.js';
export {
  jaccard,
  normalizeText,
  numericLiterals,
  stanceOf,
  subjectTokens,
} from './extract/similarity.js';
export type {
  ExtractionProvider,
  ExtractionProviderRequest,
  ExtractionProviderResponse,
} from './extract/types.js';
export type { AssembledHandoff, AssembleHandoffInput } from './handoff/assemble.js';
export {
  assembleHandoff,
  DEFAULT_HANDOFF_TOKEN_BUDGET,
  DEFAULT_ITEM_LIMIT,
  DEFAULT_SUPERSEDED_WINDOW_DAYS,
  HANDOFF_SUPERSEDED_LIMIT,
} from './handoff/assemble.js';
export type { HandoffBudget, RenderHandoffInput } from './handoff/render.js';
export { HANDOFF_SECTION_HEADINGS, provenanceLine, renderHandoff } from './handoff/render.js';
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
export type { AssembleSliceRequest } from './rehydrate/assemble.js';
export {
  assembleSlice,
  candidateLimitFor,
  MANDATORY_ITEM_LIMIT,
  MAX_CANDIDATES,
  mergeCandidates,
  RECENT_SUPERSEDED_LIMIT,
  resolveProject,
} from './rehydrate/assemble.js';
export type { PackOptions } from './rehydrate/pack.js';
export {
  DEFAULT_KIND_QUOTAS,
  isMandatoryItem,
  packSlice,
  sliceOverflow,
} from './rehydrate/pack.js';
export type { RenderSliceInput } from './rehydrate/render.js';
export { renderSlice, SLICE_SECTION_HEADINGS, shortenItemIds } from './rehydrate/render.js';
export { DEFAULT_SCORING_WEIGHTS, scoreItems, semanticRelevance } from './rehydrate/score.js';
export type { TokenCounter } from './rehydrate/tokens.js';
export {
  bpeTokenCounter,
  countItemTokens,
  defaultTokenCounter,
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
  ContextItemReview,
  ContextItemReviewDecision,
  ContextItemReviewOutcome,
  ContextItemReviewOutcomeKind,
  ContextItemSearch,
  ContextItemVerification,
  HandoffItem,
  InboxHandoffFilter,
  NewCheckpoint,
  NewConflict,
  NewContextItem,
  NewHandoff,
  NewHandoffItem,
  NewProject,
  PendingReviewFilter,
  PendingReviewItem,
  ProjectSessionFilter,
  ProjectSessionSummary,
  RetireContextItemInput,
  RetireContextItemResult,
  ReviewCapableStore,
  ReviewPendingItemsInput,
  ReviewPendingItemsResult,
  ScopedStore,
  SessionClientProvenance,
  StaleContextItem,
  StaleContextItemFilter,
  StoreAdapter,
  VerifyContextItemInput,
  VerifyContextItemResult,
  WorkspaceActorFilter,
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
  DeviceAuthorizationStatus,
  ItemKind,
  ItemStatus,
  TeamFunction,
  TeamRole,
  WorkspacePlan,
  WorkspaceRole,
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
  INVITATION_EMAIL_SETTING,
  INVITATION_TOKEN_HASH_SETTING,
  ITEM_KINDS,
  ITEM_STATUSES,
  TEAM_FUNCTIONS,
  TEAM_ROLES,
  teamRoleForWorkspaceRole,
  WORKSPACE_PLANS,
  WORKSPACE_ROLES,
  WORKSPACE_SETTING,
} from './store/schema.js';
export type {
  JsonlSinkOptions,
  MemorySinkOptions,
  MemoryTelemetrySink,
  PostgresSinkOptions,
  PostgresTelemetrySink,
  RemoteSinkOptions,
  RemoteTelemetrySink,
  TelemetryEmitterOptions,
} from './telemetry/index.js';
export {
  createJsonlSink,
  createMemorySink,
  createNoopEmitter,
  createPostgresSink,
  createRemoteSink,
  createTelemetryEmitter,
  REMOTE_ENDPOINT_ENV_VAR,
  REMOTE_TOKEN_ENV_VAR,
  redactEvent,
  remoteSinkFromEnv,
  TELEMETRY_EVENT_TABLE,
  TelemetryPersistError,
  TelemetrySinkError,
  TelemetryTransmitError,
  TelemetryValidationError,
  TelemetryWriteError,
  telemetryEnabledIn,
} from './telemetry/index.js';
export type {
  CheckpointQuality,
  ExtractorQualitySummary,
  QualityCounts,
  QualityTrendPoint,
  ReviewOutcome,
} from './telemetry/quality.js';
export { summarizeExtractorQuality } from './telemetry/quality.js';
export type {
  TelemetryContext,
  TelemetryEmitter,
  TelemetryEvent,
  TelemetryEventName,
  TelemetrySink,
} from './telemetry/types.js';
export { TELEMETRY_EVENT_NAMES } from './telemetry/types.js';
export {
  createClaudeCodeReader,
  parseClaudeCodeJsonl,
  projectSlug,
} from './trajectory/claude-code.js';
export {
  claudeDesktopSessionsRoot,
  createClaudeDesktopReader,
} from './trajectory/claude-desktop.js';
export { createCodexReader, parseCodexRollout } from './trajectory/codex.js';
export { composerFolders, createCursorReader } from './trajectory/cursor.js';
export {
  createGeminiReader,
  geminiTurns,
  parseGeminiSession,
} from './trajectory/gemini.js';
export type { DiscoveredTrajectory, TrajectoryDiscovery } from './trajectory/discover.js';
export {
  createReaders,
  discoverTrajectories,
  discoverTrajectorySessions,
  readTrajectory,
} from './trajectory/discover.js';
export { readTrajectoryFile } from './trajectory/jsonl.js';
export type { ReducedTrajectory, ReduceOptions } from './trajectory/reduce.js';
export {
  DEFAULT_MAX_CHARS,
  DEFAULT_TOOL_CALL_CHARS,
  DEFAULT_TOOL_RESULT_CHARS,
  DROP_ORDER,
  reduceTrajectory,
} from './trajectory/reduce.js';
export type { Redacted, SecretPattern } from './trajectory/secrets.js';
export { redactSecrets, SECRET_PATTERNS, SECRET_PLACEHOLDER } from './trajectory/secrets.js';
export type {
  ListTrajectoriesRequest,
  Trajectory,
  TrajectoryErrorCode,
  TrajectoryReader,
  TrajectorySource,
  TrajectorySummary,
  TrajectoryTurn,
  TrajectoryUnavailable,
  TrajectoryUnavailableReporter,
  TurnKind,
  TurnRole,
  TurnsSinceResult,
} from './trajectory/types.js';
export {
  TRAJECTORY_SOURCES,
  TrajectoryError,
  TURN_KINDS,
  TURN_ROLES,
  turnsSince,
} from './trajectory/types.js';
export { createWarpReader, parseWarpConversation } from './trajectory/warp.js';
