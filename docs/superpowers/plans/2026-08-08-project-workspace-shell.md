# Project Workspace Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every authenticated project route a persistent, collapsible, accessible workspace sidebar with route-aware navigation, loading skeletons, and restrained motion.

**Architecture:** A root client provider sits above both `AppHeader` and route content so one header toggle can control a nested project shell. A server layout resolves project identity and passes three serializable strings into a client shell; all domain reads remain server-side. Pure state helpers and a pre-paint document attribute prevent hydration flash, while route `loading.tsx` files reuse one skeleton component.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict mode, CSS Modules, Vitest 4, jsdom 26.1.0

---

## File map

**Create**

- `apps/web/src/components/project-workspace/project-menu-state.ts` — pure route, preference, and reducer behavior plus the pre-paint script.
- `apps/web/src/components/project-workspace/project-menu-state.test.ts` — storage and state-machine tests.
- `apps/web/src/components/project-workspace/ProjectMenuProvider.tsx` — root context, responsive state, persistence, dismissal, and header toggle.
- `apps/web/src/components/project-workspace/ProjectMenuProvider.test.tsx` — real DOM interaction tests.
- `apps/web/src/components/project-workspace/ProjectWorkspace.tsx` — text-only navigation, breadcrumb, backdrop, and content shell.
- `apps/web/src/components/project-workspace/ProjectWorkspace.test.tsx` — URLs, active route, breadcrumb, and text-only contract.
- `apps/web/src/components/project-workspace/ProjectWorkspace.module.css` — desktop/sidebar, mobile/drawer, focus, overflow, and entry motion.
- `apps/web/src/components/project-workspace/ProjectSectionLoading.tsx` — four destination-shaped skeleton variants.
- `apps/web/src/components/project-workspace/ProjectSectionLoading.module.css` — skeleton geometry and shimmer.
- `apps/web/src/components/project-workspace/ProjectSectionLoading.test.tsx` — loading accessibility and structure.
- `apps/web/src/components/project-workspace/project-workspace-styles.test.ts` — source-level motion and responsive safeguards.
- `apps/web/src/app/projects/[projectId]/layout.tsx` — scoped project lookup and shared shell.
- `apps/web/src/app/projects/[projectId]/layout.test.tsx` — shell composition and indistinguishable not-found tests.
- `apps/web/src/app/projects/[projectId]/loading.tsx` — Overview fallback.
- `apps/web/src/app/projects/[projectId]/decisions/loading.tsx` — Decisions fallback.
- `apps/web/src/app/projects/[projectId]/timeline/loading.tsx` — Timeline fallback.
- `apps/web/src/app/projects/[projectId]/review/loading.tsx` — Review queue fallback.
- `apps/web/src/app/projects/[projectId]/decisions/page.test.tsx` — decision-page regression coverage.
- `apps/web/src/app/projects/[projectId]/timeline/page.test.tsx` — timeline-page regression coverage.
- `apps/web/src/app/projects/[projectId]/review/page.test.tsx` — review-page regression coverage.

**Modify**

- `package.json` and `pnpm-lock.yaml` — add jsdom only; no Testing Library or animation dependency.
- `apps/web/src/app/layout.tsx` and `layout.test.tsx` — provider, pre-paint bootstrap, skip link, and header regression coverage.
- `apps/web/src/components/AppHeader.tsx` and `AppHeader.module.css` — far-left menu control while retaining every existing destination.
- `apps/web/src/app/globals.css` — skip-link and shell flex behavior.
- `apps/web/src/app/projects/project-settings.tsx`, `project-settings.test.tsx`, and `projects.module.css` — turn settings into concise Overview content and remove the old local nav.
- `apps/web/src/app/projects/[projectId]/decisions/page.tsx`, `timeline/page.tsx`, and `browse.module.css` — remove duplicated orientation, retain behavior, and replace undefined tokens.
- `apps/web/src/app/projects/[projectId]/review/page.tsx` and `review.module.css` — align heading, empty state, and tokens with the shell.

