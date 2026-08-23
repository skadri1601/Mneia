import 'server-only';

import type { RateLimitBucket, RateLimitWindow } from '../rate-limit.js';

export type RateLimitErrorCode = 'corrupt_counter' | 'rollback_failed' | 'session_cleanup_failed';

export class RateLimitError extends Error {
  readonly code: RateLimitErrorCode;

  constructor(code: RateLimitErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RateLimitError';
    this.code = code;
  }
}

export interface BumpCountersInput {
  readonly workspaceId: string;
  readonly windows: readonly RateLimitWindow[];
  readonly discardBefore: Date;
}

export interface RateLimitStore {
  bump(input: BumpCountersInput): Promise<ReadonlyMap<RateLimitBucket, number>>;
  /**
   * Undo a bump whose request was then refused.
   *
   * The counter is meant to count requests we served. bump() has to increment before the
   * decision, because the decision needs the resulting count, so a refusal has already
   * been counted by the time we know to refuse it - which is how a refused request used
   * to push the next one further over the limit. Only the refusal path pays this second
   * round trip, so the served path still costs one.
   */
  release(input: BumpCountersInput): Promise<void>;
}
