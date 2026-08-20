# @mneia/core

## 0.7.1

## 0.7.0

### Minor Changes

- d810849: Adds `mneia_retire`, which takes a stored item out of every future rehydration slice and handoff
  because it was never right or is no longer true — a doc fragment captured as a rule, a constraint
  describing a bug that has since been fixed, a fact that has gone stale.

  It is a correction, not a deletion: the row stays, the timeline still shows it, and the reason is
  recorded on the retiring checkpoint. Only a human actor may retire, because retiring overrides what
  a human recorded. Backed by `retireContextItem` on the store and `POST /api/v1/items/retire`.

## 0.6.1

### Patch Changes

- 5af42be: Handoff artifacts are now ranked and packed under a token budget instead of rendering every item the
  project holds, and the header reports what was left out. Active load-bearing constraints still appear
  regardless of budget pressure, and the `Superseded recently` block is bounded on its own.

  `mneia init` no longer marks a constraint scraped from `AGENTS.md`, `CLAUDE.md` or `.cursor/rules` as
  load-bearing — reading a bullet out of a file does not make it binding — and no longer imports
  term-definition rows such as `**Rehydrate** — assemble the context slice` as constraints at all.

## 0.6.0

### Minor Changes

- 8835fd8: `mneia handoff` freezes a receivable artifact and `mneia pickup` receives one, or lists the open handoffs when given no id. Both were refused with "ships in M2" until now.
- 1b90804: A handoff now records the item set it was rendered from. `handoff_item` gets its first writer, `listHandoffItems` reads it back with the section each item landed in, and the CLI surfaces the frozen artifact alongside where those items stand today.
- 974d555: Render the handoff artifact. `renderHandoff` produces the §10.3 eight-section markdown from real project state, with one provenance line format used by every item, and a Superseded Recently block that carries why each item went.
- 23760fe: Assemble and store a handoff. `assembleHandoff` builds the artifact from project state and writes it; the remote store's three `createHandoff` / `receiveHandoff` / `getHandoff` refusals are replaced by real calls against the hosted API.

## 0.5.0

## 0.4.0

## 0.3.0

### Minor Changes

- 0780ecf: MNE-86: record which client and which conversation a context item came from.

  `session` gains five nullable columns — `client_name`, `client_version`, `client_session_ref`,
  `client_session_name`, `client_session_url` — populated from the MCP initialization handshake and
  the harness conversation metadata, and surfaced on context reads as store-derived provenance.

  Client identity is taken only from the handshake, never from a tool payload, so `asserted_by` and
  `human_confirmed` keep their §10 authority. A write whose client metadata is missing is preserved
  and flagged partial rather than discarded, and reads that cannot resolve provenance report it as
  incomplete instead of fabricating it. Sessions are created lazily per conversation, so
  `mneia_rehydrate` gains no round trip against the §12.1 300ms budget.

### Patch Changes

- c401ca9: Rehydrate no longer fails on any project that has items. The BPE token counter loaded
  `gpt-tokenizer` through `createRequire` at call time, which no bundler can trace: the
  hosted app's `next build --output standalone` therefore shipped without it, and the first
  `countItemTokens` call threw `MODULE_NOT_FOUND`. Empty projects returned a slice because
  nothing was ever counted. The import is now static, so the tokenizer is resolved when the
  bundle is built rather than when a request arrives.
- f3ed751: MNE-271: report the version the package actually is.

  `VERSION` was a hand-maintained constant in `packages/core/src/index.ts` that changesets never
  touched, so `0.2.0` shipped reporting itself as `0.1.1` through `mneia --version`,
  `mneia-mcp --version`, the MCP `serverInfo`, and the API user-agent. `pnpm version:packages` now
  syncs it, and `pnpm check:version` fails CI and the release preflight if the two ever disagree.

## 0.2.0

### Minor Changes

- 9af6ccd: MNE-271: `mneia init` can create a project, so the CLI loop can be entered at all.

  `init` was bound to a stub that always rejected, and there was no project-creation path
  anywhere — `/api/v1/projects` was `GET` only and `createProject` returned `501`. A new
  `POST /api/v1/projects` creates or attaches idempotently on the workspace slug, the workspace
  is resolved from the bearer token rather than the payload, and the CLI is wired to it.

  Also fixes rehydration ranking: the hosted rehydrate route imported an embedding provider and
  never passed it, so the semantic weight scored every item identically and the task string
  affected nothing about which items came back (MNE-272).

- 76a23a9: MNE-271: `forbidden` joins the API error vocabulary, and the CLI names the fix.

  `POST /api/v1/projects` refuses a member creating a project that does not exist yet, so the wire
  needed a code for it. `403` previously decoded as `invalid_token`, which would have told a
  customer their credentials were bad when the real answer is that only a workspace lead can create
  a project. The CLI surfaces the server's message and tells them to ask a lead.
