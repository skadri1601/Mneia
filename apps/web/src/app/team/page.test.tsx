import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  listPendingInvitations: vi.fn(),
  seatPosition: vi.fn(),
  recordMembershipAudit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  accountStore: { listPendingInvitations: mocks.listPendingInvitations },
}));
vi.mock('../../server/membership-runtime.js', () => ({
  seats: () => ({
    seatPosition: mocks.seatPosition,
    recordMembershipAudit: mocks.recordMembershipAudit,
  }),
}));
vi.mock('./actions.js', () => ({
  inviteTeammateAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));
vi.mock('../../components/WorkspaceSwitcher.js', () => ({ WorkspaceSwitcher: () => null }));

import TeamPage from './page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_ID = '44444444-4444-4444-8444-444444444444';

const ACCOUNT = {
  workspace: {
    id: WORKSPACE_ID,
    slug: 'acme',
    displayName: 'Acme',
    plan: 'team',
    billingStatus: 'active',
    billingCustomerRef: 'cus_1',
    seatsPurchased: 5,
    checkpointAllowance: null,
    trialEndsAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  actor: {
    id: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    kind: 'human',
    displayName: 'Ada',
    externalRef: 'user_1',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  team: {
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    slug: 'default',
    displayName: 'Default',
    function: 'engineering',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  membership: {
    workspaceId: WORKSPACE_ID,
    teamId: TEAM_ID,
    actorId: ACTOR_ID,
    role: 'lead',
    addedAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  workspaces: [],
} satisfies AccountContext;

const render = async (query: Record<string, string> = {}): Promise<string> =>
  renderToStaticMarkup(await TeamPage({ searchParams: Promise.resolve(query) }));

describe('TeamPage seat position', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.listPendingInvitations.mockResolvedValue([]);
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 8,
      memberCount: 5,
      pendingInvitations: 1,
    });
  });

  it('shows members, invitations waiting, seats committed and seats purchased', async () => {
    const html = await render();

    expect(mocks.seatPosition).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
    });
    expect(html).toContain('Members');
    expect(html).toContain('Invitations waiting');
    expect(html).toContain('Seats committed');
    expect(html).toContain('Seats purchased');
    expect(html).toContain('>6<');
    expect(html).toContain('>8<');
  });

  it('says what a seat costs, so the price of one more person is on the page', async () => {
    expect(await render()).toContain('$25.00');
  });

  it('names the extra cost and disables the control when there is no spare seat', async () => {
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 5,
      memberCount: 5,
      pendingInvitations: 0,
    });

    const html = await render();

    expect(html).toContain('Buy 1 more seat');
    expect(html).toContain('$25.00 a month extra');
    expect(html).toContain('disabled');
  });

  it('leaves the control usable while a seat is spare', async () => {
    const html = await render();

    expect(html).toContain('Create invitation');
    expect(html).not.toContain('disabled');
  });

  it('explains a refused invitation rather than leaving the form silently unchanged', async () => {
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 5,
      memberCount: 5,
      pendingInvitations: 0,
    });

    expect(await render({ error: 'seats_exceeded' })).toContain('no spare seat');
  });

  it('does not present a seat price as owed on a plan that is not seat-priced', async () => {
    mocks.seatPosition.mockResolvedValue({
      plan: 'solo',
      billingStatus: 'active',
      seatsPurchased: null,
      memberCount: 2,
      pendingInvitations: 0,
    });

    const html = await render();

    expect(html).toContain('Not seat-priced');
    expect(html).toContain('costs nothing');
    expect(html).not.toContain('disabled');
  });

  it('still renders the page when the seat position cannot be read', async () => {
    mocks.seatPosition.mockResolvedValue(null);

    const html = await render();

    expect(html).toContain('Invite a colleague');
    expect(html).not.toContain('Seats committed');
  });
});
