# Checkout, Quota, and Partial Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Team-only Stripe Checkout and Portal access, enforce configured checkpoint allowances before extraction, preserve failed provider usage, and attach sanitized extraction coverage to the existing §17 checkpoint event.

**Architecture:** `/billing` is a server-rendered control surface backed by pure billing policy functions, the existing RLS-scoped billing store, and an extended Stripe client. Proposal-time quota reads the existing `checkpoint_usage` ledger in one RLS-scoped query. Partial coverage is an optional shared wire object; Lane C emits it when echoed, while Lane A owns the client echo needed to make production coverage non-default.

**Tech Stack:** TypeScript, Next.js App Router/server actions, Stripe REST API, PostgreSQL with FORCE RLS, Zod, Vitest, React server rendering.

---

## File map

- Create `apps/web/src/server/billing/checkout.ts`: pure checkout/portal authorization and request orchestration.
- Create `apps/web/src/server/billing/checkout.test.ts`: checkout policy and destination tests.
- Create `apps/web/src/server/billing/quota.ts`: pure entitlement and allowance decision.
- Create `apps/web/src/server/billing/quota.test.ts`: plan/status/seat/allowance behavior.
- Create `apps/web/src/server/billing/quota-store.ts`: one-query RLS Postgres quota snapshot.
- Create `apps/web/src/server/billing/quota-store.test.ts`: SQL, mapping, transaction, and RLS posture tests.
- Create `apps/web/src/server/billing/runtime.ts`: production Stripe client, billing store, quota store, and app origin wiring.
- Modify `apps/web/src/server/billing/stripe.ts`: Checkout Session, Billing Portal Session, and idempotency support.
- Modify `apps/web/src/server/billing/seats.ts`: represent Stripe dunning states without granting unpaid subscriptions.
- Modify `apps/web/src/server/billing/billing.test.ts`: Stripe encoding, status mapping, and cancellation regressions.
- Create `apps/web/src/app/billing/page.tsx`, `actions.ts`, `billing.module.css`, and colocated tests: reachable billing UI and authenticated actions.
- Modify `apps/web/src/components/AppHeader.tsx` and create/modify its test: signed-in `/billing` navigation.
- Modify `apps/web/src/server/extraction/select.ts` and `select.test.ts`: typed failure carrying accumulated usage attempts.
- Modify `apps/web/src/server/api/propose.ts` and `propose.test.ts`: quota gate, failed usage recording, and sanitized coverage.
- Modify `packages/core/src/api/wire.ts` and its tests: optional extraction coverage on proposal/write wires.
- Modify `packages/core/src/telemetry/types.ts`, `emitter.ts`, and telemetry tests: coverage on `checkpoint.item_extracted` without a new name.
- Modify `apps/web/src/server/api/handlers.ts` and `handlers.test.ts`: copy echoed coverage onto emitted events.
- Modify `AGENTS.md`: remove the stale MNE-265 defect section.

### Task 1: Preserve usage when extraction providers fail

**Files:**
- Modify: `apps/web/src/server/extraction/select.test.ts`
- Modify: `apps/web/src/server/extraction/select.ts`
- Modify: `apps/web/src/server/api/propose.test.ts`
- Modify: `apps/web/src/server/api/propose.ts`

- [ ] **Step 1: Write the failing runner test**

Add a test that makes both providers throw and asserts the rejection carries both attempts:

```ts
await expect(runner.run(REQUEST)).rejects.toMatchObject({
  attempts: [
    { model: PRIMARY, outcome: 'fell_back' },
    { model: FALLBACK, outcome: 'failed' },
  ],
});
```

- [ ] **Step 2: Run the runner test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/extraction/select.test.ts`

Expected: FAIL because the thrown provider error has no `attempts` property.

- [ ] **Step 3: Implement the typed failure**

Add and use this error shape in `select.ts`:

```ts
export class ExtractionRunError extends Error {
  readonly attempts: readonly ExtractionAttempt[];

