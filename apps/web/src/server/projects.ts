import 'server-only';

import type { AccountContext } from './store/account-store.js';
import {
  type ManagedProject,
  ProjectControlError,
  type ProjectControlStore,
} from './store/project-store.js';

export type { ProjectControlErrorCode } from './store/project-store.js';
export { ProjectControlError };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DISPLAY_NAME_LENGTH = 128;

const validateProjectId = (projectId: string): void => {
  if (!UUID_PATTERN.test(projectId)) {
    throw new ProjectControlError('invalid_project_id', 'A valid project id is required');
  }
};

export interface ListProjectsRequest {
  readonly account: AccountContext;
  readonly includeArchived: boolean;
  readonly store: ProjectControlStore;
}

export interface GetProjectRequest {
  readonly account: AccountContext;
  readonly projectId: string;
  readonly store: ProjectControlStore;
}

export interface RenameProjectRequest {
  readonly account: AccountContext;
  readonly projectId: string;
  readonly displayName: string;
  readonly store: ProjectControlStore;
}

export interface ArchiveProjectRequest {
  readonly account: AccountContext;
  readonly projectId: string;
  readonly expectedSlug: string;
  readonly store: ProjectControlStore;
}

export const listProjects = async ({
  account,
  includeArchived,
  store,
}: ListProjectsRequest): Promise<readonly ManagedProject[]> =>
  store.listProjects(account, { includeArchived });

export const getProject = async ({
  account,
  projectId,
  store,
}: GetProjectRequest): Promise<ManagedProject> => {
  validateProjectId(projectId);
  return store.getProject(account, projectId);
};

export const renameProject = async ({
  account,
  projectId,
  displayName,
  store,
}: RenameProjectRequest): Promise<ManagedProject> => {
  validateProjectId(projectId);
  const normalizedDisplayName = displayName.trim();
  if (
    normalizedDisplayName.length === 0 ||
    normalizedDisplayName.length > MAX_DISPLAY_NAME_LENGTH
  ) {
    throw new ProjectControlError(
      'invalid_display_name',
      `A project display name must contain between 1 and ${MAX_DISPLAY_NAME_LENGTH} characters`,
    );
  }

  return store.renameProject(account, { projectId, displayName: normalizedDisplayName });
};

export const archiveProject = async ({
  account,
  projectId,
  expectedSlug,
  store,
}: ArchiveProjectRequest): Promise<ManagedProject> => {
  validateProjectId(projectId);
  if (expectedSlug.trim().length === 0) {
    throw new ProjectControlError(
      'invalid_archive_confirmation',
      'The project binding slug is required to archive a project',
    );
  }

  return store.archiveProject(account, { projectId, expectedSlug });
};
