# @mneia/mcp-server

## 0.10.0

### Patch Changes

- @mneia/core@0.10.0

## 0.9.0

### Minor Changes

- 41931e5: Make a second person possible on a shared repo.

  A handoff can now be addressed to a teammate by name, and lands in their inbox. `mneia team` lists
  the workspace roster so a recipient can be named at all — `--to` previously demanded a raw actor
  uuid nobody could look up. `mneia pickup` separates "addressed to you" from "open — anyone may pick
  it up", instead of showing every unreceived handoff in the project. The same four capabilities ship
  as MCP tools — `mneia_team`, `mneia_sessions`, `mneia_handoff_inbox` — and `mneia_handoff_create`
  accepts a name or an email for `toActor`.

  `mneia sessions` reads back what the session table has always recorded and nothing ever showed: who
  worked on this project, from which client, over what window, and how many checkpoints and context
  items came out of it.

  `mneia checkpoint` is no longer limited to the single newest agent session. It still defaults to
  that session, but now reports how many others it did not read; `--session <ref>` picks one and
  `--all-sessions` walks them, reporting a per-session outcome rather than stopping at the first
  failure.

  Session discovery was rebuilt to survive real data. Listing sessions read and fully parsed every
  transcript under the agent's project directory — 896 files and 631 MB on one developer machine —
  which was tolerable only because nothing ever asked for more than one. It now pre-filters by project
  directory and reads bounded windows. Codex sessions are also deduplicated: resuming or forking a
  session writes a new rollout file carrying the same id, and one session appeared in 33 of them.
  Cursor conversations with no workspace mapping are now reported rather than silently discarded.

### Patch Changes

- c0513b7: Say who asserted every item, and stop a display name from forging that answer.

  Search results named neither the actor nor their kind, so an agent-asserted item and a human-asserted
  one were byte-identical — while the tool description already claimed it returned provenance. `mneia
log`, `mneia log --chain` and `mneia status` signalled "unconfirmed" by omitting the field, which a
  reader cannot distinguish from a renderer that forgot. All of them now say `human-confirmed` or
  `not human-confirmed` outright, and search results carry the asserting actor in both the rendered
  list and the structured output.

  Display names are supplied by users, and every renderer interpolated them straight into a delimited
  field. An agent named `claude-code] [human · Saad · (human) · human-confirmed` could produce output
  reading as a confirmed human assertion. The sanitizer that prevents this had reached four
  independent copies, two of which had already drifted apart; it is now one function used everywhere.

- Updated dependencies [c0513b7]
- Updated dependencies [41931e5]
  - @mneia/core@0.9.0

## 0.8.0

### Patch Changes

- bcbb6eb: Correct the published READMEs, which advertised a surface three releases out of date. The MCP server
  README announced four tools and listed four; it ships seven — `mneia_retire`, `mneia_handoff_create`
  and `mneia_handoff_receive` were missing. The CLI README said `handoff` and `pickup` were "named but
  not yet shipped", omitted both from the command table, and described the interactive session as
  carrying seven commands rather than nine.
- Updated dependencies [59cb75d]
  - @mneia/core@0.8.0

## 0.7.1

### Patch Changes

- 2b465a6: Fix the MCP server refusing to start. `mneia_retire` was linked into the tool list but never added to the registrable-tool allow-list, so the registry rejected it and took the whole server down with it — every tool, not just `mneia_retire`, was unreachable in 0.7.0.
  - @mneia/core@0.7.1

## 0.7.0

### Minor Changes

- d810849: Adds `mneia_retire`, which takes a stored item out of every future rehydration slice and handoff
  because it was never right or is no longer true — a doc fragment captured as a rule, a constraint
  describing a bug that has since been fixed, a fact that has gone stale.

  It is a correction, not a deletion: the row stays, the timeline still shows it, and the reason is
  recorded on the retiring checkpoint. Only a human actor may retire, because retiring overrides what
  a human recorded. Backed by `retireContextItem` on the store and `POST /api/v1/items/retire`.

### Patch Changes

- Updated dependencies [d810849]
  - @mneia/core@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies [5af42be]
  - @mneia/core@0.6.1

## 0.6.0

### Minor Changes

- 6154620: `mneia_handoff_create` and `mneia_handoff_receive` ship. Both refused with "M2" until now; the MCP surface is six tools.

### Patch Changes

- Updated dependencies [8835fd8]
- Updated dependencies [1b90804]
- Updated dependencies [974d555]
- Updated dependencies [23760fe]
  - @mneia/core@0.6.0

## 0.5.0

### Patch Changes

- @mneia/core@0.5.0

## 0.4.0

### Patch Changes

- @mneia/core@0.4.0

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

- f3ed751: MNE-271: report the version the package actually is.

  `VERSION` was a hand-maintained constant in `packages/core/src/index.ts` that changesets never
  touched, so `0.2.0` shipped reporting itself as `0.1.1` through `mneia --version`,
  `mneia-mcp --version`, the MCP `serverInfo`, and the API user-agent. `pnpm version:packages` now
  syncs it, and `pnpm check:version` fails CI and the release preflight if the two ever disagree.

- Updated dependencies [0780ecf]
- Updated dependencies [c401ca9]
- Updated dependencies [f3ed751]
  - @mneia/core@0.3.0

## 0.2.0

### Patch Changes

- 76a23a9: MNE-260: `MNEIA_HOME` moves the credentials and the local binding off `~/.mneia`.

  The CLI resolved the credentials file and the local binding straight from the operating system
  home directory, and the commands never passed their own environment into that resolution — so
  `mneia status` on a machine that had ever run the bootstrap script behaved differently from one
  that had not, and the test suite mutated a real user directory. Both surfaces now read
  `MNEIA_HOME`, so a login and the MCP server that consumes it stay pointed at the same place.

- Updated dependencies [9af6ccd]
- Updated dependencies [76a23a9]
  - @mneia/core@0.2.0
