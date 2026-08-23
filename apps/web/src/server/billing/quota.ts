import 'server-only';

import type { BillingStatus, WorkspacePlan } from '@mneia/core';
import { isPaidPlan, isSeatedPlan, planLimits } from './limits.js';

export type QuotaRefusal =
  | 'allowance_exhausted'
  | 'seats_exceeded'
  | 'subscription_inactive'
  | 'wallet_empty';

/** Which dial ran out, so the message can name it and the caller can meter the right one. */
export type QuotaDial = 'turns' | 'extractions' | 'embedding_tokens';

export interface QuotaPeriod {
  readonly start: Date;
  readonly end: Date;
}

export interface QuotaState {
  readonly plan: WorkspacePlan;
  readonly billingStatus: BillingStatus;
  readonly seatsPurchased: number | null;
  readonly memberCount: number;
  /**
   * Per-workspace overrides. Non-null wins over the plan default, which is how a promo
   * grant, a design partner, or a negotiated Team lands without inventing a new plan.
   */
  readonly turnAllowance: number | null;
  readonly extractionAllowance: number | null;
  readonly embeddingTokenAllowance: number | null;
  readonly turnsUsed: number;
  readonly extractionsUsed: number;
  readonly embeddingTokensUsed: number;
  /** Prepaid balance, in millionths of a dollar. Spent only once an allowance is gone. */
  readonly walletBalanceMicros: number;
  readonly period: QuotaPeriod;
}

/** What the caller is about to spend, so the decision is made before the money is. */
export interface QuotaRequest {
  readonly turns: number;
  readonly estimatedCostMicros: number;
}

export type QuotaDecision =
  | { readonly allowed: true; readonly source: 'allowance' }
  | { readonly allowed: true; readonly source: 'wallet'; readonly debitMicros: number }
  | {
      readonly allowed: false;
      readonly code: QuotaRefusal;
      readonly dial?: QuotaDial;
      readonly message: string;
    };

const ENTITLED_STATUSES: readonly BillingStatus[] = ['active', 'trialing', 'past_due'];

export const monthPeriod = (now: Date): QuotaPeriod => ({
  start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
});

const refuse = (code: QuotaRefusal, message: string, dial?: QuotaDial): QuotaDecision =>
  dial === undefined ? { allowed: false, code, message } : { allowed: false, code, dial, message };

/**
 * The allowance for one dial, after per-workspace overrides and seat pooling.
 *
 * Returns null for unmetered. Team allowances are per seat and pooled, so the workspace
 * total is the per-seat figure times the seats actually paid for - one heavy user draws on
 * a quiet colleague's share instead of being refused while the team has headroom.
 */
const allowanceFor = (
  state: QuotaState,
  override: number | null,
  perSeat: number | null,
): number | null => {
  const base = override ?? perSeat;
  if (base === null) {
    return null;
  }
  if (!isSeatedPlan(state.plan)) {
    return base;
  }
  // A seated plan with no purchased seats is not entitled to a pooled allowance; the
  // subscription check above refuses it first, and this keeps the arithmetic honest.
  return base * Math.max(state.seatsPurchased ?? 0, 0);
};

const resetsAt = (state: QuotaState): string => state.period.end.toISOString();

export const checkpointQuota = (state: QuotaState, request: QuotaRequest): QuotaDecision => {
  // Every paid plan needs a live subscription, not just Team. Gating on Team alone let a
  // cancelled Pro workspace keep its full allowance indefinitely.
  if (isPaidPlan(state.plan) && !ENTITLED_STATUSES.includes(state.billingStatus)) {
    return refuse(
      'subscription_inactive',
      `this workspace is on the ${state.plan} plan but its subscription is "${state.billingStatus}"; expected one of ${ENTITLED_STATUSES.join(', ')} — update the payment method from the billing page to checkpoint again`,
    );
  }

  if (isSeatedPlan(state.plan)) {
    const seats = state.seatsPurchased ?? 0;
    if (seats < state.memberCount) {
      return refuse(
        'seats_exceeded',
        `this workspace has ${state.memberCount} members but ${seats} purchased seat${seats === 1 ? '' : 's'}; add seats from the billing page, or remove members, before checkpointing again`,
      );
    }
  }

  const limits = planLimits(state.plan);
  const turns = allowanceFor(state, state.turnAllowance, limits.turns);
  const extractions = allowanceFor(state, state.extractionAllowance, limits.extractions);
  const embeddingTokens = allowanceFor(
    state,
    state.embeddingTokenAllowance,
    limits.embeddingTokens,
  );

  // Checked against what this request will actually consume, not just what is already
  // spent, so a single oversized upload cannot step over the ceiling in one move.
  const exhausted: { dial: QuotaDial; used: number; allowed: number } | null =
    turns !== null && state.turnsUsed + request.turns > turns
      ? { dial: 'turns', used: state.turnsUsed, allowed: turns }
      : extractions !== null && state.extractionsUsed + 1 > extractions
        ? { dial: 'extractions', used: state.extractionsUsed, allowed: extractions }
        : embeddingTokens !== null && state.embeddingTokensUsed > embeddingTokens
          ? { dial: 'embedding_tokens', used: state.embeddingTokensUsed, allowed: embeddingTokens }
          : null;

  if (exhausted === null) {
    return { allowed: true, source: 'allowance' };
  }

  // Allowance then overage, as docs/BUSINESS.md has always said. Work does not stop while
  // there is prepaid balance to draw on; only an empty wallet refuses.
  if (state.walletBalanceMicros >= request.estimatedCostMicros) {
    return { allowed: true, source: 'wallet', debitMicros: request.estimatedCostMicros };
  }

  const dollars = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

  if (state.walletBalanceMicros > 0) {
    return refuse(
      'wallet_empty',
      `this workspace has used ${exhausted.used.toLocaleString()} of its ${exhausted.allowed.toLocaleString()} ${exhausted.dial.replace('_', ' ')} for the period, and its ${dollars(state.walletBalanceMicros)} balance does not cover the ${dollars(request.estimatedCostMicros)} this checkpoint would cost; top up from the billing page, or wait for the allowance to reset at ${resetsAt(state)}`,
      exhausted.dial,
    );
  }

  return refuse(
    'allowance_exhausted',
    `this workspace has used ${exhausted.used.toLocaleString()} of its ${exhausted.allowed.toLocaleString()} ${exhausted.dial.replace('_', ' ')} for the period; add a balance from the billing page to keep checkpointing, or wait for the allowance to reset at ${resetsAt(state)}`,
    exhausted.dial,
  );
};
