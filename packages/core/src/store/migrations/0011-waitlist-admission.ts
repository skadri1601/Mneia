import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 11,
  name: 'waitlist-admission',
  sql: `
ALTER TABLE waitlist_signup
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN approved_by TEXT,
  ADD COLUMN invitation_ref TEXT,
  ADD CONSTRAINT waitlist_signup_approval_is_attributed
    CHECK ((status = 'approved') = (approved_at IS NOT NULL AND approved_by IS NOT NULL));

CREATE INDEX waitlist_signup_pending_idx
  ON waitlist_signup (created_at, id)
  WHERE status = 'pending';

ALTER TABLE workspace
  ADD COLUMN company_size TEXT
    CHECK (company_size IS NULL OR company_size IN ('1-9', '10-49', '50-199', '200-499', '500+'));
`,
};
