import { migration as baselineExtensions } from './0001-baseline.js';
import { migration as coreEntities } from './0002-core-entities.js';
import { migration as contextItem } from './0003-context-item.js';
import { migration as waitlistSignup } from './0004-waitlist-signup.js';
import { migration as waitlistUnsubscribe } from './0005-waitlist-unsubscribe.js';
import { migration as checkpointHandoff } from './0006-checkpoint-handoff.js';
import { migration as actorIdentity } from './0007-actor-identity.js';
import { migration as conflictPairConstraints } from './0008-conflict-pair-constraints.js';
import { migration as projectManagement } from './0009-project-management.js';
import { migration as waitlistBroadcast } from './0010-waitlist-broadcast.js';
import { migration as waitlistAdmission } from './0011-waitlist-admission.js';
import { migration as deviceAuthorization } from './0012-device-authorization.js';
import { migration as dropNeonDemoTable } from './0013-drop-neon-demo-table.js';
import { migration as embeddingModelProvenance } from './0014-embedding-model-provenance.js';
import { migration as rateLimitCounter } from './0015-rate-limit-counter.js';
import { migration as workspaceInvitation } from './0016-workspace-invitation.js';
import { migration as identityAndWorkspaceMembership } from './0017-identity-and-workspace-membership.js';
import { migration as contextItemEmbedding } from './0018-context-item-embedding.js';
import { migration as telemetryEvent } from './0019-telemetry-event.js';
import { migration as checkpointCostAndReview } from './0020-checkpoint-cost-and-review.js';
import { migration as decisionRationale } from './0021-decision-rationale.js';
import { migration as contextItemGrant } from './0022-context-item-grant.js';
import { migration as retentionAndResidency } from './0023-retention-and-residency.js';
import { migration as handoffItem } from './0024-handoff-item.js';
import { migration as projectFileBinding } from './0025-project-file-binding.js';
import { migration as workspaceUsagePeriod } from './0026-workspace-usage-period.js';
import { migration as apiTokenScopes } from './0027-api-token-scopes.js';
import { migration as auditEvent } from './0028-audit-event.js';
import { migration as checkpointSourceAndUsage } from './0029-checkpoint-source-and-usage.js';
import { migration as identityBackfill } from './0030-identity-backfill.js';
import { migration as sessionProvenance } from './0031-session-provenance.js';
import type { Migration } from './migration.js';

export type { AppliedMigration, Migration } from './migration.js';

export const MIGRATIONS: readonly Migration[] = [
  baselineExtensions,
  coreEntities,
  contextItem,
  waitlistSignup,
  waitlistUnsubscribe,
  checkpointHandoff,
  actorIdentity,
  conflictPairConstraints,
  projectManagement,
  waitlistBroadcast,
  waitlistAdmission,
  deviceAuthorization,
  dropNeonDemoTable,
  embeddingModelProvenance,
  rateLimitCounter,
  workspaceInvitation,
  identityAndWorkspaceMembership,
  contextItemEmbedding,
  telemetryEvent,
  checkpointCostAndReview,
  decisionRationale,
  contextItemGrant,
  retentionAndResidency,
  handoffItem,
  projectFileBinding,
  workspaceUsagePeriod,
  apiTokenScopes,
  auditEvent,
  checkpointSourceAndUsage,
  identityBackfill,
  sessionProvenance,
];
