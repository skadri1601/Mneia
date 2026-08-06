import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  bearerTokenFrom,
  confirmationCodeMatches,
  generateApiToken,
  generateConfirmationCode,
  generateDeviceCodePair,
  generateUserCode,
  hashSecret,
  isUserCodeShaped,
  normalizeUserCode,
} from './device-codes.js';

describe('user codes', () => {
  it('carries no digits, so no letter can be misread as one', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(generateUserCode()).not.toMatch(/\d/);
    }
  });

  it('carries no vowels, so a code can never spell a word at someone', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(generateUserCode()).not.toMatch(/[AEIOU]/);
    }
  });

  it('is grouped so a human can read it back over a call', () => {
    expect(generateUserCode()).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
  });

  it('accepts what a person actually types — lower case, spaces, no dash', () => {
    const code = generateUserCode();
    const bare = code.replace('-', '');
    expect(normalizeUserCode(bare.toLowerCase())).toBe(code);
    expect(normalizeUserCode(`  ${bare.slice(0, 4)} ${bare.slice(4)}  `)).toBe(code);
    expect(normalizeUserCode(code)).toBe(code);
  });

  it('rejects a code of the right length built from letters we never issue', () => {
    expect(normalizeUserCode('AEIO-UAEI')).toBe('');
    expect(isUserCodeShaped('AEIO-UAEI')).toBe(false);
  });

  it('rejects the wrong length rather than silently truncating', () => {
    expect(normalizeUserCode('BCDF-GHJ')).toBe('');
    expect(normalizeUserCode('BCDF-GHJKL')).toBe('');
    expect(normalizeUserCode('')).toBe('');
  });
});

describe('confirmation codes', () => {
  it('is always four digits, including when the draw is small', () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      expect(generateConfirmationCode()).toMatch(/^\d{4}$/);
    }
  });

  it('matches only the exact code', () => {
    expect(confirmationCodeMatches('0417', '0417')).toBe(true);
    expect(confirmationCodeMatches('0417', '0418')).toBe(false);
  });

  it('does not treat a prefix or a longer string as a match', () => {
    expect(confirmationCodeMatches('0417', '041')).toBe(false);
    expect(confirmationCodeMatches('0417', '04170')).toBe(false);
    expect(confirmationCodeMatches('0417', '')).toBe(false);
  });
});

describe('secrets', () => {
  it('stores a hash and never the device code itself', () => {
    const pair = generateDeviceCodePair();
    expect(pair.deviceCodeHash).toBe(hashSecret(pair.deviceCode));
    expect(pair.deviceCodeHash).not.toContain(pair.deviceCode);
    expect(pair.deviceCodeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues a distinct device code every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateDeviceCodePair().deviceCode));
    expect(seen.size).toBe(200);
  });

  it('prefixes the API token so a leaked one is recognisable in a log', () => {
    const token = generateApiToken();
    expect(token.token.startsWith('mneia_')).toBe(true);
    expect(token.tokenHash).toBe(hashSecret(token.token));
  });

  it('is URL safe, so it survives a copy through a shell and a header', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generateApiToken().token).toMatch(/^mneia_[\w-]+$/);
      expect(generateDeviceCodePair().deviceCode).toMatch(/^[\w-]+$/);
    }
  });
});

describe('bearer parsing', () => {
  it('reads a well formed header', () => {
    expect(bearerTokenFrom('Bearer mneia_abc123')).toBe('mneia_abc123');
  });

  it('refuses anything that is not a bearer credential', () => {
    expect(bearerTokenFrom(null)).toBe('');
    expect(bearerTokenFrom('')).toBe('');
    expect(bearerTokenFrom('mneia_abc123')).toBe('');
    expect(bearerTokenFrom('Basic dXNlcjpwYXNz')).toBe('');
    expect(bearerTokenFrom('Bearer')).toBe('');
    expect(bearerTokenFrom('Bearer ')).toBe('');
  });

  it('does not let a second token ride along in the same header', () => {
    expect(bearerTokenFrom('Bearer aaa bbb')).toBe('');
  });
});
