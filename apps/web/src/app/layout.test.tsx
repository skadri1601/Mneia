import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/projects' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

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
    SignedOut: ({ children }: { children: React.ReactNode }) => (
      <div data-signed-out="true">{children}</div>
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

  expect(markup).toContain('aria-label="MNEIA"');
  expect(markup).toContain('>NEIA</span>');
  expect(markup).toContain('href="/projects"');
});

test('gives a signed-in user a way to reach their account and sign out', () => {
  const markup = render();

  expect(markup).toContain('data-signed-in="true"');
  expect(markup).toContain('data-user-button="true"');
});

test('lays every marketing destination out across the header', () => {
  const markup = render();

  for (const path of ['/docs', '/help', '/about', '/faq', '/contact', '/privacy', '/terms']) {
    expect(markup).toContain(`href="https://mneia.dev${path}"`);
  }
});

test('reaches those destinations by anchor, not by a click handler', () => {
  expect(render().match(/<a href="https:\/\/mneia\.dev\//g)).toHaveLength(7);
});

test('hangs nothing off the avatar, which is Clerk territory', () => {
  expect(render()).toContain('<div data-user-button="true"></div>');
});

test('renders no footer, the way app dashboards do not', () => {
  expect(render()).not.toContain('<footer');
});

test('loads the webfonts rather than falling through to a generic sans', () => {
  const markup = render();

  expect(markup).toContain('font-inter');
  expect(markup).toContain('font-jetbrains-mono');
});

test('keeps the signed-in header destinations and account control intact inside the project shell', () => {
  navigation.pathname = '/projects/123e4567-e89b-12d3-a456-426614174000';
  const markup = render();

  expect(markup).toContain('href="/projects"');
  expect(markup).toContain('href="/team"');
  expect(markup).toContain('href="/billing"');
  expect(markup.match(/href="https:\/\/mneia\.dev\//g)).toHaveLength(7);
  expect(markup).toContain('data-user-button="true"');
  expect(markup).toContain('href="#project-content"');
});
