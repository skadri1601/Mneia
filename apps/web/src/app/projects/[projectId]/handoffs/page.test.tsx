import type { Project } from '@mneia/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  browseHandoffInbox: vi.fn(),
  notFound: vi.fn(() => null),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));
vi.mock('../../../../server/browse-runtime.js', () => ({
  BROWSE_LIMIT: 200,
  browseHandoffInbox: mocks.browseHandoffInbox,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import HandoffsPage from './page.js';

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

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const PROJECT = {
  id: PROJECT_ID,
  workspaceId: ACCOUNT.workspace.id,
  teamId: ACCOUNT.team.id,
  slug: 'analytical-engine',
  displayName: 'Analytical Engine',
  repoBinding: 'analytical-engine',
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
} as unknown as Project;

const MINE_ID = '55555555-5555-4555-8555-555555555555';
const OPEN_ID = '66666666-6666-4666-8666-666666666666';

const entry = (id: string, toActor: string | null, nextAction: string, fromName: string) => ({
  handoff: {
    id,
    workspaceId: ACCOUNT.workspace.id,
    projectId: PROJECT_ID,
    fromActor: '77777777-7777-4777-8777-777777777777',
    toActor,
    createdAt: new Date('2026-08-20T09:30:00.000Z'),
    receivedAt: null,
    nextAction,
    rendered: '# Handoff',
  },
  addressedToYou: toActor !== null,
  fromName,
});

const render = async () => {
  const element = await HandoffsPage({ params: Promise.resolve({ projectId: PROJECT_ID }) });
  return renderToStaticMarkup(element);
};

describe('project handoffs page', () => {
  it('links every waiting handoff to its artifact, so an inbox is reachable without a uuid', async () => {
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.browseHandoffInbox.mockResolvedValue({
      project: PROJECT,
      addressed: [entry(MINE_ID, ACCOUNT.actor.id, 'Wire the retry path.', 'Grace Hopper')],
      open: [entry(OPEN_ID, null, 'Finish the dual-read cutover.', 'Alan Turing')],
      truncated: false,
    });

    const html = await render();

    expect(html).toContain('/handoff/' + MINE_ID);
    expect(html).toContain('/handoff/' + OPEN_ID);
    expect(html).toContain('Wire the retry path.');
    expect(html).toContain('Finish the dual-read cutover.');
  });

  it('separates what is addressed to you from what is open to anyone', async () => {
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.browseHandoffInbox.mockResolvedValue({
      project: PROJECT,
      addressed: [entry(MINE_ID, ACCOUNT.actor.id, 'Wire the retry path.', 'Grace Hopper')],
      open: [],
      truncated: false,
    });

    const html = await render();

    expect(html).toContain('Addressed to you (1)');
    expect(html).toContain('Open to anyone (0)');
    expect(html).toContain('No open handoff is waiting.');
  });

  it('says plainly that opening a handoff does not claim it', async () => {
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.browseHandoffInbox.mockResolvedValue({
      project: PROJECT,
      addressed: [],
      open: [],
      truncated: false,
    });

    const html = await render();

    expect(html).toContain('does not claim it');
    expect(html).toContain('Nothing is addressed to you on this project.');
  });

  it('renders not-found when the project is not visible in this workspace', async () => {
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.browseHandoffInbox.mockResolvedValue({
      project: null,
      addressed: [],
      open: [],
      truncated: false,
    });

    await render();

    expect(mocks.notFound).toHaveBeenCalled();
  });
});
