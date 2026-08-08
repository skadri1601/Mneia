import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  AccountError,
  assertMayAdministerInvitations,
  bootstrapSoloAccount,
  INVITATION_TTL_MS,
  inviteTeammate,
  normalizeEmail,
  parseInvitableRole,
  parseWorkspaceRole,
  redeemInvitation,
} from './account.js';
import { hashJoinToken } from './invitations.js';
import type { AccountContext, AccountStore, WorkspaceInvitation } from './store/account-store.js';

const ACCOUNT_CONTEXT: AccountContext = {
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
  workspaces: [{ id: '11111111-1111-4111-8111-111111111111', slug: 'acme', displayName: 'Acme' }],
};

const INVITATION: WorkspaceInvitation = {
  id: '44444444-4444-4444-8444-444444444444',
  workspaceId: ACCOUNT_CONTEXT.workspace.id,
  teamId: ACCOUNT_CONTEXT.team.id,
  invitedEmail: 'grace@example.com',
  role: 'member',
  invitedBy: ACCOUNT_CONTEXT.actor.id,
  createdAt: new Date('2026-08-07T00:00:00.000Z'),
  expiresAt: new Date('2026-08-14T00:00:00.000Z'),
  acceptedAt: null,
  revokedAt: null,
};

const accountStore = () => {
  const bootstrapSoloAccount = vi.fn<AccountStore['bootstrapSoloAccount']>();
  const inviteToWorkspace = vi
    .fn<AccountStore['inviteToWorkspace']>()
    .mockResolvedValue(INVITATION);
  const redeem = vi.fn<AccountStore['redeemInvitation']>().mockResolvedValue(null);

  return {
    store: {
      bootstrapSoloAccount,
      inviteToWorkspace,
      redeemInvitation: redeem,
      listPendingInvitations: vi.fn<AccountStore['listPendingInvitations']>(),
      revokeInvitation: vi.fn<AccountStore['revokeInvitation']>(),
    } satisfies AccountStore,
    bootstrapSoloAccount,
    inviteToWorkspace,
    redeem,
  };
};

