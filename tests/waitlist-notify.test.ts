import { describe, expect, it, vi } from 'vitest';
import {
  unsubscribePageUrl as libPageUrl,
  unsubscribePostUrl as libPostUrl,
} from '../apps/site/src/lib/waitlist.js';
import {
  campaignNames,
  findCampaign,
  missingVariables,
  renderCampaign,
  unsubscribePageUrl,
  unsubscribePostUrl,
} from '../scripts/waitlist-campaigns.mjs';
import {
  deliver,
  idempotencyKey,
  parseArgs,
  REJECTED,
  SENT,
  selectRecipientsSql,
  UNKNOWN,
  UsageError,
} from '../scripts/waitlist-notify.mjs';

const TOKEN = '3f1c2b9a-5d84-4c7e-9a11-2b6f8e0d4c73';
const ACCESS = { accessUrl: 'https://app.mneia.dev/sign-up' };

describe('campaign registry', () => {
  it('offers access-open and nothing the waitlist did not consent to', () => {
    expect(campaignNames()).toEqual(['access-open']);
  });

  it('returns undefined for an unknown campaign rather than an inherited property', () => {
    expect(findCampaign('toString')).toBeUndefined();
    expect(findCampaign('constructor')).toBeUndefined();
    expect(findCampaign('nope')).toBeUndefined();
  });

  it('names every required variable that was not supplied', () => {
    const campaign = findCampaign('access-open');
    expect(missingVariables(campaign, {})).toEqual(['accessUrl']);
    expect(missingVariables(campaign, { accessUrl: '   ' })).toEqual(['accessUrl']);
    expect(missingVariables(campaign, ACCESS)).toEqual([]);
  });

  it('refuses to render with a required variable missing', () => {
    const campaign = findCampaign('access-open');
    expect(() => renderCampaign(campaign, { unsubscribeToken: TOKEN })).toThrow(/accessUrl/);
  });
});

describe('rendering', () => {
  const rendered = () =>
    renderCampaign(findCampaign('access-open'), { unsubscribeToken: TOKEN, vars: ACCESS });

  it('carries both one-click unsubscribe headers', () => {
    const { headers } = rendered();
    expect(headers['List-Unsubscribe']).toBe(`<${unsubscribePostUrl(TOKEN)}>`);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('puts the human opt-out page, not the one-click endpoint, in the body', () => {
    const { text } = rendered();
    expect(text).toContain(unsubscribePageUrl(TOKEN));
    expect(text).not.toContain('/api/waitlist/unsubscribe');
  });

  it('substitutes the access URL and leaves no unresolved placeholder', () => {
    const { text } = rendered();
    expect(text).toContain(ACCESS.accessUrl);
    expect(text).not.toMatch(/\{\{?\w+\}?\}|undefined|\[TODO/);
  });

  it('builds the same unsubscribe URLs as the running site does', () => {
    expect(unsubscribePostUrl(TOKEN)).toBe(libPostUrl(TOKEN));
    expect(unsubscribePageUrl(TOKEN)).toBe(libPageUrl(TOKEN));
  });
});

describe('argument parsing', () => {
  it('defaults to a dry run', () => {
    expect(parseArgs(['access-open']).send).toBe(false);
    expect(parseArgs(['access-open', '--send']).send).toBe(true);
  });

  it('reads variables, limit, and pace', () => {
    const options = parseArgs([
      'access-open',
      '--var',
      'accessUrl=https://x.dev/a=b',
      '--limit',
      '5',
      '--pace',
      '0',
    ]);
    expect(options.vars).toEqual({ accessUrl: 'https://x.dev/a=b' });
    expect(options.limit).toBe(5);
    expect(options.pace).toBe(0);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(() => parseArgs(['a', '--limit', 'many'])).toThrow(UsageError);
    expect(() => parseArgs(['a', '--limit', '0'])).toThrow(UsageError);
    expect(() => parseArgs(['a', '--var', 'novalue'])).toThrow(UsageError);
    expect(() => parseArgs(['a', '--unknown'])).toThrow(UsageError);
    expect(() => parseArgs(['a', 'b'])).toThrow(UsageError);
  });
});

describe('recipient selection', () => {
  it('excludes anyone already recorded for the campaign', () => {
    const sql = selectRecipientsSql(undefined);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('waitlist_broadcast_send');
    expect(sql).toContain('$1');
    expect(sql).not.toContain('LIMIT');
  });

  it('interpolates only a number into the limit clause', () => {
    expect(selectRecipientsSql(10)).toContain('LIMIT 10');
    expect(selectRecipientsSql('5; DROP TABLE waitlist_signup')).toContain('LIMIT NaN');
  });
});

const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body,
});

const run = async (stub: unknown) => {
  vi.useFakeTimers();
  try {
    const promise = deliver({ to: ['a@example.com'] }, 'rk_test', 'access-open:abc', stub);
    await vi.runAllTimersAsync();
    return await promise;
  } finally {
    vi.useRealTimers();
  }
};

describe('delivery outcome', () => {
  it('reports a send and its provider id', async () => {
    const result = await run(async () => reply(200, { id: 'msg_1' }));
    expect(result).toEqual({ outcome: SENT, providerId: 'msg_1' });
  });

  it('still reports a send when the body does not parse', async () => {
    const result = await run(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new Error('not json');
      },
    }));
    expect(result.outcome).toBe(SENT);
    expect(result.providerId).toBeNull();
  });

  it('calls a 4xx a rejection, because nothing was queued', async () => {
    const stub = vi.fn(async () => reply(422));
    const result = await run(stub);
    expect(result.outcome).toBe(REJECTED);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx and reports the eventual send', async () => {
    let calls = 0;
    const result = await run(async () => {
      calls += 1;
      return calls === 1 ? reply(502) : reply(200, { id: 'msg_2' });
    });
    expect(result).toEqual({ outcome: SENT, providerId: 'msg_2' });
    expect(calls).toBe(2);
  });

  it('never claims a persistent 5xx was not sent — the message may have been queued', async () => {
    const stub = vi.fn(async () => reply(503));
    const result = await run(stub);
    expect(result.outcome).toBe(UNKNOWN);
    expect(stub).toHaveBeenCalledTimes(4);
  });

  it('calls an exhausted 429 a rejection, because a rate limit is a refusal', async () => {
    const result = await run(async () => reply(429));
    expect(result.outcome).toBe(REJECTED);
  });

  it('treats a transport failure as unknown rather than as proof of non-delivery', async () => {
    const result = await run(async () => {
      throw new TypeError('fetch failed');
    });
    expect(result.outcome).toBe(UNKNOWN);
    expect(result.detail).toMatch(/may still have been accepted/);
  });

  it('sends one stable idempotency key across every retry', async () => {
    const seen: string[] = [];
    let calls = 0;
    await run(async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers['Idempotency-Key']);
      calls += 1;
      return calls < 3 ? reply(500) : reply(200, { id: 'msg_3' });
    });
    expect(seen).toEqual(['access-open:abc', 'access-open:abc', 'access-open:abc']);
  });

  it('derives the key from campaign and signup, so it survives a released claim', () => {
    expect(idempotencyKey('access-open', 'sig-1')).toBe('access-open:sig-1');
    expect(idempotencyKey('access-open', 'sig-1')).toBe(idempotencyKey('access-open', 'sig-1'));
    expect(idempotencyKey('access-open', 'sig-1')).not.toBe(idempotencyKey('access-open', 'sig-2'));
  });
});
