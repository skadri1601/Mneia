import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  renameProject: vi.fn(),
  archiveProject: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));
vi.mock('../../server/projects.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/projects.js')>();
  return {
    ...original,
    renameProject: mocks.renameProject,
    archiveProject: mocks.archiveProject,
  };
});
vi.mock('../../server/project-runtime.js', () => ({ projectStore: {} }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { ProjectControlError } from '../../server/projects.js';
import { archiveProjectAction, renameProjectAction } from './actions.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const ACCOUNT = {
  workspace: {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'workspace-ada',
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
} satisfies AccountContext;

const form = (values: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
};

describe('project actions', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
  });

  it('re-authenticates, renames, revalidates both views, and redirects', async () => {
    await renameProjectAction(form({ projectId: PROJECT_ID, displayName: 'Analytical Engine' }));

    expect(mocks.renameProject).toHaveBeenCalledWith({
      account: ACCOUNT,
      projectId: PROJECT_ID,
      displayName: 'Analytical Engine',
      store: {},
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/projects');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`);
    expect(mocks.redirect).toHaveBeenCalledWith(`/projects/${PROJECT_ID}?notice=renamed`);
  });

  it('redirects invalid names without exposing an internal error', async () => {
    mocks.renameProject.mockRejectedValue(
      new ProjectControlError('invalid_display_name', 'internal detail'),
    );

    await renameProjectAction(form({ projectId: PROJECT_ID, displayName: ' ' }));

    expect(mocks.redirect).toHaveBeenCalledWith(`/projects/${PROJECT_ID}?error=invalid_name`);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('does not distinguish missing, forbidden, or cross-workspace projects', async () => {
    mocks.renameProject.mockRejectedValue(
      new ProjectControlError('project_not_found', 'foreign project'),
    );

    await renameProjectAction(form({ projectId: PROJECT_ID, displayName: 'Name' }));

    expect(mocks.redirect).toHaveBeenCalledWith('/projects?error=project_not_found');
  });

  it('archives only with the typed binding and returns to the project list', async () => {
    await archiveProjectAction(form({ projectId: PROJECT_ID, confirmation: 'analytical-engine' }));

    expect(mocks.archiveProject).toHaveBeenCalledWith({
      account: ACCOUNT,
      projectId: PROJECT_ID,
      expectedSlug: 'analytical-engine',
      store: {},
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/projects');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`);
    expect(mocks.redirect).toHaveBeenCalledWith('/projects?notice=archived');
  });

  it('maps an invalid archive confirmation back to the settings page', async () => {
    mocks.archiveProject.mockRejectedValue(
      new ProjectControlError('invalid_archive_confirmation', 'internal detail'),
    );

    await archiveProjectAction(form({ projectId: PROJECT_ID, confirmation: 'wrong' }));

    expect(mocks.redirect).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}?error=invalid_confirmation`,
    );
  });

  it('does not swallow unexpected infrastructure failures', async () => {
    const failure = new Error('database unavailable');
    mocks.archiveProject.mockRejectedValue(failure);

    await expect(
      archiveProjectAction(form({ projectId: PROJECT_ID, confirmation: 'analytical-engine' })),
    ).rejects.toBe(failure);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
