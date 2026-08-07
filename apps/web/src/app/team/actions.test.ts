import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  inviteToWorkspace: vi.fn(),
  revokeInvitation: vi.fn(),
  redeemInvitation: vi.fn(),
  bootstrapSoloAccount: vi.fn(),
  listPendingInvitations: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  accountStore: {
    bootstrapSoloAccount: mocks.bootstrapSoloAccount,
    inviteToWorkspace: mocks.inviteToWorkspace,
    listPendingInvitations: mocks.listPendingInvitations,
    revokeInvitation: mocks.revokeInvitation,
    redeemInvitation: mocks.redeemInvitation,
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { AccountError } from '../../server/account.js';
import { inviteTeammateAction, revokeInvitationAction } from './actions.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const INVITATION_ID = '44444444-4444-4444-8444-444444444444';

const ACCOUNT = {
  workspace: {
    id: WORKSPACE_ID,
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
    id: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    kind: 'human',
    displayName: 'Ada Lovelace',
    externalRef: 'user_123',
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
} satisfies AccountContext;

const form = (entries: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    data.set(name, value);
  }
  return data;
};

const destination = (): string => String(mocks.redirect.mock.calls.at(-1)?.[0]);

describe('inviteTeammateAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.inviteToWorkspace.mockResolvedValue({
      id: INVITATION_ID,
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_ID,
      invitedEmail: 'grace@example.com',
      role: 'member',
      invitedBy: ACTOR_ID,
      createdAt: new Date('2026-08-07T00:00:00.000Z'),
      expiresAt: new Date('2026-08-14T00:00:00.000Z'),
      acceptedAt: null,
      revokedAt: null,
    });
  });

  it('scopes the invitation to the signed-in account rather than the form', async () => {
    await inviteTeammateAction(
      form({
        email: 'Grace@Example.com',
        role: 'member',
        workspaceId: 'attacker-workspace',
        invitedByActorId: 'attacker-actor',
      }),
    );

    expect(mocks.inviteToWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ID,
        invitedByActorId: ACTOR_ID,
        invitedEmail: 'grace@example.com',
        role: 'member',
      }),
    );
    expect(destination()).toMatch(/^\/team\?token=/);
  });

  it.each([
    { email: 'nonsense', role: 'member', expected: '/team?error=invalid_email' },
    { email: 'grace@example.com', role: 'owner', expected: '/team?error=invalid_role' },
  ])('redirects to $expected', async ({ email, role, expected }) => {
    await inviteTeammateAction(form({ email, role }));

    expect(mocks.inviteToWorkspace).not.toHaveBeenCalled();
    expect(destination()).toBe(expected);
  });

  it('reports a second live invitation for the same address', async () => {
    mocks.inviteToWorkspace.mockRejectedValue(
      Object.assign(new Error('duplicate'), {
        code: '23505',
      }),
    );

    await inviteTeammateAction(form({ email: 'grace@example.com', role: 'member' }));

    expect(destination()).toBe('/team?error=already_invited');
  });

  it('rethrows anything it does not recognise', async () => {
    const failure = new Error('database is on fire');
    mocks.inviteToWorkspace.mockRejectedValue(failure);

    await expect(
      inviteTeammateAction(form({ email: 'grace@example.com', role: 'member' })),
    ).rejects.toBe(failure);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('revokeInvitationAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.revokeInvitation.mockResolvedValue(undefined);
  });

  it('revokes inside the signed-in workspace only', async () => {
    await revokeInvitationAction(
      form({ invitationId: INVITATION_ID, workspaceId: 'attacker-workspace' }),
    );

    expect(mocks.revokeInvitation).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      invitationId: INVITATION_ID,
    });
    expect(destination()).toBe('/team?notice=revoked');
  });

  it('reports an invitation that is already settled', async () => {
    mocks.revokeInvitation.mockRejectedValue(
      new AccountError('invitation_not_found', 'already settled'),
    );

    await revokeInvitationAction(form({ invitationId: INVITATION_ID }));

    expect(destination()).toBe('/team?error=invitation_not_found');
  });
});
