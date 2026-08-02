import type React from 'react';
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
  test('renders the tablet-rune MNEIA lockup with an accessible name', () => {
    const markup = renderToStaticMarkup(<Nav />);

    expect(markup).toContain('<svg');
    expect(markup).toContain('viewBox="0 0 64 64"');
    expect(markup).toContain('aria-label="MNEIA"');
    expect(markup).toContain('>NEIA</a>');
    expect(markup).not.toContain('>Mneia</a>');
  });
});
