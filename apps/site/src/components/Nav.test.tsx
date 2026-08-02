import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('./Button', () => ({
  ButtonPrimary: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { Nav } from './Nav.js';

describe('Nav', () => {
  test('renders the Mneia logo mark with an accessible name', () => {
    const markup = renderToStaticMarkup(<Nav />);

    expect(markup).toContain('<svg');
    expect(markup).toContain('aria-label="Mneia"');
  });
});
