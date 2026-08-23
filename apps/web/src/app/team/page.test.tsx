import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  listPendingInvitations: vi.fn(),
  seatPosition: vi.fn(),
  recordMembershipAudit: vi.fn(),
  listMembers: vi.fn(),
  removeMember: vi.fn(),
  changeRole: vi.fn(),
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
    listMembers: mocks.listMembers,
    removeMember: mocks.removeMember,
    changeRole: mocks.changeRole,
  }),
}));
vi.mock('./actions.js', () => ({
  inviteTeammateAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
  removeMemberAction: vi.fn(),
  changeRoleAction: vi.fn(),
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
    mocks.listMembers.mockResolvedValue([]);
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

const member = (
  actorId: string,
  workspaceRole: 'owner' | 'admin' | 'member',
  displayName: string,
  activeTokens = 0,
) => ({
  actorId,
  identityId: `id-${actorId}`,
  displayName,
  kind: 'human' as const,
  workspaceRole,
  teamRole: workspaceRole === 'member' ? ('member' as const) : ('lead' as const),
  addedAt: new Date('2026-08-01T00:00:00.000Z'),
  activeTokens,
});

const GRACE_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_OWNER_ID = '66666666-6666-4666-8666-666666666666';

describe('TeamPage members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.listPendingInvitations.mockResolvedValue([]);
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 8,
      memberCount: 3,
      pendingInvitations: 0,
    });
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'owner', 'Ada'),
      member(OTHER_OWNER_ID, 'owner', 'Alan'),
      member(GRACE_ID, 'member', 'Grace', 2),
    ]);
  });

  it('lists everyone with their workspace role, and marks the viewer', async () => {
    const html = await render();

    expect(mocks.listMembers).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
    });
    expect(html).toContain('Ada');
    expect(html).toContain('Grace');
    expect(html).toContain('Owner');
    expect(html).toContain('(you)');
  });

  it('offers Remove for someone an owner may remove, and Leave for the owner themselves', async () => {
    const html = await render();

    expect(html).toContain(`/team?confirm=${GRACE_ID}`);
    expect(html).toContain('Remove');
    expect(html).toContain('Leave');
  });

  it('does not post the removal straight from the list — the link only asks to confirm', async () => {
    const html = await render();

    expect(html).not.toContain('Yes, remove');
  });

  it('confirms in-page, naming the tokens that stop working and the memory that stays', async () => {
    const html = await render({ confirm: GRACE_ID });

    expect(html).toContain('Remove Grace?');
    expect(html).toContain('2 API tokens will be revoked');
    expect(html).toContain('stay in the workspace');
    expect(html).toContain('Yes, remove Grace');
    expect(html).toContain('Cancel');
  });

  it('says so plainly when there are no tokens to revoke', async () => {
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'owner', 'Ada'),
      member(OTHER_OWNER_ID, 'owner', 'Alan'),
      member(GRACE_ID, 'member', 'Grace', 0),
    ]);

    expect(await render({ confirm: GRACE_ID })).toContain('no API tokens to revoke');
  });

  it('offers no removal control at all to a member who may not remove anyone but themselves', async () => {
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'member', 'Ada'),
      member(GRACE_ID, 'member', 'Grace', 0),
    ]);

    const html = await render();

    expect(html).not.toContain(`/team?confirm=${GRACE_ID}`);
    expect(html).toContain(`/team?confirm=${ACTOR_ID}`);
  });

  it('offers no Leave control to the only owner, because it would orphan the workspace', async () => {
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'owner', 'Ada'),
      member(GRACE_ID, 'member', 'Grace', 0),
    ]);

    const html = await render();

    expect(html).not.toContain(`/team?confirm=${ACTOR_ID}`);
    expect(html).toContain(`/team?confirm=${GRACE_ID}`);
  });

  it('will not render a confirmation for a removal it would refuse', async () => {
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'member', 'Ada'),
      member(GRACE_ID, 'owner', 'Grace', 0),
      member(OTHER_OWNER_ID, 'owner', 'Alan'),
    ]);

    const html = await render({ confirm: GRACE_ID });

    expect(html).not.toContain('Yes, remove Grace');
  });

  it('explains a refused removal', async () => {
    expect(await render({ error: 'last_owner' })).toContain('only one owner');
  });

  it('confirms a completed removal, including that the seat is free', async () => {
    expect(await render({ notice: 'removed' })).toContain('seat is free');
  });
});

