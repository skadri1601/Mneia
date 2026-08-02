import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-clerk-provider="true">{children}</div>
  ),
}));

import RootLayout from './layout.js';

test('wraps the app in ClerkProvider', () => {
  const markup = renderToStaticMarkup(
    <RootLayout>
      <p>Workspace</p>
    </RootLayout>,
  );

  expect(markup).toContain('data-clerk-provider="true"');
});
