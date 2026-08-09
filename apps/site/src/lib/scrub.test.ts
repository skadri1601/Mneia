import { describe, expect, it } from 'vitest';
import { PROBE_HEADER } from './probe.js';
import { REDACTED, SCRUBBED_HEADERS, scrubSensitiveHeaders } from './scrub.js';

const SECRET = 'a-long-random-probe-secret';

const eventWith = (headers: Record<string, string>) => ({
  request: { headers, url: 'https://mneia.dev/api/sentry-check?marker=1' },
});

describe('scrubSensitiveHeaders', () => {
  it('removes the probe secret, which the guarded route sends on every authorized call', () => {
    const event = eventWith({ [PROBE_HEADER]: SECRET, 'user-agent': 'curl/8.0' });

    const scrubbed = scrubSensitiveHeaders(event);

    expect(scrubbed.request.headers[PROBE_HEADER]).toBe(REDACTED);
    expect(JSON.stringify(scrubbed)).not.toContain(SECRET);
  });

  it('scrubs regardless of header capitalisation, since HTTP header names are case-insensitive', () => {
    const event = eventWith({ 'X-Mneia-Probe': SECRET, Authorization: 'Bearer abc123' });

    const scrubbed = scrubSensitiveHeaders(event);

    expect(scrubbed.request.headers['X-Mneia-Probe']).toBe(REDACTED);
    expect(scrubbed.request.headers.Authorization).toBe(REDACTED);
    expect(JSON.stringify(scrubbed)).not.toContain(SECRET);
    expect(JSON.stringify(scrubbed)).not.toContain('abc123');
  });

  it('leaves everything else alone, so the report stays useful for debugging', () => {
    const event = eventWith({
      'user-agent': 'curl/8.0',
      referer: 'https://mneia.dev/pricing',
      'content-type': 'application/json',
    });

    const scrubbed = scrubSensitiveHeaders(event);

    expect(scrubbed.request.headers['user-agent']).toBe('curl/8.0');
    expect(scrubbed.request.headers.referer).toBe('https://mneia.dev/pricing');
    expect(scrubbed.request.headers['content-type']).toBe('application/json');
  });

  it('covers the header the probe route actually authenticates with', () => {
    expect(SCRUBBED_HEADERS).toContain(PROBE_HEADER);
  });

  it('survives an event with no request, no headers, or null', () => {
    expect(scrubSensitiveHeaders(null)).toBeNull();
    expect(scrubSensitiveHeaders({})).toEqual({});
    expect(scrubSensitiveHeaders({ request: {} })).toEqual({ request: {} });
  });
});