### Task 1: Pure menu state and DOM test environment

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/components/project-workspace/project-menu-state.test.ts`
- Create: `apps/web/src/components/project-workspace/project-menu-state.ts`

- [ ] **Step 1: Add the one DOM test dependency**

Run:

```powershell
pnpm.cmd add --save-dev --workspace-root --save-exact jsdom@26.1.0
```

Expected: `package.json` contains `"jsdom": "26.1.0"` in `devDependencies`, the lockfile changes, and existing dependencies are reused rather than reinstalled from scratch.

- [ ] **Step 2: Write failing state and persistence tests**

Create tests that import the wished-for API and cover one behavior per test:

```ts
import { describe, expect, it } from 'vitest';
import {
  createProjectMenuState,
  isProjectWorkspacePath,
  projectMenuOpen,
  projectMenuReducer,
  readDesktopPreference,
  writeDesktopPreference,
} from './project-menu-state.js';

describe('project menu state', () => {
  it('defaults desktop to open when no valid preference exists', () => {
    expect(readDesktopPreference({ getItem: () => null })).toBe('open');
    expect(readDesktopPreference({ getItem: () => 'maybe' })).toBe('open');
  });

  it('restores a valid closed desktop preference', () => {
    expect(readDesktopPreference({ getItem: () => 'closed' })).toBe('closed');
  });

  it('falls back open when storage cannot be read', () => {
    expect(readDesktopPreference({ getItem: () => { throw new Error('denied'); } })).toBe('open');
  });

  it('reports a failed preference write without throwing', () => {
    expect(writeDesktopPreference({ setItem: () => { throw new Error('full'); } }, 'closed')).toBe(false);
  });

  it('keeps mobile closed without overwriting the desktop preference', () => {
    const state = createProjectMenuState('closed');
    const mobile = projectMenuReducer(state, { type: 'media_changed', mobile: true });
    const opened = projectMenuReducer(mobile, { type: 'toggled' });
    expect(projectMenuOpen(mobile)).toBe(false);
    expect(projectMenuOpen(opened)).toBe(true);
    expect(opened.desktopOpen).toBe(false);
  });

  it('dismisses only an open mobile drawer', () => {
    const mobile = projectMenuReducer(
      createProjectMenuState('open'),
      { type: 'media_changed', mobile: true },
    );
    expect(projectMenuOpen(projectMenuReducer(mobile, { type: 'dismissed' }))).toBe(false);
  });

  it('matches UUID project routes but not the project index', () => {
    expect(isProjectWorkspacePath('/projects/559eab63-16ac-4ac3-b8ec-51f0d79b94b6')).toBe(true);
    expect(isProjectWorkspacePath('/projects/559eab63-16ac-4ac3-b8ec-51f0d79b94b6/timeline')).toBe(true);
    expect(isProjectWorkspacePath('/projects')).toBe(false);
    expect(isProjectWorkspacePath('/projects/new')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
node node_modules\vitest\vitest.mjs run "apps/web/src/components/project-workspace/project-menu-state.test.ts"
```

Expected: FAIL because `project-menu-state.ts` does not exist.

- [ ] **Step 4: Implement the minimal pure model**

Create strict types and total functions:

```ts
export const PROJECT_MENU_STORAGE_KEY = 'mneia.project-menu.v1';
export const PROJECT_MENU_QUERY = '(max-width: 734px)';

export type DesktopPreference = 'open' | 'closed';

interface ReadStorage { getItem(key: string): string | null; }
interface WriteStorage { setItem(key: string, value: string): void; }

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

export const readDesktopPreference = (storage: ReadStorage): DesktopPreference => {
  try {
    return storage.getItem(PROJECT_MENU_STORAGE_KEY) === 'closed' ? 'closed' : 'open';
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
```

Implement the reducer without mutating state. Desktop toggle changes `desktopOpen`; mobile toggle changes only `mobileOpen`; media changes always close the drawer; dismiss is a no-op on desktop. Implement `isProjectWorkspacePath()` with a UUID-shaped project-segment regex and an allowlist of `decisions`, `timeline`, and `review` suffixes. Export a bootstrap script string that reads only `open` or `closed`, forces mobile closed, and sets `document.documentElement.dataset.projectMenu` before paint.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Step 3 command.

Expected: all state tests PASS with no warnings.

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml apps/web/src/components/project-workspace/project-menu-state.ts apps/web/src/components/project-workspace/project-menu-state.test.ts
git commit -m "MNE-25: define project menu state"
```

### Task 2: Root provider and persistent header toggle

**Files:**
- Create: `apps/web/src/components/project-workspace/ProjectMenuProvider.tsx`
- Create: `apps/web/src/components/project-workspace/ProjectMenuProvider.test.tsx`
- Modify: `apps/web/src/components/AppHeader.tsx`
- Modify: `apps/web/src/components/AppHeader.module.css`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/layout.test.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing jsdom tests for the real header control**

Use `// @vitest-environment jsdom`, React 19 `act`, `createRoot`, a mutable mocked `usePathname`, and a `matchMedia` stub. Render the provider around `AppHeader` and a probe consuming the context. Assert separately that:

```ts
expect(toggle.getAttribute('aria-controls')).toBe('project-navigation');
expect(toggle.getAttribute('aria-expanded')).toBe('true');
expect(toggle.getAttribute('aria-label')).toBe('Hide project menu');
expect(toggle.getAttribute('title')).toBe('Hide project menu');
```

Clicking the toggle must change the expanded state and persist `closed`. A non-project pathname must render no project-menu button. A throwing `localStorage.setItem` stub must not prevent the toggle state from changing.

Execute `PROJECT_MENU_BOOTSTRAP` inside jsdom with controlled `localStorage` and `matchMedia` values. Prove that a valid closed desktop preference sets `data-project-menu="closed"`, an invalid value falls back to `open`, and mobile is forced closed regardless of the saved desktop preference. Stub `requestAnimationFrame` around the real provider and prove `data-project-menu-ready` is absent before the callback and present only after it runs.

Extend `layout.test.tsx` so all existing header links and Clerk behavior remain asserted after wrapping the header and children in the provider.

- [ ] **Step 2: Run the tests and verify RED**

```powershell
node node_modules\vitest\vitest.mjs run "apps/web/src/components/project-workspace/ProjectMenuProvider.test.tsx" "apps/web/src/app/layout.test.tsx"
```

Expected: FAIL because the provider and toggle are missing.

- [ ] **Step 3: Implement provider, toggle, bootstrap, and skip link**

`ProjectMenuProvider.tsx` is a client component with this public contract:

```ts
interface ProjectMenuContextValue {
  readonly active: boolean;
  readonly mobile: boolean;
  readonly open: boolean;
  readonly toggleRef: RefObject<HTMLButtonElement | null>;
  readonly toggle: () => void;
  readonly dismiss: (restoreFocus: boolean) => void;
}

export function ProjectMenuProvider({ children }: Readonly<{ children: ReactNode }>): ReactNode;
export function ProjectMenuToggle(): ReactNode;
export function ProjectSkipLink(): ReactNode;
export function useProjectMenu(): ProjectMenuContextValue;
```

Use `useReducer`, `usePathname`, `matchMedia`, and layout effects. Reconcile the server-safe open state with the pre-paint document attribute, then set `data-project-menu-ready` on the next animation frame. Desktop toggles update state, the document attribute, and local storage; mobile toggles never write the desktop preference. Pathname changes dismiss an open mobile drawer.

In `RootLayout`, render the bootstrap in `<head>`, render `ProjectSkipLink`, and wrap both `AppHeader` and `{children}` with `ProjectMenuProvider`. `ProjectSkipLink` returns the `Skip to project content` anchor only while a project workspace is active, so non-project routes never contain a skip target that does not exist. Add narrowly scoped hydration-warning suppression only to the element whose data attribute the bootstrap mutates.

In `AppHeader`, place `<ProjectMenuToggle />` before the existing brand inside a new identity wrapper. Render three CSS lines with `aria-hidden="true"`; the button itself carries the accessible name and matching `title`. When `aria-expanded="true"`, CSS rotates the first and third lines into a close treatment and hides the middle line; when false, the familiar three-line symbol returns. Do not change any destination, header height, wordmark, Clerk component, or marketing URL.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: provider and layout tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/components/project-workspace/ProjectMenuProvider.tsx apps/web/src/components/project-workspace/ProjectMenuProvider.test.tsx apps/web/src/components/AppHeader.tsx apps/web/src/components/AppHeader.module.css apps/web/src/app/layout.tsx apps/web/src/app/layout.test.tsx apps/web/src/app/globals.css
git commit -m "MNE-25: add the project menu control"
```

### Task 3: Shared project shell and server layout

**Files:**
- Create: `apps/web/src/components/project-workspace/ProjectWorkspace.tsx`
- Create: `apps/web/src/components/project-workspace/ProjectWorkspace.test.tsx`
- Create: `apps/web/src/components/project-workspace/ProjectWorkspace.module.css`
- Create: `apps/web/src/app/projects/[projectId]/layout.tsx`
- Create: `apps/web/src/app/projects/[projectId]/layout.test.tsx`

- [ ] **Step 1: Write failing navigation and layout tests**

For project `{ id, displayName: 'Analytical Engine', slug: 'analytical-engine' }`, render the real shell with `usePathname()` mocked to each route and assert the exact links:

```ts
const destinations = [
  ['/projects/PROJECT_ID', 'Overview'],
  ['/projects/PROJECT_ID/decisions', 'Decisions'],
  ['/projects/PROJECT_ID/timeline', 'Timeline'],
  ['/projects/PROJECT_ID/review', 'Review queue'],
  ['/projects', 'All projects'],
] as const;
```

Assert one and only one `aria-current="page"`, breadcrumb links to `/projects` and Overview, project display name and binding, `id="project-navigation"`, and no `<svg` or destination icon markup inside the navigation. Read the CSS module and assert the All projects destination has a dedicated class whose layout places it at the bottom after an automatic top margin.

The server-layout tests must mock `getCurrentAccount`, `getProject`, `projectStore`, and `notFound`. Assert successful composition, then assert `invalid_project_id`, `project_not_found`, and `forbidden` all call the same `notFound()` path while an unexpected error rejects.

- [ ] **Step 2: Run tests and verify RED**

```powershell
node node_modules\vitest\vitest.mjs run "apps/web/src/components/project-workspace/ProjectWorkspace.test.tsx" "apps/web/src/app/projects/[projectId]/layout.test.tsx"
```

Expected: FAIL because the shell and layout do not exist.

- [ ] **Step 3: Implement the text-only shell and project lookup**

Give `ProjectWorkspace` this serializable boundary:

```ts
interface ProjectIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly slug: string;
}

export function ProjectWorkspace({
  children,
  project,
}: Readonly<{ children: ReactNode; project: ProjectIdentity }>): ReactNode;
```

Render an `aside` containing a distinctly labelled `nav`, the five ordinary `Link` destinations, and no icons. Derive active state from `usePathname`. Put All projects in a separately styled bottom destination with `margin-top:auto`, rather than a flat fifth row. Render breadcrumb navigation above a keyed route-content wrapper. The shell owns the single `<main id="project-content" tabIndex={-1}>`; route pages will become non-main content wrappers in Task 6.

CSS requirements:

```css
.workspace { width:min(100%,1440px); margin-inline:auto; display:grid; grid-template-columns:220px minmax(0,1fr); flex:1; }
.sidebar,.content { min-width:0; }
html[data-project-menu="closed"] .workspace { grid-template-columns:0 minmax(0,1fr); }
html[data-project-menu="closed"] .sidebar { visibility:hidden; overflow:hidden; }
html[data-project-menu-ready] .workspace { transition:grid-template-columns 200ms ease-out; }
```

Use existing design tokens only. Long project names and bindings must use `overflow-wrap:anywhere` or ellipsis inside a `min-width:0` container.

The server `layout.tsx` awaits params and account in parallel, calls the existing scoped `getProject`, maps the three expected `ProjectControlError` codes to `notFound()`, and passes only `id`, `displayName`, and `slug` into `ProjectWorkspace`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: shell and layout tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/components/project-workspace/ProjectWorkspace.tsx apps/web/src/components/project-workspace/ProjectWorkspace.test.tsx apps/web/src/components/project-workspace/ProjectWorkspace.module.css apps/web/src/app/projects/[projectId]/layout.tsx apps/web/src/app/projects/[projectId]/layout.test.tsx
git commit -m "MNE-25: add the shared project workspace"
```

### Task 4: Mobile drawer dismissal and focus behavior

**Files:**
- Modify: `apps/web/src/components/project-workspace/ProjectMenuProvider.test.tsx`
- Modify: `apps/web/src/components/project-workspace/ProjectMenuProvider.tsx`
- Modify: `apps/web/src/components/project-workspace/ProjectWorkspace.tsx`
- Modify: `apps/web/src/components/project-workspace/ProjectWorkspace.module.css`

- [ ] **Step 1: Add failing mobile interaction tests**

Mount the real provider, header toggle, shell, and a focusable child under jsdom. Stub `matchMedia.matches = true`. Assert independently:

- mobile begins closed even if storage contains `open`;
- opening focuses the Overview link;
- background project content carries `inert` while open;
- Escape closes and returns focus to the header toggle;
- backdrop activation closes and returns focus;
- selecting Timeline closes the drawer;
- changing pathname closes the drawer;
- returning to desktop restores the saved desktop preference.

- [ ] **Step 2: Run the provider test and verify RED**

Run:

```powershell
node node_modules\vitest\vitest.mjs run "apps/web/src/components/project-workspace/ProjectMenuProvider.test.tsx"
```

Expected: the new mobile assertions FAIL because drawer focus, inertness, and dismissal are not wired.

- [ ] **Step 3: Implement drawer behavior**

The shell registers its Overview ref with the provider or focuses it in an effect when `mobile && open`. Render a full-viewport backdrop button below the 60-pixel sticky header. When mobile is open, apply `inert` to the project-content region and lock body scrolling; restore the previous overflow value during cleanup.

The provider listens for Escape only while the mobile drawer is open. `dismiss(true)` closes and focuses `toggleRef.current`; pathname changes call `dismiss(false)` to avoid stealing focus during navigation. Desktop close moves focus to the header toggle before making the sidebar inert if focus currently sits inside it.

Use `overscroll-behavior:contain` on the drawer and backdrop, and keep the global header above both.

- [ ] **Step 4: Run the provider test and verify GREEN**

Run the Step 2 command.

Expected: all desktop and mobile interaction tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/components/project-workspace/ProjectMenuProvider.tsx apps/web/src/components/project-workspace/ProjectMenuProvider.test.tsx apps/web/src/components/project-workspace/ProjectWorkspace.tsx apps/web/src/components/project-workspace/ProjectWorkspace.module.css
git commit -m "MNE-25: make project navigation responsive"
```

### Task 5: Route loading skeletons and reduced motion

**Files:**
- Create: `apps/web/src/components/project-workspace/ProjectSectionLoading.tsx`
- Create: `apps/web/src/components/project-workspace/ProjectSectionLoading.module.css`
- Create: `apps/web/src/components/project-workspace/ProjectSectionLoading.test.tsx`
- Create: `apps/web/src/components/project-workspace/project-workspace-styles.test.ts`
- Create: `apps/web/src/app/projects/[projectId]/loading.tsx`
- Create: `apps/web/src/app/projects/[projectId]/decisions/loading.tsx`
- Create: `apps/web/src/app/projects/[projectId]/timeline/loading.tsx`
- Create: `apps/web/src/app/projects/[projectId]/review/loading.tsx`
- Modify: `apps/web/src/components/project-workspace/ProjectWorkspace.module.css`

- [ ] **Step 1: Write failing loading and CSS-contract tests**

Render all four variants and assert:

```ts
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
```

Read both new CSS modules and the header CSS as text and assert no `transition: all`, a reduced-motion media query, disabled shimmer under reduced motion, transform/opacity-only content entry, `min-width:0`, mobile backdrop/drawer rules, and expanded-state selectors that turn the three menu lines into the approved close treatment. The existing browse/review token regressions are covered when those files change in Task 6.

- [ ] **Step 2: Run tests and verify RED**

```powershell
node node_modules\vitest\vitest.mjs run "apps/web/src/components/project-workspace/ProjectSectionLoading.test.tsx" "apps/web/src/components/project-workspace/project-workspace-styles.test.ts"
```

Expected: FAIL because loading components and rules are missing.

- [ ] **Step 3: Implement four shaped variants**

Define:

```ts
export type ProjectSection = 'overview' | 'decisions' | 'timeline' | 'review';
export function ProjectSectionLoading(
  { section }: Readonly<{ section: ProjectSection }>,
): ReactNode;
```

Render one polite visually-hidden status and an `aria-busy="true"` region. Mark every geometry block `aria-hidden="true"`. Compose Overview with two card blocks, Decisions with filter/count/rows, Timeline with date/two sections, and Review with review cards. Do not render controls or disabled replicas.

Create four thin route fallbacks, each returning the shared component with its literal section. Add a contained neutral shimmer and a 180-millisecond opacity/5-pixel content-arrival animation. Under `prefers-reduced-motion:reduce`, remove transitions and transforms and make skeletons static.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: loading and CSS tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/components/project-workspace/ProjectSectionLoading.tsx apps/web/src/components/project-workspace/ProjectSectionLoading.module.css apps/web/src/components/project-workspace/ProjectSectionLoading.test.tsx apps/web/src/components/project-workspace/project-workspace-styles.test.ts apps/web/src/app/projects/[projectId]/loading.tsx apps/web/src/app/projects/[projectId]/decisions/loading.tsx apps/web/src/app/projects/[projectId]/timeline/loading.tsx apps/web/src/app/projects/[projectId]/review/loading.tsx apps/web/src/components/project-workspace/ProjectWorkspace.module.css
git commit -m "MNE-25: add project route loading states"
```

### Task 6: Integrate and polish all four project pages

**Files:**
- Modify: `apps/web/src/app/projects/project-settings.tsx`
- Modify: `apps/web/src/app/projects/project-settings.test.tsx`
- Modify: `apps/web/src/app/projects/projects.module.css`
- Modify: `apps/web/src/app/projects/[projectId]/decisions/page.tsx`
- Create: `apps/web/src/app/projects/[projectId]/decisions/page.test.tsx`
- Modify: `apps/web/src/app/projects/[projectId]/timeline/page.tsx`
- Create: `apps/web/src/app/projects/[projectId]/timeline/page.test.tsx`
- Modify: `apps/web/src/app/projects/[projectId]/browse.module.css`
- Modify: `apps/web/src/app/projects/[projectId]/review/page.tsx`
- Create: `apps/web/src/app/projects/[projectId]/review/page.test.tsx`
- Modify: `apps/web/src/app/projects/[projectId]/review/review.module.css`

- [ ] **Step 1: Write failing page regression tests**

Follow existing server-page mock patterns. Demonstrate separately:

- Overview renders `Overview`, both existing forms, notices/errors, and no old `Project memory` nav.
- Decisions renders concise heading, all existing filters, populated and empty states, and `notFound()` for an unavailable project.
- Timeline renders concise heading, date control, both belief sections, invalid-date alert, and `notFound()`.
- Review queue renders populated bulk controls, empty state, success notice, and stable error roles.
- The four route components contain no nested `<main>` because the shell owns the single main landmark.
- The affected project CSS modules contain none of `--tile-rule`, `--radius-md`, `--size-label`, or `--size-body-sm`.

- [ ] **Step 2: Run page tests and verify RED**

```powershell
node node_modules\vitest\vitest.mjs run "apps/web/src/app/projects/project-settings.test.tsx" "apps/web/src/app/projects/[projectId]/decisions/page.test.tsx" "apps/web/src/app/projects/[projectId]/timeline/page.test.tsx" "apps/web/src/app/projects/[projectId]/review/page.test.tsx"
```

Expected: new tests FAIL on old headings, duplicated orientation, old nav, or missing regression files.

- [ ] **Step 3: Make the pages shell-owned without changing domain behavior**

Remove the settings page’s `Projects` back link, project title/binding block, and three-link nav. Replace it with:

```tsx
<header className={styles.pageHeader}>
  <h1>Overview</h1>
  <p>Manage this project&apos;s name and lifecycle.</p>
</header>
```

Change all four route roots from `<main>` to `<div>` or `<section>` content wrappers. Remove repeated workspace display-name paragraphs. Use the exact concise headings `Overview`, `Decisions`, `Timeline`, and `Review queue`; leave filters, data reads, actions, provenance, notices, and errors intact.

Replace undefined CSS variables while touching the browse and review modules:

- `--tile-rule` → `--tile-hairline`
- `--radius-sm` → `--rounded-sm`
- `--radius-md` → `--rounded-lg`
- `--size-label` and `--size-body-sm` → `--size-fine-print`

Give the review empty state a bounded card treatment. Add overflow containment and `overflow-wrap:anywhere` to item titles, bodies, provenance, actor names, and repository bindings. Keep forms at 44-pixel targets with visible focus.

- [ ] **Step 4: Run focused page tests and verify GREEN**

Run the Step 2 command.

Expected: all project-page tests PASS.

- [ ] **Step 5: Run the complete affected web suite**

```powershell
node node_modules\vitest\vitest.mjs run "apps/web/src/components" "apps/web/src/app/layout.test.tsx" "apps/web/src/app/projects"
```

Expected: all affected tests PASS with no warnings.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/app/projects apps/web/src/components/project-workspace
git commit -m "MNE-25: integrate the project workspace pages"
```

### Task 7: Verification, review, and ready PR

**Files:**
- Modify only files required by verification or code-review findings.

- [ ] **Step 1: Run repository verification from the feature worktree**

```powershell
pnpm.cmd test
pnpm.cmd --filter @mneia/web typecheck
pnpm.cmd lint:ci
pnpm.cmd format:check
pnpm.cmd check:policy
$env:NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk'
pnpm.cmd --filter @mneia/web build
```

Expected: every command exits 0. If `DATABASE_URL` is absent, report any skipped integration suites explicitly rather than implying database coverage.

- [ ] **Step 2: Audit the changed UI against current interface guidance**

Fetch the current Vercel Web Interface Guidelines and inspect every changed TSX/CSS file. Verify semantic links/buttons, focus visibility, accessible icon label, async live status, URL-driven active state, long-text handling, hover states, no `transition:all`, and reduced-motion behavior.

- [ ] **Step 3: Perform the manual acceptance pass**

Run the web app locally and verify desktop expanded/collapsed state, persistence after reload, direct deep links, browser Back/Forward, mobile drawer Escape/backdrop/link dismissal, focus return, keyboard-only navigation, 200% zoom, reduced motion, empty review queue, populated decisions, and visible loading under throttling. Capture failures as tests before fixing them.

- [ ] **Step 4: Request independent code review**

Dispatch a reviewer with the base SHA, head SHA, this plan, and the approved spec. Fix every Critical and Important issue, rerun the focused failing test first, then rerun Step 1 in full.

- [ ] **Step 5: Push and open a non-draft PR**

```powershell
git push -u origin feat/mne-25-project-workspace-shell
$prBody = @'
## Summary
- adds persistent text-only navigation across every project route
- adds accessible desktop collapse and mobile drawer behavior from the existing header
- adds destination-shaped loading states and reduced-motion-safe transitions

## Verification
- [x] affected Vitest suite
- [x] full test suite
- [x] web typecheck and production build
- [x] lint, format, and policy checks
- [x] desktop, mobile, keyboard, zoom, and reduced-motion acceptance pass

Part of MNE-25
'@
gh pr create --base main --head feat/mne-25-project-workspace-shell --title "MNE-25: add the project workspace shell" --body $prBody
```

The PR body must include:

```markdown
## Summary
- adds persistent text-only navigation across every project route
- adds accessible desktop collapse and mobile drawer behavior from the existing header
- adds destination-shaped loading states and reduced-motion-safe transitions

## Verification
- [x] affected Vitest suite
- [x] full test suite
- [x] web typecheck and production build
- [x] lint, format, and policy checks
- [x] desktop, mobile, keyboard, zoom, and reduced-motion acceptance pass

Part of MNE-25
```

Create the PR ready for review; do not pass `--draft`. Keep the worktree and branch intact after opening it.
