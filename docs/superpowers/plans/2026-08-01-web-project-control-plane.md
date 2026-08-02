# Web Project Control Plane Implementation Plan

> Execute with test-driven development and parallel review checkpoints. Keep CLI and MCP source files
> untouched while Claude Code works in that lane.

**Goal:** Implement the MNE-181 project list, rename, and archive slice without breaking repository
bindings or weakening workspace isolation.

**Architecture:** Extend project lifecycle metadata in a forward-only migration, keep the binding slug
immutable, and implement a proprietary app-local control store over the shared Postgres connection
contract. Server-rendered Next routes call provider-neutral services; Server Actions re-authenticate
and accept no tenant scope from form input.

**Stack:** Next.js 15, React 19, Clerk, TypeScript, Postgres, Vitest, Biome.

---

## Task 1: Project lifecycle migration

**Files:**

- Create `packages/core/src/store/migrations/0009-project-management.ts`
- Create `packages/core/src/store/migrations/0009-project-management.test.ts`
- Modify `packages/core/src/store/migrations/index.ts`
- Modify `packages/core/src/store/adapter/postgres.ts`
- Modify `packages/core/src/store/adapter/postgres.test.ts`

**Steps:**

1. Write failing tests for the new columns, legacy-writer display-name default, active index, and
   migration registration.
2. Write failing adapter tests proving archived projects no longer resolve by id or slug.
3. Implement the forward-only migration and active-project filters.
4. Run the focused migration and adapter tests, then the core build.

## Task 2: App-local project contract and validation

**Files:**

- Create `apps/web/src/server/store/project-store.ts`
- Create `apps/web/src/server/projects.ts`
- Create `apps/web/src/server/projects.test.ts`

**Steps:**

1. Write failing tests for display-name, UUID, and archive-confirmation validation.
2. Define `ManagedProject`, typed public errors, and `ProjectControlStore`.
3. Implement provider-neutral list/get/rename/archive services that pass the exact trusted
   `AccountContext` to the store.
4. Run the focused service suite and web typecheck.

## Task 3: RLS-safe Postgres project store

**Files:**

- Create `apps/web/src/server/store/postgres-project-store.ts`
- Create `apps/web/src/server/store/postgres-project-store.test.ts`

**Steps:**

1. Write failing tests for the MNE-186 guard, transaction order, workspace GUC, deterministic list,
   lead authorization, display-name-only rename, idempotent archive, and indistinguishable missing or
   cross-workspace results.
2. Write failing lifecycle tests for rollback, rollback failure, release failure, and discard failure.
3. Implement the store without accepting workspace, actor, or team ids from browser input.
4. Run focused store and shared session-lifecycle tests.

## Task 4: Runtime account and database composition

**Files:**

- Create `apps/web/src/server/database.ts`
- Create `apps/web/src/server/database.test.ts`
- Create `apps/web/src/server/current-account.ts`
- Create `apps/web/src/server/current-account.test.ts`
- Modify `apps/web/package.json`
- Modify `pnpm-lock.yaml`

**Steps:**

1. Write failing tests for lazy `DATABASE_URL` validation, normal release, forced discard, and SQL
   result mapping.
2. Write failing tests for Clerk display-name fallback and account bootstrap composition.
3. Implement a lazy Node-only `pg.Pool` source so importing routes during build never opens a
   connection.
4. Implement request-cached current-account resolution.
5. Install only the app's declared runtime and type dependencies, then run focused tests and
   typecheck.

## Task 5: Project routes and actions

**Files:**

- Modify `apps/web/src/app/page.tsx`
- Modify `apps/web/src/app/page.test.tsx`
- Create `apps/web/src/app/projects/page.tsx`
- Create `apps/web/src/app/projects/project-list.tsx`
- Create `apps/web/src/app/projects/project-list.test.tsx`
- Create `apps/web/src/app/projects/[projectId]/page.tsx`
- Create `apps/web/src/app/projects/actions.ts`
- Create `apps/web/src/app/projects/actions.test.ts`
- Create `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`
- Create `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx`
- Create `apps/web/src/app/globals.css`
- Create `apps/web/src/app/projects/projects.module.css`
- Modify `apps/web/src/app/layout.tsx`

**Steps:**

1. Write failing pure-render tests for lists, archived state, immutable binding visibility, labels,
   notices, confirmation, and empty state.
2. Write failing action tests for authentication composition, validation redirects, revalidation,
   and generic not-found behavior.
3. Implement server-rendered routes and actions with Node runtime and forced dynamic rendering.
4. Apply the established site tokens and accessibility rules without adding a client boundary.
5. Run route/component tests, web typecheck, and the production Next build.

## Task 6: Real Postgres invariants

**Files:**

- Create `tests/integration/web-project-control-plane.integration.test.ts`

**Steps:**

1. Create isolated schemas and a unique dedicated `NOSUPERUSER NOBYPASSRLS` role.
2. Prove legacy project inserts receive a display name derived from the slug.
3. Prove active and archived listing behavior, rename preserving slug, and idempotent archive.
4. Prove one workspace cannot list, rename, archive, or distinguish another workspace's project.
5. Prove archived projects no longer resolve through the shared core adapter.
6. Run with `MNEIA_REQUIRE_DB=1` against the configured Postgres engine.

## Task 7: Final verification and Linear checkpoint

1. Run all focused unit, component, and integration suites.
2. Run `pnpm --filter @mneia/core build`.
3. Run `pnpm --filter @mneia/web typecheck`.
4. Run the web production build with the validated non-secret Clerk build key.
5. Run scoped Biome, `pnpm check:tests`, and `git diff --check`.
6. Request independent specification and quality reviews.
7. Comment on MNE-181 with exact evidence and leave it `In Progress`; device approval and token
   issuance still remain.
