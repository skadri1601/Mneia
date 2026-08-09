'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from 'react';
import styles from '../AppHeader.module.css';
import {
  createProjectMenuState,
  isProjectWorkspacePath,
  PROJECT_MENU_QUERY,
  projectMenuOpen,
  projectMenuReducer,
  readDesktopPreference,
  writeDesktopPreference,
} from './project-menu-state.js';

export interface ProjectMenuContextValue {
  readonly active: boolean;
  readonly mobile: boolean;
  readonly open: boolean;
  readonly toggleRef: RefObject<HTMLButtonElement | null>;
  readonly toggle: () => void;
  readonly dismiss: (restoreFocus: boolean) => void;
}

const ProjectMenuContext = createContext<ProjectMenuContextValue | undefined>(undefined);

export function ProjectMenuProvider({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const pathname = usePathname();
  const active = isProjectWorkspacePath(pathname);
  const [state, dispatch] = useReducer(projectMenuReducer, undefined, () =>
    createProjectMenuState('open'),
  );
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const open = projectMenuOpen(state);

  useLayoutEffect(() => {
    const storage = getLocalStorage();
    const mediaQuery = getProjectMenuMediaQuery();
    dispatch({
      type: 'desktop_hydrated',
      preference: storage ? readDesktopPreference(storage) : 'open',
    });
    dispatch({
      type: 'media_changed',
      mobile: mediaQuery ? readMediaQueryMatch(mediaQuery) : false,
    });

    const onMediaChanged = (event: MediaQueryListEvent) => {
      dispatch({ type: 'media_changed', mobile: event.matches });
    };

    return subscribeToMediaQuery(mediaQuery, onMediaChanged);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.projectMenu = open ? 'open' : 'closed';
  }, [open]);

  useLayoutEffect(() => {
    if (restoreFocus.current && !open) {
      toggleRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [open]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.documentElement.dataset.projectMenuReady = 'true';
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (pathname) {
      dispatch({ type: 'dismissed' });
    }
  }, [pathname]);

  const toggle = useCallback(() => {
    if (!state.mobile) {
      const storage = getLocalStorage();
      if (storage) {
        writeDesktopPreference(storage, state.desktopOpen ? 'closed' : 'open');
      }
    }
    dispatch({ type: 'toggled' });
  }, [state.desktopOpen, state.mobile]);

  const dismiss = useCallback((shouldRestoreFocus: boolean) => {
    restoreFocus.current = shouldRestoreFocus;
    dispatch({ type: 'dismissed' });
  }, []);

  return (
    <ProjectMenuContext.Provider
      value={{ active, mobile: state.mobile, open, toggleRef, toggle, dismiss }}
    >
      {children}
    </ProjectMenuContext.Provider>
  );
}

export function ProjectMenuToggle(): ReactNode {
  const pathname = usePathname();
  const { active, open, toggle, toggleRef } = useProjectMenu();

  if (!active || !isProjectWorkspacePath(pathname)) {
    return null;
  }

  const label = open ? 'Hide project menu' : 'Show project menu';
  return (
    <button
      aria-controls="project-navigation"
      aria-expanded={open}
      aria-label={label}
      className={styles.projectMenuToggle}
      onClick={toggle}
      ref={toggleRef}
      title={label}
      type="button"
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </button>
  );
}

export function ProjectSkipLink(): ReactNode {
  const pathname = usePathname();
  const { active } = useProjectMenu();

  if (!active || !isProjectWorkspacePath(pathname)) {
    return null;
  }

  return (
    <a className="project-skip-link" href="#project-content">
      Skip to project content
    </a>
  );
}

export function useProjectMenu(): ProjectMenuContextValue {
  const context = useContext(ProjectMenuContext);
  if (!context) {
    throw new Error('useProjectMenu must be used inside ProjectMenuProvider');
  }
  return context;
}

function getLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function getProjectMenuMediaQuery(): MediaQueryList | undefined {
  try {
    const matchMedia = window.matchMedia;
    return typeof matchMedia === 'function'
      ? matchMedia.call(window, PROJECT_MENU_QUERY)
      : undefined;
  } catch {
    return undefined;
  }
}

function readMediaQueryMatch(mediaQuery: MediaQueryList): boolean {
  try {
    return mediaQuery.matches;
  } catch {
    return false;
  }
}

function subscribeToMediaQuery(
  mediaQuery: MediaQueryList | undefined,
  listener: (event: MediaQueryListEvent) => void,
): () => void {
  if (!mediaQuery) {
    return () => undefined;
  }

  try {
    if (
      typeof mediaQuery.addEventListener !== 'function' ||
      typeof mediaQuery.removeEventListener !== 'function'
    ) {
      return () => undefined;
    }
    mediaQuery.addEventListener('change', listener);
  } catch {
    return () => undefined;
  }

  return () => {
    try {
      mediaQuery.removeEventListener('change', listener);
    } catch {
      return;
    }
  };
}
