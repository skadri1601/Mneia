---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript style

## No comments

**Do not add comments unless asked.** This is a standing instruction from the founder.

Names and structure carry the meaning. Rationale belongs in the Linear ticket or the commit message,
where it is dated, attributed, and searchable — a comment is none of those things and rots silently.

The narrow exception: a comment that records a genuinely non-obvious external constraint, such as a
protocol quirk or an upstream bug with a link. If you cannot name the constraint, do not write it.

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
