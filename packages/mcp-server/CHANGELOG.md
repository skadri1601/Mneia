# @mneia/mcp-server

## 0.21.1

### Patch Changes

- e985c43: The orphaned-server exit no longer waits on I/O that cannot complete.

  0.21.0 added an exit path for orphaned servers and it did not work. Thirteen servers running it were
  found spinning four minutes after a reboot, 2,928 CPU-seconds between them. A CPU profile of a live
  one showed why: the exit path had run — `record` from lifecycle.ts was 15% of the burn — but
  `shutdown()` never resolved, because draining flushes telemetry and closes a store over the very
  transport that just died. The exit was gated behind I/O that could not complete, so it never happened,
  while the fault loop underneath kept running at full speed.

  Three changes, all the same principle. The drain now gets a bounded window and the process leaves
  regardless. The fault path does nothing at all once the process is already ending, because every line
  it logged was a write inside the loop it was escaping. And a fault arriving while stdin is already
  destroyed exits immediately rather than waiting twenty more faults to prove there is nobody to serve.

  - @mneia/core@0.21.1

## 0.21.0

### Minor Changes

- e22f402: The MCP server now exits when its client is gone, instead of pegging a CPU core forever.

  Four orphaned servers were found on one laptop burning 33.9 CPU-hours between them, each holding a
  core at 100% for hours. The only symptom anyone noticed was the fan.

  Two decisions combined into it. `uncaughtException` logged "session continues" and returned, so a
  read that fails permanently was retried as fast as the event loop allowed; and the transport close
  path drained without ever exiting, so nothing ended the process. Neither is wrong alone.

  `npx` is what turns that into an orphan. On Windows it inserts `node npx-cli.js` and `cmd.exe`
  between the client and the server, and those intermediates keep the stdin handle open after the
  client dies — so the clean end-of-stream that would have exited the server never arrives.

  Now four routes end a session and all of them exit: a signal, stdin ending, stdin erroring, and
  faults arriving faster than a working server ever produces them. That last one is a budget rather
  than a switch, so an isolated bad tool call still leaves the server serving.

### Patch Changes

- @mneia/core@0.21.0

## 0.20.0

### Patch Changes

- @mneia/core@0.20.0

## 0.19.0

### Minor Changes

- d917e17: Checkpoint sub-agent sessions, and link them to the session that spawned them.

  The Claude Code reader now descends into `subagents/` directories, which a flat `readdir` never
  saw — 28% of transcripts on the machine this was measured against. A sub-agent session takes its
  ref from its filename rather than from the parent's `sessionId` recorded inside it, so parent and
  child stay distinct, and it reports the parent's ref as `parentSessionRef`.

  `session.parent_session_id` records that link. Callers name the parent by its client session ref
  (`parentClientSessionRef` on session creation, `sourceSession.parentRef` on an MCP write) and the
  store resolves it within the workspace.

  `mneia checkpoint` gives sub-agents their own budget rather than letting them compete with root
  sessions for `MAX_CHECKPOINT_SESSIONS` — they share their parent's working directory, so one busy
  fan-out could previously take every slot and leave the other sessions of the day uncovered.

  Discovery applies its own limit to roots and sub-agents separately, so a directory whose fifty
  newest transcripts are all sub-agents still yields root sessions to checkpoint, and `mneia
checkpoint` opens a `session` row for every transcript it commits — naming the parent by ref — so
  parentage reaches the store on the CLI path and not only through the MCP tools.

- e726d7b: Add `mneia_review_confirm`, so an agent can relay a human decision on a queued item through the
  approval UI its client already has — Claude Code's ask, Cursor's inline approval, or a plain
  question — instead of leaving the queue drainable only from a terminal. It records one decision at
  a time: `approve` marks the item human-confirmed, `reject` retires it with the reason the person
  gave. The reviewing actor is read from the token and its kind from the database, never from the
  arguments, so a server authenticated as an agent is refused (vision.md §10.1). `mneia review
--drain` is unchanged.

  The decision emits its §17 arbitration event — `checkpoint.item_confirmed` or
  `checkpoint.item_rejected` — from the tool itself, so a confirmation relayed through the hosted
  `/api/mcp` endpoint, which serves a direct scoped store rather than the REST wrapper that emits,
  is recorded rather than lost. A transport failure now reports the outcome as unknown and points
  the caller back at `mneia_review_queue`, instead of claiming nothing was written when the review
  may already have committed.

### Patch Changes

- Updated dependencies [d917e17]
  - @mneia/core@0.19.0

## 0.18.0

### Patch Changes

- @mneia/core@0.18.0

## 0.17.0

### Minor Changes

- 6308bb3: Show what a workspace has spent, on every surface — including the one an agent can see.

  One percentage, `max(turns used / turn allowance, extractions used / extraction allowance)`, so
  the number tracks whichever dial is closest to binding. The embedding dial is recorded so cost
  stays computable and is never shown: a customer cannot act on it, and letting it move the
  headline number would show a bar shifting for a reason nobody can explain.

  `mneia status` renders the line, and `--json` carries the raw dials, the percentage, and which
  dial is binding — so a script never has to re-derive it. It warns at 80% in words rather than
  colour alone, and an older server that has no meter yet simply prints nothing rather than an
  error.

  The meter also rides on `mneia_checkpoint`, `mneia_assert` and `mneia_rehydrate` in
  `structuredContent`, because a number only the terminal can see is invisible to the agent doing
  the spending. No new tool name, so the registry stays as it was. Reading it can never fail a
  write that already succeeded — an unreachable meter reports nothing rather than turning a
  recorded checkpoint into a reported failure. Rehydrate races the read against slice assembly
  rather than waiting on it, so the §12.1 budget is untouched, and its rendered markdown is
  byte-identical with the meter present or absent.

  `UsageWireSchema` in `@mneia/core` is the shape that crosses the wire. It has no embedding
  field at all, so the dial that must not be displayed cannot be received in the first place.

### Patch Changes

- Updated dependencies [6308bb3]
  - @mneia/core@0.17.0

## 0.16.0

### Minor Changes

- d0a3c74: Add cross-client MCP install, list, and uninstall commands, with agent-ready setup documentation for Codex, Claude, Cursor, Gemini CLI, VS Code, Windsurf, and other MCP clients.

### Patch Changes

- Updated dependencies [d0a3c74]
  - @mneia/core@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [5b68324]
  - @mneia/core@0.15.0

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

- Updated dependencies [8ef2b35]
  - @mneia/core@0.14.1

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

### Patch Changes

- Updated dependencies [9823152]
  - @mneia/core@0.14.0

## 0.13.0

### Minor Changes

- 03d360a: Cut what a checkpoint costs to run, without changing what it does.

  The extraction prompt now lists existing items by title alone. Their ids were never read
  back — no candidate field names an existing item and the system prompt tells the model not
  to judge replacement — so a rendered UUID cost about 20 tokens each and bought nothing. At
  the 200-item limit the prefix drops from roughly 7,400 tokens to 3,600.

  `ExtractionProviderRequest` gains an optional `cacheKey`, so a caller can group provider
  prompt-cache lookups. Optional, so existing implementers are unaffected.

### Patch Changes

- Updated dependencies [03d360a]
  - @mneia/core@0.13.0

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

### Patch Changes

- Updated dependencies [cb8705c]
- Updated dependencies [cb8705c]
  - @mneia/core@0.12.0

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

### Patch Changes

- Updated dependencies [f047d41]
- Updated dependencies [e82bd37]
  - @mneia/core@0.11.0

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
