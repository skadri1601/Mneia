# Web App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `apps/web`, a private Clerk-authenticated Mneia product-app foundation with a server-only identity boundary.

**Architecture:** Clerk authenticates the user at the edge; a server-only module translates the Clerk subject to a Mneia actor. The application keeps Mneia workspace, team, and scope authorization in Postgres, so no browser input establishes a database scope.

**Tech Stack:** Next.js App Router, React, TypeScript, Clerk, Vitest, Postgres.

---

## File structure

- `apps/web/package.json` — product-app scripts and dependencies.
- `apps/web/tsconfig.json` — strict Next.js TypeScript configuration.
- `apps/web/src/app/layout.tsx` — Clerk provider and application shell.
- `apps/web/src/app/page.tsx` — authenticated application entrypoint.
- `apps/web/src/middleware.ts` — Clerk route protection.
- `apps/web/src/server/identity.ts` — server-only Clerk-subject-to-actor contract.
- `apps/web/src/server/identity.test.ts` — identity-boundary tests.
- `docs/STACK.md`, `vision.md`, `ROADMAP.md` — Clerk and single-private-repo rulings.

### Task 1: Record the private application boundary

**Files:**
- Modify: `.claude/rules/architecture.md`
- Modify: `docs/STACK.md`
- Test: `git diff --check`

- [ ] **Step 1: State the boundary**

Replace the public/private repository requirement with the current ruling: this repository is private and
may contain `apps/web`; if it becomes public, extract the hosted API and product app before publishing.

- [ ] **Step 2: Verify the documentation diff**

Run: `git diff --check`

Expected: exit code 0.

- [ ] **Step 3: Commit the ruling**

```text
MNE-166: choose Clerk as Mneia identity provider

Records Clerk identity with Postgres-owned authorization and the current private-repository boundary.
```

### Task 2: Scaffold the application and Clerk provider

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/middleware.ts`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Write the failing app-shell test**

Create `apps/web/src/app/page.test.tsx` and assert that the signed-in shell renders a Mneia application
heading and a workspace-loading state. Mock Clerk's server helper so the test does not require a live key.

```ts
expect(renderToStaticMarkup(<HomePage />)).toContain('Mneia workspace');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules\\vitest\\vitest.mjs run apps/web/src/app/page.test.tsx`

Expected: failure because `apps/web` and `HomePage` do not exist.

- [ ] **Step 3: Create the minimal app shell**

Use `@clerk/nextjs` only in `layout.tsx` and `middleware.ts`. Keep `page.tsx` server-rendered and render a
workspace-loading state rather than querying Postgres from a component.

```tsx
export default function HomePage() {
  return <main><h1>Mneia workspace</h1><p>Loading your workspace.</p></main>;
}
```

- [ ] **Step 4: Run the focused test and typecheck**

Run: `node node_modules\\vitest\\vitest.mjs run apps/web/src/app/page.test.tsx`

Expected: one passing test.

Run: `pnpm --filter @mneia/web typecheck`

Expected: exit code 0.

- [ ] **Step 5: Commit the shell**

```text
MNE-101: scaffold the authenticated Mneia web app

Implements the hosted web foundation required by §12.3.
```

### Task 3: Define the server-only identity boundary

**Files:**
- Create: `apps/web/src/server/identity.ts`
- Create: `apps/web/src/server/identity.test.ts`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Write failing identity tests**

Test a resolver that accepts a Clerk subject and a lookup function. It returns the matching actor only when
the actor is human and belongs to the requested Mneia workspace; it rejects an absent subject and an absent actor.

```ts
await expect(resolveActor({ subject: null, workspaceId: 'workspace_1', findActor })).rejects.toMatchObject({ code: 'unauthenticated' });
await expect(resolveActor({ subject: 'user_1', workspaceId: 'workspace_1', findActor })).resolves.toMatchObject({ id: 'actor_1' });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules\\vitest\\vitest.mjs run apps/web/src/server/identity.test.ts`

Expected: failure because `resolveActor` does not exist.

- [ ] **Step 3: Implement the identity contract**

Export `IdentityError` with `unauthenticated` and `account_not_found` codes, plus `resolveActor`. Keep the
lookup injected so this module does not create a database connection or import Clerk into tests.

```ts
export async function resolveActor(input: ResolveActorInput): Promise<Actor> {
  if (input.subject === null) throw new IdentityError('unauthenticated');
  const actor = await input.findActor({ subject: input.subject, workspaceId: input.workspaceId });
  if (actor === null || actor.kind !== 'human' || actor.workspaceId !== input.workspaceId || actor.externalRef !== input.subject) {
    throw new IdentityError('account_not_found');
  }
  return actor;
}
```

- [ ] **Step 4: Run focused tests and the application build**

Run: `node node_modules\\vitest\\vitest.mjs run apps/web/src/server/identity.test.ts apps/web/src/app/page.test.tsx`

Expected: all tests pass.

Run: `pnpm --filter @mneia/web build`

Expected: exit code 0.

- [ ] **Step 5: Commit the boundary**

```text
MNE-101: add the Clerk identity boundary for the web app

Keeps identity provider subjects separate from Mneia workspace authorization (§11.3).
```

## Self-review

The plan covers the approved first delivery step: the private app, Clerk integration, and the server-only
identity boundary. Account bootstrap, workspace/project operations, and device flow are deliberately
separate follow-up plans because they require new RLS-safe store operations and durable token records.
