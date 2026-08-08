import 'server-only';

import { auth, currentUser } from '@clerk/nextjs/server';
import { cache } from 'react';
import { bootstrapSoloAccount, redeemInvitation } from './account.js';
import { database } from './database.js';
import { AccountError } from './store/account-store.js';
import type { AccountContext, AccountStore } from './store/account-store.js';
import { PostgresAccountStore } from './store/postgres-account-store.js';
import { readSelectedWorkspace } from './workspace-selection.js';

export interface ClerkAuthentication {
  readonly userId: string | null;
}

export interface ClerkEmailAddress {
  readonly emailAddress: string;
  readonly verified: boolean;
}

export interface ClerkProfile {
  readonly fullName: string | null;
  readonly primaryEmailAddress: ClerkEmailAddress | null;
}

export interface CurrentAccountDependencies {
  readonly authenticate: () => Promise<ClerkAuthentication>;
  readonly loadCurrentUser: () => Promise<ClerkProfile | null>;
  readonly store: AccountStore;
  readonly readSelectedWorkspace?: (() => Promise<string | null>) | undefined;
}

export type CurrentAccountResolver = () => Promise<AccountContext>;
export type AccountRequestCache = (resolve: CurrentAccountResolver) => CurrentAccountResolver;

const nonBlank = (value: string | null | undefined): string | null => {
  const candidate = value?.trim();
  return candidate === undefined || candidate.length === 0 ? null : candidate;
};

export const verifiedEmailOf = (profile: ClerkProfile | null): string | null => {
  const primary = profile?.primaryEmailAddress;
  if (primary === null || primary === undefined || !primary.verified) return null;
  return nonBlank(primary.emailAddress);
};

export const resolveCurrentAccount = async (
  dependencies: CurrentAccountDependencies,
): Promise<AccountContext> => {
  const { userId } = await dependencies.authenticate();
  if (userId === null) {
    return bootstrapSoloAccount({ subject: null, displayName: '', store: dependencies.store });
  }

  const profile = await dependencies.loadCurrentUser();
  const verifiedEmail = verifiedEmailOf(profile);
  const displayName = nonBlank(profile?.fullName) ?? verifiedEmail ?? userId;

  const joined = await redeemInvitation({
    subject: userId,
    verifiedEmail,
    displayName,
    store: dependencies.store,
  });
  if (joined !== null) {
    return joined;
  }

  if (verifiedEmail === null) {
    throw new AccountError(
      'email_unverified',
      'expected the signed-in user to have a verified primary email address before a workspace is provisioned; found none — ' +
        'the MNE-173 daily inference ceiling is keyed on the workspace, so provisioning one per unverified signup would let ' +
        'account cycling reset it. Verify the address and reload.',
    );
  }

  const preferredWorkspaceId = (await dependencies.readSelectedWorkspace?.()) ?? null;

  return bootstrapSoloAccount({
    subject: userId,
    displayName,
    preferredWorkspaceId,
    store: dependencies.store,
  });
};

export const createCurrentAccountResolver = (
  dependencies: CurrentAccountDependencies,
  requestCache: AccountRequestCache = (resolve) => cache(resolve),
): CurrentAccountResolver => requestCache(() => resolveCurrentAccount(dependencies));

const accountStore = new PostgresAccountStore(database);

export const currentAccountDependencies: CurrentAccountDependencies = {
  authenticate: async () => {
    const { userId } = await auth();
    return { userId };
  },
  loadCurrentUser: async () => {
    const user = await currentUser();
    if (user === null) return null;
    return {
      fullName: user.fullName,
      primaryEmailAddress:
        user.primaryEmailAddress === null || user.primaryEmailAddress === undefined
          ? null
          : {
              emailAddress: user.primaryEmailAddress.emailAddress,
              verified: user.primaryEmailAddress.verification?.status === 'verified',
            },
    };
  },
  store: accountStore,
  readSelectedWorkspace,
};

export const getCurrentAccount = createCurrentAccountResolver(currentAccountDependencies);

export { accountStore };
