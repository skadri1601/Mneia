// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/projects' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

import { ProjectMenuProvider, ProjectMenuToggle, ProjectSkipLink } from './ProjectMenuProvider.js';
import {
  PROJECT_MENU_BOOTSTRAP,
  PROJECT_MENU_QUERY,
  PROJECT_MENU_STORAGE_KEY,
} from './project-menu-state.js';

const projectId = '123e4567-e89b-12d3-a456-426614174000';
const headerStyles = readFileSync(
  resolve(process.cwd(), 'apps/web/src/components/AppHeader.module.css'),
  'utf8',
);
const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');

class MatchMediaController {
  #matches = false;
  #eventListeners = new Set<EventListener>();
  #legacyListeners = new Set<(this: MediaQueryList, event: MediaQueryListEvent) => unknown>();

  readonly matchMedia: typeof window.matchMedia = (query) => {
    if (query !== PROJECT_MENU_QUERY) {
      throw new Error(`expected query ${PROJECT_MENU_QUERY}; received ${query}`);
    }

    const controller = this;
    const mediaQueryList: MediaQueryList = {
      get matches() {
        return controller.#matches;
      },
      media: PROJECT_MENU_QUERY,
      onchange: null,
      addListener: (listener) => {
        if (listener) {
          this.#legacyListeners.add(listener);
        }
      },
      removeListener: (listener) => {
        if (listener) {
          this.#legacyListeners.delete(listener);
        }
      },
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (typeof listener === 'function') {
          this.#eventListeners.add(listener);
        }
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (typeof listener === 'function') {
          this.#eventListeners.delete(listener);
        }
      },
      dispatchEvent: () => true,
    };

    return mediaQueryList;
  };

  setMobile(matches: boolean): void {
    this.#matches = matches;
    const event = Object.assign(new Event('change'), {
      matches,
      media: PROJECT_MENU_QUERY,
    }) as MediaQueryListEvent;
    for (const listener of this.#eventListeners) {
      listener(event);
    }
    for (const listener of this.#legacyListeners) {
      listener.call(this.matchMedia(PROJECT_MENU_QUERY), event as MediaQueryListEvent);
    }
  }
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let matchMediaController: MatchMediaController;
let animationFrame = 0;
let animationFrames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  navigation.pathname = `/projects/${projectId}`;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-project-menu');
  document.documentElement.removeAttribute('data-project-menu-ready');
  animationFrame = 0;
  animationFrames = new Map();
  matchMediaController = new MatchMediaController();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: matchMediaController.matchMedia,
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      animationFrame += 1;
      animationFrames.set(animationFrame, callback);
      return animationFrame;
    },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: (frame: number) => animationFrames.delete(frame),
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  root = undefined;
  container = undefined;
  restoreWindowProperty('localStorage', localStorageDescriptor);
  restoreWindowProperty('matchMedia', matchMediaDescriptor);
  vi.restoreAllMocks();
});

