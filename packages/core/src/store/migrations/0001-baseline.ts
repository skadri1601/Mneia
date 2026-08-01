import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 1,
  name: 'baseline-extensions',
  sql: `
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
`,
};
