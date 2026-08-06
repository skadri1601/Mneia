import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => ({
  SignIn: () => <div data-sign-in="true">Sign in</div>,
}));

import SignInPage from './page.js';

test('renders the single Clerk sign-in surface', () => {
  const html = renderToStaticMarkup(<SignInPage />);

  expect(html).toContain('data-sign-in="true"');
});

test('leaves the heading to Clerk so the title is not shown twice', () => {
  const html = renderToStaticMarkup(<SignInPage />);

  expect(html).not.toContain('<h1');
});

test('offers a way home, labelled Home rather than naming the domain', () => {
  const html = renderToStaticMarkup(<SignInPage />);

  expect(html).toContain('href="https://mneia.dev"');
  expect(html).toContain('Home');
  expect(html).not.toContain('Back to mneia.dev');
});
