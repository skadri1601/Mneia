import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DatabasePool } from './database.js';
import { LazyPostgresConnectionSource } from './database.js';
import { createProjectStore, projectStore } from './project-runtime.js';

const unusedPool = (): DatabasePool => {
  throw new Error('the runtime composition test must not open a connection');
};

describe('createProjectStore', () => {
  it('builds a store exposing the whole ProjectControlStore contract', () => {
    const store = createProjectStore(new LazyPostgresConnectionSource({ createPool: unusedPool }));

    expect(typeof store.listProjects).toBe('function');
    expect(typeof store.getProject).toBe('function');
    expect(typeof store.renameProject).toBe('function');
    expect(typeof store.archiveProject).toBe('function');
  });

  it('builds a distinct store per connection source', () => {
    const first = createProjectStore(new LazyPostgresConnectionSource({ createPool: unusedPool }));
    const second = createProjectStore(new LazyPostgresConnectionSource({ createPool: unusedPool }));

    expect(first).not.toBe(second);
  });

  it('does not touch the database while composing the store', () => {
    expect(() =>
      createProjectStore(new LazyPostgresConnectionSource({ createPool: unusedPool })),
    ).not.toThrow();
  });
});

describe('projectStore', () => {
  it('exposes the whole ProjectControlStore contract to the route layer', () => {
    expect(typeof projectStore.listProjects).toBe('function');
    expect(typeof projectStore.getProject).toBe('function');
    expect(typeof projectStore.renameProject).toBe('function');
    expect(typeof projectStore.archiveProject).toBe('function');
  });

  it('is a single shared instance, so routes and server actions share one pool', async () => {
    const reimported = await import('./project-runtime.js');

    expect(reimported.projectStore).toBe(projectStore);
  });
});
