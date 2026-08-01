import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default withSentryConfig(config, {
  org: 'mneia',
  project: 'javascript-nextjs',
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
  },
});
