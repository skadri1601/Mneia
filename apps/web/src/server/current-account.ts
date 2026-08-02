import 'server-only';

import { auth, currentUser } from '@clerk/nextjs/server';
import { cache } from 'react';
import { bootstrapSoloAccount } from './account.js';
import { database } from './database.js';
import type { AccountContext, AccountStore } from './store/account-store.js';
import { PostgresAccountStore } from './store/postgres-account-store.js';

export interface ClerkAuthentication {
  readonly userId: string | null;
}

export interface ClerkProfile {
  readonly fullName: string | null;
  readonly primaryEmailAddress: { readonly emailAddress: string } | null;
}

export interface CurrentAccountDependencies {
  readonly authenticate: () => Promise<ClerkAuthentication>;
  readonly loadCurrentUser: () => Promise<ClerkProfile | null>;
  readonly store: AccountStore;
}

export type CurrentAccountResolver = () => Promise<AccountContext>;
export type AccountRequestCache = (resolve: CurrentAccountResolver) => CurrentAccountResolver;

const nonBlank = (value: string | null | undefined): string | null => {
  const candidate = value?.trim();
  return candidate === undefined || candidate.length === 0 ? null : candidate;
};

export const resolveCurrentAccount = async (
  dependencies: CurrentAccountDependencies,
): Promise<AccountContext> => {
  const { userId } = await dependencies.authenticate();
  if (userId === null) {
    return bootstrapSoloAccount({ subject: null, displayName: '', store: dependencies.store });
  }

  const profile = await dependencies.loadCurrentUser();
  const displayName =
    nonBlank(profile?.fullName) ?? nonBlank(profile?.primaryEmailAddress?.emailAddress) ?? userId;

  return bootstrapSoloAccount({ subject: userId, displayName, store: dependencies.store });
};

export const createCurrentAccountResolver = (
  dependencies: CurrentAccountDependencies,
  requestCache: AccountRequestCache = (resolve) => cache(resolve),
): CurrentAccountResolver => requestCache(() => resolveCurrentAccount(dependencies));

const accountStore = new PostgresAccountStore(database);

export const getCurrentAccount = createCurrentAccountResolver({
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
        user.primaryEmailAddress === null
          ? null
          : { emailAddress: user.primaryEmailAddress.emailAddress },
    };
  },
  store: accountStore,
});
