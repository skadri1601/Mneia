import { describe, expect, it } from 'vitest';
import {
  describeRouteFailure,
  NO_USER_CONTENT,
  REDACTED,
  routeOf,
  scrubRequestData,
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
