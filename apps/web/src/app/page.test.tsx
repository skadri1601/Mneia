import { expect, test, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect }));

import HomePage from './page.js';

test('redirects the authenticated root to the project control plane', () => {
  HomePage();

  expect(redirect).toHaveBeenCalledWith('/projects');
});
