import 'server-only';

import type { ReviewCapableStore, WorkspaceScope } from '@mneia/core';
import { PostgresStoreAdapter } from '@mneia/core';
import { database } from './database.js';

const adapter = new PostgresStoreAdapter(database);

export const withWorkspaceScope = <T>(
  scope: WorkspaceScope,
  run: (store: ReviewCapableStore) => Promise<T>,
): Promise<T> => adapter.withScope(scope, run);
