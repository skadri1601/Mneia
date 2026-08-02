import 'server-only';

import type { Actor, Team, TeamMember, Workspace } from '@mneia/core';

export type AccountErrorCode =
  | 'unauthenticated'
  | 'invalid_profile'
  | 'corrupt_account'
  | 'rollback_failed'
  | 'session_cleanup_failed';

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AccountError';
    this.code = code;
  }
}

export interface AccountContext {
  readonly workspace: Workspace;
  readonly actor: Actor;
  readonly team: Team;
  readonly membership: TeamMember;
}

export interface BootstrapSoloAccountInput {
  readonly subject: string;
  readonly displayName: string;
}

export interface AccountStore {
  bootstrapSoloAccount(input: BootstrapSoloAccountInput): Promise<AccountContext>;
}
