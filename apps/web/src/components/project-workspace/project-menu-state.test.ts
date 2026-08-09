// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createProjectMenuState,
  isProjectWorkspacePath,
  PROJECT_MENU_BOOTSTRAP,
  PROJECT_MENU_QUERY,
  PROJECT_MENU_STORAGE_KEY,
  projectMenuOpen,
  projectMenuReducer,
  readDesktopPreference,
  writeDesktopPreference,
} from './project-menu-state.js';

const projectId = '123e4567-e89b-12d3-a456-426614174000';

describe('project menu state', () => {
  beforeEach(() => {
    document.documentElement.dataset.projectMenu = '';
  });

  test('defaults missing storage to desktop open', () => {
    expect(readDesktopPreference({ getItem: () => null })).toBe('open');
  });

  test('defaults invalid storage to desktop open', () => {
    expect(readDesktopPreference({ getItem: () => 'expanded' })).toBe('open');
  });

  test('restores a valid closed storage value', () => {
    expect(readDesktopPreference({ getItem: () => 'closed' })).toBe('closed');
  });

  test('falls back open when storage read throws', () => {
    expect(
      readDesktopPreference({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('open');
  });

  test('returns false when storage write fails without throwing', () => {
    const storage = {
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(writeDesktopPreference(storage, 'closed')).toBe(false);
  });

  test('writes the versioned key and exact preference value', () => {
    const setItem = vi.fn();
    expect(writeDesktopPreference({ setItem }, 'closed')).toBe(true);
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(PROJECT_MENU_STORAGE_KEY, 'closed');
  });

  test('createProjectMenuState starts desktop open and mobile closed', () => {
    expect(createProjectMenuState('open')).toEqual({
      desktopOpen: true,
      mobile: false,
      mobileOpen: false,
    });
  });

  test('mobile toggle changes only mobileOpen after media enters mobile', () => {
    const state = projectMenuReducer(createProjectMenuState('closed'), {
      type: 'media_changed',
      mobile: true,
    });
    const next = projectMenuReducer(state, { type: 'toggled' });
    expect(next).toEqual({ desktopOpen: false, mobile: true, mobileOpen: true });
  });

  test('desktop toggle changes only desktopOpen', () => {
    const state = createProjectMenuState('open');
    expect(projectMenuReducer(state, { type: 'toggled' })).toEqual({
      desktopOpen: false,
      mobile: false,
      mobileOpen: false,
    });
  });

  test('dismiss closes an open mobile drawer', () => {
    const mobile = projectMenuReducer(
      { desktopOpen: true, mobile: true, mobileOpen: true },
      { type: 'dismissed' },
    );
    expect(mobile.mobileOpen).toBe(false);
  });

  test('dismiss is a no-op on desktop', () => {
    const desktop = projectMenuReducer(
      { desktopOpen: true, mobile: false, mobileOpen: true },
      { type: 'dismissed' },
    );
    expect(desktop).toEqual({ desktopOpen: true, mobile: false, mobileOpen: true });
  });

  test('media changes close the mobile drawer', () => {
    const state = { desktopOpen: false, mobile: true, mobileOpen: true };
    expect(projectMenuReducer(state, { type: 'media_changed', mobile: true })).toEqual({
      desktopOpen: false,
      mobile: true,
      mobileOpen: false,
    });
  });

  test('restoring desktop reveals the saved desktop preference', () => {
    const state = { desktopOpen: false, mobile: true, mobileOpen: true };
    const desktop = projectMenuReducer(state, { type: 'media_changed', mobile: false });
    expect(desktop).toEqual({ desktopOpen: false, mobile: false, mobileOpen: false });
    expect(projectMenuOpen(desktop)).toBe(false);
  });

  test('desktop_hydrated restores the open desktop preference', () => {
    const state = createProjectMenuState('closed');
    expect(projectMenuReducer(state, { type: 'desktop_hydrated', preference: 'open' })).toEqual({
      desktopOpen: true,
      mobile: false,
      mobileOpen: false,
    });
  });

  test('matches the project root and allowlisted project subpaths', () => {
    expect(isProjectWorkspacePath(`/projects/${projectId}`)).toBe(true);
    expect(isProjectWorkspacePath(`/projects/${projectId}/decisions`)).toBe(true);
    expect(isProjectWorkspacePath(`/projects/${projectId}/timeline`)).toBe(true);
    expect(isProjectWorkspacePath(`/projects/${projectId}/review`)).toBe(true);
  });

  test('rejects collection routes malformed IDs unknown suffixes and extra segments', () => {
    expect(isProjectWorkspacePath('/projects')).toBe(false);
    expect(isProjectWorkspacePath('/projects/new')).toBe(false);
    expect(isProjectWorkspacePath('/projects/not-a-uuid')).toBe(false);
    expect(isProjectWorkspacePath(`/projects/${projectId}/settings`)).toBe(false);
    expect(isProjectWorkspacePath(`/projects/${projectId}/review/extra`)).toBe(false);
  });

  test('bootstrap restores exact closed preference on desktop', () => {
    runBootstrap('closed', false);
    expect(document.documentElement.dataset.projectMenu).toBe('closed');
  });

  test('bootstrap restores exact open preference on desktop', () => {
    runBootstrap('open', false);
    expect(document.documentElement.dataset.projectMenu).toBe('open');
  });

  test('bootstrap defaults invalid preference open on desktop', () => {
    runBootstrap('expanded', false);
    expect(document.documentElement.dataset.projectMenu).toBe('open');
  });

  test('bootstrap defaults open when storage read throws', () => {
    runBootstrap(undefined, false, true);
    expect(document.documentElement.dataset.projectMenu).toBe('open');
  });

  test('bootstrap forces saved open preference closed on mobile', () => {
    runBootstrap('open', true);
    expect(document.documentElement.dataset.projectMenu).toBe('closed');
  });

  test('bootstrap never includes or sets project-menu-ready', () => {
    runBootstrap('open', false);
    expect(PROJECT_MENU_BOOTSTRAP).not.toContain('project-menu-ready');
    expect(document.documentElement.dataset.projectMenuReady).toBeUndefined();
  });

  function runBootstrap(stored: string | undefined, mobile: boolean, throws = false): void {
    const getItem = vi.fn(() => {
      if (throws) throw new Error('blocked');
      return stored ?? null;
    });
    const matchMedia = vi.fn(() => ({ matches: mobile }));
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem } });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
    new Function(PROJECT_MENU_BOOTSTRAP)();
    expect(getItem).toHaveBeenCalledWith(PROJECT_MENU_STORAGE_KEY);
    expect(matchMedia).toHaveBeenCalledWith(PROJECT_MENU_QUERY);
  }
});
