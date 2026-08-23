'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { HAS_ANY_TAG } from '@/lib/tags';
import styles from './ConsentBanner.module.css';
import { useConsent } from './ConsentProvider';

export function ConsentBanner() {
  const { prompting, gated, categories, acceptAll, rejectAll, decide } = useConsent();
  const [detailOpen, setDetailOpen] = useState(false);
  const [analytics, setAnalytics] = useState(categories.analytics);
  const [advertising, setAdvertising] = useState(categories.advertising);
  const titleId = useId();
  const detailId = useId();

  if (!HAS_ANY_TAG || !prompting) {
    return null;
  }

  return (
    <div aria-labelledby={titleId} className={styles.banner} role="dialog">
      <div className={styles.inner}>
        <div className={styles.copy}>
          <h2 className={styles.title} id={titleId}>
            Cookies
          </h2>
          <p className={styles.body}>
            {gated
              ? 'We would like to set analytics and advertising cookies to understand how the site is found and used. Nothing is set unless you accept, and you can change this at any time.'
              : 'We set analytics and advertising cookies to understand how the site is found and used. You can turn them off here or at any time from the footer.'}{' '}
            <Link className={styles.link} href="/cookies">
              Cookie Policy
            </Link>
          </p>
        </div>

        <div className={styles.actions}>
          <button className={styles.secondary} onClick={rejectAll} type="button">
            Reject all
          </button>
          <button className={styles.secondary} onClick={acceptAll} type="button">
            Accept all
          </button>
          <button
            aria-controls={detailId}
            aria-expanded={detailOpen}
            className={styles.tertiary}
            onClick={() => setDetailOpen((open) => !open)}
            type="button"
          >
            Choose
          </button>
        </div>
      </div>

      {detailOpen ? (
        <div className={styles.detail} id={detailId}>
          <label className={styles.choice}>
            <input
              checked={analytics}
              onChange={(event) => setAnalytics(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Analytics</strong> - which pages are read, and where visitors arrive from.
            </span>
          </label>
          <label className={styles.choice}>
            <input
              checked={advertising}
              onChange={(event) => setAdvertising(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Advertising</strong> - measuring ad campaigns, and showing them to you
              elsewhere.
            </span>
          </label>
          <button
            className={styles.primary}
            onClick={() => decide({ analytics, advertising })}
            type="button"
          >
            Save choices
          </button>
        </div>
      ) : null}
    </div>
  );
}
