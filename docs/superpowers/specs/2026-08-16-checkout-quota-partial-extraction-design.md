# Checkout, Quota, and Partial Extraction Design

## Scope

This lane completes MNE-141 checkout, MNE-178 quota enforcement, and the MNE-268 follow-up that makes partial extraction visible on the existing §17 event. It does not add pricing-page claims, overage billing, a second usage ledger, or a new telemetry event name.

## Checkout

The Team page gains a billing section visible to the current workspace. Only a workspace lead may start checkout, and checkout is refused until the workspace has at least two accepted members. This keeps the individual tier free under standing rule 7.

The server action creates a Stripe-hosted Checkout Session in subscription mode for the existing recurring Team price. Its quantity equals the workspace member count. The session carries `workspace_id` in checkout and subscription metadata so the existing subscription webhook can apply the resulting Team plan without an unscoped customer lookup. Success and cancellation return to the Team page with an explicit status message.

Stripe-hosted checkout is preferred over direct subscription creation because Stripe owns payment collection and authentication. Payment Links are rejected because they cannot enforce the workspace lead and membership checks at session creation.

## Quota and Entitlement Enforcement

Checkpoint proposal is the inference boundary and therefore the quota gate. The later checkpoint-write request does not invoke extraction and is not independently charged.

One RLS-scoped query returns the workspace plan, billing status, purchased seats, configured checkpoint allowance, accepted member count, and the current calendar month's usage. Usage is the count of distinct `checkpointId` values in `checkpoint.item_extracted` payloads, keeping §17 as the source of truth instead of using `checkpoint_usage` or another counter.

The gate applies these rules:

- `checkpoint_allowance IS NULL` fails closed and no inference request is sent.
- A workspace at or above its allowance is refused with a clear quota message.
- A Team workspace must be `active` or `trialing` and must have purchased at least as many seats as it has accepted members.
- Solo remains free; its configured allowance is enforced without opening a checkout path for one-person workspaces.
- Enterprise uses the same explicit allowance contract until a later ticket defines different commercial behavior.

The usage query uses the existing `(workspace_id, name, occurred_at)` telemetry index and scopes by the current monthly period. Counting distinct checkpoint IDs prevents a checkpoint containing several extracted items from consuming several units.

## Partial Extraction Telemetry

The extraction proposal reports three coverage fields: `droppedTurns`, `splitTurns`, and `incompleteReason`. The CLI preserves them through human review and includes them in the checkpoint write request. The hosted write handler copies them onto every existing `checkpoint.item_extracted` event for that checkpoint.

No event names are added. The values contain counts and a control-flow reason, never transcript or item content. The strict telemetry schema and privacy invariant are extended accordingly.

## Error Handling

Checkout rejects non-leads, one-person workspaces, missing Stripe configuration, and malformed Stripe responses without changing billing state. Quota failures return a typed API error before calling the extraction provider. Stripe webhook behavior remains the authority for changing a workspace plan.

## Verification

Tests cover Stripe Checkout request encoding and response validation, lead/team authorization, quota query mapping and each denial rule, proof that denied proposals never call extraction, propagation of all partial-extraction fields, strict telemetry validation, and the no-content privacy invariant. Targeted Vitest runs precede the full repository verification required before opening the PR.
