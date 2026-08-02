# Web Account Bootstrap Implementation Plan

**Goal:** Add an atomic, idempotent M1 account bootstrap that turns one verified Clerk subject into one
solo workspace, one human actor, one default team, and one lead membership without trusting browser ids.

**Current ruling:** MNE-101 explicitly limits M1 to exactly one workspace per account. MNE-181 excludes
MNE-128 cross-workspace identity. A global unique human `actor.external_ref` is therefore intentional in
this slice and must be replaced when MNE-128 designs multi-workspace identity.

**Security boundary:** The bootstrap runs only on a non-superuser, non-`BYPASSRLS` connection accepted
by the MNE-186 guard. It uses transaction-local `mneia.identity_subject` only to discover the matching
human actor before workspace scope exists. Every write still requires transaction-local
`mneia.workspace_id` and the existing workspace RLS policies.

---

## Task 1: Add the pre-scope identity policy

**Files:**

- Create: `packages/core/src/store/migrations/0007-actor-identity.ts`
- Create: `packages/core/src/store/migrations/0007-actor-identity.test.ts`
- Modify: `packages/core/src/store/migrations/index.ts`
- Modify: `packages/core/src/store/schema.ts`
- Modify: `packages/core/src/index.ts`

1. Write a failing migration test that requires version 7, the
   `actor_human_external_ref_unique` partial index, and an `actor_identity_lookup` policy declared
   `FOR SELECT`.
2. Require the policy to match a human `external_ref` to
   `NULLIF(current_setting('mneia.identity_subject', true), '')` only while
   `mneia.workspace_id` is unset. This keeps the subject policy from widening actor reads after normal
   workspace scope has been established.
3. Add `IDENTITY_SUBJECT_SETTING = 'mneia.identity_subject'` to the schema exports.
4. Create the partial unique index over non-null human `actor.external_ref` and the SELECT-only policy.
   Do not add an insert, update, or delete policy.
5. Register migration 7 and export the new setting from `@mneia/core`.
6. Run the focused migration test and the core build.

Do not run `pnpm db:migrate` against production. Migration verification belongs in temporary integration
schemas and the Neon PR branch.

## Task 2: Complete account row mapping

**Files:**

- Modify: `packages/core/src/store/adapter/rows.ts`
- Modify: `packages/core/src/store/adapter/rows.test.ts`
- Modify: `packages/core/src/store/adapter/index.ts`
- Modify: `packages/core/src/index.ts`

1. Add failing tests for `toWorkspace`, `toTeam`, and `toTeamMember`, including all nullable workspace
   billing fields and unknown enum rejection.
2. Add a strict `toNullableNumber` primitive rather than accepting database strings silently.
3. Implement the three mappers using the existing row-reading primitives and schema enum constants.
4. Export the mappers and any connection/row types the proprietary adapter needs through the package
   root. Export the existing MNE-186 RLS guard rather than copying its SQL into `apps/web`.
5. Run the row-mapper tests and core typecheck/build.

## Task 3: Define the provider-neutral bootstrap contract

**Files:**

- Create: `apps/web/src/server/store/account-store.ts`
- Create: `apps/web/src/server/account.ts`
- Create: `apps/web/src/server/account.test.ts`

Use this contract:

```ts
interface AccountContext {
  readonly workspace: Workspace;
  readonly actor: Actor;
  readonly team: Team;
  readonly membership: TeamMember;
}

interface BootstrapSoloAccountInput {
  readonly subject: string;
  readonly displayName: string;
}

interface AccountStore {
  bootstrapSoloAccount(input: BootstrapSoloAccountInput): Promise<AccountContext>;
}
```

1. Write failing tests for an absent Clerk subject, an empty display name, and delegation of the exact
   verified subject/profile to the store.
2. Define typed `unauthenticated`, `invalid_profile`, `corrupt_account`, `rollback_failed`, and
   `session_cleanup_failed` failures.
3. Add `server-only` guards. Do not import Clerk or create a database connection in these modules.
4. Implement the thin account service and run its focused tests.

## Task 4: Implement the Postgres account store

**Files:**

