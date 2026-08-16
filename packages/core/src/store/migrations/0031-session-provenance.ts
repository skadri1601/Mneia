import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 31,
  name: 'session-provenance',
  sql: `
ALTER TABLE session
  ADD COLUMN client_name TEXT,
  ADD COLUMN client_version TEXT,
  ADD COLUMN client_session_ref TEXT,
  ADD COLUMN client_session_name TEXT,
  ADD COLUMN client_session_url TEXT;

ALTER TABLE session
  ADD CONSTRAINT session_client_provenance_fields_are_not_blank
  CHECK (
    (client_name IS NULL OR client_name <> '')
    AND (client_version IS NULL OR client_version <> '')
    AND (client_session_ref IS NULL OR client_session_ref <> '')
    AND (client_session_name IS NULL OR client_session_name <> '')
    AND (client_session_url IS NULL OR client_session_url <> '')
  );
`,
};
