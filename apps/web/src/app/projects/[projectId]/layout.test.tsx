import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProjectIdentity } from '../../../components/project-workspace/ProjectWorkspace.js';
import type { AccountContext } from '../../../server/store/account-store.js';
import type { ManagedProject } from '../../../server/store/project-store.js';

const NOT_FOUND = new Error('not found');
const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  getProject: vi.fn(),
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
  projectWorkspace: vi.fn(
    (_props: Readonly<{ children: ReactNode; project: ProjectIdentity }>): ReactNode => null,
  ),
  projectStore: {},
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
  projectStore: mocks.projectStore,
}));
vi.mock('../../../components/project-workspace/ProjectWorkspace.js', () => ({
  ProjectWorkspace: mocks.projectWorkspace,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import { ProjectControlError } from '../../../server/projects.js';
import ProjectLayout from './layout.js';

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
  workspaces: [{ id: '11111111-1111-4111-8111-111111111111', slug: 'acme', displayName: 'Acme' }],
} satisfies AccountContext;

const PROJECT = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  workspaceId: ACCOUNT.workspace.id,
  teamId: ACCOUNT.team.id,
  slug: 'analytical-engine',
  displayName: 'Analytical Engine',
  repoUrl: null,
  archivedAt: null,
  createdAt: new Date('2026-08-01T01:00:00.000Z'),
} satisfies ManagedProject;

describe('ProjectLayout', () => {
  beforeEach(() => {
    mocks.getCurrentAccount.mockReset();
    mocks.getProject.mockReset();
    mocks.notFound.mockClear();
    mocks.projectWorkspace.mockClear();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.getProject.mockResolvedValue(PROJECT);
  });

  test('loads the scoped project and passes its serializable identity into the shell', async () => {
    await renderLayout();

    expect(mocks.getProject).toHaveBeenCalledWith({
      account: ACCOUNT,
      projectId: PROJECT.id,
      store: mocks.projectStore,
    });
    expect(mocks.projectWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        project: { id: PROJECT.id, displayName: PROJECT.displayName, slug: PROJECT.slug },
      }),
      undefined,
    );
    const props = mocks.projectWorkspace.mock.calls[0]?.[0];
    expect(props?.project).toEqual({
      id: PROJECT.id,
      displayName: PROJECT.displayName,
      slug: PROJECT.slug,
    });
    expect(props?.children).toBeDefined();
  });

  test.each(['invalid_project_id', 'project_not_found', 'forbidden'] as const)(
    'uses the indistinguishable not-found path for %s',
    async (code) => {
      mocks.getProject.mockRejectedValue(new ProjectControlError(code, code));

      await expect(renderLayout()).rejects.toBe(NOT_FOUND);

      expect(mocks.notFound).toHaveBeenCalledOnce();
    },
  );

  test('propagates unexpected project lookup failures', async () => {
    const failure = new Error('database unavailable');
    mocks.getProject.mockRejectedValue(failure);

    await expect(renderLayout()).rejects.toBe(failure);

    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});

async function renderLayout(): Promise<void> {
  const layout = await ProjectLayout({
    children: <p>Project route content</p>,
    params: Promise.resolve({ projectId: PROJECT.id }),
  });
  renderToStaticMarkup(layout);
}
