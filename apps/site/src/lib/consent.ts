export const CONSENT_STORAGE_KEY = 'mneia.consent';

export const CONSENT_VERSION = 1;

export type ConsentCategories = {
  analytics: boolean;
  advertising: boolean;
};

export type ConsentDecision = {
  version: number;
  decidedAt: string;
  categories: ConsentCategories;
};

export type ConsentSignal = 'granted' | 'denied';

export type ConsentModeSignals = {
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
  analytics_storage: ConsentSignal;
};

export const ALL_DENIED: ConsentCategories = { analytics: false, advertising: false };

export const ALL_GRANTED: ConsentCategories = { analytics: true, advertising: true };

const EEA = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
] as const;

const PRIOR_CONSENT_COUNTRIES: ReadonlySet<string> = new Set([...EEA, 'GB', 'CH']);

const UNRESOLVED_COUNTRY_CODES: ReadonlySet<string> = new Set(['XX', 'T1']);

export function requiresPriorConsent(country: string | null | undefined): boolean {
  if (!country) {
    return true;
  }
  const normalised = country.trim().toUpperCase();
  if (normalised.length !== 2 || UNRESOLVED_COUNTRY_CODES.has(normalised)) {
    return true;
  }
  return PRIOR_CONSENT_COUNTRIES.has(normalised);
}

export function isLimitedDataUseRegion(
  country: string | null | undefined,
  region: string | null | undefined,
): boolean {
  if (country?.trim().toUpperCase() !== 'US') {
    return false;
  }
  const normalised = region?.trim().toUpperCase();
  if (!normalised) {
    return true;
  }
  return normalised === 'CA' || normalised === 'CALIFORNIA';
}

export function parseConsentDecision(raw: string | null): ConsentDecision | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== CONSENT_VERSION) {
    return null;
  }
  if (typeof candidate.decidedAt !== 'string') {
    return null;
  }

  const categories = candidate.categories;
  if (typeof categories !== 'object' || categories === null) {
    return null;
  }

  const { analytics, advertising } = categories as Record<string, unknown>;
  if (typeof analytics !== 'boolean' || typeof advertising !== 'boolean') {
    return null;
  }

  return {
    version: CONSENT_VERSION,
    decidedAt: candidate.decidedAt,
    categories: { analytics, advertising },
  };
}

export function resolveConsent(input: {
  stored: ConsentDecision | null;
  gated: boolean;
  globalPrivacyControl: boolean;
}): ConsentCategories {
  if (input.globalPrivacyControl) {
    return ALL_DENIED;
  }
  if (input.stored) {
    return input.stored.categories;
  }
  return input.gated ? ALL_DENIED : ALL_GRANTED;
}

export function shouldPrompt(input: {
  stored: ConsentDecision | null;
  globalPrivacyControl: boolean;
}): boolean {
  if (input.globalPrivacyControl) {
    return false;
  }
  return input.stored === null;
}

export function consentModeSignals(categories: ConsentCategories): ConsentModeSignals {
  const advertising: ConsentSignal = categories.advertising ? 'granted' : 'denied';
  return {
    ad_storage: advertising,
    ad_user_data: advertising,
    ad_personalization: advertising,
    analytics_storage: categories.analytics ? 'granted' : 'denied',
  };
}
