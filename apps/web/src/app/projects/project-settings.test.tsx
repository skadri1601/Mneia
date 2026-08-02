import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ManagedProject } from '../../server/store/project-store.js';
import { ProjectSettings } from './project-settings.js';

const PROJECT: ManagedProject = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  teamId: '33333333-3333-4333-8333-333333333333',
  slug: 'stealth-startup',
  displayName: 'Mneia',
  repoUrl: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  archivedAt: null,
};

describe('ProjectSettings', () => {
  it('renders labelled rename and slug-confirmed archive forms', () => {
    const html = renderToStaticMarkup(
      <ProjectSettings project={PROJECT} renameAction={vi.fn()} archiveAction={vi.fn()} />,
    );

    expect(html).toContain('Project name');
    expect(html).toContain('name="displayName"');
    expect(html).toContain('maxLength="128"');
    expect(html).toContain('Repository binding');
    expect(html).toContain('stealth-startup');
    expect(html).toContain('name="confirmation"');
    expect(html).toContain('Type the repository binding to confirm');
    expect(html).toContain('Archive project');
  });

  it('renders stable notices and validation errors accessibly', () => {
    const html = renderToStaticMarkup(
      <ProjectSettings
        project={PROJECT}
        renameAction={vi.fn()}
        archiveAction={vi.fn()}
        notice="renamed"
        error="invalid_name"
      />,
    );

    expect(html).toContain('Project name updated.');
    expect(html).toContain('Enter a project name between 1 and 128 characters.');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="display-name-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="project-name-help display-name-error"');
    expect(html).toContain('autoComplete="off"');
  });

  it('makes an archived project read-only', () => {
    const html = renderToStaticMarkup(
      <ProjectSettings
        project={{ ...PROJECT, archivedAt: new Date('2026-08-02T00:00:00.000Z') }}
        renameAction={vi.fn()}
        archiveAction={vi.fn()}
      />,
    );

    expect(html).toContain('This project is archived.');
    expect(html).not.toContain('<form');
  });
});
