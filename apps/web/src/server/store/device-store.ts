import type { DeviceAuthorizationStatus } from '@mneia/core';

export type DeviceErrorCode =
  | 'unknown_user_code'
  | 'already_decided'
  | 'confirmation_mismatch'
  | 'too_many_attempts'
  | 'unknown_device_code'
  | 'authorization_pending'
  | 'authorization_denied'
  | 'authorization_expired'
  | 'already_redeemed'
  | 'unknown_token'
  | 'rollback_failed'
  | 'session_cleanup_failed'
  | 'corrupt_device_state';

export class DeviceError extends Error {
  constructor(
    readonly code: DeviceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DeviceError';
  }
}

export interface StartDeviceAuthorizationInput {
  readonly deviceCodeHash: string;
  readonly userCode: string;
  readonly confirmationCode: string;
  readonly clientLabel: string;
  readonly lifetimeSeconds: number;
}

export interface PendingAuthorization {
  readonly userCode: string;
  readonly confirmationCode: string;
  readonly clientLabel: string;
  readonly expiresAt: Date;
}

export interface DecideAuthorizationInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly userCode: string;
  readonly confirmationCode: string;
  readonly approve: boolean;
}

export interface RedeemAuthorizationInput {
  readonly deviceCodeHash: string;
  readonly tokenHash: string;
  readonly label: string;
}

export interface RedeemedToken {
  readonly workspaceId: string;
  readonly actorId: string;
}

export interface PollResult {
  readonly status: DeviceAuthorizationStatus;
  readonly workspaceId: string | null;
}

export interface BearerIdentity {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly tokenId: string;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  readonly actorName: string;
  readonly actorKind: string;
  readonly teamId: string;
  readonly teamName: string;
}

export interface DeviceStore {
  start(input: StartDeviceAuthorizationInput): Promise<void>;
  findPendingByUserCode(userCode: string): Promise<PendingAuthorization | null>;
  decide(input: DecideAuthorizationInput): Promise<void>;
  poll(deviceCodeHash: string): Promise<PollResult>;
  redeem(input: RedeemAuthorizationInput): Promise<RedeemedToken>;
  identify(tokenHash: string): Promise<BearerIdentity>;
}
