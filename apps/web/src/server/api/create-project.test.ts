import type { NewProject, Project, ScopedStore } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { handleCreateProject } from './handlers.js';

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';

const project = (overrides: Partial<Project> = {}): Project => ({
  id: PROJECT,
  workspaceId: WORKSPACE,
  teamId: null,
  slug: 'mneia',
  repoUrl: null,
  createdAt: new Date('2026-08-08T10:00:00.000Z'),
  ...overrides,
});

interface Harness {
  readonly store: ScopedStore;
  readonly created: NewProject[];
  readonly lookups: string[];
}

const harness = (bySlug: readonly (Project | null)[], onCreate?: () => never): Harness => {
  const created: NewProject[] = [];
  const lookups: string[] = [];
  const queue = [...bySlug];

  const store = {
    scope: { workspaceId: WORKSPACE, actorId: ACTOR },
    getProjectBySlug: async (slug: string): Promise<Project | null> => {
      lookups.push(slug);
      return queue.shift() ?? null;
    },
    createProject: async (input: NewProject): Promise<Project> => {
      created.push(input);
      if (onCreate !== undefined) {
        onCreate();
      }
      return project({ slug: input.slug });
    },
  } as unknown as ScopedStore;

  return { store, created, lookups };
};

const input = { slug: 'mneia', displayName: 'Mneia', repoUrl: null };

describe('handleCreateProject', () => {
  it('creates the project when the slug is free, and says it created it', async () => {
    const sink = harness([null]);

    const result = await handleCreateProject(sink.store, input);

    expect(result.created).toBe(true);
    expect(result.project.slug).toBe('mneia');
    expect(sink.created).toEqual([{ slug: 'mneia', displayName: 'Mneia', repoUrl: null }]);
  });

  it('attaches to the existing project rather than failing, so a second init is not an error', async () => {
    const sink = harness([project()]);

    const result = await handleCreateProject(sink.store, input);

    expect(result.created).toBe(false);
    expect(result.project.id).toBe(PROJECT);
    expect(sink.created).toEqual([]);
  });

  it('returns the winner when a concurrent init took the slug between the read and the insert', async () => {
    const sink = harness([null, project()], () => {
      throw new Error(
        'duplicate key value violates unique constraint "project_workspace_id_slug_key"',
      );
    });

    const result = await handleCreateProject(sink.store, input);

    expect(result.created).toBe(false);
    expect(result.project.id).toBe(PROJECT);
    expect(sink.lookups).toEqual(['mneia', 'mneia']);
  });

  it('rethrows a create failure that is not a lost race, rather than reporting success', async () => {
    const sink = harness([null, null], () => {
      throw new Error('connection terminated unexpectedly');
    });

    await expect(handleCreateProject(sink.store, input)).rejects.toThrow(
      'connection terminated unexpectedly',
    );
  });

  it('never lets the caller choose the workspace — it comes from the scope', async () => {
    const sink = harness([null]);

    await handleCreateProject(sink.store, {
      ...input,
      ...({ workspaceId: '99999999-9999-4999-8999-999999999999' } as Record<string, unknown>),
    });

    expect(sink.created[0]).toEqual({ slug: 'mneia', displayName: 'Mneia', repoUrl: null });
  });
});
