---
paths:
  - "packages/mcp-server/**"
---

# MCP server rules

§12.1: **the primary distribution vehicle.** First 100 users come from MCP registries plus one Show HN.

## Tool surface

Tools are `mneia_*`. Shipping order matters — do not build ahead of the milestone:

| Milestone | Tools |
|---|---|
| M1 | `mneia_rehydrate`, `mneia_assert`, `mneia_checkpoint`, `mneia_search` |
| M2 | `mneia_handoff_create`, `mneia_handoff_receive` |
| M4 | `mneia_conflicts` |

## The 300ms budget

**`mneia_rehydrate` p95 stays under 300ms.** §12.1: *"If it is slow, nobody uses it and the whole
product fails."*

It is called unconditionally at session start, so its latency decides whether the product gets used
at all. Treat 300ms as a hard CI-enforced budget, not an aspiration — and note that every ranking
improvement pushes against it, so the two goals must be traded off deliberately rather than by accident.

## Confirmation cannot block

Unlike the CLI, an MCP tool cannot block on an interactive prompt. Items needing human confirmation
are **returned as a pending queue** for the agent to surface — never silently auto-confirmed.

Auto-confirming to avoid an awkward return shape would quietly destroy the arbitration dataset,
which is one of only two real moats (§8).

## Every path enforces the arbitration rules

`mneia_assert` is a different code path from checkpoint, and it is the obvious place for standing
rule 1 to be violated by accident. An agent asserting mid-session must not be able to overwrite a
`human_confirmed` item by taking a route nobody wrote a test for.

## Client neutrality

Works in Claude Code, Cursor, Codex, and anything MCP-capable. No client-specific behaviour in tool
implementations; normalise differences at the transport edge.

MNE-79's compatibility matrix is the evidence for the neutrality claim in §3 Corollary B. A README
claiming "works with any MCP client" that has only ever been tested in one is the same single-vendor
product our competitors ship, with better marketing.

## Errors

Return structured errors an agent can act on. A tool failure that reads as prose gets retried
identically; one that names the cause and the fix gets corrected.
