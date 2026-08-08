import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../server/store/account-store.js';
import type { ManagedProject } from '../../server/store/project-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));
vi.mock('../../server/projects.js', () => ({
  listProjects: mocks.listProjects,
}));
vi.mock('../../server/project-runtime.js', () => ({
  projectStore: {},
}));

import ProjectsPage from './page.js';

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
  id: '44444444-4444-4444-8444-444444444444',
  workspaceId: ACCOUNT.workspace.id,
  teamId: ACCOUNT.team.id,
  slug: 'analytical-engine',
  displayName: 'Analytical Engine',
  repoUrl: null,
  archivedAt: null,
  createdAt: new Date('2026-08-01T01:00:00.000Z'),
} satisfies ManagedProject;

describe('ProjectsPage', () => {
  beforeEach(() => {
    mocks.getCurrentAccount.mockReset();
    mocks.listProjects.mockReset();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.listProjects.mockResolvedValue([PROJECT]);
  });

  it('loads every current-workspace project from the trusted account', async () => {
    const html = renderToStaticMarkup(await ProjectsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Analytical Engine');
    expect(mocks.listProjects).toHaveBeenCalledWith({
      account: ACCOUNT,
      includeArchived: true,
      store: {},
    });
  });

  it('renders the stable archive notice accessibly', async () => {
    const html = renderToStaticMarkup(
      await ProjectsPage({ searchParams: Promise.resolve({ notice: 'archived' }) }),
    );

    expect(html).toContain('Project archived.');
    expect(html).toContain('role="status"');
  });

  it('renders a generic not-found error without revealing tenant existence', async () => {
    const html = renderToStaticMarkup(
      await ProjectsPage({ searchParams: Promise.resolve({ error: 'project_not_found' }) }),
    );

    expect(html).toContain('That project is no longer available.');
    expect(html).toContain('role="alert"');
  });
});
