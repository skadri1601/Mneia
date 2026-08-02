import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), currentUser: vi.fn() }));

import {
  type CurrentAccountDependencies,
  createCurrentAccountResolver,
  resolveCurrentAccount,
} from './current-account.js';
import type { AccountContext, AccountStore } from './store/account-store.js';

const ACCOUNT_CONTEXT = {
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
} satisfies AccountContext;

const harness = () => {
  const authenticate = vi.fn<CurrentAccountDependencies['authenticate']>();
  const loadCurrentUser = vi.fn<CurrentAccountDependencies['loadCurrentUser']>();
  const bootstrapSoloAccount = vi
    .fn<AccountStore['bootstrapSoloAccount']>()
    .mockResolvedValue(ACCOUNT_CONTEXT);
  const store = { bootstrapSoloAccount } satisfies AccountStore;

  return {
    dependencies: { authenticate, loadCurrentUser, store } satisfies CurrentAccountDependencies,
    authenticate,
    loadCurrentUser,
    bootstrapSoloAccount,
  };
};

describe('resolveCurrentAccount', () => {
  it('rejects a signed-out request without loading a Clerk profile', async () => {
    const { dependencies, authenticate, loadCurrentUser, bootstrapSoloAccount } = harness();
    authenticate.mockResolvedValue({ userId: null });

    await expect(resolveCurrentAccount(dependencies)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(loadCurrentUser).not.toHaveBeenCalled();
    expect(bootstrapSoloAccount).not.toHaveBeenCalled();
  });

  it.each([
    {
      profile: {
        fullName: 'Ada Lovelace',
        primaryEmailAddress: { emailAddress: 'ada@example.com' },
      },
      expected: 'Ada Lovelace',
    },
    {
      profile: { fullName: null, primaryEmailAddress: { emailAddress: 'ada@example.com' } },
      expected: 'ada@example.com',
    },
    {
      profile: { fullName: '   ', primaryEmailAddress: { emailAddress: '   ' } },
      expected: 'user_123',
    },
    { profile: null, expected: 'user_123' },
  ])(
    'uses the deterministic Clerk display-name fallback to $expected',
    async ({ profile, expected }) => {
      const { dependencies, authenticate, loadCurrentUser, bootstrapSoloAccount } = harness();
      authenticate.mockResolvedValue({ userId: 'user_123' });
      loadCurrentUser.mockResolvedValue(profile);

      await expect(resolveCurrentAccount(dependencies)).resolves.toBe(ACCOUNT_CONTEXT);
      expect(bootstrapSoloAccount).toHaveBeenCalledWith({
        subject: 'user_123',
        displayName: expected,
      });
    },
  );
});

describe('createCurrentAccountResolver', () => {
  it('deduplicates account bootstrap through the supplied request cache', async () => {
    const { dependencies, authenticate, loadCurrentUser, bootstrapSoloAccount } = harness();
    authenticate.mockResolvedValue({ userId: 'user_123' });
    loadCurrentUser.mockResolvedValue({ fullName: 'Ada Lovelace', primaryEmailAddress: null });
    const requestCache = <T>(resolve: () => Promise<T>): (() => Promise<T>) => {
      let result: Promise<T> | undefined;
      return () => {
        result ??= resolve();
        return result;
      };
    };
    const resolver = createCurrentAccountResolver(dependencies, requestCache);

    await expect(Promise.all([resolver(), resolver()])).resolves.toEqual([
      ACCOUNT_CONTEXT,
      ACCOUNT_CONTEXT,
    ]);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(loadCurrentUser).toHaveBeenCalledOnce();
    expect(bootstrapSoloAccount).toHaveBeenCalledOnce();
  });
});
