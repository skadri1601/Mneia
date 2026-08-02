'use client';

import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';
import { honeybadger } from '../../honeybadger.config';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    honeybadger.notify(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
