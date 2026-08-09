export const PROJECT_MENU_STORAGE_KEY = 'mneia.project-menu.v1';
export const PROJECT_MENU_QUERY = '(max-width: 734px)';

export type DesktopPreference = 'open' | 'closed';

export interface ReadStorage {
  getItem(key: string): string | null;
}

export interface WriteStorage {
  setItem(key: string, value: string): void;
}

export interface ProjectMenuState {
  readonly desktopOpen: boolean;
  readonly mobile: boolean;
  readonly mobileOpen: boolean;
}

export type ProjectMenuAction =
  | { readonly type: 'desktop_hydrated'; readonly preference: DesktopPreference }
  | { readonly type: 'media_changed'; readonly mobile: boolean }
  | { readonly type: 'toggled' }
  | { readonly type: 'dismissed' };

const isDesktopPreference = (value: string | null): value is DesktopPreference =>
  value === 'open' || value === 'closed';

export const readDesktopPreference = (storage: ReadStorage): DesktopPreference => {
  try {
    const value = storage.getItem(PROJECT_MENU_STORAGE_KEY);
    return isDesktopPreference(value) ? value : 'open';
  } catch {
    return 'open';
  }
};

export const writeDesktopPreference = (
  storage: WriteStorage,
  preference: DesktopPreference,
): boolean => {
  try {
    storage.setItem(PROJECT_MENU_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
};

export const createProjectMenuState = (preference: DesktopPreference): ProjectMenuState => ({
  desktopOpen: preference === 'open',
  mobile: false,
  mobileOpen: false,
});

export const projectMenuOpen = (state: ProjectMenuState): boolean =>
  state.mobile ? state.mobileOpen : state.desktopOpen;

export const projectMenuReducer = (
  state: ProjectMenuState,
  action: ProjectMenuAction,
): ProjectMenuState => {
  switch (action.type) {
    case 'desktop_hydrated':
      return { ...state, desktopOpen: action.preference === 'open' };
    case 'media_changed':
      return { ...state, mobile: action.mobile, mobileOpen: false };
    case 'toggled':
      return state.mobile
        ? { ...state, mobileOpen: !state.mobileOpen }
        : { ...state, desktopOpen: !state.desktopOpen };
    case 'dismissed':
      return state.mobile && state.mobileOpen ? { ...state, mobileOpen: false } : state;
  }
};

const PROJECT_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PROJECT_WORKSPACE_PATH = new RegExp(
  `^/projects/${PROJECT_ID}(?:/(?:decisions|timeline|review))?$`,
  'i',
);

export const isProjectWorkspacePath = (pathname: string): boolean =>
  PROJECT_WORKSPACE_PATH.test(pathname);

export const PROJECT_MENU_BOOTSTRAP = `(() => {
  let preference = 'open';
  try {
    const stored = window.localStorage.getItem('${PROJECT_MENU_STORAGE_KEY}');
    if (stored === 'closed') preference = 'closed';
  } catch {
    preference = 'open';
  }
  let mobile = false;
  try {
    mobile = window.matchMedia('${PROJECT_MENU_QUERY}').matches;
  } catch {
    mobile = false;
  }
  document.documentElement.dataset.projectMenu = mobile ? 'closed' : preference;
})();`;
