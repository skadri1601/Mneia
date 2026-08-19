import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 32,
  name: 'workspace-plan-pro',
  sql: `
ALTER TABLE workspace DROP CONSTRAINT workspace_plan_check;

ALTER TABLE workspace
  ADD CONSTRAINT workspace_plan_check
  CHECK (plan IN ('solo', 'pro', 'team', 'enterprise'));
`,
};
