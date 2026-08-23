# @mneia/cli

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

### Minor Changes

- a1d0d6b: Read a handoff without receiving it: `mneia pickup <id> --read`.

  Until now the only way to see a handoff body from the terminal was `mneia pickup <id>`, which
  consumes it — stamps `received_at`, emits `handoff.received`, and drops it off everyone else's
  inbox. So the ordinary case, deciding whether a piece of work is yours before claiming it, could
  only be done by claiming it first.

  `--read` renders the same artifact and changes nothing. It ends with the command that does claim it,
  so the two acts stay distinct rather than one being a side effect of looking.

### Patch Changes

- a1d0d6b: Fix a circular import that stopped the CLI from starting at all.

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

- 5af42be: Handoff artifacts are now ranked and packed under a token budget instead of rendering every item the
  project holds, and the header reports what was left out. Active load-bearing constraints still appear
  regardless of budget pressure, and the `Superseded recently` block is bounded on its own.

  `mneia init` no longer marks a constraint scraped from `AGENTS.md`, `CLAUDE.md` or `.cursor/rules` as
  load-bearing — reading a bullet out of a file does not make it binding — and no longer imports
  term-definition rows such as `**Rehydrate** — assemble the context slice` as constraints at all.

- Updated dependencies [5af42be]
  - @mneia/core@0.6.1

## 0.6.0

### Minor Changes

- 8835fd8: `mneia handoff` freezes a receivable artifact and `mneia pickup` receives one, or lists the open handoffs when given no id. Both were refused with "ships in M2" until now.

### Patch Changes

- cab2ea6: `mneia init` now detects hand edits inside the generated section instead of silently overwriting them. The begin marker carries a digest of the body Mneia wrote — `<!-- mneia:begin sha=… -->` — and a mismatch stops the run before anything is written, naming what to move out of the fence or offering `--force`. Sections written by earlier versions carry no digest and are accepted unchanged, then stamped on the next write.
- Updated dependencies [8835fd8]
- Updated dependencies [1b90804]
- Updated dependencies [974d555]
- Updated dependencies [23760fe]
  - @mneia/core@0.6.0

## 0.5.0

### Minor Changes

- 1532514: Rebuild the interactive session's input surface.

  Typing `/` now opens a menu of every command and each further character narrows it, so the commands
  are discoverable without running `/help` first. The arrow keys move the selection, Tab or the right
  arrow accepts it, and Escape dismisses the menu. The rest of the selected name is shown as ghost
  text after the cursor, which is what makes Tab discoverable in the first place. Enter runs the
  selected command outright, or leaves the cursor after it when the command still needs an argument.

  History now survives the process. It is appended to `~/.mneia/history` — honouring `MNEIA_HOME` —
  and loaded at startup, so the up arrow reaches what was typed in a previous session.

  The line editor also gained the emacs bindings the old `readline` prompt had no route to: Ctrl+A,
  Ctrl+E, Ctrl+U, Ctrl+K, Ctrl+W, and Ctrl+L to clear the screen without losing the typed line.

  The banner's block-glyph mark now renders as the M it was always meant to be, built from full and
  half blocks only so it cannot drift between fonts, and the plain-words hint line is gone.

### Patch Changes

- @mneia/core@0.5.0

## 0.4.0

### Minor Changes

- 295a025: MNE-12: give the interactive session a proper masthead.

  The session opened with three unstyled lines. It now leads with a logo beside
  the facts that matter — version, who you are, where you are, which project —
  and drops the redundant "signed in as" line. A workspace whose name is just
  your own name is no longer printed twice.

  Colour is brand accent `#2997ff` on the logo and prompt, bold on the name, dim
  on everything else. It respects `NO_COLOR` and `TERM=dumb`, and is off whenever
  stdout is not a terminal. Per the CLI rule, meaning is never carried by colour
  alone: a test strips every escape sequence and asserts the result is identical
  to the unpainted banner.

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

- d3876cc: MNE-12: `mneia` with no arguments opens an interactive session instead of exiting.

  Bare `mneia` printed the command list to stderr and exited `2` — correct for a script, wrong for a
  person. On a TTY it now opens a persistent session: a prompt that dispatches `/init`, `/brief`,
  `/checkpoint`, `/log`, `/status`, `/login` and `/whoami` with their usual flags, completes slash
  commands on Tab, keeps a history, and treats anything not starting with `/` as a task to rehydrate.
  An absent or expired token runs the existing device flow inline rather than sending the user away
  to another command.

  Off a TTY — piped, redirected, or in CI — bare `mneia` is unchanged: command list to stderr, exit
  `2`. One-shot `mneia <command>` is unchanged in every context.

  The session is a shell over the existing commands. It reimplements none of them, adds no dependency,
  and never reaches the API itself; every line goes through the same router as the one-shot form, so
  the two cannot drift.

### Patch Changes

- bfd46bf: `mneia checkpoint` no longer discards turns from a large session before uploading it. Previously the
  client reduced the transcript to 700,000 characters and sent only what survived; because the server
  sets its watermark from what it received, the discarded turns were marked as covered and running the
  command again did not pick them up.

  A session too large for one request is now uploaded across successive runs instead. The turns that do
  not fit are reported as pending — the state that already means "run again, nothing was skipped" —
  rather than dropped. Per-turn truncation of large tool output and secret redaction are unchanged.

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

### Minor Changes

- 9af6ccd: MNE-271: `mneia init` can create a project, so the CLI loop can be entered at all.

  `init` was bound to a stub that always rejected, and there was no project-creation path
  anywhere — `/api/v1/projects` was `GET` only and `createProject` returned `501`. A new
  `POST /api/v1/projects` creates or attaches idempotently on the workspace slug, the workspace
  is resolved from the bearer token rather than the payload, and the CLI is wired to it.

  Also fixes rehydration ranking: the hosted rehydrate route imported an embedding provider and
  never passed it, so the semantic weight scored every item identically and the task string
  affected nothing about which items came back (MNE-272).

### Patch Changes

- 76a23a9: MNE-271: `forbidden` joins the API error vocabulary, and the CLI names the fix.

  `POST /api/v1/projects` refuses a member creating a project that does not exist yet, so the wire
  needed a code for it. `403` previously decoded as `invalid_token`, which would have told a
  customer their credentials were bad when the real answer is that only a workspace lead can create
  a project. The CLI surfaces the server's message and tells them to ask a lead.

- 76a23a9: MNE-260: `MNEIA_HOME` moves the credentials and the local binding off `~/.mneia`.

  The CLI resolved the credentials file and the local binding straight from the operating system
  home directory, and the commands never passed their own environment into that resolution — so
  `mneia status` on a machine that had ever run the bootstrap script behaved differently from one
  that had not, and the test suite mutated a real user directory. Both surfaces now read
  `MNEIA_HOME`, so a login and the MCP server that consumes it stay pointed at the same place.

- Updated dependencies [9af6ccd]
- Updated dependencies [76a23a9]
  - @mneia/core@0.2.0
