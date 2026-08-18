# @mneia/cli

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
