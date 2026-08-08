import 'server-only';

import type { TeamMember, WorkspaceRole } from '@mneia/core';
import { createJoinToken, hashJoinToken } from './invitations.js';
import {
  type AccountContext,
  AccountError,
  type AccountStore,
  type WorkspaceInvitation,
} from './store/account-store.js';

export type { AccountErrorCode } from './store/account-store.js';
export { AccountError };

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_EMAIL_LENGTH = 320;

export interface BootstrapSoloAccountRequest {
  readonly subject: string | null;
  readonly displayName: string;
  readonly preferredWorkspaceId?: string | null;
  readonly store: AccountStore;
}

export const bootstrapSoloAccount = async ({
  subject,
  displayName,
  preferredWorkspaceId,
  store,
}: BootstrapSoloAccountRequest): Promise<AccountContext> => {
  if (subject === null || subject.trim().length === 0) {
    throw new AccountError('unauthenticated', 'A verified identity is required');
  }

  if (displayName.trim().length === 0) {
    throw new AccountError('invalid_profile', 'A profile display name is required');
  }

  return store.bootstrapSoloAccount({
    subject,
    displayName,
    preferredWorkspaceId: preferredWorkspaceId ?? null,
  });
};

export const normalizeEmail = (value: string): string => {
  const candidate = value.trim().toLowerCase();
  if (
    candidate.length === 0 ||
    candidate.length > MAX_EMAIL_LENGTH ||
    !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(candidate)
  ) {
    throw new AccountError(
      'invalid_email',
      `Expected an email address of up to ${MAX_EMAIL_LENGTH} characters; received "${value}"`,
    );
  }
  return candidate;
};

export const parseWorkspaceRole = (value: string): WorkspaceRole => {
  if (value === 'owner' || value === 'admin' || value === 'member') return value;
  throw new AccountError(
    'invalid_role',
    `Expected the role to be owner, admin or member; received "${value}"`,
  );
};

export const parseInvitableRole = (value: string): WorkspaceRole => {
  const role = parseWorkspaceRole(value);
  if (role === 'owner') {
    throw new AccountError(
      'not_permitted',
      'An invitation cannot grant the owner role; the owner is whoever created the workspace — invite an admin instead',
    );
  }
  return role;
};

export const assertMayAdministerInvitations = (membership: TeamMember): void => {
  if (membership.role !== 'lead') {
    throw new AccountError(
      'not_permitted',
      `Only a workspace lead may create or revoke invitations; this account is a ${membership.role} — ask a lead to send it`,
    );
  }
};

export interface InviteTeammateRequest {
  readonly workspaceId: string;
  readonly teamId: string;
  readonly invitedByActorId: string;
  readonly invitedByMembership: TeamMember;
  readonly email: string;
  readonly role: string;
  readonly store: AccountStore;
  readonly now?: () => Date;
  readonly issueToken?: () => string;
}

export interface IssuedInvitation {
  readonly invitation: WorkspaceInvitation;
  readonly token: string;
}

export const inviteTeammate = async ({
  workspaceId,
  teamId,
  invitedByActorId,
  invitedByMembership,
  email,
  role,
  store,
  now = () => new Date(),
  issueToken = createJoinToken,
}: InviteTeammateRequest): Promise<IssuedInvitation> => {
  assertMayAdministerInvitations(invitedByMembership);
  const grantedRole = parseInvitableRole(role);
  const invitedEmail = normalizeEmail(email);
  const token = issueToken();

  const invitation = await store.inviteToWorkspace({
    workspaceId,
    teamId,
    invitedByActorId,
    invitedEmail,
    role: grantedRole,
    tokenHash: hashJoinToken(token),
    expiresAt: new Date(now().getTime() + INVITATION_TTL_MS),
  });

  return { invitation, token };
};

export interface RedeemInvitationRequest {
  readonly subject: string | null;
  readonly verifiedEmail: string | null;
  readonly displayName: string;
  readonly token?: string | undefined;
  readonly store: AccountStore;
}

export const redeemInvitation = async ({
  subject,
  verifiedEmail,
  displayName,
  token,
  store,
}: RedeemInvitationRequest): Promise<AccountContext | null> => {
  if (subject === null || subject.trim().length === 0) {
    throw new AccountError('unauthenticated', 'A verified identity is required');
  }
  if (verifiedEmail === null) {
    return null;
  }
  if (displayName.trim().length === 0) {
    throw new AccountError('invalid_profile', 'A profile display name is required');
  }

  return store.redeemInvitation({
    subject,
    verifiedEmail: normalizeEmail(verifiedEmail),
    displayName,
    tokenHash: token === undefined ? undefined : hashJoinToken(token),
  });
};
