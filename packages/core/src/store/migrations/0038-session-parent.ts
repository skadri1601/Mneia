import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 38,
  name: 'session-parent',
  sql: `
-- Which session spawned this one, so a sub-agent's work is attributable to the session
-- that delegated it.
--
-- Harnesses that fan work out to sub-agents write each one its own transcript. Claude Code
-- puts them in <parent-session-id>/subagents/agent-<id>.jsonl, so the parentage is in the
-- path and nowhere else: every line inside the child file carries the *parent's* sessionId,
-- and the child's own identity exists only as the filename. Without this column that
-- relationship has nowhere to land, and a checkpoint extracted from a sub-agent transcript
-- reads as an unrelated session that happens to share a working directory.
--
-- Nullable, and deliberately with no backfill. Every session already recorded was opened by
-- a root agent, so NULL is the correct value for all of them and NOT NULL would fail on the
-- first insert from the code currently deployed - which, because the deploy gate permits
-- only migrate-then-deploy, would deadlock every lane in the repo.
--
-- The foreign key is composite on (workspace_id, parent_session_id) rather than on
-- parent_session_id alone. session carries a UNIQUE (workspace_id, id) for exactly this
-- reason: a single-column reference would let a row in one workspace name a parent in
-- another, which RLS cannot see and therefore cannot stop. Every other cross-table
-- reference in this schema is composite for the same reason.
--
-- No GRANT statement: mneia_app holds table-level DML, which in Postgres covers columns
-- added afterwards. This is a new column on an existing table, not a new table.
ALTER TABLE session
  ADD COLUMN parent_session_id uuid;

ALTER TABLE session
  ADD CONSTRAINT session_workspace_id_parent_session_id_fkey
    FOREIGN KEY (workspace_id, parent_session_id) REFERENCES session(workspace_id, id);

-- A session cannot spawn itself. This catches the obvious mistake - resolving a parent ref
-- to the row being written - rather than every cycle; deeper loops need a recursive check
-- the write path does not warrant, and the write path only ever names an already-committed
-- parent.
ALTER TABLE session
  ADD CONSTRAINT session_parent_session_id_is_not_self
    CHECK (parent_session_id IS NULL OR parent_session_id <> id);

-- Partial, because the overwhelming majority of sessions are roots and indexing their NULLs
-- would double the index for no reader. The one query is "the children of this session".
CREATE INDEX session_workspace_id_parent_session_id_idx
  ON session (workspace_id, parent_session_id)
  WHERE parent_session_id IS NOT NULL;

-- Resolving a parent by the ref the harness knows it as - the lookup createSession performs
-- when a client reports a parent transcript rather than a session id it cannot know.
CREATE INDEX session_workspace_id_project_id_client_session_ref_idx
  ON session (workspace_id, project_id, client_session_ref, started_at DESC)
  WHERE client_session_ref IS NOT NULL;
`,
};
