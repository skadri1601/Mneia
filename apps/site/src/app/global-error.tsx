'use client';

import * as Sentry from '@sentry/browser';
import { useEffect } from 'react';
import { SITE_URL } from '@/lib/site';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeContent: 'center',
          justifyItems: 'center',
          gap: '16px',
          padding: '24px',
          background: '#ffffff',
          color: '#1d1d1f',
          fontFamily:
            'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
          textAlign: 'center',
        }}
      >
        <a
          aria-label="MNEIA"
          href={SITE_URL}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0,
            color: 'inherit',
            fontSize: '21px',
            fontWeight: 600,
            letterSpacing: '0.01em',
            textDecoration: 'none',
          }}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            style={{ width: '0.66em', height: '0.72em', marginRight: '0.04em' }}
            viewBox="0 0 22 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 22V2l9 12 9-12v20"
              fill="none"
              stroke="#0066cc"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="4"
            />
          </svg>
          <span>NEIA</span>
        </a>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ margin: 0, color: '#7a7a7a', fontSize: '15px' }}>
          The page could not be loaded. The error has been reported.
        </p>
      </body>
    </html>
  );
}