  constructor(message: string, attempts: readonly ExtractionAttempt[], cause: unknown) {
    super(message, { cause });
    this.name = 'ExtractionRunError';
    this.attempts = [...attempts];
  }
}
```

Every terminal throw from `run()` must wrap the original failure after pushing the corresponding attempt. Successful fallback still returns the existing `ExtractionRunResult`.

- [ ] **Step 4: Verify the runner GREEN**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/extraction/select.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing proposal test**

Make `deps.run` reject with `new ExtractionRunError('both failed', attempts, cause)` and assert:

```ts
expect(deps.recordUsage).toHaveBeenCalledWith({ projectId: PROJECT.id, attempts });
expect(result.proposal.incompleteReason).toContain('both failed');
```

- [ ] **Step 6: Run the proposal test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/api/propose.test.ts`

Expected: FAIL because `handleProposeCheckpoint` discards attempts from rejected runs.

- [ ] **Step 7: Record failed attempts before returning partial coverage**

In the extraction catch, append attempts from `ExtractionRunError`; keep the current raw diagnostic for the HTTP response. The existing post-loop `recordUsage` call then persists successful and failed attempts in one transaction.

- [ ] **Step 8: Verify Task 1 GREEN and commit**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/extraction/select.test.ts apps/web/src/server/api/propose.test.ts`

Expected: PASS.

Commit:

```text
MNE-178: preserve failed extraction usage

Records provider attempts before a failed proposal returns so §14.1 enforcement counts inference that produced no checkpoint.
```

### Task 2: Make Stripe dunning states truthful

**Files:**
- Modify: `apps/web/src/server/billing/billing.test.ts`
- Modify: `apps/web/src/server/billing/seats.ts`

- [ ] **Step 1: Write failing status tests**

Add assertions that `unpaid` and `incomplete` map to `canceled`, while `past_due` retains Team and seats:

```ts
expect(billingStatusFor('unpaid')).toBe('canceled');
expect(billingStatusFor('incomplete')).toBe('canceled');
expect(
  stateAfterSubscription({
    current: SOLO,
    subscriptionStatus: 'past_due',
    seats: 3,
    customerRef: 'cus_1',
  }),
).toMatchObject({ plan: 'team', billingStatus: 'past_due', seatsPurchased: 3 });
```

- [ ] **Step 2: Run and verify RED**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/billing.test.ts`

Expected: FAIL with the old `past_due` mappings and solo/null past-due state.

- [ ] **Step 3: Implement the minimal mapping**

Change the status map and entitlement predicate:

```ts
unpaid: 'canceled',
incomplete: 'canceled',

const entitled = status === 'active' || status === 'trialing' || status === 'past_due';
```

Use `entitled` for Team plan and purchased seats. Preserve Enterprise as the current implementation does.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/billing.test.ts`

Expected: PASS.

Commit:

```text
MNE-141: represent Stripe dunning states

Keeps recoverable past-due teams entitled while refusing Team access to subscriptions that never paid or exhausted dunning.
```

### Task 3: Extend the Stripe client for Checkout and Portal

**Files:**
- Modify: `apps/web/src/server/billing/billing.test.ts`
- Modify: `apps/web/src/server/billing/stripe.ts`

- [ ] **Step 1: Write failing Checkout and Portal encoding tests**

Assert Checkout posts subscription mode, seat quantity, both workspace metadata fields, the configured price, optional existing customer, and `Idempotency-Key`. Assert Portal posts customer and return URL. Assert missing `url` responses fail with `invalid_payload`.

```ts
const session = await client.createCheckoutSession({
  workspaceId: WORKSPACE,
  customerId: 'cus_1',
  seats: 3,
  successUrl: 'https://app.mneia.dev/billing?checkout=success',
  cancelUrl: 'https://app.mneia.dev/billing?checkout=canceled',
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
});
expect(session.url).toBe('https://checkout.stripe.test/session');
```

- [ ] **Step 2: Run and verify RED**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/billing.test.ts`

Expected: FAIL because both methods are absent.

- [ ] **Step 3: Implement Stripe session methods**

Add:

```ts
export interface StripeHostedSession {
  readonly id: string;
  readonly url: string;
}

async createCheckoutSession(input: CheckoutInput): Promise<StripeHostedSession>;
async createPortalSession(input: PortalInput): Promise<StripeHostedSession>;
```

