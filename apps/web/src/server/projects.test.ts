import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  archiveProject,
  getProject,
  listProjects,
  ProjectControlError,
  renameProject,
} from './projects.js';
import type { AccountContext } from './store/account-store.js';
import type { ManagedProject, ProjectControlStore } from './store/project-store.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const ACCOUNT: AccountContext = {
  workspace: {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'workspace-11111111-1111-4111-8111-111111111111',
    displayName: 'Ada Lovelace',
    plan: 'solo',
    billingStatus: 'active',
    billingCustomerRef: null,
    seatsPurchased: null,
    checkpointAllowance: null,
    trialEndsAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  actor: {
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    kind: 'human',
    displayName: 'Ada Lovelace',
    externalRef: 'user_123',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  team: {
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    slug: 'default',
    displayName: 'Default',
    function: 'engineering',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  membership: {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    teamId: '33333333-3333-4333-8333-333333333333',
    actorId: '22222222-2222-4222-8222-222222222222',
    role: 'lead',
    addedAt: new Date('2026-08-01T00:00:00.000Z'),
  },
};

const PROJECT: ManagedProject = {
  id: PROJECT_ID,
  workspaceId: ACCOUNT.workspace.id,
  teamId: ACCOUNT.team.id,
  slug: 'analytical-engine',
  displayName: 'Analytical Engine',
  repoUrl: 'https://example.com/analytical-engine.git',
  archivedAt: null,
  createdAt: new Date('2026-08-01T01:00:00.000Z'),
};

const projectStore = () => {
  const listProjects = vi.fn<ProjectControlStore['listProjects']>();
  const getProject = vi.fn<ProjectControlStore['getProject']>();
  const renameProject = vi.fn<ProjectControlStore['renameProject']>();
  const archiveProject = vi.fn<ProjectControlStore['archiveProject']>();

  return {
    store: {
      listProjects,
      getProject,
      renameProject,
      archiveProject,
    } satisfies ProjectControlStore,
    listProjects,
    getProject,
    renameProject,
    archiveProject,
  };
};

describe('ProjectControlError', () => {
  it('retains its typed code and cause', () => {
    const cause = new Error('database unavailable');
    const error = new ProjectControlError('session_cleanup_failed', 'Cleanup failed', { cause });

    expect(error.name).toBe('ProjectControlError');
    expect(error.code).toBe('session_cleanup_failed');
    expect(error.cause).toBe(cause);
  });
});

describe('listProjects', () => {
  it('delegates the exact trusted account and archive option to the store', async () => {
    const { store, listProjects: persist } = projectStore();
    persist.mockResolvedValue([PROJECT]);

    await expect(listProjects({ account: ACCOUNT, includeArchived: true, store })).resolves.toEqual(
      [PROJECT],
    );
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(ACCOUNT, { includeArchived: true });
  });
});

describe('getProject', () => {
  it('rejects a malformed project id before calling the store', async () => {
    const { store, getProject: persist } = projectStore();

    await expect(
      getProject({ account: ACCOUNT, projectId: 'not-a-uuid', store }),
    ).rejects.toMatchObject({
      code: 'invalid_project_id',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('delegates the exact trusted account and validated project id', async () => {
    const { store, getProject: persist } = projectStore();
    persist.mockResolvedValue(PROJECT);

    await expect(getProject({ account: ACCOUNT, projectId: PROJECT_ID, store })).resolves.toBe(
      PROJECT,
    );
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(ACCOUNT, PROJECT_ID);
  });
});

describe('renameProject', () => {
  it('rejects a malformed project id before calling the store', async () => {
    const { store, renameProject: persist } = projectStore();

    await expect(
      renameProject({
        account: ACCOUNT,
        projectId: ` ${PROJECT_ID}`,
        displayName: 'A valid name',
        store,
      }),
    ).rejects.toMatchObject({ code: 'invalid_project_id' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a blank display name before calling the store', async () => {
    const { store, renameProject: persist } = projectStore();
    const rename = renameProject({
      account: ACCOUNT,
      projectId: PROJECT_ID,
      displayName: '   ',
      store,
    });

    await expect(rename).rejects.toBeInstanceOf(ProjectControlError);
    await expect(rename).rejects.toMatchObject({ code: 'invalid_display_name' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a display name longer than 128 trimmed characters', async () => {
    const { store, renameProject: persist } = projectStore();

    await expect(
      renameProject({
        account: ACCOUNT,
        projectId: PROJECT_ID,
        displayName: ` ${'a'.repeat(129)} `,
        store,
      }),
    ).rejects.toMatchObject({ code: 'invalid_display_name' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('trims a valid display name and delegates the exact trusted account', async () => {
    const { store, renameProject: persist } = projectStore();
    persist.mockResolvedValue({ ...PROJECT, displayName: 'A'.repeat(128) });

    await expect(
      renameProject({
        account: ACCOUNT,
        projectId: PROJECT_ID,
        displayName: ` ${'A'.repeat(128)} `,
        store,
      }),
    ).resolves.toEqual({ ...PROJECT, displayName: 'A'.repeat(128) });
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(ACCOUNT, {
      projectId: PROJECT_ID,
      displayName: 'A'.repeat(128),
    });
  });
});

describe('archiveProject', () => {
  it('rejects a malformed project id before calling the store', async () => {
    const { store, archiveProject: persist } = projectStore();

    await expect(
      archiveProject({
        account: ACCOUNT,
        projectId: '44444444-4444-4444-8444',
        expectedSlug: PROJECT.slug,
        store,
      }),
    ).rejects.toMatchObject({ code: 'invalid_project_id' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a blank binding confirmation before calling the store', async () => {
    const { store, archiveProject: persist } = projectStore();

    await expect(
      archiveProject({
        account: ACCOUNT,
        projectId: PROJECT_ID,
        expectedSlug: '\t ',
        store,
      }),
    ).rejects.toMatchObject({ code: 'invalid_archive_confirmation' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('delegates the exact trusted account and binding confirmation', async () => {
    const { store, archiveProject: persist } = projectStore();
    const archived = { ...PROJECT, archivedAt: new Date('2026-08-01T02:00:00.000Z') };
    persist.mockResolvedValue(archived);

    await expect(
      archiveProject({
        account: ACCOUNT,
        projectId: PROJECT_ID,
        expectedSlug: PROJECT.slug,
        store,
      }),
    ).resolves.toBe(archived);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(ACCOUNT, {
      projectId: PROJECT_ID,
      expectedSlug: PROJECT.slug,
    });
  });
});
