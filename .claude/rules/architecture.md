---
paths:
  - "packages/**"
  - "apps/**"
  - "package.json"
  - "pnpm-workspace.yaml"
  - "turbo.json"
---

# Architecture rules

## Packages

| Package | Contents | Licence |
|---|---|---|
| `@mneia/core` | Data model, store adapters, checkpoint, rehydration, handoff render, telemetry | Apache 2.0 |
| `@mneia/cli` | Thin surface over core | Apache 2.0 |
| `@mneia/mcp-server` | Thin surface over core | Apache 2.0 |
| `@mneia/web` | Proprietary hosted product control plane | Unlicensed |

**Dependency direction is one-way.** `cli` and `mcp-server` both depend on `core`. They never depend
on each other, and `core` never imports from either. If a behaviour is needed in both surfaces, it
belongs in `core`.

Keeping the surfaces thin is what makes MNE-104 possible — the CLI and the MCP server returning
identical results for the same input requires the logic to live in one place.

## The open/closed split

This repository is private. It may contain both the Apache 2.0 **client** packages and the proprietary
hosted layer — API, store, `apps/web`, billing, conflict UI, permissions, and audit. The hosted layer
consumes `@mneia/core` within this repository.

The root Apache 2.0 licence covers only `packages/core`, `packages/cli`, and `packages/mcp-server`.
Each hosted package must declare `UNLICENSED` and carry a nested licence notice that excludes it from
the root licence.

If this repository is ever made public, extract the entire proprietary hosted layer into a separate
private repository before publishing: API, hosted store, product app, billing, conflict UI, permissions,
and audit. A public repository may contain only the Apache 2.0 clients; a private directory inside it
cannot protect proprietary product code.

**Never add server concerns to these packages.** They hold the schema, the prompts, the ranking
algorithm, and the surface translation — nothing that requires the database.

**And never claim self-hostability here.** §15 was rewritten on 2026-07-28: the clients require an
account and do not function without the service. Language implying otherwise in a README, a package
description, or a registry listing is a claim we do not currently meet.

## Build versus adopt (§11)

| | |
|---|---|
| **Build** | Extraction, contradiction detection, rehydration ranking. *This is the product.* |
| **Adopt** | Postgres + pgvector, embeddings (pluggable), durable execution if ever needed |
| **Never** | Agent orchestration, observability, document indexing, a vector database |

§11 on orchestration: *"We sit beside LangGraph, CrewAI, Claude Code. Never above them."*

## One dependency

The store is Postgres. Not Postgres plus a graph database plus Redis plus a queue.

This is not minimalism for its own sake — it is what makes the M5 BYOC deployment (MNE-147) a
conversation an enterprise buyer will have rather than a procurement project. §11 rules a graph
database premature: bi-temporal columns plus `supersedes` links cover the need until multi-hop
reasoning is a demonstrated bottleneck.

## Vendor neutrality

§3 Corollary B: *"If it only works inside Claude Code, it is not a handoff, it is a session feature."*

No vendor-specific types, paths, or assumptions in `core`. Client differences are normalised at the
edges — the trajectory reader (MNE-57) is the main place this pressure shows up. Embeddings stay
behind an interface with the model identity recorded alongside stored vectors.
