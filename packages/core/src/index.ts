export const VERSION = '0.0.0';

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
  MigrationError,
  checksumOf,
  planMigrations,
  validateMigrationList,
} from './store/plan.js';
