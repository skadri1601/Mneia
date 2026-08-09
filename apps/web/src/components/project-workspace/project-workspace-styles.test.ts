import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const read = (specifier: string): string =>
  readFileSync(new URL(specifier, import.meta.url), 'utf8');

const workspace = read('./ProjectWorkspace.module.css');
const loading = read('./ProjectSectionLoading.module.css');
const header = read('../AppHeader.module.css');

const reducedMotionBlock = (css: string): string => {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  expect(start).toBeGreaterThan(-1);
  return css.slice(start);
};

describe('project workspace styles', () => {
  test.each([
    ['ProjectWorkspace.module.css', workspace],
    ['ProjectSectionLoading.module.css', loading],
    ['AppHeader.module.css', header],
  ])('%s never animates every property at once', (_name, css) => {
    expect(css).not.toMatch(/transition:\s*all\b/);
  });

  test.each([
    ['ProjectWorkspace.module.css', workspace],
    ['ProjectSectionLoading.module.css', loading],
    ['AppHeader.module.css', header],
  ])('%s honours a reduced-motion preference', (_name, css) => {
    expect(reducedMotionBlock(css)).toContain('transition: none');
  });

  test('the workspace grid and its columns cannot be forced wider than their track', () => {
    expect(workspace).toContain('grid-template-columns: 220px minmax(0, 1fr)');
    expect(workspace).toContain('html[data-project-menu="closed"] .workspace');
    expect(workspace).toContain('grid-template-columns: 0 minmax(0, 1fr)');
    expect(workspace.match(/min-width:\s*0/g) ?? []).not.toHaveLength(0);
  });

  test('route content enters on transform and opacity only', () => {
    const start = workspace.indexOf('@keyframes contentEnter');
    expect(start).toBeGreaterThan(-1);
    const entry = workspace.slice(start, workspace.indexOf('\n}\n', start));

    expect(entry).toContain('opacity: 0');
    expect(entry).toContain('transform: translateY(5px)');
    expect(entry).not.toMatch(/\b(width|height|margin|padding|top|left):/);
  });

  test('the mobile drawer and backdrop contain their own scrolling', () => {
    expect(workspace).toContain('@media (max-width: 734px)');
    expect(workspace.match(/overscroll-behavior:\s*contain/g) ?? []).toHaveLength(2);
    expect(workspace).toContain('transform: translateX(-100%)');
    expect(workspace).toContain('html[data-project-menu="open"] .sidebar');
  });

  test('reduced motion stops the workspace transition and the content entry', () => {
    const reduced = reducedMotionBlock(workspace);

    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('transform: none');
  });

  test('reduced motion stops the skeleton shimmer rather than only its container', () => {
    const reduced = reducedMotionBlock(loading);

    expect(reduced).toContain('.line::after');
    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('background: none');
  });

  test('the menu control shows a close treatment before and after hydration', () => {
    expect(header).toContain(
      'html[data-project-menu="open"]:not([data-project-menu-ready]) .projectMenuToggle span:first-child',
    );
    expect(header).toContain(
      'html[data-project-menu-ready] .projectMenuToggle[aria-expanded="true"] span:first-child',
    );
    expect(header).toContain('transform: translateY(6px) rotate(45deg)');
    expect(header).toContain('transform: translateY(-6px) rotate(-45deg)');
    expect(header).toContain('opacity: 0');
  });
});
