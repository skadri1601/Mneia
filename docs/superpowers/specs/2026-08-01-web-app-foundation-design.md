# Web app foundation

## Goal

Add the private Mneia product app at `apps/web`. Its first slice establishes one Clerk-backed identity
system for the web, CLI, and MCP; a server-only Mneia authorization boundary; account bootstrap;
workspace and project management; and device-flow approval.

`apps/site` remains the static marketing site. The product app is not a browser replacement for the
CLI or MCP server.

## Architecture

`apps/web` is a Next.js App Router application. Clerk authenticates a human and supplies a stable user
identifier. The application maps that identifier to `actor.external_ref`; it never takes an actor or
workspace id from a browser request as authority.

An active workspace id may arrive as an untrusted route or session selection, but it is only a lookup
candidate. Authorization succeeds only when a human actor in that workspace has an `external_ref` equal
to the authenticated Clerk subject. This subject-plus-workspace check supports one Clerk identity across
multiple workspace-scoped actor rows without making the browser selection authoritative.

Mneia Postgres remains the authorization system. Every request derives an actor and workspace from the
authenticated identity, establishes the workspace scope in the database transaction, and relies on the
existing RLS policies plus the query-layer scope filter. Clerk Organizations are not used as the Mneia
workspace or team model.

Server-only modules own authentication resolution, scoped-store access, account bootstrap, workspace
and project operations, and device-flow issuance and approval. Route handlers and server components
call those modules; client components receive typed response data and never access the database.

## First routes

- Sign-in and sign-up routes supplied by Clerk.
- An authenticated app shell with workspace selection.
- Workspace and project management routes for listing, creating, and editing the current workspace's
  projects.
- A device approval route that displays a pending CLI or MCP authorization request and either approves
  or denies it from the current Clerk-authenticated Mneia actor.

The device-flow API creates an expiring, single-use request; the CLI or MCP polls with its device code.
Approval issues a Mneia token associated with the same actor and workspace. The token is the client
credential, not a second user identity system.

## Data and error handling

The account bootstrap path is idempotent: a Clerk identity maps to one actor and gets an initial solo
workspace only if it has no Mneia account. Workspace and project reads and writes run inside scoped
transactions. Invalid or expired device codes, wrong-workspace requests, denied approvals, and absent
account state return explicit typed failures; no route treats missing data as an empty authorized result.

The initial slice does not add invitations, team-role administration, billing, conflict resolution,
chat, or agent orchestration. Those remain outside its scope.

## Verification

Tests cover identity-to-actor mapping, idempotent account bootstrap, workspace isolation, project
management restricted to the active workspace, and device approval/denial/expiry. The app also passes
typecheck, build, and the relevant integration tests against Postgres.

## Delivery order

1. Establish `apps/web`, Clerk middleware, and server-only boundary.
2. Implement identity mapping and RLS-safe account bootstrap.
3. Implement workspace/project management.
4. Implement device flow and approval UI.
5. Add the decision browser, then an explicit pending-review contract and review queue, then the
   valid-time timeline.