- Create: `apps/web/src/server/store/postgres-account-store.ts`
- Create: `apps/web/src/server/store/postgres-account-store.test.ts`
- Modify: `packages/core/src/index.ts` only for required existing-type/guard exports

1. Build a fake session/source and write failing tests for new-account creation, existing-account reuse,
   corrupt existing state, rollback, release, and RLS-guard refusal.
2. Inject the connection source and an id factory. The default id factory uses `crypto.randomUUID`; tests
   use fixed UUIDs. Browser input never supplies a workspace, actor, team, or membership id.
3. On every acquired session, call `assertConnectionEnforcesRls` before starting bootstrap work.
4. Execute one transaction in this order:

   - `BEGIN`, then explicitly select `READ COMMITTED` isolation;
   - clear `mneia.workspace_id`, then set `mneia.identity_subject` transaction-locally from the verified
     Clerk subject;
   - take `pg_advisory_xact_lock(hashtextextended(subject, 0))`;
   - select the unique human actor by `external_ref`;
   - clear `mneia.identity_subject` immediately after the lookup;
   - if found, set `mneia.workspace_id` from that actor, then load exactly one workspace, default team,
     and membership;
   - if absent, generate ids, set `mneia.workspace_id` to the new workspace id, and insert workspace,
     actor, default team, and lead membership in that order;
   - `COMMIT` and return the mapped `AccountContext`.

5. Use workspace slug `workspace-<full workspace UUID>` and team slug `default` so retry behavior does not
   depend on a mutable display name. Do not create a project; `mneia init` owns project creation.
6. Treat zero or multiple existing default memberships as `corrupt_account`, never as an empty account.
   An existing workspace may have been upgraded to `team` or `enterprise`; only newly created workspaces
   are required to be `solo`.
7. On any transaction failure, `ROLLBACK`; if rollback fails, raise `rollback_failed` and discard the
   connection instead of returning it to the pool. Preserve original and cleanup failures in a typed
   `session_cleanup_failed` aggregate. Release only a clean session. Let the partial unique index plus
   advisory lock serialize concurrent retries.
8. Run the focused adapter tests, all web tests, and web typecheck.

## Task 5: Prove the RLS and concurrency invariants against Postgres

**Files:**

- Create: `tests/integration/web-account-bootstrap.integration.test.ts`

1. Follow the existing temporary-schema harness and create a dedicated `NOSUPERUSER NOBYPASSRLS` test
   role with only schema/table privileges.
2. Assert that identity lookup sees no actor when `mneia.identity_subject` is unset, sees subject A only
   when set to A, and never returns an agent row.
3. Prove subject-only scope cannot insert, update, delete, or lock an actor, and that commit/rollback
   clears the transaction-local identity subject.
4. Call bootstrap twice for one subject and assert identical workspace, actor, team, and membership ids.
5. Call bootstrap concurrently for one new subject and assert exactly one row of each account entity.
6. Bootstrap two subjects and prove each receives an isolated workspace and cannot read the other's
   workspace/team after scope is set.
7. Assert the created values are `solo`, `human`, matching `external_ref`, default team, and lead
   membership, with zero projects.
8. Assert a failed team or membership write rolls the entire account back.
9. Skip only when `DATABASE_URL` is absent, matching the repository harness; `MNEIA_REQUIRE_DB=1` must
   turn that skip into a Neon workflow failure.

## Task 6: Verify and report the slice

Run:

```text
node node_modules\vitest\vitest.mjs run packages/core/src/store/migrations/0007-actor-identity.test.ts packages/core/src/store/adapter/rows.test.ts apps/web/src/server/account.test.ts apps/web/src/server/store/postgres-account-store.test.ts
pnpm --filter @mneia/core build
pnpm --filter @mneia/web typecheck
node node_modules\vitest\vitest.mjs run tests/integration/web-account-bootstrap.integration.test.ts
pnpm check:tests
pnpm format:check
pnpm lint:ci
git diff --check
```

Run the integration test with `MNEIA_REQUIRE_DB=1` against a temporary Postgres/Neon branch before
calling the database invariants complete. Keep MNE-181 `In Progress`; device approval and `mneia whoami`
remain outside this slice.
