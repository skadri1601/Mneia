---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/vitest.config.*"
  - "**/tests/**"
---

# Testing rules

Vitest. Colocate unit tests next to source as `*.test.ts`. Integration tests that need a real
Postgres go in `tests/integration/` and run against the CI service container.

## The invariant tests

Four tests encode rules that must not be broken by a later refactor. They are the reason those rules
are tests rather than comments. **Never weaken, skip, or delete them.**

| Test | Rule | Ticket |
|---|---|---|
| Human-confirmed items are never auto-superseded by an agent assertion | §10.1 step 5 | MNE-63 |
| Load-bearing active constraints always appear in a slice, at any budget | §10.2 | MNE-69 |
| Every write path emits its §17 event | §17 | MNE-51 |
| No item `body` appears in a remote telemetry payload | MNE-50 | MNE-50 |

If one of these starts failing, the code is wrong. Fix the code. If you genuinely believe the test is
wrong, that is a `vision.md` change and needs the founder — not a test edit.

## One engine

Store tests run against **Postgres only** — there is no second engine (§11.1). Use a CI service
container or a throwaway Neon branch; do not reach for an in-memory substitute that behaves
differently from the thing you ship on.

## Fixtures

Use the shared seed harness (MNE-47): humans and agents, superseded chains, disputed items,
load-bearing constraints. Ad-hoc fixtures per test file produce subtly different corpora that hide
ranking bugs — which is the class of bug hardest to notice and most damaging to trust.

## Performance

The p95 rehydration budget (300ms, §12.1) is a CI check against a realistically sized corpus, not a
manual measurement. A store with fifty items passes any budget and tells you nothing.

## What not to test

Do not assert on LLM output text. Extraction and contradiction detection are evaluated by the eval
harnesses (MNE-66, MNE-113, MNE-116) against precision and recall, not by string equality in unit
tests. Unit-test the schema validation and the control flow around the model call.
