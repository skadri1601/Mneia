'use client';

import { HAS_ANY_TAG } from '@/lib/tags';
import styles from './CookiePreferences.module.css';
import { useConsent } from './ConsentProvider';

export function CookiePreferencesPanel() {
  const { ready, categories, gated, globalPrivacyControl, decide } = useConsent();

  if (!HAS_ANY_TAG) {
    return null;
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Your choices</h2>

      {globalPrivacyControl ? (
        <p className={styles.status}>
          Your browser is sending <strong>Global Privacy Control</strong>. We are treating that as a
          refusal of analytics and advertising, so nothing below is loading and there is nothing for
          you to switch off.
        </p>
      ) : (
        <p className={styles.status}>
          {gated
            ? 'You are in a region where we ask before setting anything, so these are off until you turn them on.'
            : 'These are on by default where you are. Turning one off takes effect immediately.'}
        </p>
      )}

      <div className={styles.choices}>
        <label className={styles.choice}>
          <input
            checked={categories.analytics}
            disabled={!ready || globalPrivacyControl}
            onChange={(event) =>
              decide({ analytics: event.target.checked, advertising: categories.advertising })
            }
            type="checkbox"
          />
          <span>
            <strong>Analytics</strong>
            <span className={styles.detail}>
              Google Analytics. Which pages are read, and where visitors arrive from.
            </span>
          </span>
        </label>

        <label className={styles.choice}>
          <input
            checked={categories.advertising}
            disabled={!ready || globalPrivacyControl}
            onChange={(event) =>
              decide({ analytics: categories.analytics, advertising: event.target.checked })
            }
            type="checkbox"
          />
          <span>
            <strong>Advertising</strong>
            <span className={styles.detail}>
              Google Ads and the Meta Pixel. Measuring campaigns, and showing you ads elsewhere.
              Turning this off is also the CCPA opt-out from sharing.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

export function CookiePreferencesButton({ className }: { className?: string | undefined }) {
  const { openPreferences } = useConsent();

  if (!HAS_ANY_TAG) {
    return null;
  }

  return (
    <button className={className} onClick={openPreferences} type="button">
      Cookie preferences
    </button>
  );
}

export function DoNotSellButton({ className }: { className?: string | undefined }) {
  const { categories, decide } = useConsent();

  if (!HAS_ANY_TAG) {
    return null;
  }

  return (
    <button
      className={className}
      onClick={() => decide({ analytics: categories.analytics, advertising: false })}
      type="button"
    >
      Do Not Sell or Share My Personal Information
    </button>
  );
}
