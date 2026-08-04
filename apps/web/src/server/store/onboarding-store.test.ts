import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { OnboardingError, parseOnboardingProfile } from './onboarding-store.js';

const valid = {
  companyName: '  Ada Corp  ',
  companySize: '50-199',
  teamFunction: 'engineering',
  displayName: '  Ada Lovelace  ',
};

describe('parseOnboardingProfile', () => {
  it('trims what it accepts', () => {
    expect(parseOnboardingProfile(valid)).toEqual({
      companyName: 'Ada Corp',
      companySize: '50-199',
      teamFunction: 'engineering',
      displayName: 'Ada Lovelace',
    });
  });

  it('treats an unanswered company size as unknown rather than invalid', () => {
    expect(parseOnboardingProfile({ ...valid, companySize: '' }).companySize).toBeNull();
  });

  it('rejects a company size outside the buckets the column allows', () => {
    expect(() => parseOnboardingProfile({ ...valid, companySize: '42' })).toThrow(OnboardingError);
  });

  it('rejects a team function outside the enum', () => {
    expect(() => parseOnboardingProfile({ ...valid, teamFunction: 'wizardry' })).toThrow(
      OnboardingError,
    );
  });

  it('rejects blank names rather than writing them', () => {
    expect(() => parseOnboardingProfile({ ...valid, companyName: '   ' })).toThrow(OnboardingError);
    expect(() => parseOnboardingProfile({ ...valid, displayName: '' })).toThrow(OnboardingError);
  });

  it('rejects names past the length the column expects', () => {
    expect(() => parseOnboardingProfile({ ...valid, companyName: 'a'.repeat(201) })).toThrow(
      OnboardingError,
    );
  });
});
