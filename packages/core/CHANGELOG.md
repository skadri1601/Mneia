# @mneia/core

## 0.14.1

### Patch Changes

- 8ef2b35: Fix the defects the three core operations were carrying, several of which lost work silently.

  **A rehydration slice now costs what it says it costs.** `countItemTokens` charged a flat six
  tokens of markup per item, which covered `- ` and nothing else — not the provenance meta line,
  not the `**LOAD-BEARING**` marker, not per-line body indent. Measured, a forty-item slice
  reported `1200/3000` while rendering 2,405 tokens, so `mneia_rehydrate` at its 4,000-token
  default was quietly spending about 8,000 tokens of the caller's context and printing a false
  number in the header. It now prices the exact text the renderer emits. At the same budget a
  slice carries roughly half as many items, because the old count was wrong rather than because
  anything got stingier. Handoffs share the packer and shrink the same way.

  **Checkpoint stops losing turns.** An upload that did not reach back to the stored watermark
  was refused outright, so for a transcript that had moved on those turns were gone for good.
  The upload is now always extracted, and the watermark is held rather than moved when nothing
  in the request proves forward progress — monotonic by construction. Separately, a single turn
  over the wire limit, or more than five thousand turns since the watermark, made a session
  permanently un-checkpointable: the oversized turn was in every later upload too, so the
  rejection repeated forever. Both are now trimmed or split at the client with the loss made
  visible in the prompt.

  **Extraction degrades instead of stopping.** A revoked, unpaid, or forbidden model key threw
  before the fallback vendor was ever tried, taking every checkpoint down until a redeploy —
  while an ordinary rate limit on the same key failed over correctly. A vendor refusing the
  account is now treated as worth falling back from; a refused request still fails terminally.

  **Non-English candidates survive.** The similarity normaliser stripped everything outside
  `[a-z0-9]`, so a Chinese, Japanese, Cyrillic, Greek, or Arabic title normalised to the empty
  string and was discarded as carrying nothing a reader could act on. Accented Latin was split
  into fragments that matched the wrong things.

  **A handoff reads the way it was written.** The interop importer cut a title at the first
  markdown soft-wrap and then repeated the whole bullet as the body, which is why received
  artifacts printed each constraint twice. The renderer escaped inline `**bold**` as though it
  opened a block, leaving a literal backslash in the artifact. The "Superseded recently" block
  was capped before it was windowed, and on the wrong ordering, so a decision superseded
  yesterday could be hidden behind five older ones — the one block whose whole purpose is to
  stop a receiver re-proposing a rejected approach.

## 0.14.0

### Minor Changes

- 9823152: Stop paying twice for the same turns when a transcript rotates.

  `propose` ignored the `resolved` flag from `turnsSince`, so an upload that did not reach
  back to the stored watermark was treated as entirely new: the watermark moved backwards and
  every turn in between was extracted, and billed, a second time.

  Telling the two cases apart needs the client, because the server cannot distinguish "turns
  went missing between us" from "this transcript no longer goes back that far" by looking at
  the upload alone. `CheckpointProposeWireSchema` therefore gains `fromStart`, which the CLI
  sets only after probing for the watermark and finding the transcript has rotated past it.
  It defaults to `false`, so an older client is unaffected.

  The same schema also drops `.min(1)` from `turns`. The client probes for the watermark by
  uploading no turns, and requiring at least one made an oversized session impossible to
  checkpoint at all (MNE-100).

## 0.13.0

### Minor Changes

- 03d360a: Cut what a checkpoint costs to run, without changing what it does.

  The extraction prompt now lists existing items by title alone. Their ids were never read
  back — no candidate field names an existing item and the system prompt tells the model not
  to judge replacement — so a rendered UUID cost about 20 tokens each and bought nothing. At
  the 200-item limit the prefix drops from roughly 7,400 tokens to 3,600.

  `ExtractionProviderRequest` gains an optional `cacheKey`, so a caller can group provider
  prompt-cache lookups. Optional, so existing implementers are unaffected.

## 0.12.0

### Minor Changes

