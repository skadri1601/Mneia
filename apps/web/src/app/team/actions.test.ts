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
  deliverInvitationEmail: vi.fn(),
  seatPosition: vi.fn(),
  recordMembershipAudit: vi.fn(),
  removeMember: vi.fn(),
  listMembers: vi.fn(),
  changeRole: vi.fn(),
  syncSeats: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../server/membership-runtime.js', () => ({
  seats: () => ({
    seatPosition: mocks.seatPosition,
    recordMembershipAudit: mocks.recordMembershipAudit,
    removeMember: mocks.removeMember,
    listMembers: mocks.listMembers,
    changeRole: mocks.changeRole,
  }),
}));
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
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }));
vi.mock('../../server/billing/runtime.js', () => ({
  billingRuntime: () => ({ seatSync: { syncSeats: mocks.syncSeats } }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../server/invitation-runtime.js', () => ({
  deliverInvitationEmail: mocks.deliverInvitationEmail,
  joinUrl: (token: string) => `https://app.mneia.dev/join/${token}`,
}));

import { AccountError } from '../../server/account.js';
import {
  changeRoleAction,
  inviteTeammateAction,
  removeMemberAction,
  revokeInvitationAction,
} from './actions.js';

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
  workspaces: [{ id: '11111111-1111-4111-8111-111111111111', slug: 'acme', displayName: 'Acme' }],
} satisfies AccountContext;

const form = (entries: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    data.set(name, value);
  }
  return data;
};

const destination = (): string => String(mocks.redirect.mock.calls.at(-1)?.[0]);

/** A Team workspace with room to spare, unless a test says otherwise. */
const SEATS_SPARE = {
  plan: 'team',
  billingStatus: 'active',
  seatsPurchased: 10,
  memberCount: 3,
  pendingInvitations: 0,
} as const;

