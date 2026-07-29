---
paths:
  - "packages/**"
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

**Dependency direction is one-way.** `cli` and `mcp-server` both depend on `core`. They never depend
on each other, and `core` never imports from either. If a behaviour is needed in both surfaces, it
belongs in `core`.

Keeping the surfaces thin is what makes MNE-104 possible — self-hosted and hosted producing identical
results on the same input requires the logic to live in one place.

## The open/closed split is physical

§15 keeps the three packages above open source. The hosted layer — sync, web app, billing, conflict
UI, permissions, audit — is **closed and lives in a separate private repo**, consuming `@mneia/core`
from npm.

A private directory inside a public repo is not possible, and a single repo with a licence split
confuses contributors. MNE-37 requires CONTRIBUTING to state the boundary; two repos make it
self-evident instead of a rule anyone has to remember.

**Never add closed-source concerns to these packages.** If a feature only matters when more than one
person is involved, it is hosted-layer work.

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
