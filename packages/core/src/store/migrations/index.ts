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
];