describe('inviteTeammateAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.seatPosition.mockResolvedValue(SEATS_SPARE);
    mocks.recordMembershipAudit.mockResolvedValue(undefined);
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
    mocks.deliverInvitationEmail.mockResolvedValue({
      delivered: true,
      providerId: 'resend-1',
      detail: null,
    });
  });

  it('emails the invited address the join link, and says so', async () => {
    await inviteTeammateAction(form({ email: 'Grace@Example.com', role: 'member' }));

    expect(mocks.deliverInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'grace@example.com',
        invitationId: INVITATION_ID,
        workspaceName: 'Ada Lovelace',
        inviterName: 'Ada Lovelace',
        role: 'member',
      }),
    );
    const sent = mocks.deliverInvitationEmail.mock.calls[0]?.[0] as { joinUrl: string };
    expect(sent.joinUrl).toMatch(/^https:\/\/app\.mneia\.dev\/join\//);
    expect(destination()).toMatch(/^\/team\?notice=invited&token=/);
  });

  it('reports a failed send and keeps the link recoverable, rather than losing the invitation', async () => {
    mocks.deliverInvitationEmail.mockResolvedValue({
      delivered: false,
      providerId: null,
      detail: 'Resend returned 422 Unprocessable Entity',
    });

    await inviteTeammateAction(form({ email: 'grace@example.com', role: 'member' }));

    expect(destination()).toMatch(/^\/team\?error=invite_email_failed&token=/);
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
    expect(destination()).toMatch(/^\/team\?notice=invited&token=/);
  });

  it.each([
    { email: 'nonsense', role: 'member', expected: '/team?error=invalid_email' },
    { email: 'grace@example.com', role: 'lead', expected: '/team?error=invalid_role' },
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

  it('refuses at invite time when the workspace has no spare seat, and creates nothing', async () => {
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 5,
      memberCount: 5,
      pendingInvitations: 0,
    });

    await inviteTeammateAction(form({ email: 'grace@example.com', role: 'member' }));

    expect(mocks.inviteToWorkspace).not.toHaveBeenCalled();
    expect(mocks.deliverInvitationEmail).not.toHaveBeenCalled();
    expect(destination()).toBe('/team?error=seats_exceeded');
  });

  it('counts invitations already waiting against the seats, not just accepted members', async () => {
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 6,
      memberCount: 5,
      pendingInvitations: 1,
    });

    await inviteTeammateAction(form({ email: 'grace@example.com', role: 'member' }));

    expect(mocks.inviteToWorkspace).not.toHaveBeenCalled();
    expect(destination()).toBe('/team?error=seats_exceeded');
  });

  it('does not gate a plan that is not seat-priced', async () => {
    mocks.seatPosition.mockResolvedValue({
      plan: 'solo',
      billingStatus: 'active',
      seatsPurchased: null,
      memberCount: 9,
      pendingInvitations: 4,
    });

    await inviteTeammateAction(form({ email: 'grace@example.com', role: 'member' }));

    expect(mocks.inviteToWorkspace).toHaveBeenCalled();
    expect(destination()).toMatch(/^\/team\?notice=invited&token=/);
  });

  it('records the invitation in the audit log, scoped to the signed-in account', async () => {
    await inviteTeammateAction(form({ email: 'grace@example.com', role: 'member' }));

    expect(mocks.recordMembershipAudit).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
      expect.objectContaining({
        action: 'membership.invitation_created',
        targetKind: 'workspace_invitation',
        targetId: INVITATION_ID,
      }),
    );
  });

  it('never puts the join token or the invited address in the audit metadata', async () => {
    await inviteTeammateAction(form({ email: 'grace@example.com', role: 'member' }));

    const recorded = JSON.stringify(mocks.recordMembershipAudit.mock.calls[0]?.[1]);
    const token = String(destination()).split('token=')[1];

    expect(recorded).not.toContain('grace@example.com');
    expect(token).toBeDefined();
    expect(recorded).not.toContain(decodeURIComponent(String(token)));
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
    mocks.recordMembershipAudit.mockResolvedValue(undefined);
  });

  it('records the revocation, so a released seat has a trail', async () => {
    await revokeInvitationAction(form({ invitationId: INVITATION_ID }));

    expect(mocks.recordMembershipAudit).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
      expect.objectContaining({
        action: 'membership.invitation_revoked',
        targetId: INVITATION_ID,
      }),
    );
  });

  it('refuses a member trying to revoke, before it reaches the store', async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      ...ACCOUNT,
      membership: { ...ACCOUNT.membership, role: 'member' },
    });

    await revokeInvitationAction(form({ invitationId: INVITATION_ID }));

    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
    expect(destination()).toBe('/team?error=not_permitted');
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

describe('removeMemberAction', () => {
  const TARGET_ACTOR_ID = '55555555-5555-4555-8555-555555555555';

  beforeEach(() => {
    // vi.clearAllMocks() clears calls but not implementations, so these were previously
    // inherited from the inviteTeammateAction describe above. Set explicitly: a test that
    // depends on another describe's leftovers breaks mysteriously when files are reordered.
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 10,
      memberCount: 3,
      pendingInvitations: 0,
    });
    mocks.syncSeats.mockResolvedValue({ synced: true, reason: 'ok', seats: 3 });
  });

  it('removes inside the signed-in workspace only, taking nothing but the id from the form', async () => {
    mocks.removeMember.mockResolvedValue({
      removed: true,
      displayName: 'Grace',
      tokensRevoked: 2,
      selfRemoval: false,
    });

    await removeMemberAction(
      form({
        actorId: TARGET_ACTOR_ID,
        workspaceId: 'attacker-workspace',
        role: 'owner',
        humanConfirmed: 'true',
      }),
    );

    expect(mocks.removeMember).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
      { actorId: TARGET_ACTOR_ID },
    );
    expect(destination()).toBe('/team?notice=removed');
  });

  it('sends a departing member away from the workspace they just left', async () => {
    mocks.removeMember.mockResolvedValue({
      removed: true,
      displayName: 'Ada',
      tokensRevoked: 0,
      selfRemoval: true,
    });

    await removeMemberAction(form({ actorId: ACTOR_ID }));

    expect(destination()).toBe('/projects?notice=left_workspace');
  });

  it.each(['last_owner', 'not_permitted', 'member_not_found'])(
    'surfaces a %s refusal rather than reporting success',
    async (code) => {
      mocks.removeMember.mockResolvedValue({ removed: false, code, message: 'no' });

      await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

      expect(destination()).toBe(`/team?error=${code}`);
    },
  );

  it('revalidates the token list too, because removal revokes tokens', async () => {
    mocks.removeMember.mockResolvedValue({
      removed: true,
      displayName: 'Grace',
      tokensRevoked: 1,
      selfRemoval: false,
    });

    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/tokens');
  });
});

