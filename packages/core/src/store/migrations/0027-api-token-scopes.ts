import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 27,
  name: 'api-token-scopes',
  sql: `
ALTER TABLE api_token ADD COLUMN scopes TEXT[] NOT NULL DEFAULT ARRAY['*'];

ALTER TABLE api_token
  ADD CONSTRAINT api_token_scopes_are_not_empty
  CHECK (cardinality(scopes) > 0 AND array_position(scopes, NULL) IS NULL AND NOT ('' = ANY (scopes)));
`,
};