describe('ProjectMenuProvider', () => {
  test('renders the desktop project-menu control open with accessible X decoration', async () => {
    await renderMenu();

    const toggle = getToggle();
    expect(toggle.getAttribute('aria-controls')).toBe('project-navigation');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Hide project menu');
    expect(toggle.getAttribute('title')).toBe('Hide project menu');
    expect(toggle.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(3);
  });

  test('persists desktop toggles and reconciles the document state', async () => {
    await renderMenu();

    await clickToggle();
    expect(getToggle().getAttribute('aria-expanded')).toBe('false');
    expect(getToggle().getAttribute('aria-label')).toBe('Show project menu');
    expect(getToggle().getAttribute('title')).toBe('Show project menu');
    expect(document.documentElement.dataset.projectMenu).toBe('closed');
    expect(window.localStorage.getItem(PROJECT_MENU_STORAGE_KEY)).toBe('closed');

    await clickToggle();
    expect(document.documentElement.dataset.projectMenu).toBe('open');
    expect(window.localStorage.getItem(PROJECT_MENU_STORAGE_KEY)).toBe('open');
  });

  test('keeps the visible state responsive when desktop storage writes fail', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    await renderMenu();

    await clickToggle();
    expect(getToggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.documentElement.dataset.projectMenu).toBe('closed');
    expect(setItem).toHaveBeenCalledWith(PROJECT_MENU_STORAGE_KEY, 'closed');
  });

  test('does not persist a mobile drawer toggle as a desktop preference', async () => {
    await renderMenu();
    await act(async () => matchMediaController.setMobile(true));

    await clickToggle();
    expect(getToggle().getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem(PROJECT_MENU_STORAGE_KEY)).toBeNull();
  });

  test('keeps rendering when the localStorage property getter throws', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('storage blocked');
      },
    });

    await renderMenu();
    await clickToggle();

    expect(getToggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.documentElement.dataset.projectMenu).toBe('closed');
  });

  test('falls back to desktop when matchMedia is unavailable', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });

    await renderMenu();
    await clickToggle();

    expect(getToggle().getAttribute('aria-expanded')).toBe('false');
  });

  test('falls back to desktop when matchMedia throws', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => {
        throw new Error('media blocked');
      },
    });

    await renderMenu();
    await clickToggle();

    expect(getToggle().getAttribute('aria-expanded')).toBe('false');
  });

  test('invokes matchMedia with the window receiver', async () => {
    let calledWithWindow = false;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: function (this: Window, query: string): MediaQueryList {
        if (this !== window) {
          throw new Error('matchMedia requires the window receiver');
        }
        calledWithWindow = true;
        matchMediaController.setMobile(true);
        return matchMediaController.matchMedia(query);
      },
    });

    await renderMenu();

    expect(calledWithWindow).toBe(true);
    expect(getToggle().getAttribute('aria-expanded')).toBe('false');
  });

  test('renders project-only controls only for allowlisted project paths', async () => {
    for (const pathname of ['/projects', '/projects/new', '/team']) {
      navigation.pathname = pathname;
      await renderMenu();
      expect(container?.querySelector('button')).toBeNull();
      expect(container?.querySelector('a[href="#project-content"]')).toBeNull();
      await unmountMenu();
    }

    for (const pathname of [`/projects/${projectId}`, `/projects/${projectId}/review`]) {
      navigation.pathname = pathname;
      await renderMenu();
      expect(container?.querySelector('button')).not.toBeNull();
      expect(container?.querySelector('a[href="#project-content"]')).not.toBeNull();
      await unmountMenu();
    }
  });

  test('marks project-menu hydration ready only after its animation frame', async () => {
    new Function(PROJECT_MENU_BOOTSTRAP)();
    await renderMenu();

    expect(document.documentElement.dataset.projectMenuReady).toBeUndefined();
    await flushAnimationFrame();
    expect(document.documentElement.dataset.projectMenuReady).toBe('true');
  });

  test('uses the bootstrap document state before hydration and only animates menu lines when ready', () => {
    expect(headerStyles).toContain('html[data-project-menu="open"]:not([data-project-menu-ready])');
    expect(headerStyles).toContain(
      'html[data-project-menu="closed"]:not([data-project-menu-ready])',
    );
    expect(headerStyles).toContain('html[data-project-menu-ready] .projectMenuToggle span');
    expect(headerStyles).toMatch(
      /html\[data-project-menu-ready\] \.projectMenuToggle span \{[^}]*transition:/,
    );
    expect(headerStyles).not.toMatch(/^\.projectMenuToggle span \{[^}]*transition:/m);
  });

  test('disables menu-line motion for reduced-motion users', () => {
    expect(headerStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(headerStyles).toContain('transition: none;');
  });
});

async function renderMenu(): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ProjectMenuProvider>
        <ProjectSkipLink />
        <ProjectMenuToggle />
      </ProjectMenuProvider>,
    );
  });
}

async function unmountMenu(): Promise<void> {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  root = undefined;
  container = undefined;
}

function getToggle(): HTMLButtonElement {
  const toggle = container?.querySelector('button');
  if (!(toggle instanceof HTMLButtonElement)) {
    throw new Error('expected a project menu toggle button');
  }
  return toggle;
}

async function clickToggle(): Promise<void> {
  await act(async () => getToggle().click());
}

async function flushAnimationFrame(): Promise<void> {
  const callbacks = [...animationFrames.values()];
  animationFrames.clear();
  await act(async () => {
    for (const callback of callbacks) {
      callback(0);
    }
  });
}

function restoreWindowProperty(
  name: 'localStorage' | 'matchMedia',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor);
    return;
  }
  Reflect.deleteProperty(window, name);
}
