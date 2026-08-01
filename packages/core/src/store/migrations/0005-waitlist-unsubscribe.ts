import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 5,
  name: 'waitlist-unsubscribe',
  sql: `
ALTER TABLE waitlist_signup
  ADD COLUMN unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX waitlist_signup_unsubscribe_token_key
  ON waitlist_signup (unsubscribe_token);
`,
};