describe('TeamPage role change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.listPendingInvitations.mockResolvedValue([]);
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 8,
      memberCount: 2,
      pendingInvitations: 0,
    });
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'owner', 'Ada'),
      member(GRACE_ID, 'member', 'Grace'),
    ]);
  });

  it('offers a role change an owner is allowed to make', async () => {
    expect(await render()).toContain(`/team?role=${GRACE_ID}`);
  });

  it('does not post the change straight from the list — the link only asks to confirm', async () => {
    expect(await render()).not.toContain('Make Grace an admin');
  });

  it('confirms in-page, offering only roles the server would accept', async () => {
    const html = await render({ role: GRACE_ID });

    // renderToStaticMarkup escapes the apostrophe, so match the rendered entity.
    expect(html).toContain('Change Grace&#x27;s role?');
    expect(html).toContain('Make Grace an admin');
    expect(html).toContain('Make Grace an owner');
    expect(html).toContain('Cancel');
  });

  it('says what each offered role can actually do, next to the button that grants it', async () => {
    const html = await render({ role: GRACE_ID });

    expect(html).toContain('grant and revoke ownership');
    expect(html).toContain('cannot touch admins or owners');
    // Grace is already a member, so `member` is a no-op and is not offered - and therefore
    // its description must not appear either.
    expect(html).not.toContain('cannot invite, remove, or change roles');
  });

  it('says the change does not move the seat count', async () => {
    expect(await render({ role: GRACE_ID })).toContain('does not change the number of seats');
  });

  it('offers no owner option to an admin, who may not create one', async () => {
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'admin', 'Ada'),
      member(GRACE_ID, 'member', 'Grace'),
      member(OTHER_OWNER_ID, 'owner', 'Alan'),
    ]);

    const html = await render({ role: GRACE_ID });

    expect(html).toContain('Make Grace an admin');
    expect(html).not.toContain('Make Grace an owner');
  });

  it('offers a member no role control at all', async () => {
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'member', 'Ada'),
      member(GRACE_ID, 'member', 'Grace'),
      member(OTHER_OWNER_ID, 'owner', 'Alan'),
    ]);

    const html = await render();

    expect(html).not.toContain(`/team?role=${GRACE_ID}`);
  });

  it('will not render a role panel for a change it would refuse', async () => {
    mocks.listMembers.mockResolvedValue([
      member(ACTOR_ID, 'member', 'Ada'),
      member(GRACE_ID, 'owner', 'Grace'),
      member(OTHER_OWNER_ID, 'owner', 'Alan'),
    ]);

    expect(await render({ role: GRACE_ID })).not.toContain('Change Grace&#x27;s role?');
  });

  it('lets the sole owner promote someone, which is the way out of the last-owner block', async () => {
    const html = await render({ role: GRACE_ID });

    // Ada is the only owner, so she cannot leave — but she can promote Grace.
    expect(html).not.toContain(`/team?confirm=${ACTOR_ID}`);
    expect(html).toContain('Make Grace an owner');
  });

  it('confirms a completed role change and says seats are unchanged', async () => {
    const html = await render({ notice: 'role_changed', role: 'owner' });

    expect(html).toContain('Role updated');
    expect(html).toContain('Seats are unchanged');
  });

  it('explains a refused no-op change', async () => {
    expect(await render({ error: 'role_unchanged' })).toContain('already hold that role');
  });
});
