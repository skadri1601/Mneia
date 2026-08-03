'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ALL_DENIED,
  ALL_GRANTED,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  type ConsentCategories,
  type ConsentDecision,
  consentModeSignals,
  parseConsentDecision,
  resolveConsent,
  shouldPrompt,
} from '@/lib/consent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean };
    globalPrivacyControl?: boolean;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

type ConsentContextValue = {
  ready: boolean;
  categories: ConsentCategories;
  gated: boolean;
  limitedDataUse: boolean;
  globalPrivacyControl: boolean;
  prompting: boolean;
  decide: (categories: ConsentCategories) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  openPreferences: () => void;
  dismissPreferences: () => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

function readStoredDecision(): ConsentDecision | null {
  try {
    return parseConsentDecision(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredDecision(decision: ConsentDecision): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(decision));
  } catch {}
}

function pushConsentUpdate(categories: ConsentCategories): void {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag?.('consent', 'update', consentModeSignals(categories));
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<ConsentDecision | null>(null);
  const [gated, setGated] = useState(true);
  const [limitedDataUse, setLimitedDataUse] = useState(true);
  const [globalPrivacyControl, setGlobalPrivacyControl] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const gpc = navigator.globalPrivacyControl === true || window.globalPrivacyControl === true;
    const existing = readStoredDecision();

    setGlobalPrivacyControl(gpc);
    setStored(existing);

    async function loadRegion() {
      try {
        const response = await fetch('/api/consent-region', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`expected /api/consent-region to return 200; got ${response.status}`);
        }
        const body = (await response.json()) as { gated?: unknown; limitedDataUse?: unknown };
        setGated(body.gated !== false);
        setLimitedDataUse(body.limitedDataUse !== false);
      } catch {
        setGated(true);
        setLimitedDataUse(true);
      } finally {
        setReady(true);
      }
    }

    void loadRegion();

    return () => controller.abort();
  }, []);

  const categories = useMemo(
    () => resolveConsent({ stored, gated, globalPrivacyControl }),
    [stored, gated, globalPrivacyControl],
  );

  useEffect(() => {
    if (ready) {
      pushConsentUpdate(categories);
    }
  }, [ready, categories]);

  const decide = useCallback((next: ConsentCategories) => {
    const decision: ConsentDecision = {
      version: CONSENT_VERSION,
      decidedAt: new Date().toISOString(),
      categories: next,
    };
    writeStoredDecision(decision);
    setStored(decision);
    setPreferencesOpen(false);
  }, []);

  const acceptAll = useCallback(() => decide(ALL_GRANTED), [decide]);
  const rejectAll = useCallback(() => decide(ALL_DENIED), [decide]);
  const openPreferences = useCallback(() => setPreferencesOpen(true), []);
  const dismissPreferences = useCallback(() => setPreferencesOpen(false), []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      ready,
      categories,
      gated,
      limitedDataUse,
      globalPrivacyControl,
      prompting: ready && (preferencesOpen || shouldPrompt({ stored, globalPrivacyControl })),
      decide,
      acceptAll,
      rejectAll,
      openPreferences,
      dismissPreferences,
    }),
    [
      ready,
      categories,
      gated,
      limitedDataUse,
      globalPrivacyControl,
      preferencesOpen,
      stored,
      decide,
      acceptAll,
      rejectAll,
      openPreferences,
      dismissPreferences,
    ],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const value = useContext(ConsentContext);
  if (!value) {
    throw new Error('expected useConsent to be called inside ConsentProvider; found no provider');
  }
  return value;
}
