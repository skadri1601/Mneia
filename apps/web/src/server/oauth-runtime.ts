import 'server-only';

import { database } from './database.js';
import { PostgresOAuthStore } from './store/postgres-oauth-store.js';

export const oauthStore = new PostgresOAuthStore(database);

// Short by design. An authorization code is exchanged immediately by a client that already holds
// the verifier, so a long window only widens the replay opportunity for a code that leaked through
// a redirect. OAuth 2.1 recommends a maximum of ten minutes; this is well inside it.
export const AUTHORIZATION_CODE_LIFETIME_SECONDS = 120;

// The only scope we issue. It exists so a token says what it is for rather than being unmarked,
// not because there is a second scope to choose between yet.
export const MCP_SCOPE = 'mcp';
