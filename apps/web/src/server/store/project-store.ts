import 'server-only';

import type { AccountContext } from './account-store.js';

export type ProjectControlErrorCode =
  | 'invalid_project_id'
  | 'invalid_display_name'
  | 'invalid_archive_confirmation'
  | 'project_not_found'
  | 'forbidden'
  | 'corrupt_project'
  | 'rollback_failed'
  | 'session_cleanup_failed';

export class ProjectControlError extends Error {
  readonly code: ProjectControlErrorCode;

  constructor(code: ProjectControlErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProjectControlError';
    this.code = code;
  }
}

export interface ManagedProject {
  readonly id: string;
  readonly workspaceId: string;
  readonly teamId: string | null;
  readonly slug: string;
  readonly displayName: string;
  readonly repoUrl: string | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

export interface ListProjectsInput {
  readonly includeArchived: boolean;
}

export interface RenameProjectInput {
  readonly projectId: string;
  readonly displayName: string;
}

export interface ArchiveProjectInput {
  readonly projectId: string;
  readonly expectedSlug: string;
}

export interface ProjectControlStore {
  listProjects(
    account: AccountContext,
    input: ListProjectsInput,
  ): Promise<readonly ManagedProject[]>;
  getProject(account: AccountContext, projectId: string): Promise<ManagedProject>;
  renameProject(account: AccountContext, input: RenameProjectInput): Promise<ManagedProject>;
  archiveProject(account: AccountContext, input: ArchiveProjectInput): Promise<ManagedProject>;
}
