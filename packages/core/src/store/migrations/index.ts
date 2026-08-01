import { migration as baselineExtensions } from './0001-baseline.js';
import { migration as coreEntities } from './0002-core-entities.js';
import { migration as contextItem } from './0003-context-item.js';
import { migration as waitlistSignup } from './0004-waitlist-signup.js';
import { migration as waitlistUnsubscribe } from './0005-waitlist-unsubscribe.js';
import type { Migration } from './migration.js';

export type { AppliedMigration, Migration } from './migration.js';

export const MIGRATIONS: readonly Migration[] = [
  baselineExtensions,
  coreEntities,
  contextItem,
  waitlistSignup,
  waitlistUnsubscribe,
];
