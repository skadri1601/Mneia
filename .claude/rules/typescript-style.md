---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript style

## Comments

**Comments are allowed, for the understanding of the code and the decision behind it.** Ruled by the
founder 2026-08-23, replacing the earlier "no comments unless asked". `AGENTS.md` §Code style is the
authority; this file previously contradicted it, which would have had the next agent stripping
comments the founder asked for.

What has not changed is what makes a comment worth writing. Names and structure still carry the
*what*; a comment earns its place by carrying the *why* — a protocol quirk, an upstream bug, a
constraint that is not visible from the code, or a decision that looks wrong until you know the
reason. A comment restating the line below it still rots silently and still costs the next reader.

Rationale that is dated and attributable belongs in the commit message as well, where it is
searchable. The two are not alternatives.

## Strictness

`strict: true`. No `any`. No non-null assertions (`!`) — narrow properly or handle the absence.
Prefer `unknown` plus a validator at boundaries over a cast.

Schema-validate everything crossing a trust boundary: MCP tool inputs, LLM responses, file imports,
HTTP request bodies. §10.1 step 2 requires malformed extractions to fail loudly rather than writing
partial rows, and that only works if the boundary is validated.

## Errors

Fail loudly and early. No empty catches, no swallowed rejections.

Error messages name what was expected, what was received, and what to do. `"invalid config"` costs
the reader a debugging session; `"expected .mneia/config to contain a projectId; found none — run
mneia init"` does not.

## Naming

Match `vision.md` §9 exactly for domain terms: `context_item`, `load_bearing`, `human_confirmed`,
`asserted_by`, `valid_from`, `decay_after`. Snake case in SQL, camel case in TypeScript, and the
mapping is mechanical.

Do not invent synonyms. "memory", "note", and "entry" are not `context_item`. A drifting vocabulary
between the spec and the code makes every future §n citation ambiguous.

## Async

`async`/`await`, never raw `.then()` chains. Bound concurrency on anything fanning out over items —
embedding a thousand items must not open a thousand sockets.
