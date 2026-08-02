import 'server-only';

import type { PostgresConnectionSource } from '@mneia/core';
import { database } from './database.js';
import { PostgresProjectStore } from './store/postgres-project-store.js';
import type { ProjectControlStore } from './store/project-store.js';

export const createProjectStore = (source: PostgresConnectionSource): ProjectControlStore =>
  new PostgresProjectStore(source);

export const projectStore: ProjectControlStore = createProjectStore(database);
