import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { verifyPkce } from './postgres-oauth-store.js';

const challengeFor = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

// PKCE is the only thing standing between an intercepted authorization code and an access token
// for a public client, which is every MCP client that registers without a secret. OAuth 2.1 makes
// it mandatory for exactly that reason.
describe('verifyPkce', () => {
  it('accepts the verifier its challenge was derived from', () => {
    const verifier = randomUUID().replace(/-/g, '');
    expect(verifyPkce(verifier, challengeFor(verifier))).toBe(true);
  });

  it('rejects a different verifier', () => {
    const challenge = challengeFor(randomUUID().replace(/-/g, ''));
    expect(verifyPkce(randomUUID().replace(/-/g, ''), challenge)).toBe(false);
  });

  it('rejects an empty verifier against a real challenge', () => {
    expect(verifyPkce('', challengeFor('something'))).toBe(false);
  });

  it('rejects a challenge of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so the length check has to come first — a
    // crash here would surface as a 500 rather than invalid_grant, and would leak that the code
    // was found and only the verifier failed.
    expect(() => verifyPkce('verifier', 'too-short')).not.toThrow();
    expect(verifyPkce('verifier', 'too-short')).toBe(false);
  });

  it('rejects the plain verifier presented as its own challenge', () => {
    // Guards against a "plain" downgrade: a client that sent the verifier as the challenge must
    // not authenticate, which is why S256 is the only method the schema accepts.
    const verifier = randomUUID().replace(/-/g, '');
    expect(verifyPkce(verifier, verifier)).toBe(false);
  });

  it('is not fooled by a challenge that is a prefix of the right one', () => {
    const verifier = randomUUID().replace(/-/g, '');
    const challenge = challengeFor(verifier);
    expect(verifyPkce(verifier, challenge.slice(0, -1))).toBe(false);
  });
});
