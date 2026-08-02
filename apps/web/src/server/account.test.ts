import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { AccountError, bootstrapSoloAccount } from './account.js';
import type { AccountContext, AccountStore } from './store/account-store.js';

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
};

const accountStore = () => {
  const bootstrapSoloAccount = vi.fn<AccountStore['bootstrapSoloAccount']>();

  return {
    store: { bootstrapSoloAccount } satisfies AccountStore,
    bootstrapSoloAccount,
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
    });
  });
});
