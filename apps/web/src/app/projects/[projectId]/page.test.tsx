import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../../server/store/account-store.js';
import type { ManagedProject } from '../../../server/store/project-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  getProject: vi.fn(),
  notFound: vi.fn(),
  renameProjectAction: vi.fn(),
  archiveProjectAction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));
vi.mock('../../../server/projects.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../server/projects.js')>();
  return { ...original, getProject: mocks.getProject };
});
vi.mock('../../../server/project-runtime.js', () => ({
  projectStore: {},
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('../actions.js', () => ({
  renameProjectAction: mocks.renameProjectAction,
  archiveProjectAction: mocks.archiveProjectAction,
}));

import { ProjectControlError } from '../../../server/projects.js';
import ProjectPage from './page.js';

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

const PROJECT = {
  id: '44444444-4444-4444-8444-444444444444',
  workspaceId: ACCOUNT.workspace.id,
  teamId: ACCOUNT.team.id,
  slug: 'analytical-engine',
  displayName: 'Analytical Engine',
  repoUrl: null,
  archivedAt: null,
  createdAt: new Date('2026-08-01T01:00:00.000Z'),
} satisfies ManagedProject;

describe('ProjectPage', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.getProject.mockResolvedValue(PROJECT);
  });

  it('awaits Next route inputs and renders project settings', async () => {
    const html = renderToStaticMarkup(
      await ProjectPage({
        params: Promise.resolve({ projectId: PROJECT.id }),
        searchParams: Promise.resolve({ notice: 'renamed' }),
      }),
    );

    expect(html).toContain('Analytical Engine');
    expect(html).toContain('Project name updated.');
    expect(mocks.getProject).toHaveBeenCalledWith({
      account: ACCOUNT,
      projectId: PROJECT.id,
      store: {},
    });
  });

  it('does not distinguish a missing or cross-workspace project', async () => {
    mocks.getProject.mockRejectedValue(
      new ProjectControlError('project_not_found', 'Project not found'),
    );

    await ProjectPage({
      params: Promise.resolve({ projectId: PROJECT.id }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
