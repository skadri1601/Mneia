import 'server-only';

import { type AccountContext, AccountError, type AccountStore } from './store/account-store.js';

export type { AccountErrorCode } from './store/account-store.js';
export { AccountError };

export interface BootstrapSoloAccountRequest {
  readonly subject: string | null;
  readonly displayName: string;
  readonly store: AccountStore;
}

export const bootstrapSoloAccount = async ({
  subject,
  displayName,
  store,
}: BootstrapSoloAccountRequest): Promise<AccountContext> => {
  if (subject === null || subject.trim().length === 0) {
    throw new AccountError('unauthenticated', 'A verified identity is required');
  }

  if (displayName.trim().length === 0) {
    throw new AccountError('invalid_profile', 'A profile display name is required');
  }

  return store.bootstrapSoloAccount({ subject, displayName });
};
