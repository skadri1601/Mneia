import { defineConfig } from 'vitest/config';

export default defineConfig({
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