describe('bootstrapSoloAccount', () => {
  it('rejects an absent Clerk subject', async () => {
    const { store, bootstrapSoloAccount: persist } = accountStore();
    const bootstrap = bootstrapSoloAccount({
      subject: null,
      displayName: 'Ada Lovelace',
      store,
    });

    await expect(bootstrap).rejects.toBeInstanceOf(AccountError);
    await expect(bootstrap).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a blank Clerk subject', async () => {
    const { store, bootstrapSoloAccount: persist } = accountStore();
    const bootstrap = bootstrapSoloAccount({
      subject: '   ',
      displayName: 'Ada Lovelace',
      store,
    });

    await expect(bootstrap).rejects.toBeInstanceOf(AccountError);
    await expect(bootstrap).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a blank profile display name', async () => {
    const { store, bootstrapSoloAccount: persist } = accountStore();
    const bootstrap = bootstrapSoloAccount({
      subject: 'user_123',
      displayName: '   ',
      store,
    });

    await expect(bootstrap).rejects.toBeInstanceOf(AccountError);
    await expect(bootstrap).rejects.toMatchObject({ code: 'invalid_profile' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('delegates the exact verified subject and profile to the store', async () => {
    const { store, bootstrapSoloAccount: persist } = accountStore();
    persist.mockResolvedValue(ACCOUNT_CONTEXT);

    await expect(
      bootstrapSoloAccount({ subject: 'user_123', displayName: ' Ada Lovelace ', store }),
    ).resolves.toBe(ACCOUNT_CONTEXT);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({
      subject: 'user_123',
      displayName: ' Ada Lovelace ',
      preferredWorkspaceId: null,
    });
  });
});

describe('normalizeEmail', () => {
  it.each([
    { input: '  Grace@Example.COM ', expected: 'grace@example.com' },
    { input: 'a.b+tag@sub.example.co.uk', expected: 'a.b+tag@sub.example.co.uk' },
  ])('normalizes $input', ({ input, expected }) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each(['', '   ', 'grace', 'grace@', '@example.com', 'grace@example', 'a b@example.com'])(
    'rejects %j',
    (input) => {
      expect(() => normalizeEmail(input)).toThrowError(
        expect.objectContaining({ code: 'invalid_email' }),
      );
    },
  );

  it('rejects an address longer than the RFC maximum', () => {
    expect(() => normalizeEmail(`${'a'.repeat(320)}@example.com`)).toThrowError(
      expect.objectContaining({ code: 'invalid_email' }),
    );
  });
});

describe('parseWorkspaceRole', () => {
  it.each(['owner', 'admin', 'member'] as const)('accepts %s', (role) => {
    expect(parseWorkspaceRole(role)).toBe(role);
  });

  it.each(['lead', '', 'OWNER'])('rejects %j', (role) => {
    expect(() => parseWorkspaceRole(role)).toThrowError(
      expect.objectContaining({ code: 'invalid_role' }),
    );
  });
});

describe('inviteTeammate', () => {
  it('stores only the hash of a token it returns exactly once', async () => {
    const { store, inviteToWorkspace } = accountStore();

    const { invitation, token } = await inviteTeammate({
      workspaceId: ACCOUNT_CONTEXT.workspace.id,
      teamId: ACCOUNT_CONTEXT.team.id,
      invitedByActorId: ACCOUNT_CONTEXT.actor.id,
      invitedByMembership: ACCOUNT_CONTEXT.membership,
      email: '  Grace@Example.com ',
      role: 'member',
      store,
      now: () => new Date('2026-08-07T00:00:00.000Z'),
      issueToken: () => 'join-token',
    });

    expect(invitation).toBe(INVITATION);
    expect(token).toBe('join-token');
    expect(inviteToWorkspace).toHaveBeenCalledWith({
      workspaceId: ACCOUNT_CONTEXT.workspace.id,
      teamId: ACCOUNT_CONTEXT.team.id,
      invitedByActorId: ACCOUNT_CONTEXT.actor.id,
      invitedEmail: 'grace@example.com',
      role: 'member',
      tokenHash: hashJoinToken('join-token'),
      expiresAt: new Date(new Date('2026-08-07T00:00:00.000Z').getTime() + INVITATION_TTL_MS),
    });
    expect(JSON.stringify(inviteToWorkspace.mock.calls)).not.toContain('join-token');
  });

  it.each([
    { email: 'not-an-address', role: 'member', code: 'invalid_email' },
    { email: 'grace@example.com', role: 'lead', code: 'invalid_role' },
    { email: 'grace@example.com', role: 'owner', code: 'not_permitted' },
  ])('refuses $code before touching the store', async ({ email, role, code }) => {
    const { store, inviteToWorkspace } = accountStore();

    await expect(
      inviteTeammate({
        workspaceId: ACCOUNT_CONTEXT.workspace.id,
        teamId: ACCOUNT_CONTEXT.team.id,
        invitedByActorId: ACCOUNT_CONTEXT.actor.id,
        invitedByMembership: ACCOUNT_CONTEXT.membership,
        email,
        role,
        store,
      }),
    ).rejects.toMatchObject({ code });
    expect(inviteToWorkspace).not.toHaveBeenCalled();
  });

  it.each(['member', 'admin', 'owner'])(
    'refuses a non-lead inviting %s, rather than letting a member grant any role',
    async (role) => {
      const { store, inviteToWorkspace } = accountStore();

      await expect(
        inviteTeammate({
          workspaceId: ACCOUNT_CONTEXT.workspace.id,
          teamId: ACCOUNT_CONTEXT.team.id,
          invitedByActorId: ACCOUNT_CONTEXT.actor.id,
          invitedByMembership: { ...ACCOUNT_CONTEXT.membership, role: 'member' },
          email: 'grace@example.com',
          role,
          store,
        }),
      ).rejects.toMatchObject({ code: 'not_permitted' });
      expect(inviteToWorkspace).not.toHaveBeenCalled();
    },
  );

  it('lets a lead invite an admin, which is the role the form offers', async () => {
    const { store, inviteToWorkspace } = accountStore();

    await inviteTeammate({
      workspaceId: ACCOUNT_CONTEXT.workspace.id,
      teamId: ACCOUNT_CONTEXT.team.id,
      invitedByActorId: ACCOUNT_CONTEXT.actor.id,
      invitedByMembership: ACCOUNT_CONTEXT.membership,
      email: 'grace@example.com',
      role: 'admin',
      store,
      issueToken: () => 'join-token',
    });

    expect(inviteToWorkspace).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
  });
});

describe('assertMayAdministerInvitations', () => {
  it('admits a lead', () => {
    expect(() => assertMayAdministerInvitations(ACCOUNT_CONTEXT.membership)).not.toThrow();
  });

  it('refuses a member, naming the role it saw and who to ask', () => {
    expect(() =>
      assertMayAdministerInvitations({ ...ACCOUNT_CONTEXT.membership, role: 'member' }),
    ).toThrowError(expect.objectContaining({ code: 'not_permitted' }));
  });
});

describe('parseInvitableRole', () => {
  it.each(['admin', 'member'] as const)('accepts %s', (role) => {
    expect(parseInvitableRole(role)).toBe(role);
  });

  it('refuses owner, because the owner is whoever created the workspace', () => {
    expect(() => parseInvitableRole('owner')).toThrowError(
      expect.objectContaining({ code: 'not_permitted' }),
    );
  });

  it('still refuses a role that does not exist at all', () => {
    expect(() => parseInvitableRole('lead')).toThrowError(
      expect.objectContaining({ code: 'invalid_role' }),
    );
  });
});

describe('redeemInvitation', () => {
  it('rejects an absent Clerk subject', async () => {
    const { store, redeem } = accountStore();

    await expect(
      redeemInvitation({
        subject: null,
        verifiedEmail: 'grace@example.com',
        displayName: 'Grace Hopper',
        store,
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(redeem).not.toHaveBeenCalled();
  });

  it('never reaches the store without a verified email address', async () => {
    const { store, redeem } = accountStore();

    await expect(
      redeemInvitation({
        subject: 'user_123',
        verifiedEmail: null,
        displayName: 'Grace Hopper',
        store,
      }),
    ).resolves.toBeNull();
    expect(redeem).not.toHaveBeenCalled();
  });

  it('passes the normalized verified email and hashes the join token', async () => {
    const { store, redeem } = accountStore();
    redeem.mockResolvedValue(ACCOUNT_CONTEXT);

    await expect(
      redeemInvitation({
        subject: 'user_123',
        verifiedEmail: ' Grace@Example.com ',
        displayName: 'Grace Hopper',
        token: 'join-token',
        store,
      }),
    ).resolves.toBe(ACCOUNT_CONTEXT);
    expect(redeem).toHaveBeenCalledWith({
      subject: 'user_123',
      verifiedEmail: 'grace@example.com',
      displayName: 'Grace Hopper',
      tokenHash: hashJoinToken('join-token'),
    });
  });
});
