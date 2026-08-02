import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'apps/site/src') },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    setupFiles: ['tests/setup-env.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'apps/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.tsx',
            'packages/*/src/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/**/*.test.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
