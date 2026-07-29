---
name: scope-check
description: Rule on whether a request falls inside the vision.md §19 non-goals before building it. Use when a feature request touches orchestration, observability, document search, chat interfaces, durable execution, model hosting, or vector databases — or whenever a request feels reasonable but outside the three core operations.
---

# Scope check

`vision.md` §19: **"Explicitly out of scope. If a feature request falls here, the answer is no."**

Scope creep in a pre-revenue company rarely arrives as one bad decision. It arrives as eight
reasonable-sounding exceptions that nobody wrote down. This skill exists to make each one a recorded
ruling instead of a quiet drift.

## The list

- Agent orchestration or a runtime — *"we sit beside frameworks, never above them"*
- Observability, tracing, or evals — integrate, do not rebuild
- Enterprise document search — that is Glean's business
- A chat interface or an agent of our own
- Durable execution infrastructure
- Model hosting or inference
- A vector database — we use one
- Support for every framework on day one — MCP plus CLI covers the ecosystem

## How to rule

**1. Does it fall on the list?** If clearly not, proceed with normal work — no ruling needed.

**2. If it does, does it serve checkpoint, rehydrate, or handoff?**
§4: *"Everything else in the product exists to serve those three."* A request that serves none of them
is out, regardless of how good it sounds.

**3. Check whether §11 already pre-answers it.** Several of the tempting ones are settled:
durable execution is *"adopt if needed, do not build"* and not before month 6; observability is
*"do not build"* — integrate with LangSmith or Langfuse later if asked.

**4. Write the ruling.** Add an issue under **MNE-164** (Standing ruling log) labelled
`Non-Goal Guard`, with the date, the request, and either:
- **No** — with which §19 item it hits, or
- **Boundary moved** — with the specific reason it is no longer true

**5. Tell the founder.** A boundary that has genuinely moved is a `vision.md` change, and that is
their call, not yours.

## Expect the pressure to be reasonable

The requests that threaten §19 do not look like bad ideas. They look like *"can it also trace my
agent runs"*, *"can it index our Confluence"*, *"can it orchestrate the sub-agents"* — each
defensible alone, and asked by real users with real problems.

§7.2 is the counterweight: *"Any one of these five can be built by a funded team in a quarter. If our
plan is feature superiority, we lose."* Breadth is not the moat. Switching cost and the arbitration
dataset are (§8). Work that builds neither, and costs a milestone, is a loss even when it ships well.
