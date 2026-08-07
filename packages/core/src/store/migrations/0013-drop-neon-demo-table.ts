import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 13,
  name: 'drop-neon-demo-table',
  sql: `
DROP TABLE IF EXISTS playing_with_neon;
`,
};
