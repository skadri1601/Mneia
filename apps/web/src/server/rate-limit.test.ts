import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  evaluateRateLimit,
  type RateLimitBucket,
  readRateLimitConfig,
  windowStartFor,
  windowsFor,
} from './rate-limit.js';

const TOKEN = '9f1c2b3a-0000-4000-8000-000000000001';
const WORKSPACE = '9f1c2b3a-0000-4000-8000-000000000002';
const NOW = new Date('2026-08-07T13:37:42.500Z');

const counts = (entries: Readonly<Record<string, number>>): ReadonlyMap<RateLimitBucket, number> =>
  new Map(Object.entries(entries) as [RateLimitBucket, number][]);

describe('windowStartFor', () => {
  it('floors to the start of the window so a window is shared by every caller in it', () => {
    expect(windowStartFor(NOW, 60).toISOString()).toBe('2026-08-07T13:37:00.000Z');
    expect(windowStartFor(NOW, 3_600).toISOString()).toBe('2026-08-07T13:00:00.000Z');
    expect(windowStartFor(NOW, 86_400).toISOString()).toBe('2026-08-07T00:00:00.000Z');
  });
});

describe('windowsFor', () => {
  it('charges a read against the per-token request budget only', () => {
    const windows = windowsFor({
      cost: 'read',
      tokenId: TOKEN,
      workspaceId: WORKSPACE,
      now: NOW,
      config: DEFAULT_RATE_LIMIT_CONFIG,
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]?.bucket).toBe('requests');
    expect(windows[0]?.subject).toBe(`token:${TOKEN}`);
  });

  it('charges a checkpoint against the request, hourly, and workspace-daily budgets', () => {
    const windows = windowsFor({
      cost: 'checkpoint',
      tokenId: TOKEN,
      workspaceId: WORKSPACE,
      now: NOW,
      config: DEFAULT_RATE_LIMIT_CONFIG,
    });

    expect(windows.map((window) => window.bucket)).toEqual([
      'requests',
      'checkpoints_hourly',
      'checkpoints_daily',
    ]);
  });

  it('keys the daily ceiling on the workspace, not the token, so cycling tokens does not reset it', () => {
    const windows = windowsFor({
      cost: 'checkpoint',
      tokenId: TOKEN,
      workspaceId: WORKSPACE,
      now: NOW,
      config: DEFAULT_RATE_LIMIT_CONFIG,
    });

    const daily = windows.find((window) => window.bucket === 'checkpoints_daily');
    expect(daily?.subject).toBe(`workspace:${WORKSPACE}`);
  });
});

describe('evaluateRateLimit', () => {
  const windows = windowsFor({
    cost: 'checkpoint',
    tokenId: TOKEN,
    workspaceId: WORKSPACE,
    now: NOW,
    config: DEFAULT_RATE_LIMIT_CONFIG,
  });

  it('allows a request that lands exactly on the limit', () => {
    const decision = evaluateRateLimit({
      windows,
      counts: counts({
        requests: DEFAULT_RATE_LIMIT_CONFIG.requestsPerMinute,
        checkpoints_hourly: DEFAULT_RATE_LIMIT_CONFIG.checkpointsPerHour,
        checkpoints_daily: DEFAULT_RATE_LIMIT_CONFIG.checkpointsPerDay,
      }),
      now: NOW,
    });

    expect(decision.allowed).toBe(true);
  });

  it('refuses the first request past the limit', () => {
    const decision = evaluateRateLimit({
      windows,
      counts: counts({ requests: 121, checkpoints_hourly: 1, checkpoints_daily: 1 }),
      now: NOW,
    });

    expect(decision.allowed).toBe(false);
  });

  it('reports how long to wait, rounded up to the end of the window', () => {
    const decision = evaluateRateLimit({
      windows,
      counts: counts({ requests: 999, checkpoints_hourly: 1, checkpoints_daily: 1 }),
      now: NOW,
    });

    expect(decision.retryAfterSeconds).toBe(18);
  });

  it('never reports a retry-after of zero, which a client would busy-loop on', () => {
    const decision = evaluateRateLimit({
      windows,
      counts: counts({ requests: 999, checkpoints_hourly: 1, checkpoints_daily: 1 }),
      now: new Date('2026-08-07T13:37:59.999Z'),
    });

    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('names the budget, the observed count, and how to raise it', () => {
    const decision = evaluateRateLimit({
      windows,
      counts: counts({ requests: 1, checkpoints_hourly: 61, checkpoints_daily: 1 }),
      now: NOW,
    });

    expect(decision.message).toContain('61 checkpoints');
    expect(decision.message).toContain('the limit is 60');
    expect(decision.message).toContain('MNEIA_RATE_LIMIT_CHECKPOINTS_PER_HOUR');
  });

  it('says the daily ceiling is a ceiling rather than a throttle', () => {
    const decision = evaluateRateLimit({
      windows,
      counts: counts({ requests: 1, checkpoints_hourly: 1, checkpoints_daily: 501 }),
      now: NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain('hard per-account ceiling');
    expect(decision.message).toContain('no checkpoint is lost');
  });

  it('reports the tightest breached budget first, so the message names the real cause', () => {
    const decision = evaluateRateLimit({
      windows,
      counts: counts({ requests: 121, checkpoints_hourly: 61, checkpoints_daily: 501 }),
      now: NOW,
    });

    expect(decision.message).toContain('requests');
  });

  it('allows when a bucket has no observed count', () => {
    const decision = evaluateRateLimit({ windows, counts: counts({}), now: NOW });

    expect(decision.allowed).toBe(true);
  });
});

describe('readRateLimitConfig', () => {
  it('falls back to the documented defaults when nothing is set', () => {
    expect(readRateLimitConfig({})).toEqual(DEFAULT_RATE_LIMIT_CONFIG);
  });

  it('reads each budget from its own variable', () => {
    const config = readRateLimitConfig({
      MNEIA_RATE_LIMIT_REQUESTS_PER_MINUTE: '10',
      MNEIA_RATE_LIMIT_CHECKPOINTS_PER_HOUR: '5',
      MNEIA_RATE_LIMIT_CHECKPOINTS_PER_DAY: '20',
      MNEIA_MAX_REQUEST_BYTES: '2048',
    });

    expect(config).toEqual({
      requestsPerMinute: 10,
      checkpointsPerHour: 5,
      checkpointsPerDay: 20,
      maxRequestBytes: 2048,
    });
  });

  it('refuses a limit that is not a positive integer rather than silently defaulting', () => {
    expect(() => readRateLimitConfig({ MNEIA_RATE_LIMIT_REQUESTS_PER_MINUTE: '0' })).toThrow(
      /positive integer/,
    );
    expect(() => readRateLimitConfig({ MNEIA_RATE_LIMIT_REQUESTS_PER_MINUTE: 'lots' })).toThrow(
      /received "lots"/,
    );
  });
});
