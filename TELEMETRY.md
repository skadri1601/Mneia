# Telemetry

What Mneia records, where it goes, and how to turn it off.

This document is the disclosure obligation in MNE-50. If you change an event payload, change this
file in the same commit — a stale telemetry disclosure is worse than none.

## The short version

Mneia records **thirteen structured events** describing *what happened to which item*. Every payload
is ids, types, counts and timings. **No event carries an item `body`, an item `title`, a task
description, a file path, or any prose you or an agent wrote.**

That is enforced by the type system and by a test, not by convention. `packages/core/src/telemetry/
privacy.test.ts` instantiates one of every event name and asserts a sentinel body string reaches no
sink at any nesting depth, and that any undeclared field is refused outright. `.claude/rules/
testing.md` lists it among the four tests that may never be weakened, skipped, or deleted.

## Turning it off

```
MNEIA_TELEMETRY=off
```

That yields a no-op emitter with an identical type signature, so nothing downstream changes shape.
Events are written nowhere — not buffered, not queued for later.

## Where events go

**Locally, always.** Events are appended as JSON Lines to `~/.mneia/events.jsonl` (or
`telemetryPath` in `~/.mneia/local.json`). That path involves no network.

**Remotely, only if you ask.** Setting `MNEIA_TELEMETRY_ENDPOINT` adds a second sink that POSTs
batches to that URL; `MNEIA_TELEMETRY_TOKEN` supplies a bearer token if the endpoint needs one. With
the endpoint unset — which is the default, and the only state a fresh install is ever in — **nothing
is transmitted off your machine.** The remote sink is additive: enabling it never stops the local
JSONL from being written, so turning it off later does not cost you your own history.

Transmission failures are reported, not swallowed. A rejected batch or an unreachable endpoint logs
how many events were lost rather than failing silently.

Read the file, delete it, or point it somewhere else. It is yours.

## What is in an event

Every event carries the same context: `workspaceId`, `projectId`, `actorId`, `sessionId` (nullable),
`occurredAt`, and `name`. Beyond that:

| Event | Adds |
|---|---|
| `rehydration.slice_shown` | `sliceId`, `itemIds`, `tokenBudget`, `tokensUsed`, `durationMs` |
| `rehydration.item_referenced` | `sliceId`, `itemId` |
| `rehydration.item_ignored` | `sliceId`, `itemId` |
| `checkpoint.item_extracted` | `checkpointId`, `itemId`, `kind`, `confidence`, `loadBearing`, `trigger` |
| `checkpoint.item_confirmed` | `checkpointId`, `itemId` |
| `checkpoint.item_edited` | `checkpointId`, `itemId`, `fieldsChanged` — **field names only, never values** |
| `checkpoint.item_rejected` | `checkpointId`, `itemId` |
| `conflict.detected` | `conflictId`, `itemA`, `itemB`, `loadBearing` |
| `conflict.resolved` | `conflictId`, `itemA`, `itemB`, `resolution`, `resolvedBy` |
| `item.superseded` | `previousItemId`, `nextItemId` |
| `handoff.created` | `handoffId`, `itemIds`, `toActor` |
| `handoff.received` | `handoffId`, `receivedBy` |
| `handoff.time_to_first_action` | `handoffId`, `elapsedMs` |

`kind`, `trigger` and `resolution` are fixed enums from `vision.md` §9. `fieldsChanged` is a list of
column names — that an item's `body` was edited is recorded; what it was edited to is not.

## Why these events exist

§17. They are the arbitration dataset — which items an agent was shown, which it actually used, and
which a human confirmed, edited or rejected. That is the training signal for ranking, and it is the
one thing in this product that cannot be retrofitted: a week not recorded is a week that can never be
reconstructed.

The signal does not need the prose. Keeping bodies out means the corpus is structurally incapable of
leaking one customer's decisions into another's ranking.

## What this document does not claim

Mneia is hosted. Item bodies live in our Postgres, because a shared memory layer with no shared
bodies is not a product — see `vision.md` §11.1, which revoked the earlier "no content leaves your
machine" framing on 2026-07-28. Privacy here is enforced by **controls**: scope enforcement on read,
retention, and residency. This file covers the telemetry path only.

What the store holds, and who can read it, is the Privacy Policy's subject, not this file's.
