# Web Project Control Plane Design

**Ticket:** MNE-181

## Purpose

Give the authenticated account owner a thin browser control plane for projects created by
`mneia init`: list them, change the human-facing name, and archive them without breaking a checked-in
repository binding or deleting project history.

## Decisions

- The project `slug` is the immutable repository binding. The CLI persists it in
  `.mneia/config.json`, so changing it in a browser would silently break every bound checkout.
- Rename changes a new `display_name`, not `slug`.
- Archive sets `archived_at`; it never deletes the row because sessions, context items, checkpoints,
  handoffs, and conflicts retain project foreign keys.
- Archived slugs remain reserved. A binding never changes meaning.
- Project mutations receive only a stable project id and user-entered value from the browser.
  Workspace, actor, and team scope come exclusively from the Clerk-backed `AccountContext`.
- Every database operation first applies the MNE-186 connection guard, then establishes a
  transaction-local workspace GUC on a non-`BYPASSRLS` connection.
- The browser re-authenticates inside every Server Action. Middleware is not authorization.

## Data Model

Migration `0009-project-management` adds:

- `display_name TEXT`, backfilled from `slug` and defaulted from `slug` for legacy writers
- `archived_at TIMESTAMPTZ`
- an active-project listing index scoped by workspace

The existing `(workspace_id, slug)` uniqueness remains unchanged. Core project resolution excludes
archived projects so an archived binding cannot continue receiving CLI or MCP writes.

## Server Contract

`ProjectControlStore` accepts an `AccountContext`, never a browser-provided workspace id.

- `listProjects(account, { includeArchived })`
- `getProject(account, projectId)`
- `renameProject(account, { projectId, displayName })`
- `archiveProject(account, { projectId, expectedSlug })`

The archive operation requires the immutable slug as confirmation and is idempotent. Cross-workspace
and missing projects produce the same public `project_not_found` result.

## Web Surface

- `/` redirects to `/projects`.
- `/projects` shows the current workspace, active projects, their binding slugs, and an archived
  section.
- `/projects/[projectId]` shows project settings, a rename form, and a slug-confirmed archive form.
- `/sign-in` and `/sign-up` use Clerk's hosted components inside the app routes.
- Server Actions validate inputs, resolve the current Clerk account again, perform the mutation,
  revalidate affected routes, and redirect with stable notice or error codes.

The pages remain server-rendered with no client component required for project management.

## Verification

- Migration contract and mapper tests cover defaults, timestamps, and archive state.
- Store tests cover query order, trusted scope, authorization, idempotency, rollback, discard, and
  cleanup failure behavior.
- Real Postgres tests use a dedicated `NOSUPERUSER NOBYPASSRLS` role to prove cross-workspace reads
  and mutations fail closed.
- Service tests cover all untrusted input validation.
- Component and route tests cover semantic rendering, immutable binding visibility, labels, archive
  confirmation, notices, and empty states.
- Core build, web typecheck, production Next build, scoped Biome, and test-integrity checks must pass.

