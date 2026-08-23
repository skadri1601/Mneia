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
  /**
   * `debitMicros` is an **authorization**, not the amount to charge.
   *
   * It is the pre-flight estimate, priced from the prompt size and ASSUMED_OUTPUT_TOKENS,
   * which is deliberately generous. The real cost is only known once the provider reports
   * its token counts, so whoever applies the debit must reconcile against `costMicrosFor`
   * rather than settling this figure. Debiting this number verbatim over-charges every
   * checkpoint whose completion came in under the assumption, which is most of them.
   */
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

/** What every dial is worth to this workspace, after overrides and seat pooling. */
export interface EffectiveAllowances {
  readonly turns: number | null;
  readonly extractions: number | null;
  readonly embeddingTokens: number | null;
}

/**
 * The allowances `checkpointQuota` will decide against, exported so the billing page can
 * show the same numbers the enforcer uses. Deriving them a second time in the UI is how a
 * page ends up telling a customer they have headroom the API is refusing.
 */
export const effectiveAllowances = (state: QuotaState): EffectiveAllowances => {
  const limits = planLimits(state.plan);
  return {
    turns: allowanceFor(state, state.turnAllowance, limits.turns),
    extractions: allowanceFor(state, state.extractionAllowance, limits.extractions),
    embeddingTokens: allowanceFor(state, state.embeddingTokenAllowance, limits.embeddingTokens),
  };
};

const resetsAt = (state: QuotaState): string => state.period.end.toISOString();

/**
 * The one thing this workspace can actually do about a spent allowance, today.
 *
 * These sentences name controls that exist. The earlier text said "add a balance from the
 * billing page", and nothing in the product credits `wallet_balance_micros` — there is no
 * top-up flow, no `credit` row is ever written, and the page has no such control. A
 * refusal that sends a customer to a button that is not there is not actionable, so the
 * remedy is derived from the plan and stops at what is buyable.
 */
const remedyFor = (plan: WorkspacePlan): string => {
  switch (plan) {
    case 'solo':
      // Free, and the only self-serve purchase in the app is Team checkout, which needs a
      // second accepted member. A one-person workspace has nothing to buy, so say that
      // rather than implying it does.
      return 'the solo plan is free and its ceiling is fixed, so the only way to raise it is Team billing on the billing page, which needs a second accepted member in this workspace';
    case 'pro':
      return 'move this workspace to Team from the billing page, whose allowance is per seat and pooled';
    case 'team':
      // Team allowances are per seat and pooled, so a seat is literally more headroom.
      return 'add seats from the billing page — the Team allowance is per seat and pooled across the workspace';
    default:
      // enterprise is unmetered by construction, so this is unreachable via the dials and
      // exists only so a new plan cannot silently fall through with no remedy at all.
      return 'ask the workspace lead to raise this workspace’s allowance';
  }
};

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

  const { turns, extractions, embeddingTokens } = effectiveAllowances(state);

  // Checked against what this request will actually consume, not just what is already
  // spent, so a single oversized upload cannot step over the ceiling in one move.
  //
  // embedding_tokens deliberately does not add the request's share, unlike the two dials
  // above. A QuotaRequest carries no embedding estimate — embeddings are produced after
  // the checkpoint is written, not by this call — so there is nothing to add, and this
  // dial only notices a workspace that is already past its ceiling. That is consistent
  // with it being the slack dial (limits.ts): it exists to make the spend visible and to
  // stop a runaway, not to bind at the same point as the other two.
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

  const spent = `this workspace has used ${exhausted.used.toLocaleString()} of its ${exhausted.allowed.toLocaleString()} ${exhausted.dial.replace('_', ' ')} for the period`;

  if (state.walletBalanceMicros > 0) {
    return refuse(
      'wallet_empty',
      `${spent}, and its ${dollars(state.walletBalanceMicros)} balance does not cover the ${dollars(request.estimatedCostMicros)} this checkpoint would cost; ${remedyFor(state.plan)}, or wait for the allowance to reset at ${resetsAt(state)}`,
      exhausted.dial,
    );
  }

  return refuse(
    'allowance_exhausted',
    `${spent}; ${remedyFor(state.plan)}, or wait for the allowance to reset at ${resetsAt(state)}`,
    exhausted.dial,
  );
};
