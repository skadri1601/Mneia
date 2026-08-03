import 'server-only';

export type AdmissionErrorCode =
  | 'invalid_signup_id'
  | 'signup_not_found'
  | 'already_decided'
  | 'corrupt_signup'
  | 'rollback_failed'
  | 'session_cleanup_failed';

export class AdmissionError extends Error {
  readonly code: AdmissionErrorCode;

  constructor(code: AdmissionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AdmissionError';
    this.code = code;
  }
}

export interface PendingSignup {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
}

export interface ApprovedSignup {
  readonly id: string;
  readonly email: string;
  readonly unsubscribeToken: string;
}

export interface ApproveSignupInput {
  readonly signupId: string;
  readonly approvedBy: string;
}

export interface ClaimSendInput {
  readonly signupId: string;
  readonly campaign: string;
}

export interface SettleSendInput {
  readonly claimId: string;
  readonly providerId: string | null;
  readonly delivered: boolean;
}

export interface AdmissionStore {
  listPending(limit: number): Promise<readonly PendingSignup[]>;
  approve(input: ApproveSignupInput): Promise<ApprovedSignup>;
  recordInvitation(signupId: string, invitationRef: string): Promise<void>;
  claimSend(input: ClaimSendInput): Promise<string | null>;
  settleSend(input: SettleSendInput): Promise<void>;
}