describe('changeRoleAction', () => {
  const TARGET_ACTOR_ID = '55555555-5555-4555-8555-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
  });

  it('scopes the change to the signed-in account, taking only the id and role from the form', async () => {
    mocks.changeRole.mockResolvedValue({
      changed: true,
      displayName: 'Grace',
      previousRole: 'member',
      newRole: 'owner',
      selfChange: false,
      direction: 'promotion',
    });

    await changeRoleAction(
      form({
        actorId: TARGET_ACTOR_ID,
        role: 'owner',
        workspaceId: 'attacker-workspace',
        assertedBy: 'attacker-actor',
        humanConfirmed: 'true',
      }),
    );

    expect(mocks.changeRole).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
      { actorId: TARGET_ACTOR_ID, role: 'owner' },
    );
    expect(destination()).toBe('/team?notice=role_changed&role=owner');
  });

  it.each(['last_owner', 'not_permitted', 'role_unchanged', 'member_not_found'])(
    'surfaces a %s refusal rather than reporting success',
    async (code) => {
      mocks.changeRole.mockResolvedValue({ changed: false, code, message: 'no' });

      await changeRoleAction(form({ actorId: TARGET_ACTOR_ID, role: 'admin' }));

      expect(destination()).toBe(`/team?error=${code}`);
    },
  );

  it('does not revalidate the token list, because a role change issues no credentials', async () => {
    mocks.changeRole.mockResolvedValue({
      changed: true,
      displayName: 'Grace',
      previousRole: 'member',
      newRole: 'admin',
      selfChange: false,
      direction: 'promotion',
    });

    await changeRoleAction(form({ actorId: TARGET_ACTOR_ID, role: 'admin' }));

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/team');
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith('/tokens');
  });

  it('never consults the seat position, because a role change cannot move it', async () => {
    mocks.changeRole.mockResolvedValue({
      changed: true,
      displayName: 'Grace',
      previousRole: 'member',
      newRole: 'admin',
      selfChange: false,
      direction: 'promotion',
    });

    await changeRoleAction(form({ actorId: TARGET_ACTOR_ID, role: 'admin' }));

    expect(mocks.seatPosition).not.toHaveBeenCalled();
  });
});

describe('removal releases the seat to Stripe', () => {
  const TARGET_ACTOR_ID = '55555555-5555-4555-8555-555555555555';

  const removed = {
    removed: true,
    displayName: 'Grace',
    tokensRevoked: 1,
    selfRemoval: false,
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.removeMember.mockResolvedValue(removed);
    mocks.syncSeats.mockResolvedValue({ synced: true, reason: 'ok', seats: 4 });
    // Four members and one live invitation remain after the removal.
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 6,
      memberCount: 4,
      pendingInvitations: 1,
    });
  });

  it('lowers the Stripe quantity to what the workspace still needs', async () => {
    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    expect(mocks.syncSeats).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      seats: 5,
      reason: 'member_removed',
    });
    expect(destination()).toBe('/team?notice=removed');
  });

  it('counts a live invitation, so it does not drop a seat that invitation still needs', async () => {
    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    // 4 members + 1 waiting invitation = 5, not 4.
    const call = mocks.syncSeats.mock.calls[0]?.[0] as { seats: number };
    expect(call.seats).toBe(5);
  });

  it('reads the seat position after the removal, not before', async () => {
    const order: string[] = [];
    mocks.removeMember.mockImplementation(async () => {
      order.push('remove');
      return removed;
    });
    mocks.seatPosition.mockImplementation(async () => {
      order.push('read');
      return {
        plan: 'team',
        billingStatus: 'active',
        seatsPurchased: 6,
        memberCount: 4,
        pendingInvitations: 1,
      };
    });

    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    expect(order).toEqual(['remove', 'read']);
  });

  it('uses the membership path, which may only lower the bill — never a purchase', async () => {
    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    const call = mocks.syncSeats.mock.calls[0]?.[0] as { reason: string };
    expect(call.reason).toBe('member_removed');
  });

  it('never syncs when the removal was refused', async () => {
    mocks.removeMember.mockResolvedValue({
      removed: false,
      code: 'last_owner',
      message: 'no',
    });

    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    expect(mocks.syncSeats).not.toHaveBeenCalled();
  });
});

