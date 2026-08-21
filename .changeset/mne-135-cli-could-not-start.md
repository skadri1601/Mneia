---
'@mneia/cli': patch
---

Fix a circular import that stopped the CLI from starting at all.

`http-api.ts` imported `MAX_CHAIN_REVISIONS` and `matchItemIds` from `commands/log.ts` as values
while `commands/log.ts` imported `httpLogApi` back from `http-api.ts`. Every other command import in
that file is `import type` and erases at compile time; this one did not, so the two modules formed a
real cycle and `httpLogApi` was still in its temporal dead zone when `log.js` evaluated.

The result was that **no** command ran — `mneia --version` threw `ReferenceError: Cannot access
'httpLogApi' before initialization` before any argument was parsed. Both symbols now live in
`item-ids.ts`, which imports nothing from the command layer.

Nothing caught this: the type checker is blind to value cycles, the suite never executed the built
binary, and CI does not run the artifact it publishes. `tests/smoke/binaries-start.test.ts` now runs
every binary declared in a package manifest and asserts it starts, and CI runs it after the build.
