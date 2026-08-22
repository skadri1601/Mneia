import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 34,
  name: 'turn-metering-and-wallet',
  sql: `
ALTER TABLE workspace
  ADD COLUMN turn_allowance BIGINT,
  ADD COLUMN extraction_allowance INTEGER,
  ADD COLUMN embedding_token_allowance BIGINT,
  ADD COLUMN wallet_balance_micros BIGINT NOT NULL DEFAULT 0;

ALTER TABLE workspace
  ADD CONSTRAINT workspace_turn_allowance_is_not_negative
    CHECK (turn_allowance IS NULL OR turn_allowance >= 0),
  ADD CONSTRAINT workspace_extraction_allowance_is_not_negative
    CHECK (extraction_allowance IS NULL OR extraction_allowance >= 0),
  ADD CONSTRAINT workspace_embedding_token_allowance_is_not_negative
    CHECK (embedding_token_allowance IS NULL OR embedding_token_allowance >= 0),
  ADD CONSTRAINT workspace_wallet_balance_is_not_negative
    CHECK (wallet_balance_micros >= 0);

ALTER TABLE workspace_usage_period
  ADD COLUMN turns_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN extractions_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN embedding_tokens_used BIGINT NOT NULL DEFAULT 0;

ALTER TABLE workspace_usage_period
  ADD CONSTRAINT workspace_usage_period_turns_are_not_negative
    CHECK (turns_used >= 0),
  ADD CONSTRAINT workspace_usage_period_extractions_are_not_negative
    CHECK (extractions_used >= 0),
  ADD CONSTRAINT workspace_usage_period_embedding_tokens_are_not_negative
    CHECK (embedding_tokens_used >= 0);

CREATE TABLE wallet_ledger (
  id             UUID NOT NULL,
  workspace_id   UUID NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  amount_micros  BIGINT NOT NULL,
  reason         TEXT NOT NULL,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT wallet_ledger_kind_is_known
    CHECK (kind IN ('grant', 'topup', 'debit')),
  CONSTRAINT wallet_ledger_amount_is_positive
    CHECK (amount_micros > 0),
  CONSTRAINT wallet_ledger_reason_is_not_blank
    CHECK (reason <> ''),
  CONSTRAINT wallet_ledger_created_by_fkey
    FOREIGN KEY (workspace_id, created_by) REFERENCES actor (workspace_id, id)
);

CREATE INDEX wallet_ledger_workspace_history_idx
  ON wallet_ledger (workspace_id, created_at DESC);

ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY wallet_ledger_workspace_isolation ON wallet_ledger
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
