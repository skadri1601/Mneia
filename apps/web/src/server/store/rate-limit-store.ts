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
}
