# Project Workspace Shell Design

**Linear:** Part of MNE-25  
**Status:** Approved by founder on 2026-08-08  
**Surface:** Authenticated `apps/web` project routes

## Context

The project settings, decision browser, timeline, and review queue are separate routes, but only the settings page exposes links to the other sections. The other routes discard project identity and section navigation, forcing people to use browser Back or return to the project list and re-enter the project.

The authenticated product needs a persistent project workspace shell. It may have its own product-oriented layout and does not need to match the public marketing site, but the existing authenticated global header stays visually and functionally intact except for one project-menu control.

## Goals

- Keep project identity and navigation visible across every project route.
- Make Overview, Decisions, Timeline, Review queue, and All projects directly reachable.
- Let desktop users reclaim horizontal space by fully hiding the project sidebar.
- Make the same navigation usable as a mobile drawer.
- Communicate route loading without blank screens or disruptive full-page spinners.
- Add restrained, useful motion while respecting reduced-motion preferences.
- Preserve URLs, browser history, keyboard navigation, and deep linking.

## Non-goals

- Redesigning the public homepage or marketing pages.
- Replacing or restyling the existing authenticated global-header destinations or account menu.
- Adding new project capabilities, editing decisions, changing timeline semantics, or changing review behavior.
- Adding orchestration, chat, observability, or any other §19 surface.
- Introducing an animation library when CSS transitions and keyframes cover the approved behavior.

## Research basis

- W3C and USWDS breadcrumb guidance: breadcrumb navigation communicates hierarchy and links to parent sections.
- GitHub Primer navigation guidance: section controls that change the URL are navigation links rather than ARIA tab panels.
- Carbon loading guidance: skeletons mirror structured destination content and communicate that a route is progressing.
- W3C reduced-motion guidance: interaction-triggered motion is suppressed when `prefers-reduced-motion: reduce` is active.
- Vercel Web Interface Guidelines: links perform navigation, controls retain visible focus, async status is announced, URL state remains authoritative, and motion uses transform or opacity rather than broad transitions.

## Approved information architecture

Every `/projects/[projectId]` route is inside one shared project workspace:

1. Global authenticated header
2. Project sidebar
3. Project content region

The sidebar contains text labels only, in this order:

1. Project display name and repository binding
2. Overview
3. Decisions
4. Timeline
5. Review queue
6. All projects, separated at the bottom

The existing `/projects/[projectId]` settings page is labeled **Overview** in navigation. The remaining routes retain their current URLs:

- `/projects/[projectId]`
- `/projects/[projectId]/decisions`
- `/projects/[projectId]/timeline`
- `/projects/[projectId]/review`

Each content page starts with a breadcrumb in the form `Projects / Project name / Current section`. `Projects` and the project name are links where they represent a parent route. The current section is plain text or carries `aria-current="page"` if rendered as a link.

## Global header integration

The current global header remains unchanged in height, destinations, wordmark, and account behavior. Project routes add one icon-only menu button at the far left, before the Mneia wordmark.

The button:

- is visible only while a project workspace is active;
- remains reachable whether the sidebar is open or hidden;
- uses the familiar three-line menu symbol when the sidebar is hidden and a close treatment when it is open;
- has a 44-by-44-pixel minimum target;
- uses `aria-controls` to reference the project navigation;
- updates `aria-expanded`, `aria-label`, and tooltip text between “Show project menu” and “Hide project menu”;
- has explicit hover, active, and `:focus-visible` states.

No symbols or icons appear beside sidebar destinations.

## Desktop behavior

- The sidebar is 210–224 pixels wide when open.
- It is open by default for a user with no saved preference.
- Activating the header control fully collapses it to zero width; it does not leave an icon rail.
- The content region expands into the released space.
- The preference is stored locally in the browser under a Mneia-specific key. It is presentation state, not workspace data, and does not go to the server.
- A small pre-paint bootstrap reads the validated preference and sets a document data attribute before the shell is visible. Transitions are enabled only after hydration, preventing an open-then-collapse flash or an animated first render.
- The active route uses `aria-current="page"`, stronger text contrast, a quiet tinted background, and a narrow leading accent.
- Hover may shift a destination by no more than 2 pixels and increase contrast. The active destination does not move.

## Mobile behavior

Below the existing mobile breakpoint, the project navigation becomes an off-canvas drawer rather than resizing the content column.

- It starts closed on each fresh mobile page load regardless of the saved desktop preference.
- The same header control opens and closes it.
- An open drawer has a non-opaque backdrop and does not move the underlying page.
- Escape, backdrop activation, selecting a destination, or navigating away closes it.
- Focus moves to the first meaningful drawer control when opened and returns to the header toggle when closed.
- Background content is not keyboard- or pointer-interactive while the drawer is open.
- The drawer never obscures the persistent global header.

## Content hierarchy

The shared shell supplies project identity, breadcrumbs, navigation, and the main-content landmark. Individual routes own only their section title, explanation, controls, data, notices, errors, and empty states.

