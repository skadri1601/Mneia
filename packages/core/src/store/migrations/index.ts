import { migration as baselineExtensions } from './0001-baseline.js';
import { migration as coreEntities } from './0002-core-entities.js';
import { migration as contextItem } from './0003-context-item.js';
import type { Migration } from './migration.js';

export type { AppliedMigration, Migration } from './migration.js';

export const MIGRATIONS: readonly Migration[] = [baselineExtensions, coreEntities, contextItem];
