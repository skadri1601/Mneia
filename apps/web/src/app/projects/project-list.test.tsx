import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ManagedProject } from '../../server/store/project-store.js';
import { ProjectList } from './project-list.js';

const CREATED_AT = new Date('2026-08-01T00:00:00.000Z');

const project = (overrides: Partial<ManagedProject> = {}): ManagedProject => ({
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  teamId: '33333333-3333-4333-8333-333333333333',
  slug: 'stealth-startup',
  displayName: 'Mneia',
  repoUrl: 'https://github.com/mneia/mneia',
  createdAt: CREATED_AT,
  archivedAt: null,
  ...overrides,
});

describe('ProjectList', () => {
  it('renders an active project with its immutable repository binding', () => {
    const html = renderToStaticMarkup(<ProjectList projects={[project()]} />);

    expect(html).toContain('Mneia');
    expect(html).toContain('stealth-startup');
    expect(html).toContain('/projects/11111111-1111-4111-8111-111111111111');
    expect(html).toContain('Repository binding');
    expect(html).not.toContain('<details');
  });

  it('shows a useful empty state without inventing browser-side project creation', () => {
    const html = renderToStaticMarkup(<ProjectList projects={[]} />);

    expect(html).toContain('No projects attached yet');
    expect(html).toContain('mneia init');
    expect(html).not.toContain('Create project');
  });

  it('separates archived projects from active work', () => {
    const html = renderToStaticMarkup(
      <ProjectList
        projects={[
          project(),
          project({
            id: '44444444-4444-4444-8444-444444444444',
            slug: 'retired-api',
            displayName: 'Retired API',
            archivedAt: new Date('2026-08-02T00:00:00.000Z'),
          }),
        ]}
      />,
    );

    expect(html).toContain('Archived (1)');
    expect(html).toContain('Retired API');
    expect(html).toContain('Archived project');
  });
});
