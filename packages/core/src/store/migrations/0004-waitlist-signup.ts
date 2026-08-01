import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 4,
  name: 'waitlist-signup',
  sql: `
CREATE TABLE waitlist_signup (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL CHECK (email <> ''),
  source       TEXT NOT NULL DEFAULT 'site',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX waitlist_signup_email_key ON waitlist_signup (lower(email));
`,
};