Extend private `post` with an optional idempotency key and validate both `id` and an HTTPS `url` before returning.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/billing.test.ts`

Expected: PASS.

Commit:

```text
MNE-141: create Stripe checkout and portal sessions

Uses Stripe-hosted payment and account management while binding subscriptions to the RLS workspace through metadata.
```

### Task 4: Build billing policy, runtime, actions, page, and navigation

**Files:**
- Create: `apps/web/src/server/billing/checkout.test.ts`
- Create: `apps/web/src/server/billing/checkout.ts`
- Create: `apps/web/src/server/billing/runtime.ts`
- Create: `apps/web/src/app/billing/actions.test.ts`
- Create: `apps/web/src/app/billing/actions.ts`
- Create: `apps/web/src/app/billing/page.test.tsx`
- Create: `apps/web/src/app/billing/page.tsx`
- Create: `apps/web/src/app/billing/billing.module.css`
- Create: `apps/web/src/components/AppHeader.test.tsx`
- Modify: `apps/web/src/components/AppHeader.tsx`

- [ ] **Step 1: Write failing pure-policy tests**

Cover lead-only access, two-member minimum, duplicate active/trialing/past-due checkout refusal, canceled refusal, valid solo checkout, Portal customer requirement, customer reuse, and attempt-token validation.

```ts
await expect(startCheckout({ account: MEMBER, snapshot, attemptId, stripe, origin }))
  .rejects.toMatchObject({ code: 'not_permitted' });

await expect(startCheckout({ account: LEAD, snapshot: { ...snapshot, memberCount: 1 }, attemptId, stripe, origin }))
  .rejects.toThrow(/at least two accepted members/);
```

- [ ] **Step 2: Run policy tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/checkout.test.ts`

Expected: FAIL because `checkout.ts` does not exist.

- [ ] **Step 3: Implement pure checkout orchestration**

Export `startCheckout` and `startPortal`. Derive workspace, role, seats, customer, and URLs only from trusted account/snapshot arguments. Never accept workspace, customer, quantity, price, or redirect URL from form data.

- [ ] **Step 4: Verify policy GREEN**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/checkout.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing action and page tests**

Mock `getCurrentAccount` and billing runtime. Assert actions redirect only to the Stripe URL returned by policy. Render the page and assert it shows no dollar price or unfinished Team feature claim, exposes checkout only to an eligible lead, exposes Portal when a customer exists, and renders accessible notices.

- [ ] **Step 6: Run UI tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/app/billing/actions.test.ts apps/web/src/app/billing/page.test.tsx apps/web/src/components/AppHeader.test.tsx`

Expected: FAIL because the billing route and header destination do not exist.

- [ ] **Step 7: Implement runtime, actions, page, styles, and header link**

Use server actions with fresh authentication. Instantiate `PostgresBillingStore(database)` and `StripeClient(requireStripeConfiguration())` in `runtime.ts`. Use `MNEIA_APP_ORIGIN` with the existing `https://app.mneia.dev` fallback. Add `<Link href="/billing">Billing</Link>` beside Projects and Team in the signed-in header.

- [ ] **Step 8: Verify UI GREEN and commit**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/checkout.test.ts apps/web/src/app/billing/actions.test.ts apps/web/src/app/billing/page.test.tsx apps/web/src/components/AppHeader.test.tsx`

Expected: PASS.

Commit:

```text
MNE-141: add the self-serve billing surface

