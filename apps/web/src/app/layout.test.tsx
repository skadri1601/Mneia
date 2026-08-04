import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-clerk-provider="true">{children}</div>
  ),
  SignedIn: ({ children }: { children: React.ReactNode }) => (
    <div data-signed-in="true">{children}</div>
  ),
  UserButton: () => <div data-user-button="true">Account</div>,
}));

vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'font-inter' }),
  JetBrains_Mono: () => ({ variable: 'font-jetbrains-mono' }),
}));

import RootLayout from './layout.js';

const render = () =>
  renderToStaticMarkup(
    <RootLayout>
      <p>Workspace</p>
    </RootLayout>,
  );

test('wraps the app in ClerkProvider', () => {
  expect(render()).toContain('data-clerk-provider="true"');
});

test('gives every page a wordmark that leads back to the workspace', () => {
  const markup = render();

  expect(markup).toContain('Mneia');
  expect(markup).toContain('href="/projects"');
});

test('gives a signed-in user a way to reach their account and sign out', () => {
  const markup = render();

  expect(markup).toContain('data-signed-in="true"');
  expect(markup).toContain('data-user-button="true"');
});

test('carries the published legal pages in the footer', () => {
  const markup = render();

  expect(markup).toContain('https://mneia.dev/privacy');
  expect(markup).toContain('https://mneia.dev/terms');
});

test('offers a signed-in user support, not the marketing homepage', () => {
  const markup = render();

  expect(markup).toContain('https://mneia.dev/docs');
  expect(markup).toContain('https://mneia.dev/help');
  expect(markup).toContain('https://mneia.dev/contact');
  expect(markup).not.toContain('href="https://mneia.dev"');
});

test('loads the webfonts rather than falling through to a generic sans', () => {
  const markup = render();

  expect(markup).toContain('font-inter');
  expect(markup).toContain('font-jetbrains-mono');
});
