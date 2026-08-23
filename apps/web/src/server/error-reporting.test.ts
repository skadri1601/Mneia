import { beforeEach, describe, expect, it } from 'vitest';
import {
  describeRouteFailure,
  NO_USER_CONTENT,
  observeSentryDelivery,
  RATE_LIMIT_HEADER,
  recordSentryDelivery,
  REDACTED,
  resetSentryDelivery,
  routeOf,
  scrubRequestData,
  sentryDelivery,
  sentryDropDetail,
} from './error-reporting.js';

describe('scrubRequestData', () => {
  it('redacts the credential-bearing headers and drops everything a caller sent', () => {
    const event = {
      request: {
        headers: {
          Authorization: 'Bearer mneia_live_secret',
          Cookie: '__session=abc',
          'content-type': 'application/json',
        },
        cookies: { __session: 'abc' },
        data: { items: [{ body: 'a load-bearing constraint' }] },
        query_string: 'task=redact+me',
      },
    };

    const scrubbed = scrubRequestData(event);
    const serialised = JSON.stringify(scrubbed);

    expect(scrubbed.request.headers.Authorization).toBe(REDACTED);
    expect(scrubbed.request.headers.Cookie).toBe(REDACTED);
    expect(scrubbed.request.headers['content-type']).toBe('application/json');
    expect(scrubbed.request.data).toBeUndefined();
    expect(scrubbed.request.cookies).toBeUndefined();
    expect(scrubbed.request.query_string).toBeUndefined();
    expect(serialised).not.toContain('mneia_live_secret');
    expect(serialised).not.toContain('a load-bearing constraint');
    expect(serialised).not.toContain('redact+me');
  });

  it('passes through an event with no request attached', () => {
    expect(scrubRequestData(null)).toBeNull();
    expect(scrubRequestData({})).toEqual({});
  });
});

describe('NO_USER_CONTENT', () => {
  it('turns off every collector that could carry an item body or a credential', () => {
    expect(NO_USER_CONTENT).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    });
  });
});

describe('describeRouteFailure', () => {
  it('names the route and the error class without the query string', () => {
    const request = new Request('https://app.mneia.dev/api/v1/rehydrate?task=redact+me', {
      method: 'POST',
    });

    expect(describeRouteFailure(request, new TypeError('nope'))).toEqual({
      route: '/api/v1/rehydrate',
      method: 'POST',
      errorClass: 'TypeError',
    });
  });

  it('names the thrown type when something that is not an Error escapes', () => {
    const request = new Request('https://app.mneia.dev/api/v1/checkpoint');

    expect(describeRouteFailure(request, 'a string').errorClass).toBe('string');
    expect(routeOf(request)).toBe('/api/v1/checkpoint');
  });
});

describe('sentry delivery observation', () => {
  beforeEach(() => {
    resetSentryDelivery();
  });

  it('starts unproven, because a deployment that has raised no errors has sent nothing', () => {
    expect(sentryDelivery()).toBe('unproven');
    expect(sentryDropDetail()).toBeNull();
  });

  it('reports delivering once Sentry accepts an envelope', () => {
    expect(recordSentryDelivery({ statusCode: 200 })).toBe('delivering');
    expect(sentryDropDetail()).toBeNull();
  });

  it('reports dropped on the 429 an exhausted org quota returns', () => {
    expect(
      recordSentryDelivery({
        statusCode: 429,
        headers: { [RATE_LIMIT_HEADER]: '60:default;error:organization:error_usage_exceeded' },
      }),
    ).toBe('dropped');
    expect(sentryDropDetail()).toContain('error_usage_exceeded');
  });

  it('reports dropped when a 200 still carries a rate-limit header', () => {
    expect(
      recordSentryDelivery({
        statusCode: 200,
        headers: { [RATE_LIMIT_HEADER]: '60:error:organization' },
      }),
    ).toBe('dropped');
  });

  it('reports dropped when Sentry refuses the envelope outright', () => {
    expect(recordSentryDelivery({ statusCode: 401 })).toBe('dropped');
    expect(sentryDropDetail()).toContain('401');
  });

  it('keeps the drop sticky, because a rate-limited SDK stops sending and goes quiet', () => {
    recordSentryDelivery({ statusCode: 429 });
    expect(sentryDelivery()).toBe('dropped');
    expect(recordSentryDelivery(undefined)).toBe('delivering');
  });

  it('records what the client reports through afterSendEvent', () => {
    const handlers: ((event: unknown, response: unknown) => void)[] = [];
    observeSentryDelivery({
      on: (_hook, registered) => {
        handlers.push(registered);
      },
    });

    expect(handlers).toHaveLength(1);
    for (const handler of handlers) {
      handler({}, { statusCode: 429 });
    }
    expect(sentryDelivery()).toBe('dropped');
  });
});
