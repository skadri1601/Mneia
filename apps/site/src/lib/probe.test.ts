import { describe, expect, it } from 'vitest';
import { authorizeProbe, PROBE_SECRET_VAR } from './probe.js';

const WITH_SECRET = { [PROBE_SECRET_VAR]: 'a-long-random-probe-secret' };

describe('authorizeProbe', () => {
  it('is inert until the secret is configured, so the route cannot be reached by default', () => {
    expect(authorizeProbe('anything', {})).toBe('not_configured');
    expect(authorizeProbe(null, {})).toBe('not_configured');
    expect(authorizeProbe('anything', { [PROBE_SECRET_VAR]: '' })).toBe('not_configured');
    expect(authorizeProbe('anything', { [PROBE_SECRET_VAR]: '   ' })).toBe('not_configured');
  });

  it('authorizes only the exact secret', () => {
    expect(authorizeProbe('a-long-random-probe-secret', WITH_SECRET)).toBe('authorized');
  });

  it('rejects a missing, empty, wrong, or near-miss header', () => {
    expect(authorizeProbe(null, WITH_SECRET)).toBe('rejected');
    expect(authorizeProbe('', WITH_SECRET)).toBe('rejected');
    expect(authorizeProbe('wrong', WITH_SECRET)).toBe('rejected');
    expect(authorizeProbe('a-long-random-probe-secre', WITH_SECRET)).toBe('rejected');
    expect(authorizeProbe('a-long-random-probe-secret ', WITH_SECRET)).toBe('rejected');
    expect(authorizeProbe('A-LONG-RANDOM-PROBE-SECRET', WITH_SECRET)).toBe('rejected');
  });

  it('does not let a prefix of the secret through, which a startsWith check would', () => {
    expect(authorizeProbe('a', WITH_SECRET)).toBe('rejected');
    expect(authorizeProbe('a-long', WITH_SECRET)).toBe('rejected');
  });

  it('does not let a superstring through either', () => {
    expect(authorizeProbe('a-long-random-probe-secret-and-more', WITH_SECRET)).toBe('rejected');
  });

  it('compares multi-byte secrets by bytes rather than by code unit', () => {
    const env = { [PROBE_SECRET_VAR]: 'sécret-🔑' };
    expect(authorizeProbe('sécret-🔑', env)).toBe('authorized');
    expect(authorizeProbe('secret-🔑', env)).toBe('rejected');
  });
});