describe('a failed seat sync does not undo or block the removal', () => {
  const TARGET_ACTOR_ID = '55555555-5555-4555-8555-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.removeMember.mockResolvedValue({
      removed: true,
      displayName: 'Grace',
      tokensRevoked: 2,
      selfRemoval: false,
    });
    mocks.seatPosition.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 6,
      memberCount: 4,
      pendingInvitations: 0,
    });
  });

  it('still reports the removal as done when Stripe is unreachable', async () => {
    mocks.syncSeats.mockRejectedValue(new Error('stripe_unreachable'));

    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    expect(destination()).toBe('/team?notice=removed&seat_sync=failed');
  });

  it('reports the failure rather than swallowing it', async () => {
    const failure = new Error('stripe_unreachable');
    mocks.syncSeats.mockRejectedValue(failure);

    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    expect(mocks.captureException).toHaveBeenCalledWith(failure, {
      tags: { mneia_seat_sync: 'member_removed' },
    });
  });

  it('survives Stripe being unconfigured, which must not stop a removal', async () => {
    // billingRuntime() throws when the Stripe keys are absent.
    mocks.syncSeats.mockImplementation(() => {
      throw new Error('STRIPE_SECRET_KEY is not set');
    });

    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    expect(destination()).toBe('/team?notice=removed&seat_sync=failed');
    expect(mocks.captureException).toHaveBeenCalled();
  });

  it('flags it on a self-removal too, rather than losing it', async () => {
    mocks.removeMember.mockResolvedValue({
      removed: true,
      displayName: 'Ada',
      tokensRevoked: 0,
      selfRemoval: true,
    });
    mocks.syncSeats.mockRejectedValue(new Error('stripe_unreachable'));

    await removeMemberAction(form({ actorId: ACTOR_ID }));

    expect(destination()).toBe('/projects?notice=left_workspace&seat_sync=failed');
  });

  it('reports an unreadable seat position rather than silently skipping the sync', async () => {
    mocks.seatPosition.mockResolvedValue(null);

    await removeMemberAction(form({ actorId: TARGET_ACTOR_ID }));

    expect(mocks.syncSeats).not.toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalled();
    expect(destination()).toBe('/team?notice=removed&seat_sync=failed');
  });
});

describe('a role change never touches Stripe', () => {
  const TARGET_ACTOR_ID = '55555555-5555-4555-8555-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.changeRole.mockResolvedValue({
      changed: true,
      displayName: 'Grace',
      previousRole: 'member',
      newRole: 'owner',
      selfChange: false,
      direction: 'promotion',
    });
  });

  it('does not sync seats on a promotion', async () => {
    await changeRoleAction(form({ actorId: TARGET_ACTOR_ID, role: 'owner' }));

    expect(mocks.syncSeats).not.toHaveBeenCalled();
  });

  it('does not sync seats on a demotion either', async () => {
    mocks.changeRole.mockResolvedValue({
      changed: true,
      displayName: 'Grace',
      previousRole: 'admin',
      newRole: 'member',
      selfChange: false,
      direction: 'demotion',
    });

    await changeRoleAction(form({ actorId: TARGET_ACTOR_ID, role: 'member' }));

    expect(mocks.syncSeats).not.toHaveBeenCalled();
  });
});
