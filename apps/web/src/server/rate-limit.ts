export type RateLimitBucket = 'requests';

/**
 * Kept as a type even with one member: the checkpoint path is metered by the three dials
 * in quota.ts now, not here, and `cost` still marks which requests the limiter sees.
 */
export type RequestCost = 'read';

export interface RateLimitConfig {
  readonly requestsPerMinute: number;
  readonly maxRequestBytes: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  requestsPerMinute: 120,
  maxRequestBytes: 1_048_576,
};

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3_600;
const DAY_SECONDS = 86_400;

export const RATE_LIMIT_RETENTION_SECONDS = DAY_SECONDS * 2;

const readPositiveInteger = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `expected a positive integer; received "${raw}" — set it to a whole number of 1 or greater, or unset it to use the default of ${fallback}`,
    );
  }
  return parsed;
};

export const readRateLimitConfig = (
  env: Readonly<Record<string, string | undefined>>,
): RateLimitConfig => ({
  requestsPerMinute: readPositiveInteger(
    env.MNEIA_RATE_LIMIT_REQUESTS_PER_MINUTE,
    DEFAULT_RATE_LIMIT_CONFIG.requestsPerMinute,
  ),
  maxRequestBytes: readPositiveInteger(
    env.MNEIA_MAX_REQUEST_BYTES,
    DEFAULT_RATE_LIMIT_CONFIG.maxRequestBytes,
  ),
});

export interface RateLimitWindow {
  readonly bucket: RateLimitBucket;
  readonly subject: string;
  readonly windowStart: Date;
  readonly windowSeconds: number;
  readonly limit: number;
}

export const windowStartFor = (now: Date, windowSeconds: number): Date =>
  new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);

export interface WindowsForInput {
  readonly cost: RequestCost;
  readonly tokenId: string;
  readonly now: Date;
  readonly config: RateLimitConfig;
}

export const windowsFor = ({
  tokenId,
  now,
  config,
}: WindowsForInput): readonly RateLimitWindow[] => [
  {
    bucket: 'requests',
    subject: `token:${tokenId}`,
    windowStart: windowStartFor(now, MINUTE_SECONDS),
    windowSeconds: MINUTE_SECONDS,
    limit: config.requestsPerMinute,
  },
];

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly message: string;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0, message: '' };

const describeWindow = (windowSeconds: number): string => {
  if (windowSeconds === MINUTE_SECONDS) return 'a minute';
  if (windowSeconds === HOUR_SECONDS) return 'an hour';
  if (windowSeconds === DAY_SECONDS) return 'a day';
  return `${windowSeconds} seconds`;
};

const describeDuration = (seconds: number): string => {
  if (seconds < MINUTE_SECONDS) return `${seconds}s`;
  if (seconds < HOUR_SECONDS) return `${Math.ceil(seconds / MINUTE_SECONDS)}m`;
  return `${Math.ceil(seconds / HOUR_SECONDS)}h`;
};

const explain = (window: RateLimitWindow, observed: number, retryAfterSeconds: number): string =>
  `this token has made ${observed} requests in ${describeWindow(window.windowSeconds)}, and the limit is ${window.limit} — retry in ${describeDuration(retryAfterSeconds)}, or spread the calls out. Raise it with MNEIA_RATE_LIMIT_REQUESTS_PER_MINUTE.`;

export interface EvaluateRateLimitInput {
  readonly windows: readonly RateLimitWindow[];
  readonly counts: ReadonlyMap<RateLimitBucket, number>;
  readonly now: Date;
}

export const evaluateRateLimit = ({
  windows,
  counts,
  now,
}: EvaluateRateLimitInput): RateLimitDecision => {
  for (const window of windows) {
    const observed = counts.get(window.bucket);
    if (observed === undefined || observed <= window.limit) {
      continue;
    }

    const endsAt = window.windowStart.getTime() + window.windowSeconds * 1000;
    const retryAfterSeconds = Math.max(1, Math.ceil((endsAt - now.getTime()) / 1000));

    return {
      allowed: false,
      retryAfterSeconds,
      message: explain(window, observed, retryAfterSeconds),
    };
  }

  return ALLOWED;
};
