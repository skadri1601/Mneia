import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => {
  const UserButton = ({ children }: { children?: React.ReactNode }) => (
    <div data-user-button="true">{children}</div>
  );
  UserButton.MenuItems = ({ children }: { children?: React.ReactNode }) => <ul>{children}</ul>;
  UserButton.Link = ({ label, href }: { label: string; href: string }) => (
    <li>
      <a href={href}>{label}</a>
    </li>
  );

  return {
    ClerkProvider: ({ children }: { children: React.ReactNode }) => (
      <div data-clerk-provider="true">{children}</div>
    ),
    SignedIn: ({ children }: { children: React.ReactNode }) => (
      <div data-signed-in="true">{children}</div>
    ),
    UserButton,
  };
});

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

test('puts the two links a developer reaches for in the header', () => {
  const markup = render();

  expect(markup).toContain('https://mneia.dev/docs');
  expect(markup).toContain('https://mneia.dev/help');
});

test('keeps every other destination reachable from the account menu', () => {
  const markup = render();

  for (const path of ['', '/about', '/faq', '/contact', '/privacy', '/terms']) {
    expect(markup).toContain(`href="https://mneia.dev${path}"`);
  }
});

test('renders no footer, the way app dashboards do not', () => {
  expect(render()).not.toContain('<footer');
});

test('loads the webfonts rather than falling through to a generic sans', () => {
  const markup = render();

  expect(markup).toContain('font-inter');
  expect(markup).toContain('font-jetbrains-mono');
});
