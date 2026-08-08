import 'server-only';

import type { Actor, Team, TeamMember, Workspace, WorkspaceRole } from '@mneia/core';

export type AccountErrorCode =
  | 'unauthenticated'
  | 'invalid_profile'
  | 'invalid_email'
  | 'invalid_role'
  | 'not_permitted'
  | 'invitation_not_found'
  | 'already_in_a_workspace'
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

export interface WorkspaceChoice {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
}

export interface AccountContext {
  readonly workspace: Workspace;
  readonly actor: Actor;
  readonly team: Team;
  readonly membership: TeamMember;
  readonly workspaces: readonly WorkspaceChoice[];
}

export interface WorkspaceInvitation {
  readonly id: string;
  readonly workspaceId: string;
  readonly teamId: string;
  readonly invitedEmail: string;
  readonly role: WorkspaceRole;
  readonly invitedBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface BootstrapSoloAccountInput {
  readonly subject: string;
  readonly displayName: string;
  readonly preferredWorkspaceId?: string | null;
}

export interface InviteToWorkspaceInput {
  readonly workspaceId: string;
  readonly teamId: string;
  readonly invitedByActorId: string;
  readonly invitedEmail: string;
  readonly role: WorkspaceRole;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface ListPendingInvitationsInput {
  readonly workspaceId: string;
}

export interface RevokeInvitationInput {
  readonly workspaceId: string;
  readonly invitationId: string;
}

export interface RedeemInvitationInput {
  readonly subject: string;
  readonly verifiedEmail: string;
  readonly displayName: string;
  readonly tokenHash?: string | undefined;
}

export interface AccountStore {
  bootstrapSoloAccount(input: BootstrapSoloAccountInput): Promise<AccountContext>;
  inviteToWorkspace(input: InviteToWorkspaceInput): Promise<WorkspaceInvitation>;
  listPendingInvitations(
    input: ListPendingInvitationsInput,
  ): Promise<readonly WorkspaceInvitation[]>;
  revokeInvitation(input: RevokeInvitationInput): Promise<WorkspaceInvitation>;
  redeemInvitation(input: RedeemInvitationInput): Promise<AccountContext | null>;
}