Lets an eligible workspace lead enter Stripe Checkout and lets existing customers manage billing without advertising unfinished Team features (§14).
```

### Task 5: Add one-query quota state and gate extraction

**Files:**
- Create: `apps/web/src/server/billing/quota.test.ts`
- Create: `apps/web/src/server/billing/quota.ts`
- Create: `apps/web/src/server/billing/quota-store.test.ts`
- Create: `apps/web/src/server/billing/quota-store.ts`
- Modify: `apps/web/src/server/billing/runtime.ts`
- Modify: `apps/web/src/server/api/propose.test.ts`
- Modify: `apps/web/src/server/api/propose.ts`
- Modify: `apps/web/src/app/api/v1/checkpoints/propose/route.ts`

- [ ] **Step 1: Write failing quota policy tests**

Cover null allowance fail-open, exact-limit denial, solo configured allowance, Team billing status, past-due entitlement, seat deficit, and Enterprise explicit allowance.

```ts
expect(checkpointQuota({ ...BASE, checkpointAllowance: null })).toEqual({ allowed: true });
expect(checkpointQuota({ ...BASE, checkpointAllowance: 10, checkpointsUsed: 10 }))
  .toMatchObject({ allowed: false, code: 'allowance_exhausted' });
```

- [ ] **Step 2: Verify policy RED, implement, then GREEN**

Run before and after implementation: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/quota.test.ts`

Expected RED: module absent. Expected GREEN: PASS.

- [ ] **Step 3: Write failing RLS store tests**

Assert `assertConnectionEnforcesRls` precedes `BEGIN`, the workspace GUC is set, the query selects workspace plan/status/seats/allowance plus accepted member count and `count(DISTINCT created_at)` from `checkpoint_usage`, and mapped values are validated.

- [ ] **Step 4: Verify store RED, implement, then GREEN**

Run before and after implementation: `node node_modules/vitest/vitest.mjs run apps/web/src/server/billing/quota-store.test.ts`

Expected RED: module absent. Expected GREEN: PASS.

- [ ] **Step 5: Write the failing proposal gate tests**

Add `quotaFor(workspaceId, now)` to proposal dependencies. Assert an exhausted workspace throws `ApiRequestError('forbidden', ...)` before `deps.run`, and a null allowance proceeds.

- [ ] **Step 6: Verify proposal RED, implement route wiring, then GREEN**

Run before and after implementation: `node node_modules/vitest/vitest.mjs run apps/web/src/server/api/propose.test.ts apps/web/src/server/billing/quota.test.ts apps/web/src/server/billing/quota-store.test.ts`

Expected RED: extraction runs despite denial. Expected GREEN: PASS and provider mock remains uncalled on denial.

- [ ] **Step 7: Commit**

```text
MNE-178: enforce configured checkpoint allowances

Reads proposal usage from the existing RLS ledger before inference; null remains unmetered until MNE-180 backfills an allowance (§14.1).
```

### Task 6: Carry sanitized partial coverage on the existing §17 event

**Files:**
- Modify: `packages/core/src/api/wire.ts`
- Modify: `packages/core/src/api/wire.test.ts`
- Modify: `packages/core/src/telemetry/types.ts`
- Modify: `packages/core/src/telemetry/emitter.ts`
- Modify: `packages/core/src/telemetry/privacy.test.ts`
- Modify: `packages/core/src/telemetry/emitter.test.ts`
- Modify: `apps/web/src/server/api/propose.test.ts`
- Modify: `apps/web/src/server/api/propose.ts`
- Modify: `apps/web/src/server/api/handlers.test.ts`
- Modify: `apps/web/src/server/api/handlers.ts`

- [ ] **Step 1: Write failing wire tests**

Define the desired shared schema:

```ts
const ExtractionCoverageWireSchema = z.strictObject({
  droppedTurns: z.number().int().nonnegative(),
  splitTurns: z.number().int().nonnegative(),
  pendingTurns: z.number().int().nonnegative(),
  consumedTurns: z.number().int().nonnegative(),
  incompleteReason: z.enum(['provider_failed', 'invalid_output']).nullable(),
});
```

Assert proposal responses expose it and checkpoint write accepts it optionally while rejecting arbitrary reason text.

- [ ] **Step 2: Run wire tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run packages/core/src/api/wire.test.ts`

Expected: FAIL because the schema is absent.

- [ ] **Step 3: Implement shared wire schema and exports**

Add optional `coverage` to `CheckpointProposalWireSchema` and `CheckpointWriteWireSchema.checkpoint`. Preserve existing top-level `pendingTurns` and raw `incompleteReason` for old clients.

- [ ] **Step 4: Verify wire GREEN**

Run: `node node_modules/vitest/vitest.mjs run packages/core/src/api/wire.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing proposal coverage tests**

