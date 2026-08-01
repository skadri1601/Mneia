import { migration as baselineExtensions } from './0001-baseline.js';
import { migration as coreEntities } from './0002-core-entities.js';
import type { Migration } from './migration.js';

export type { AppliedMigration, Migration } from './migration.js';

export const MIGRATIONS: readonly Migration[] = [baselineExtensions, coreEntities];
