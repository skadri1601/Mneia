import 'server-only';

import type { BillingStatus, WorkspacePlan } from '@mneia/core';

export type QuotaRefusal = 'allowance_exhausted' | 'seats_exceeded' | 'subscription_inactive';

export interface QuotaPeriod {
  readonly start: Date;
  readonly end: Date;
}

export interface QuotaState {
  readonly plan: WorkspacePlan;
  readonly billingStatus: BillingStatus;
  readonly seatsPurchased: number | null;
  readonly memberCount: number;
  readonly checkpointAllowance: number | null;
  readonly checkpointsUsed: number;
  readonly period: QuotaPeriod;
}

export type QuotaDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: QuotaRefusal; readonly message: string };

const ENTITLED_STATUSES: readonly BillingStatus[] = ['active', 'trialing', 'past_due'];

export const monthPeriod = (now: Date): QuotaPeriod => ({
  start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
});

const refuse = (code: QuotaRefusal, message: string): QuotaDecision => ({
  allowed: false,
  code,
  message,
});

export const checkpointQuota = (state: QuotaState): QuotaDecision => {
  if (state.plan === 'team') {
    if (!ENTITLED_STATUSES.includes(state.billingStatus)) {
      return refuse(
        'subscription_inactive',
        `this workspace is on the Team plan but its subscription is "${state.billingStatus}"; expected one of ${ENTITLED_STATUSES.join(', ')} — update the payment method from the billing page to checkpoint again`,
      );
    }

    const seats = state.seatsPurchased ?? 0;
    if (seats < state.memberCount) {
      return refuse(
        'seats_exceeded',
        `this workspace has ${state.memberCount} members but ${seats} purchased seat${seats === 1 ? '' : 's'}; add seats from the billing page, or remove members, before checkpointing again`,
      );
    }
  }

  if (state.checkpointAllowance === null) {
    return { allowed: true };
  }

  if (state.checkpointsUsed >= state.checkpointAllowance) {
    return refuse(
      'allowance_exhausted',
      `this workspace has used ${state.checkpointsUsed} of its ${state.checkpointAllowance} checkpoints for the period; the allowance resets at ${state.period.end.toISOString()}`,
    );
  }

  return { allowed: true };
};