Assert chunk splitting populates `splitTurns`, failed providers produce `provider_failed`, invalid model output produces `invalid_output`, and no raw provider/model text appears inside `coverage`.

- [ ] **Step 6: Run proposal tests RED, implement, then GREEN**

Destructure `splitTurns` from `chunkTurns`, read reducer `droppedTurns`, track an enum separately from raw `incompleteReason`, and return `coverage`.

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/server/api/propose.test.ts`

Expected final result: PASS.

- [ ] **Step 7: Write failing telemetry and handler tests**

Assert `checkpoint.item_extracted` accepts exactly one nested coverage object, rejects raw strings outside the enum, and that `handleWriteCheckpoint` copies echoed coverage to every extracted event. Add a sentinel provider message and prove the serialized event does not contain it.

- [ ] **Step 8: Run telemetry/handler RED, implement, then GREEN**

Run: `node node_modules/vitest/vitest.mjs run packages/core/src/telemetry/emitter.test.ts packages/core/src/telemetry/privacy.test.ts apps/web/src/server/api/handlers.test.ts`

Expected final result: PASS without adding to `TELEMETRY_EVENT_NAMES`.

- [ ] **Step 9: Commit**

```text
MNE-268: expose sanitized extraction coverage in §17

Carries numeric coverage and bounded failure codes on checkpoint.item_extracted without sending transcript or model output.
```

### Task 7: Correct the stale record and verify the lane

**Files:**
- Modify: `AGENTS.md`
- Verify: `apps/site/src/content/legal.ts`
- Verify: all files above

- [ ] **Step 1: Update `AGENTS.md:77-88`**

Replace the stale open-defect block with a current statement that commit `915685c` disabled the server reducer cap, chunks within model windows, advances the watermark only through validated chunks, and reads `contextTokens` during model selection. Do not add unrelated roadmap prose.

- [ ] **Step 2: Verify legal disclosure without editing it**

Run:

```powershell
Select-String -Path apps/site/src/content/legal.ts -Pattern 'Stripe|checkpoint consumption' -Context 1,2
```

Expected: Stripe remains in the subprocessor table and checkpoint consumption remains disclosed.

- [ ] **Step 3: Run focused tests sequentially**

Run:

```powershell
node node_modules/vitest/vitest.mjs run apps/web/src/server/extraction/select.test.ts apps/web/src/server/api/propose.test.ts apps/web/src/server/api/handlers.test.ts apps/web/src/server/billing/billing.test.ts apps/web/src/server/billing/checkout.test.ts apps/web/src/server/billing/quota.test.ts apps/web/src/server/billing/quota-store.test.ts apps/web/src/app/billing/actions.test.ts apps/web/src/app/billing/page.test.tsx packages/core/src/api/wire.test.ts packages/core/src/telemetry/emitter.test.ts packages/core/src/telemetry/privacy.test.ts
```

Expected: all listed test files pass with zero failures.

- [ ] **Step 4: Run repository verification**

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:policy`, and `pnpm -r build`. Record explicitly whether `DATABASE_URL` was present; skipped Postgres integrations are not a verified pass.

- [ ] **Step 5: Run the preview billing journey**

With test Stripe configuration, verify an eligible lead can reach `/billing`, receive a Checkout URL, process signed subscription events into active/past-due/canceled states, and open a Portal URL. Do not deploy production or change production Stripe configuration without approval.

- [ ] **Step 6: Commit documentation and verification record**

```text
MNE-141, MNE-178, MNE-268: correct the lane C operating record

Updates the stale extraction posture and records verification boundaries for checkout, quota, and §17 coverage.
```

- [ ] **Step 7: Prepare the PR and Linear handoff**

Push `feat/mne-141-checkout-and-quota` and open a PR containing `Closes MNE-141`, `Part of MNE-178`, and `Part of MNE-268`. Keep MNE-178 open until MNE-180 supplies and backfills allowances. Keep MNE-268 open until Lane A echoes coverage and production delivery is verified.
