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

export const CORE_ENTITY_TABLES = [
  'workspace',
  'actor',
  'team',
  'team_member',
  'project',
  'session',
] as const;
export type CoreEntityTable = (typeof CORE_ENTITY_TABLES)[number];
