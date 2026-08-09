import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import DecisionsLoading from '../../app/projects/[projectId]/decisions/loading.js';
import OverviewLoading from '../../app/projects/[projectId]/loading.js';
import ReviewLoading from '../../app/projects/[projectId]/review/loading.js';
import TimelineLoading from '../../app/projects/[projectId]/timeline/loading.js';
import { ProjectSectionLoading } from './ProjectSectionLoading.js';
import styles from './ProjectSectionLoading.module.css';

const loadingStyles = readFileSync(
  resolve(
    process.cwd(),
    'apps/web/src/components/project-workspace/ProjectSectionLoading.module.css',
  ),
  'utf8',
);

const blockClass = (name: keyof typeof styles): string => {
  const className = styles[name];
  if (typeof className !== 'string') {
    throw new Error(`expected ProjectSectionLoading.module.css to define .${String(name)}`);
  }
  return className;
};

const occurrences = (markup: string, name: keyof typeof styles): number =>
  markup.split(`class="${blockClass(name)}"`).length - 1;

describe('ProjectSectionLoading', () => {
  test('announces each destination politely without rendering anything interactive', () => {
    for (const [section, label] of [
      ['overview', 'Loading Overview…'],
      ['decisions', 'Loading Decisions…'],
      ['timeline', 'Loading Timeline…'],
      ['review', 'Loading Review queue…'],
    ] as const) {
      const markup = renderToStaticMarkup(<ProjectSectionLoading section={section} />);
      expect(markup).toContain(label);
      expect(markup).toContain('aria-busy="true"');
      expect(markup).toContain('aria-live="polite"');
      expect(markup).not.toMatch(/<(button|a|input|select|textarea)\b/);
    }
  });

  test('hides every geometry block from assistive technology', () => {
    for (const section of ['overview', 'decisions', 'timeline', 'review'] as const) {
      const markup = renderToStaticMarkup(<ProjectSectionLoading section={section} />);
      const blocks = markup.match(/<div /g) ?? [];
      const hidden = markup.match(/<div class="[^"]*" aria-hidden="true"/g) ?? [];

      expect(blocks.length).toBeGreaterThan(1);
      expect(hidden).toHaveLength(blocks.length - 1);
      expect(markup).not.toContain('<svg');
    }
  });

  test('shapes Overview like a heading above two settings cards', () => {
    const markup = renderToStaticMarkup(<ProjectSectionLoading section="overview" />);

    expect(occurrences(markup, 'heading')).toBe(1);
    expect(occurrences(markup, 'card')).toBe(2);
    expect(occurrences(markup, 'control')).toBe(2);
  });

  test('shapes Decisions like a filter bar, a count, and decision rows', () => {
    const markup = renderToStaticMarkup(<ProjectSectionLoading section="decisions" />);

    expect(occurrences(markup, 'heading')).toBe(1);
    expect(occurrences(markup, 'filters')).toBe(1);
    expect(occurrences(markup, 'count')).toBe(1);
    expect(occurrences(markup, 'row')).toBe(4);
  });

  test('shapes Timeline like a date control above two belief sections', () => {
    const markup = renderToStaticMarkup(<ProjectSectionLoading section="timeline" />);

    expect(occurrences(markup, 'heading')).toBe(1);
    expect(occurrences(markup, 'dateControl')).toBe(1);
    expect(occurrences(markup, 'beliefSection')).toBe(2);
  });

  test('shapes Review queue like a heading above review cards', () => {
    const markup = renderToStaticMarkup(<ProjectSectionLoading section="review" />);

    expect(occurrences(markup, 'heading')).toBe(1);
    expect(occurrences(markup, 'reviewCard')).toBe(3);
  });

  test.each([
    ['overview', OverviewLoading, 'Loading Overview…'],
    ['decisions', DecisionsLoading, 'Loading Decisions…'],
    ['timeline', TimelineLoading, 'Loading Timeline…'],
    ['review', ReviewLoading, 'Loading Review queue…'],
  ])('serves the %s route fallback from the shared skeleton', (_section, Fallback, label) => {
    expect(renderToStaticMarkup(<Fallback />)).toContain(label);
  });

  test('animates with contained, reduced-motion-safe motion only', () => {
    expect(loadingStyles).not.toContain('transition: all');
    expect(loadingStyles).toContain('@keyframes project-section-shimmer');
    expect(loadingStyles).toContain('@keyframes project-section-arrive');
    expect(loadingStyles).toMatch(/\.section \{[^}]*animation: project-section-arrive 180ms/s);
    expect(loadingStyles).toMatch(/@keyframes project-section-arrive \{[^@]*opacity: 0;/s);
    expect(loadingStyles).toMatch(/@keyframes project-section-arrive \{[^@]*translateY\(5px\)/s);
    expect(loadingStyles).toMatch(/overflow: hidden;/);
    expect(loadingStyles).toContain('@media (prefers-reduced-motion: reduce)');

    const reducedMotion = loadingStyles.slice(
      loadingStyles.indexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(reducedMotion).toContain('animation: none;');
    expect(reducedMotion).toContain('transition: none;');
    expect(reducedMotion).toContain('transform: none;');
  });
});
