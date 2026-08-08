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
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DISPLAY_NAME_LENGTH = 128;
const MAX_SLUG_LENGTH = 100;

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

export interface CreateProjectRequest {
  readonly account: AccountContext;
  readonly slug: string;
  readonly displayName: string;
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

const validateDisplayName = (displayName: string): string => {
  const normalized = displayName.trim();
  if (normalized.length === 0 || normalized.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new ProjectControlError(
      'invalid_display_name',
      `A project display name must contain between 1 and ${MAX_DISPLAY_NAME_LENGTH} characters`,
    );
  }
  return normalized;
};

export const createProject = async ({
  account,
  slug,
  displayName,
  store,
}: CreateProjectRequest): Promise<ManagedProject> => {
  const normalizedSlug = slug.trim().toLowerCase();
  if (normalizedSlug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(normalizedSlug)) {
    throw new ProjectControlError(
      'invalid_slug',
      `A repository binding must be lower-case letters, digits, and single hyphens, at most ${MAX_SLUG_LENGTH} characters — received "${slug}"`,
    );
  }

  return store.createProject(account, {
    slug: normalizedSlug,
    displayName: validateDisplayName(displayName),
  });
};

export const renameProject = async ({
  account,
  projectId,
  displayName,
  store,
}: RenameProjectRequest): Promise<ManagedProject> => {
  validateProjectId(projectId);
  return store.renameProject(account, {
    projectId,
    displayName: validateDisplayName(displayName),
  });
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
