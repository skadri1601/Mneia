# Checkout, Quota, and Partial Extraction Design

## Scope and lane boundaries

This lane completes the remaining MNE-141 checkout plumbing, the enforceable part of MNE-178, the MNE-268 partial-extraction follow-up, and the stale `AGENTS.md:77-88` correction. It does not add pricing claims, overage invoices, a new telemetry event name, or a new usage table.

Lane C creates `apps/web/src/app/billing/**` and changes only its assigned billing, Stripe API, and hosted checkpoint-handler files. It may read Lane B's account context but does not edit `app/team`, `app/join`, or `server/current-account.ts`. The billing journey depends on Lane B's multi-workspace invitation fix landing first.

The telemetry payload contract requires a small shared-core schema change and client echo. Lane C will announce that interface before touching shared telemetry code and will not edit Lane A's CLI files. Until Lane A echoes the optional coverage object, older clients remain compatible and emit zero/default coverage.

## Checkout and portal

The new `/billing` page shows billing posture without advertising the unfinished Team feature table or displaying a dollar price. Stripe remains the price authority through `STRIPE_PRICE_ID`; the provisional `SEAT_PRICE_USD_CENTS` constant is not rendered.

Only a workspace lead may start checkout, and checkout is refused until the workspace has at least two accepted members. A workspace already `active`, `trialing`, or `past_due` is sent to the Stripe Billing Portal instead of receiving another checkout path.

The server action creates a Stripe-hosted Checkout Session in subscription mode. Its quantity equals the accepted member count. Checkout and subscription metadata carry `workspace_id`, preserving the webhook's metadata-only, RLS-safe workspace resolution. The existing Stripe customer is reused when present; otherwise Checkout creates one. A per-render checkout-attempt token becomes Stripe's idempotency key so repeated submission of one form returns one session.

The existing cancellation ordering guard is narrowed: a new `customer.subscription.created` event may revive a canceled workspace for the same customer, while a delayed `customer.subscription.updated` event still may not. This permits resubscription without orphaning the customer.

The Billing Portal is available whenever `billing_customer_ref` exists, including `past_due`, so a customer can update payment details or cancel. Stripe controls the dunning window: `past_due` retains Team entitlement and seats; `unpaid` and `canceled` remove them. No application-defined grace-period clock is added.

Stripe-hosted checkout is preferred over direct subscription creation because Stripe owns payment collection and authentication. Payment Links are rejected because they cannot enforce workspace authorization, membership, idempotency, or metadata binding at session creation.

## Quota and entitlement enforcement

Checkpoint proposal is the dominant inference boundary. Checkpoint write and rehydrate also incur smaller embedding costs, but this ticket follows §14.1 and meters extraction only; the existing daily rate limiter continues to bound all checkpoint requests.

The existing `checkpoint_usage` table is the only durable record written at proposal time. It records successful, failed, and fallback model attempts even when the client never commits a checkpoint. Reading it closes the abandoned-proposal and zero-candidate gaps that make `checkpoint.item_extracted` unsuitable as a pre-inference quota gate. No new counter or ledger is created.

One RLS-scoped query returns the workspace plan, billing status, purchased seats, configured checkpoint allowance, accepted member count, and current calendar-month proposal usage. Attempts written by one `recordUsage` transaction share PostgreSQL's transaction-stable `created_at`; usage therefore counts distinct `created_at` values, so a primary/fallback sequence consumes one proposal while a failed proposal still consumes one.

The gate applies these rules before invoking the extraction provider:

- `checkpoint_allowance IS NULL` is temporarily unmetered. MNE-180 must choose and backfill a real allowance before strict enforcement can be enabled without disabling every existing workspace.
- A configured workspace at or above its allowance is refused with the existing `forbidden` API code and a message naming usage, allowance, and the calendar-month reset boundary.
- A Team workspace must be `active`, `trialing`, or `past_due` and must have purchased at least as many seats as it has accepted members.
- Solo remains free and its configured allowance is enforced without exposing checkout to a one-person workspace.
- Enterprise uses the same explicit-allowance contract until a later commercial ruling defines otherwise.

The calendar month is an operational quota period, not a Stripe invoice period and not an overage-billing claim. Aligning it to subscription anniversaries would require persisting subscription-period data and is outside this no-migration lane.

## Partial extraction telemetry

The proposal exposes a coverage object containing `droppedTurns`, `splitTurns`, `pendingTurns`, `consumedTurns`, and `incompleteReason`. `splitTurns` comes from `chunkTurns`; server-side `droppedTurns` is normally zero because the server reducer cap is disabled. Lane A's removal of the client reducer cap makes that zero truthful rather than hiding client-side loss.

Raw provider and extraction-validation messages remain in the HTTP response for diagnosis but never enter §17. Telemetry receives a sanitized `incompleteReason` code: `provider_failed`, `invalid_output`, or `null`. Counts and the code are carried through the optional checkpoint-write coverage object and copied onto every existing `checkpoint.item_extracted` payload for that checkpoint.

No event names are added. The strict telemetry schema and privacy invariant cover the added fields, and the payload contains no transcript, model output, item body, or provider message. Sink failures remain observable through the existing telemetry health posture; changing write-path failure semantics is outside this lane because checkpoint writes deliberately survive telemetry delivery failures.

## Error handling

Checkout rejects non-leads, one-person workspaces, active duplicate subscriptions, missing Stripe configuration, malformed Stripe responses, and invalid attempt tokens without changing billing state. Quota failures occur before extraction. Stripe webhook events remain the authority for changing plan and billing status.

## Documentation and legal verification

`AGENTS.md:77-88` is replaced with the current chunking, watermark, and failover posture from commit `915685c`. No legal-copy edit is needed: Stripe is already named as a subprocessor and checkpoint consumption is already disclosed in `apps/site/src/content/legal.ts`.

## Verification and done-when evidence

Tests cover Checkout and Portal request encoding, metadata, customer reuse, idempotency, authorization, duplicate-subscription prevention, canceled-workspace resubscription, dunning status mapping, quota query grouping, every entitlement denial rule, proof that denied proposals never invoke extraction, coverage propagation, sanitized telemetry validation, and the no-content privacy invariant.

MNE-141 is complete only after a two-member workspace can move from no subscription through Stripe Checkout to an active Team state, open the Billing Portal, cancel, and resubscribe. Unit tests establish the code contract; a preview journey establishes routing and authorization; a live Stripe test-mode journey establishes webhook state transitions. Production deployment and production Stripe changes still require explicit approval.
