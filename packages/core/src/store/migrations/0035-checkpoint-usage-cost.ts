import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 35,
  name: 'checkpoint-usage-cost',
  sql: `
-- What each extraction attempt actually cost, in millionths of a dollar.
--
-- checkpoint.cost_micros has existed since migration 0020 and has never been written,
-- because cost is known at propose time and no checkpoint row exists yet - the proposal
-- is offered to a human before anything is committed. So the number had nowhere to live
-- and we could not answer "what did last month cost" from our own data.
--
-- It belongs here rather than on checkpoint for the same reason the token counts do: an
-- attempt is the thing that was billed, and one proposal can make several of them across
-- chunks and across a vendor fallback.
--
-- Nullable, because rows written before this migration have no cost to backfill and a
-- guessed one would be worse than an absent one.
ALTER TABLE checkpoint_usage
  ADD COLUMN cost_micros BIGINT;

ALTER TABLE checkpoint_usage
  ADD CONSTRAINT checkpoint_usage_cost_is_not_negative
    CHECK (cost_micros IS NULL OR cost_micros >= 0);

-- Answers "what did this workspace cost over a period" without scanning the table. The
-- existing checkpoint_usage_metering_idx covers (workspace_id, created_at), so this one
-- only earns its keep by carrying the cost, letting the sum come from the index alone.
CREATE INDEX checkpoint_usage_cost_idx
  ON checkpoint_usage (workspace_id, created_at)
  INCLUDE (cost_micros)
  WHERE cost_micros IS NOT NULL;
`,
};
