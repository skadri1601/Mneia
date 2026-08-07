# @mneia/core

The library underneath [Mneia](https://mneia.dev) — shared project memory and handoff for teams
working with AI agents.

This package holds the data model, the rehydration pipeline, the supersede policy, the Postgres
store adapter and its migrations, and the telemetry spine. It is published because
[`@mneia/cli`](https://www.npmjs.com/package/@mneia/cli) and
[`@mneia/mcp-server`](https://www.npmjs.com/package/@mneia/mcp-server) depend on it.

**Most people want one of those two, not this.** Reach for `@mneia/core` when you are building your
own integration against a Mneia store.

## Install

```
npm install @mneia/core
```

Node 20.11 or newer. ESM only.

## What is in it

| Area | What it gives you |
|---|---|
| Domain types | `ContextItem`, `Checkpoint`, `Handoff`, `Conflict`, `Actor`, `Project`, `Session`, `Workspace`, and the §9 vocabulary — `load_bearing`, `human_confirmed`, `asserted_by`, `valid_from`, `decay_after` |
| Rehydration | `assembleSlice`, `scoreItems`, `packSlice`, `renderSlice`, and the token counters they budget against |
| Policy | `evaluateSupersede` and `assertSupersedeAllowed` — the arbiter that decides who may overrule whom |
| Store | `PostgresStoreAdapter`, the workspace-scoped store interface, and `MIGRATIONS` with its runner |
| Telemetry | The event spine, its sinks, and `redactEvent` |

## Two invariants worth knowing before you build on it

**An agent never overwrites what a human confirmed.** `evaluateSupersede` is the only place that
decides. Provenance — who asserted an item, and whether a human confirmed it — is derived from the
actor row in the store, never taken from a caller's payload.

**A load-bearing active constraint is always in the slice**, whatever the score and whatever the
token budget. A dropped constraint is exactly how an agent redoes the approach a human already
rejected.

## Multi-tenancy

Every tenant row carries `workspace_id`, and Postgres row-level security is mandatory rather than
advisory. The store adapter refuses a connection whose role holds `BYPASSRLS` or `SUPERUSER`, so a
misconfigured deployment fails loudly instead of quietly serving one tenant's rows to another.

## Stability

`0.1.x`. The surface will move before `1.0`; pin an exact version if you depend on it.

Apache-2.0.
