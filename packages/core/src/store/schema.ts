export const WORKSPACE_SETTING = 'mneia.workspace_id';

export const ACTOR_KINDS = ['human', 'agent'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const TEAM_FUNCTIONS = [
  'engineering',
  'product',
  'design',
  'sales',
  'marketing',
  'support',
  'success',
  'operations',
  'finance',
  'other',
] as const;
export type TeamFunction = (typeof TEAM_FUNCTIONS)[number];

export const TEAM_ROLES = ['lead', 'member'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const WORKSPACE_PLANS = ['solo', 'team', 'enterprise'] as const;
export type WorkspacePlan = (typeof WORKSPACE_PLANS)[number];

export const BILLING_STATUSES = ['active', 'trialing', 'past_due', 'canceled'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const ITEM_KINDS = [
  'decision',
  'constraint',
  'open_question',
  'fact',
  'artifact_ref',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_STATUSES = ['active', 'superseded', 'disputed', 'retired'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ACCESS_SCOPES = ['private', 'project', 'team', 'workspace', 'restricted'] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

export const ACCESS_SCOPE_ORDER = ['private', 'project', 'team', 'workspace'] as const;

export const CHECKPOINT_TRIGGERS = [
  'task_boundary',
  'day_boundary',
  'manual',
  'pre_compaction',
] as const;
export type CheckpointTrigger = (typeof CHECKPOINT_TRIGGERS)[number];

export const CHECKPOINT_ACTIONS = ['created', 'updated', 'superseded', 'rejected'] as const;
export type CheckpointAction = (typeof CHECKPOINT_ACTIONS)[number];

export const CONFLICT_RESOLUTIONS = ['a_wins', 'b_wins', 'merged', 'both_retired'] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

export const EMBEDDING_DIMENSIONS = 1536;

export const CORE_ENTITY_TABLES = [
  'workspace',
  'actor',
  'team',
  'team_member',
  'project',
  'session',
] as const;
export type CoreEntityTable = (typeof CORE_ENTITY_TABLES)[number];
