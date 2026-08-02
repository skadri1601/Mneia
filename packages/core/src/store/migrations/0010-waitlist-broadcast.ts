import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 10,
  name: 'waitlist-broadcast',
  sql: `
CREATE TABLE waitlist_broadcast_send (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign     TEXT NOT NULL CHECK (campaign <> ''),
  signup_id    UUID NOT NULL REFERENCES waitlist_signup (id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'claimed'
                 CHECK (status IN ('claimed', 'sent', 'unknown')),
  provider_id  TEXT,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  CONSTRAINT waitlist_broadcast_send_delivered_when_sent
    CHECK ((status = 'sent') = (delivered_at IS NOT NULL))
);

CREATE UNIQUE INDEX waitlist_broadcast_send_campaign_signup_key
  ON waitlist_broadcast_send (campaign, signup_id);

CREATE INDEX waitlist_broadcast_send_unresolved_idx
  ON waitlist_broadcast_send (campaign, claimed_at)
  WHERE status <> 'sent';
`,
};