Repeated workspace display-name text is removed from individual page headers because the global account context and project shell already provide orientation. Section headings become concise:

- Overview
- Decisions
- Timeline
- Review queue

The content width may grow beyond the current narrow reading column for filter rows and review cards, but prose retains a readable maximum line length. Long display names, repository bindings, titles, provenance, and actor names wrap or truncate without creating horizontal page scroll.

## Loading states

The sidebar and global header persist during project-section navigation. Only the destination content region enters a loading state.

Each route has a skeleton shaped like its real content:

- Overview: heading plus two settings cards.
- Decisions: heading, filter bar, count, and decision rows.
- Timeline: heading, date control, and two belief sections.
- Review queue: heading and review cards.

Skeletons:

- never replace real buttons, menus, dialogs, or form controls with interactive-looking disabled replicas;
- use neutral blocks that preserve the destination layout and prevent large shifts;
- expose one polite status message such as “Loading Timeline…”;
- set the content region to `aria-busy="true"` while pending;
- disappear immediately when the server route resolves;
- introduce no artificial minimum delay.

Empty states remain real content and are not treated as loading. The review queue’s empty state retains its meaning but gains a bounded, visually intentional presentation.

## Motion

Motion clarifies state changes rather than decorating the interface.

- Sidebar open and close: 180–220 milliseconds with an ease-out curve.
- Content arrival: 160–200 milliseconds using opacity and no more than 5 pixels of vertical translation.
- Hover elevation: 120–160 milliseconds on cards that are actually interactive or inspectable.
- Skeleton shimmer: subtle and contained within skeleton blocks.
- No `transition: all`, parallax, looping decorative motion, route-wide slide animations, or delayed navigation.

Under `prefers-reduced-motion: reduce`, sidebar and content changes are immediate, hover translation is removed, and skeleton shimmer becomes static. Loading status and layout remain fully understandable without animation.

## State ownership and component boundaries

- A shared dynamic-project layout resolves the account and project once for the shell and returns `notFound()` for missing, forbidden, or cross-workspace projects without revealing which case occurred.
- A root-level client-side workspace controller wraps both the global header and route content. It owns menu visibility, the saved desktop preference, mobile drawer dismissal, focus return, and header-toggle state.
- The global header renders the toggle through the shared workspace context only on project routes.
- A shared project-navigation component derives links from the project ID and derives active state from the current pathname.
- Route-level loading files reuse shared skeleton primitives while composing the appropriate destination shape.
- Individual pages keep their existing server data reads, forms, actions, notices, errors, and domain behavior unless moving project lookup into the shared layout makes a duplicate lookup unnecessary.

The shell must not add a client-side data-fetching layer or duplicate the server store. Navigation remains ordinary Next.js links so browser history, modifier-click behavior, and deep links continue to work.

## Accessibility

- Include a skip link that moves focus past the global header and project navigation to the current project content.
- Use semantic `header`, `nav`, `aside`, and `main` landmarks with distinct accessible labels.
- Use links for destinations and a button for the menu action.
- Keep heading order hierarchical with one section `h1` per route.
- Give every interactive element a visible `:focus-visible` treatment.
- Maintain a 44-pixel minimum target for the header toggle and sidebar links.
- Do not encode active or loading state by color alone.
- Announce loading and mutation results without moving focus unexpectedly.
- Preserve zoom, reflow, and keyboard operation at narrow widths.

## Error handling

- Existing route errors and notices remain next to the affected content.
- A project that cannot be resolved produces the existing indistinguishable not-found result.
- Failure to read or write the local sidebar preference falls back silently to an open desktop sidebar and does not affect navigation.
- A route-loading failure leaves the persistent shell intact and uses the route’s existing error boundary or error response; the skeleton never remains indefinitely after an error resolves.

## Verification

Automated coverage must demonstrate:

- all five navigation destinations render with correct URLs;
- the current section has `aria-current="page"`;
- the header control has correct accessible name, `aria-controls`, and expanded state;
- desktop preference read/write and storage failure fallback;
- mobile Escape, backdrop, link-selection, and focus-return behavior;
- route loading renders destination-shaped skeletons, a live status, and `aria-busy`;
- reduced-motion CSS removes nonessential animation;
- long project and item text does not create horizontal overflow;
- existing Overview, Decisions, Timeline, and Review queue behavior remains covered.

Manual verification covers desktop expanded and collapsed layouts, mobile drawer operation, keyboard-only navigation, browser Back/Forward, direct deep links, reduced motion, 200% zoom, empty review queue, and a populated decision list.

## Acceptance criteria

A signed-in person can enter any project route directly, understand which project and section they are in, move to any other project section in one action, return to All projects, fully hide and restore the desktop sidebar from the persistent header, use the navigation as a mobile drawer, receive clear route-loading feedback, and complete the entire flow with keyboard-only navigation and reduced motion enabled.
