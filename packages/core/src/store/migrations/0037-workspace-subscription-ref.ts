import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 37,
  name: 'workspace-subscription-ref',
  sql: `
-- Where the Stripe subscription lives, so seats can be pushed back to it.
--
-- workspace has carried billing_customer_ref since the beginning, and that is enough to
-- open a billing portal session but not enough to change anything. StripeClient.updateSeats
-- has existed unused since MNE-141 because it needs two identifiers this table did not
-- have: the subscription to update, and the subscription *item* inside it, because in the
-- Stripe API quantity lives on the item and not on the subscription. Without them a Team
-- workspace that added a member kept its old Stripe quantity and we billed for fewer seats
-- than we served.
--
-- Both nullable, and deliberately with no backfill. The code deployed right now never
-- writes either column, so a NOT NULL here would fail on its first insert and, because the
-- deploy gate permits only migrate-then-deploy, would deadlock every lane in the repo until
-- someone reverted it. They fill in on their own: every subscription webhook re-reads the
-- live subscription from Stripe and writes what it finds, so an active workspace is
-- populated by its next lifecycle event without a data migration.
--
-- No GRANT statement here on purpose. mneia_app is granted DML at table granularity by
-- scripts/db-provision-app-role.mjs (GRANT ... ON ALL TABLES, plus ALTER DEFAULT PRIVILEGES
-- for tables created later), and in Postgres a table-level privilege covers columns added
-- afterwards - column privileges are separate only when they were granted column-scoped,
-- which these were not. A GRANT here would also fail outright in CI, where database.yml
-- applies migrations to a throwaway pgvector container on which the mneia_app role does not
-- exist. This is a new column on an existing table, not a new table; a new table would need
-- the grant.
ALTER TABLE workspace
  ADD COLUMN billing_subscription_ref text,
  ADD COLUMN billing_subscription_item_ref text;

ALTER TABLE workspace
  ADD CONSTRAINT workspace_billing_subscription_ref_is_not_blank
    CHECK (billing_subscription_ref IS NULL OR billing_subscription_ref <> '');

ALTER TABLE workspace
  ADD CONSTRAINT workspace_billing_subscription_item_ref_is_not_blank
    CHECK (billing_subscription_item_ref IS NULL OR billing_subscription_item_ref <> '');
`,
};
