import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 1,
  name: 'baseline-extensions',
  sql: `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
`,
};
