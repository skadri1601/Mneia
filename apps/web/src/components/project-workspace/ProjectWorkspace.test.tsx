// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProjectMenuContextValue } from './ProjectMenuProvider.js';

const navigation = vi.hoisted(() => ({ pathname: '/projects' }));
const mocks = vi.hoisted(() => ({ useProjectMenu: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock('./ProjectMenuProvider.js', () => ({
  useProjectMenu: mocks.useProjectMenu,
}));

import { ProjectWorkspace } from './ProjectWorkspace.js';

const PROJECT = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  displayName: 'Analytical Engine',
  slug: 'analytical-engine',
};

const workspaceStyles = readFileSync(
  resolve(process.cwd(), 'apps/web/src/components/project-workspace/ProjectWorkspace.module.css'),
  'utf8',
);

describe('ProjectWorkspace', () => {
  beforeEach(() => {
    navigation.pathname = `/projects/${PROJECT.id}`;
    setProjectMenuOpen(true);
  });

  test('renders the five text-only project destinations in their required order', () => {
    const navigationElement = render().querySelector('#project-navigation');
    if (!(navigationElement instanceof HTMLElement)) {
      throw new Error('expected project navigation');
    }

    expect(destinationLinks(navigationElement)).toEqual([
      { href: `/projects/${PROJECT.id}`, text: 'Overview' },
      { href: `/projects/${PROJECT.id}/decisions`, text: 'Decisions' },
      { href: `/projects/${PROJECT.id}/timeline`, text: 'Timeline' },
      { href: `/projects/${PROJECT.id}/handoffs`, text: 'Handoffs' },
      { href: `/projects/${PROJECT.id}/review`, text: 'Review queue' },
      { href: '/projects', text: 'All projects' },
    ]);
    expect(navigationElement.querySelector('svg, [data-icon]')).toBeNull();
  });

  test.each([
    [`/projects/${PROJECT.id}`, `/projects/${PROJECT.id}`, 'Overview'],
    [`/projects/${PROJECT.id}/decisions`, `/projects/${PROJECT.id}/decisions`, 'Decisions'],
    [`/projects/${PROJECT.id}/timeline`, `/projects/${PROJECT.id}/timeline`, 'Timeline'],
    [`/projects/${PROJECT.id}/handoffs`, `/projects/${PROJECT.id}/handoffs`, 'Handoffs'],
    [`/projects/${PROJECT.id}/review`, `/projects/${PROJECT.id}/review`, 'Review queue'],
  ])('marks only %s as the current destination', (pathname, href, label) => {
    navigation.pathname = pathname;
    const navigationElement = render().querySelector('#project-navigation');
    if (!(navigationElement instanceof HTMLElement)) {
      throw new Error('expected project navigation');
    }

    const current = navigationElement.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe(href);
    expect(current[0]?.textContent).toBe(label);
    expect(
      navigationElement.querySelector('a[href="/projects"]')?.hasAttribute('aria-current'),
    ).toBe(false);
  });

  test('renders the project breadcrumb, identity, labelled navigation, and one content landmark', () => {
    navigation.pathname = `/projects/${PROJECT.id}/decisions`;
    const container = render();
    const breadcrumb = container.querySelector('main > nav[aria-label="Breadcrumb"]');
    const navigationElement = container.querySelector('#project-navigation');

    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb?.textContent).toContain('Projects');
    expect(breadcrumb?.textContent).toContain('Analytical Engine');
    expect(breadcrumb?.textContent).toContain('Decisions');
    expect(breadcrumb?.querySelector('a[href="/projects"]')?.textContent).toBe('Projects');
    expect(breadcrumb?.querySelector(`a[href="/projects/${PROJECT.id}"]`)?.textContent).toBe(
      'Analytical Engine',
    );
    expect(breadcrumb?.querySelector('li:last-child a')).toBeNull();
    expect(breadcrumb?.querySelector('li:last-child')?.textContent).toBe('Decisions');
    expect(navigationElement?.getAttribute('aria-label')).toBe('Project navigation');
    expect(container.querySelectorAll('main#project-content[tabindex="-1"]')).toHaveLength(1);
    expect(container.textContent).toContain('Repository binding');
    expect(container.textContent).toContain('analytical-engine');
  });

  test('hides and disables the sidebar when the project menu is closed', () => {
    setProjectMenuOpen(false);
    const sidebar = render().querySelector('aside');

    expect(sidebar?.getAttribute('aria-hidden')).toBe('true');
    expect(sidebar?.hasAttribute('inert')).toBe(true);
  });

  test('keeps the sidebar exposed and interactive when the project menu is open', () => {
    const sidebar = render().querySelector('aside');

    expect(sidebar?.hasAttribute('aria-hidden')).toBe(false);
    expect(sidebar?.hasAttribute('inert')).toBe(false);
  });

  test('uses a collapsible, reduced-motion-safe workspace grid with a bottom-separated project list exit', () => {
    expect(workspaceStyles).toContain('width: min(100%, 1440px);');
    expect(workspaceStyles).toContain('grid-template-columns: 220px minmax(0, 1fr);');
    expect(workspaceStyles).toContain(
      'html[data-project-menu="closed"] .workspace {\n  grid-template-columns: 0 minmax(0, 1fr);',
    );
    expect(workspaceStyles).toMatch(/\.sidebar \{[^}]*min-width: 0;[^}]*overflow: hidden;/s);
    expect(workspaceStyles).toMatch(/\.content \{[^}]*min-width: 0;/s);
    expect(workspaceStyles).toContain('visibility: hidden;');
    expect(workspaceStyles).toContain('html[data-project-menu-ready] .workspace');
    expect(workspaceStyles).toContain('html[data-project-menu-ready] .sidebar');
    expect(workspaceStyles).toContain('200ms ease-out');
    expect(workspaceStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(workspaceStyles).toContain('transition: none;');
    expect(workspaceStyles).toMatch(/\.projectName \{[^}]*overflow-wrap: anywhere;/s);
    expect(workspaceStyles).toMatch(/\.bindingValue \{[^}]*text-overflow: ellipsis;/s);
    expect(workspaceStyles).toMatch(
      /\.allProjects \{[^}]*margin-block-start: auto;[^}]*border-block-start:/s,
    );
  });
});

function render(): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <ProjectWorkspace project={PROJECT}>
      <h1>Route content</h1>
    </ProjectWorkspace>,
  );
  return container;
}

function setProjectMenuOpen(open: boolean): void {
  mocks.useProjectMenu.mockReturnValue({
    active: true,
    mobile: false,
    open,
    toggleRef: { current: null },
    toggle: () => undefined,
    dismiss: () => undefined,
  } satisfies ProjectMenuContextValue);
}

function destinationLinks(
  navigationElement: HTMLElement,
): readonly { href: string | null; text: string | null }[] {
  return [...navigationElement.querySelectorAll('a')].map((link) => ({
    href: link.getAttribute('href'),
    text: link.textContent,
  }));
}
