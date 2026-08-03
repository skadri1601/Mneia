import { describe, expect, it } from 'vitest';
import {
  ALL_DENIED,
  ALL_GRANTED,
  CONSENT_VERSION,
  type ConsentDecision,
  consentModeSignals,
  isLimitedDataUseRegion,
  parseConsentDecision,
  requiresPriorConsent,
  resolveConsent,
  shouldPrompt,
} from './consent';

function decision(analytics: boolean, advertising: boolean): ConsentDecision {
  return {
    version: CONSENT_VERSION,
    decidedAt: '2026-08-02T00:00:00.000Z',
    categories: { analytics, advertising },
  };
}

describe('requiresPriorConsent', () => {
  it('gates every EEA member state', () => {
    for (const country of ['DE', 'FR', 'IE', 'PL', 'SE', 'IS', 'LI', 'NO']) {
      expect(requiresPriorConsent(country)).toBe(true);
    }
  });

  it('gates the UK and Switzerland', () => {
    expect(requiresPriorConsent('GB')).toBe(true);
    expect(requiresPriorConsent('CH')).toBe(true);
  });

  it('does not gate the US, Canada, or India', () => {
    expect(requiresPriorConsent('US')).toBe(false);
    expect(requiresPriorConsent('CA')).toBe(false);
    expect(requiresPriorConsent('IN')).toBe(false);
  });

  it('is case and whitespace insensitive', () => {
    expect(requiresPriorConsent(' de ')).toBe(true);
    expect(requiresPriorConsent('us')).toBe(false);
  });

  it('gates when the country is unknown, so a missing header fails closed', () => {
    expect(requiresPriorConsent(null)).toBe(true);
    expect(requiresPriorConsent(undefined)).toBe(true);
    expect(requiresPriorConsent('')).toBe(true);
    expect(requiresPriorConsent('XX')).toBe(true);
    expect(requiresPriorConsent('T1')).toBe(true);
  });
});

describe('isLimitedDataUseRegion', () => {
  it('flags California', () => {
    expect(isLimitedDataUseRegion('US', 'CA')).toBe(true);
  });

  it('flags US traffic whose region is unknown, so detection failure fails closed', () => {
    expect(isLimitedDataUseRegion('US', null)).toBe(true);
    expect(isLimitedDataUseRegion('US', '')).toBe(true);
  });

  it('does not flag other US states', () => {
    expect(isLimitedDataUseRegion('US', 'TX')).toBe(false);
    expect(isLimitedDataUseRegion('US', 'NY')).toBe(false);
  });

  it('does not flag traffic outside the US', () => {
    expect(isLimitedDataUseRegion('DE', null)).toBe(false);
    expect(isLimitedDataUseRegion(null, 'CA')).toBe(false);
  });
});

describe('parseConsentDecision', () => {
  it('round-trips a stored decision', () => {
    const stored = decision(true, false);
    expect(parseConsentDecision(JSON.stringify(stored))).toEqual(stored);
  });

  it('rejects absent, malformed, and non-object payloads', () => {
    expect(parseConsentDecision(null)).toBeNull();
    expect(parseConsentDecision('')).toBeNull();
    expect(parseConsentDecision('{')).toBeNull();
    expect(parseConsentDecision('"granted"')).toBeNull();
    expect(parseConsentDecision('null')).toBeNull();
  });

  it('rejects a decision recorded against an older policy version', () => {
    const stale = { ...decision(true, true), version: CONSENT_VERSION - 1 };
    expect(parseConsentDecision(JSON.stringify(stale))).toBeNull();
  });

  it('rejects non-boolean categories rather than coercing them', () => {
    const loose = {
      version: CONSENT_VERSION,
      decidedAt: '2026-08-02T00:00:00.000Z',
      categories: { analytics: 'yes', advertising: 1 },
    };
    expect(parseConsentDecision(JSON.stringify(loose))).toBeNull();
  });
});

describe('resolveConsent', () => {
  it('denies everything in a gated region until a decision is stored', () => {
    expect(resolveConsent({ stored: null, gated: true, globalPrivacyControl: false })).toEqual(
      ALL_DENIED,
    );
  });

  it('grants outside gated regions when no decision is stored', () => {
    expect(resolveConsent({ stored: null, gated: false, globalPrivacyControl: false })).toEqual(
      ALL_GRANTED,
    );
  });

  it('honours a stored decision in both region postures', () => {
    const stored = decision(true, false);
    expect(resolveConsent({ stored, gated: true, globalPrivacyControl: false })).toEqual(
      stored.categories,
    );
    expect(resolveConsent({ stored, gated: false, globalPrivacyControl: false })).toEqual(
      stored.categories,
    );
  });

  it('lets Global Privacy Control override a stored grant, in every region', () => {
    const stored = decision(true, true);
    expect(resolveConsent({ stored, gated: false, globalPrivacyControl: true })).toEqual(
      ALL_DENIED,
    );
    expect(resolveConsent({ stored, gated: true, globalPrivacyControl: true })).toEqual(ALL_DENIED);
  });
});

describe('shouldPrompt', () => {
  it('prompts when nothing is stored', () => {
    expect(shouldPrompt({ stored: null, globalPrivacyControl: false })).toBe(true);
  });

  it('does not prompt once a decision exists', () => {
    expect(shouldPrompt({ stored: decision(false, false), globalPrivacyControl: false })).toBe(
      false,
    );
  });

  it('does not nag a visitor who already sent Global Privacy Control', () => {
    expect(shouldPrompt({ stored: null, globalPrivacyControl: true })).toBe(false);
  });
});

describe('consentModeSignals', () => {
  it('maps a full grant to four granted v2 signals', () => {
    expect(consentModeSignals(ALL_GRANTED)).toEqual({
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    });
  });

  it('maps a full denial to four denied v2 signals', () => {
    expect(consentModeSignals(ALL_DENIED)).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
    });
  });

  it('keeps analytics-only consent out of all three advertising signals', () => {
    expect(consentModeSignals({ analytics: true, advertising: false })).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted',
    });
  });
});
