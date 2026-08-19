import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ErrorProbeError, inspectProbeRequest, PROBE_TOKEN_ENV_VAR } from './error-probe.js';

const armed = { [PROBE_TOKEN_ENV_VAR]: 'a-long-random-probe-token' };

describe('inspectProbeRequest', () => {
  it('is unarmed when the token is unset, which is the normal production state', () => {
    expect(inspectProbeRequest('anything', {})).toBe('unarmed');
  });

  it('is unarmed when the token is set but blank', () => {
    expect(inspectProbeRequest('anything', { [PROBE_TOKEN_ENV_VAR]: '   ' })).toBe('unarmed');
  });

  it('rejects a request presenting no token even when armed', () => {
    expect(inspectProbeRequest(null, armed)).toBe('rejected');
  });

  it('rejects a wrong token, and one that is merely a prefix of the right one', () => {
    expect(inspectProbeRequest('nope', armed)).toBe('rejected');
    expect(inspectProbeRequest('a-long-random-probe-toke', armed)).toBe('rejected');
    expect(inspectProbeRequest('a-long-random-probe-tokenX', armed)).toBe('rejected');
  });

  it('arms only on an exact match', () => {
    expect(inspectProbeRequest('a-long-random-probe-token', armed)).toBe('armed');
  });
});

describe('ErrorProbeError', () => {
  it('names itself as deliberate so it is never mistaken for a real fault', () => {
    const error = new ErrorProbeError('mne-240 confirmation');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ErrorProbeError');
    expect(error.message).toContain('deliberate production error');
    expect(error.message).toContain('mne-240 confirmation');
  });
});
