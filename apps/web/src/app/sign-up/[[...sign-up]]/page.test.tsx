import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => ({
  SignUp: () => <div data-sign-up="true">Sign up</div>,
}));

import SignUpPage from './page.js';

test('renders the single Clerk sign-up surface', () => {
  const html = renderToStaticMarkup(<SignUpPage />);

  expect(html).toContain('data-sign-up="true"');
  expect(html).toContain('Create your Mneia account');
});