- cb8705c: `mneia checkpoint` now reads every agent session discovered for the directory, not only the most recent one. A session you never checkpointed no longer stays invisible. `--all-sessions` still works and now names the default; `--session <ref>` still picks one.

  Sweeping is affordable because `propose` asks for the watermark before it uploads anything — a session with no new turns sends no transcript at all, where it previously re-uploaded the whole thing to discover there was nothing to do.

  Fixed: the API rejected an upload of no turns, so a session too large for a single request could not be checkpointed at all. The incremental-upload path had been sending exactly that as its first request.

  Rehydration got roughly three times faster on a large corpus. The candidate query no longer serialises every candidate's embedding vector to text before discarding all but the top 200; the cosine similarity the ranker needs is computed once in Postgres and returned as a number. Measured on 8,000 items, p95 fell from 331ms to 107ms, back inside the 300ms budget.

  Gemini CLI sessions are now a capture source. `mneia checkpoint` discovers them for the directory you are in, attributing each one through the project map Gemini CLI keeps. Sessions written by an older Gemini CLI, which named its project directory by a hash rather than by the path, are readable by naming them with `--session <ref>` — they carry no directory of their own, so nothing guesses one for them.

- cb8705c: `mneia checkpoint --session <ref>` accepts `--source <harness>` alongside it. When both are given, Mneia reads that one transcript directly instead of enumerating every harness on the machine and filtering the results down.

  Discovery was scan-then-filter: every invocation opened Cursor's global `state.vscdb` and one per Cursor workspace, walked `~/.gemini`, and parsed every Codex, Claude Desktop and Warp session it could find, only to discard everything whose working directory was not the one you ran in. That cost about 1.3s and a great deal of I/O before any useful work, and sessions that record no working directory showed up as `blocked` noise from folders you were not working in.

  An automatic trigger already knows which harness it is, which session just ended, and which directory it ran in. It can now say so.

  `createReaders(sources)` in `@mneia/core` takes an optional source list and builds only those readers.

## 0.11.0

### Minor Changes

- f047d41: Let a person drain the review queue without opening a browser.

  Items a checkpoint recorded wait for a human to confirm, edit, or reject them, and until now that
  could only happen in the web app — an agent that had just run a checkpoint had no way to put the
  queue in front of its human. `mneia review` lists what is waiting and `mneia review --drain` walks it
  one item at a time, where confirm is one keypress and editing prefills rather than making you retype.
  `mneia_review_queue` exposes the same queue to an agent, deliberately read-only: an MCP tool cannot
  block and ask, so confirming there would be an agent deciding on a person's behalf.

  A confirmation can only come from a keypress. `--drain` refuses off a TTY — piped, redirected, or in
  CI — before it even reads the queue, and there is no flag anywhere that confirms an item.

  Both surfaces go through one hosted handler, so the terminal and the web app return the same pending
  set and leave the same record.

- e82bd37: `mneia checkpoint` now reads every agent session discovered for the directory, not only the most recent one. A session you never checkpointed no longer stays invisible. `--all-sessions` still works and now names the default; `--session <ref>` still picks one.

  Sweeping is affordable because `propose` asks for the watermark before it uploads anything — a session with no new turns sends no transcript at all, where it previously re-uploaded the whole thing to discover there was nothing to do.

  Fixed: the API rejected an upload of no turns, so a session too large for a single request could not be checkpointed at all. The incremental-upload path had been sending exactly that as its first request.

  Rehydration got roughly three times faster on a large corpus. The candidate query no longer serialises every candidate's embedding vector to text before discarding all but the top 200; the cosine similarity the ranker needs is computed once in Postgres and returned as a number. Measured on 8,000 items, p95 fell from 331ms to 107ms, back inside the 300ms budget.

  Gemini CLI sessions are now a capture source. `mneia checkpoint` discovers them for the directory you are in, attributing each one through the project map Gemini CLI keeps. Sessions written by an older Gemini CLI, which named its project directory by a hash rather than by the path, are readable by naming them with `--session <ref>` — they carry no directory of their own, so nothing guesses one for them.

## 0.10.0

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

## 0.8.0

### Minor Changes

- 59cb75d: Surface who asserted every item, and let a decision's history be read end to end.

  `mneia log --chain <id>` renders a decision's full supersede history oldest first, with the
  rationale, provenance and confidence at each step. When two humans disagree, no revision is marked
  `in force` — §10.4 leaves that to the actors involved. A step where a human-confirmed revision is
  replaced by one that is not is flagged inline, per §10.1.

  `mneia status` now names the asserter on every stale, disputed and unanswered line, and carries
  `assertedBy` in `--json`.

  The rehydration slice previously rendered whether an item was confirmed but not who asserted it, so
  an agent-asserted item and a human-asserted one were byte-identical. Both renderers now emit actor
  kind and display name, read from the `actor` table rather than any payload, and strip the delimiters
  from display names so a name can no longer forge a second provenance group that reads as
  human-confirmed.

  Scoring gains a per-kind `decay_after` default, so freshness applies to items that never set one. A
  constraint defaults to never decaying, keeping load-bearing constraints in every slice regardless of
  age.

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
