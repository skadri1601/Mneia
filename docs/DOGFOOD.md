# MNE-86 — the seven-day dogfood

**Done when:** seven consecutive working days logged with the tool enabled throughout, rehydrating at
every session start and checkpointing at every task boundary — **or** the failure recorded honestly
with the reason it got turned off. Both halves satisfy the clause. §6 of this file is where the second
one gets written, and it is not a lesser outcome.

The founder approved a **setup phase** on 2026-08-16 (recorded as a comment on MNE-86 — Linear is at
its free issue limit and refuses new issues). **The seven-day clock starts only once this is merged
and activated**, not when it was written.

---

## 1. What was built

Two things, and they are deliberately different in kind:

| | Where | Mechanism |
|---|---|---|
| **Deterministic** | Claude Code | Hooks. The client runs them; the model cannot forget. |
| **Instructed** | Claude Desktop, Codex, Cursor, Gemini CLI | The MCP server's `instructions` field, shown to the model at connect time. |

Only Claude Code exposes session and completion hooks today. Everywhere else the strongest available
lever is the connect-time instruction, which is already carried by `SERVER_INSTRUCTIONS` in
`packages/mcp-server/src/server.ts` and is deliberately vendor-neutral (§3 Corollary B — *"if it only
works inside Claude Code, it is not a handoff, it is a session feature"*).

**So the five clients are not equally instrumented, and the log below must not pretend they are.**
Record which client each day was worked in.

---

## 2. Activation — do this once, in order

### 2.1 Sign this machine in

Build the repo's own client first, then sign in **with it**:

```
pnpm -r build
node packages/cli/dist/bin.js login
```

`login` runs a device flow and writes a token to `~/.mneia/credentials`. **That file is the only
credential, it is outside the repo, and it must stay there.** Nothing in this repository holds a token.

**Do not sign in with a globally installed `mneia`** unless you have checked its version. `npm view
@mneia/cli version` reports what the registry has; `mneia --version` reports what is on this machine.
On the founder's machine that was `0.1.0` — two releases behind the repo's `0.2.0` — which is exactly
the trap §4 describes. The credential file is shared between them, so signing in with either works;
running the dogfood through the old one does not.

### 2.2 Check the binding matches your workspace

`.mneia/config.json` is checked in — it is the non-secret project binding, and it carries a workspace
slug and a project slug and nothing else:

```json
{
  "workspace": "mneia",
  "project": "mneia"
}
```

The `workspace` value **must equal the workspace your token belongs to**, because `mneia init` refuses
a binding that names a different one (`packages/cli/src/http-api.ts:116`). Confirm it:

```
node packages/cli/dist/bin.js whoami --json
```

If the `workspace.slug` it prints is not `mneia`, fix the file — either by hand or by running:

```
node packages/cli/dist/bin.js init --force --project mneia
```

`init` creates the project if the slug does not exist yet, imports this repo's existing constraints
from `AGENTS.md` / `CLAUDE.md` / `.cursor/rules`, and rewrites `.mneia/config.json`. **Commit the
result if it changed.**

### 2.3 Confirm the binding is tracked and nothing else in `.mneia/` is

`.gitignore` was narrowed from `.mneia/` to `.mneia/*` plus a `!.mneia/config.json` negation, so the
binding is versioned and everything else the tooling writes there stays out of git:

```
git check-ignore -v .mneia/config.json    # matches the negation — tracked
git status --porcelain -uall | grep mneia # only .mneia/config.json ever appears
```

### 2.4 Configure the clients

Two are committed and need nothing from you. Three are user-scoped and cannot live in this repo —
see §3.

### 2.5 Start a session and confirm the instrument is on

See §4.

---

## 3. Per-client configuration

### Claude Code — committed, `.mcp.json`

Already in the repo root. Claude Code prompts once to approve a project-scoped MCP server; approve it.

```json
{
  "mcpServers": {
    "mneia": {
      "command": "node",
      "args": ["./packages/mcp-server/dist/bin.js"]
    }
  }
}
```

**This runs the local build, not `npx @mneia/mcp-server`, and that is load-bearing.** The published
`0.2.0` tarball contains no `dist/session-provenance.js` — it was cut before that work existed. The
local package is *also* version `0.2.0`, so npm has no way to tell the two apart and `npx` would
silently serve the older one. A dogfood run against it would leave all five `session.client_*`
columns NULL for seven days and nothing would warn. Run `pnpm -r build` before the first session, and
after any pull that touches `packages/`.

Once a release carrying session provenance is on the registry, these two committed configs can move
back to `npx -y @mneia/mcp-server@<version>` — pinned, not floating.

No `env` block, on purpose. The server resolves its credential in a documented order — `MNEIA_TOKEN`,
then `~/.mneia/credentials`, then `~/.mneia/local.json` (`docs/CLIENTS.md` §"How the server finds a
store"). `mneia login` supplies the second, so referencing a token here would be redundant and would
break the config outright if the variable were ever unset.

### Cursor — committed, `.cursor/mcp.json`

Same block, same reasoning, including the local-build point above. Cursor reads project-scoped MCP
config from `.cursor/mcp.json`.

> Cursor has **never been driven end to end** against this server — `docs/CLIENTS.md` says so
> explicitly. The config shape is documented, not observed. If day one in Cursor fails, that is the
> known gap, not a surprise.

### Claude Desktop — user-scoped, not committable

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Merge this into the existing `mcpServers` object, then restart Claude Desktop completely:

```json
{
  "mcpServers": {
    "mneia": {
      "command": "node",
      "args": ["C:\\Users\\kadri\\stealth-startup\\packages\\mcp-server\\dist\\bin.js"]
    }
  }
}
```

**Absolute path, for the same reason the committed configs use the local build** — see Claude Code
above. A user-scoped client launches outside the repo, so the relative path used there will not
resolve; substitute your own checkout path. `npx -y @mneia/mcp-server` would start a server with no
session provenance in it.

Claude Desktop does not pass your shell environment to the server, so if `~/.mneia/credentials` does
not exist you must add an `env` block referencing the variable rather than pasting a literal:

```json
"env": { "MNEIA_TOKEN": "${MNEIA_TOKEN}" }
```

Claude Desktop has a further constraint: it has **no repository cwd**, so it cannot read
`.mneia/config.json` and the project must be named in each tool call. Expect to say which project you
mean in Desktop and not in the others.

### Codex CLI — user-scoped, **TOML not JSON**

`%USERPROFILE%\.codex\config.toml` on Windows, `~/.codex/config.toml` elsewhere. Let the CLI write it:

```
codex mcp add mneia -- node C:\Users\kadri\stealth-startup\packages\mcp-server\dist\bin.js
```

which produces:

```toml
[mcp_servers.mneia]
command = "node"
args = ["C:\\Users\\kadri\\stealth-startup\\packages\\mcp-server\\dist\\bin.js"]
```

Absolute path, and your own checkout — `npx -y @mneia/mcp-server` has no session provenance in it.

**A copy-pasted JSON block silently does nothing here.** `docs/CLIENTS.md` names this as the single
most likely setup failure. Verify with `codex mcp get mneia` — it should report `enabled: true` and
`transport: stdio`. `Auth: Unsupported` is correct and not a defect: the server authenticates with
`MNEIA_TOKEN` or `~/.mneia/`, not MCP OAuth.

### Gemini CLI — user-scoped

`%USERPROFILE%\.gemini\settings.json` on Windows, `~/.gemini/settings.json` elsewhere. Merge into the
existing top-level object:

```json
{
  "mcpServers": {
    "mneia": {
      "command": "node",
      "args": ["C:\\Users\\kadri\\stealth-startup\\packages\\mcp-server\\dist\\bin.js"]
    }
  }
}
```

Absolute path, and your own checkout — same reason as the other user-scoped clients.

Confirm with `/mcp` inside the CLI; it should list `mneia` with four tools.

> Gemini CLI has never been driven against this server either. Add a row to `docs/CLIENTS.md` when it
> is, rather than leaving the claim in this file only.

---

## 4. The two hooks, and why they cannot double-fire

Registered in `.claude/settings.json`. Both are **code lane** (`CLAUDE.md` §Git lanes), which is why
this landed through a PR.

| Hook | Event | Script | Runs |
|---|---|---|---|
| Rehydrate | `SessionStart` | `.claude/hooks/mneia-rehydrate.mjs` | `brief "<task>" --json` |
| Checkpoint | `Stop` | `.claude/hooks/mneia-checkpoint.mjs` | `checkpoint --json --trigger task_boundary` |

Both shell out to the **CLI** rather than reimplementing the wire protocol. That is the point of a
dogfood: the instrument exercises the same client surface a customer installs.

### Which CLI, and why it is the repo's own build

`resolveCli` in `.claude/hooks/mneia-dogfood.mjs` picks one of three, in order, and records which it
picked in every `.mneia/dogfood/log.jsonl` line as `client` / `clientSource`:

| Order | `clientSource` | What runs |
|---|---|---|
| 1 | `env` | `MNEIA_DOGFOOD_CLI`, spawned as a single executable path |
| 2 | `repo` | `node <repo>/packages/cli/dist/bin.js` — the default whenever that file exists |
| 3 | `path` | `mneia` from `PATH` — only when there is no local build |

**Preferring the repo build is load-bearing, for the same reason `.mcp.json` runs
`node ./packages/mcp-server/dist/bin.js` instead of `npx -y @mneia/mcp-server`** (§3 above). It fell
out of the day-zero smoke test: `.claude/settings.json` sets no `env` block, so the old code fell
through to `mneia` on `PATH`, which on this machine resolved to a globally installed **`0.1.0`** while
the repo was on `0.2.0`. Seven days of rehydrates and checkpoints would have run through a client
predating both the MNE-257 client fixes and session provenance, and nothing would have said so.

So the hooks do not depend on a global install at all, and they do not need an `env` block in
`.claude/settings.json`. Run `pnpm -r build` before the first session, and after any pull that touches
`packages/` — the same instruction the MCP config already carries. With no local build the hooks fall
back to `PATH`, and if that is missing too they fail open and name the fix.

`MNEIA_DOGFOOD_CLI` remains the escape hatch and is still spawned as **one executable path**, not a
command line: `"node C:/path/to/bin.js"` is not a valid value. Point it at a real executable — an npm
`.cmd` shim or a binary — or leave it unset and let order 2 do the work.

### Session start

Resets this session's state marker, derives a task string from the current git branch, calls
`mneia brief`, and injects the returned slice — plus its `sliceId` — into the session as
`additionalContext`. The model therefore starts every session holding the active constraints without
anyone remembering to ask.

### Completion, exactly once

`Stop` fires every time the main agent finishes responding, so an unguarded hook would checkpoint per
turn and could re-trigger itself. Four guards, in this order, and each one is a plain early return in
`.claude/hooks/mneia-checkpoint.mjs`:

1. **`stop_hook_active === true` → exit.** Claude Code sets this when the agent is already continuing
   because of a `Stop` hook. This is the recursion guard, and it is why the hook cannot loop.
2. **No state marker for this session → exit.** The marker is written only by the session-start hook,
   so a session that never rehydrated never checkpoints.
3. **Fewer than `MNEIA_DOGFOOD_MIN_TURNS` new transcript entries since the last checkpoint → exit.**
   Default 6. This is what stops one-checkpoint-per-turn: repeated `Stop`s with no new work are free.
4. **Lock claimed atomically or exit.** `writeFileSync(..., { flag: 'wx' })` — a second concurrent
   `Stop` loses the race and returns immediately. Released in a `finally`, and a lock older than ten
   minutes is treated as stale and taken over exactly once, so a killed process cannot wedge the
   session permanently.

After an attempt the marker advances **whether or not the checkpoint succeeded**. Nothing is lost by
that: `mneia checkpoint` resumes from the *server-side* watermark, not from this local marker, so the
next successful checkpoint still covers everything since the last committed one. The marker is a
debounce, never a record of what was captured — which is the founder's ruling that missing provenance
must not discard memory.

`mneia checkpoint --json` exits **1 when items are pending human review**. That is a normal outcome,
not a failure, and the hook treats any parseable receipt as success.

### They fail open, always

Neither hook can block work. Every failure path — Mneia unreachable, CLI not installed, token
expired, timeout — writes a line to `.mneia/dogfood/log.jsonl`, prints one line to stderr, and
**exits 0**. The session-start hook additionally injects a short note saying memory was *not* loaded,
so a silent instrument failure cannot be mistaken for an empty project.

Timeouts are enforced twice: inside each script via `spawnSync`'s `timeout` (12s for rehydrate, 45s
for checkpoint), and again by the `timeout` field in `.claude/settings.json` (25s and 60s) as a
backstop. §12.1 keeps `mneia_rehydrate` p95 under 300ms, but the hook does not rely on that holding.

### Knobs

| Variable | Default | Effect |
|---|---|---|
| `MNEIA_DOGFOOD=off` | unset | Kill switch. Both hooks exit immediately. **Use this rather than deleting the hooks — then say so in §6.** |
| `MNEIA_DOGFOOD_CLI` | the repo build | Absolute path to a CLI **executable** to use instead. One path, not a command line. |
| `MNEIA_DOGFOOD_TIMEOUT_MS` | 12000 / 45000 | Per-invocation timeout. |
| `MNEIA_DOGFOOD_MIN_TURNS` | 6 | New transcript entries required before a checkpoint. |

---

## 5. Verifying the instrument is on

```
curl -s https://app.mneia.dev/api/health        # rls: enforced, all three model keys configured
node packages/cli/dist/bin.js --version         # 0.2.0 — the repo build, not a stale global
node packages/cli/dist/bin.js whoami            # actor, workspace, team
node packages/cli/dist/bin.js status            # which project this repo is bound to
node packages/cli/dist/bin.js brief "verifying the dogfood instrument"
```

Or drive the hook itself, which is the only check that proves what the *hook* resolves rather than
what your shell does:

```
echo '{"session_id":"verify-001","cwd":"'"$PWD"'","source":"startup","hook_event_name":"SessionStart"}' \
  | node .claude/hooks/mneia-rehydrate.mjs
tail -1 .mneia/dogfood/log.jsonl    # "clientSource":"repo"
```

Then start a Claude Code session in this repo and check all three:

1. The session opens with a **"Mneia project memory (rehydrated at session start)"** block. If it
   says *"unavailable"*, the reason is in the block and in the log.
2. `/mcp` lists `mneia` with `mneia_rehydrate`, `mneia_assert`, `mneia_checkpoint`, `mneia_search`.
3. After a real task, `.mneia/dogfood/log.jsonl` has a `{"event":"checkpoint","outcome":"ok",...}`
   line.

That log file is the evidence behind the table in §6 — fill the table from it, not from memory.
`pnpm dogfood:report` reports extraction quality across the same period.

**When a hook reports a failure, check Sentry before guessing.** `apps/web` now initialises Sentry
(`apps/web/sentry.server.config.ts`, `apps/web/src/instrumentation.ts`) and `serve.ts` captures any
error that escapes an API route, tagged `mneia_route` / `mneia_method` / `mneia_error_class`. Before
that, a route could return a bare 500 with an empty body and leave no trace anywhere — which is how
the day-zero `/api/v1/rehydrate` 500 went unreported. Reporting needs `SENTRY_DSN` set on the droplet;
without it the SDK is inert and nothing crashes.

---

## 6. The seven-day log

Seven consecutive **working** days. Fill one row at the end of each day, from
`.mneia/dogfood/log.jsonl` rather than from recollection. A day with the tool off is still a logged
day — write down why.

**Planned window: Mon 2026-08-17 → Tue 2026-08-25** (weekend of 22–23 August excluded). Correct these
dates if activation slips; do not silently shift them.

| # | Date | Clients used | Rehydrates | Checkpoints | Items written | Pending review | Turned off? | What it got right, what it got wrong |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-08-17 | | | | | | | |
| 2 | 2026-08-18 | | | | | | | |
| 3 | 2026-08-19 | | | | | | | |
| 4 | 2026-08-20 | | | | | | | |
| 5 | 2026-08-21 | | | | | | | |
| 6 | 2026-08-24 | | | | | | | |
| 7 | 2026-08-25 | | | | | | | |

### Recording the failure honestly

**MNE-86 closes either way.** Seven clean days closes it; so does an honest record of why the
instrument got turned off. What does *not* close it is a table quietly filled in for days the tool was
not actually running, and the temptation to do that is the single biggest risk to this ticket — a
dogfood that reports success it did not have is worse than no dogfood, because every downstream
decision then rests on it.

If it gets turned off, stop filling the table and write this instead:

```markdown
## Outcome: turned off on <date>, after <n> days

**What was turned off:** <the Stop hook / the whole instrument / one client>
**How:** <MNEIA_DOGFOOD=off / removed from settings.json / uninstalled>

**Why, in one sentence:** <the real reason, not the charitable one>

**The specific moment:** <what you were doing, what it did, what it cost you>

**Was it the product or the harness?** <a slow checkpoint is the product; a broken .cmd shim is not>

**What would have to be true to turn it back on:** <the concrete change>

**Tickets filed:** <MNE-nnn, or "none — Linear is at its free issue limit, written up in a comment on MNE-86">
```

Then say plainly in the ticket comment that the clause was satisfied by the second branch, and move
on. Do not re-run the seven days to get a nicer answer without changing something first.

---

## 7. Known gaps, recorded before day one

- **Cursor and Gemini CLI have never been driven against this server.** Config shapes are documented,
  not observed. `docs/CLIENTS.md` is the file to update when they are.
- **Claude Desktop has no repository cwd**, so it cannot read `.mneia/config.json`. Tool calls there
  must name the project.
- **Only Claude Code is deterministic.** The other four rely on the model honouring the MCP
  instructions. If the log shows checkpoints only ever happening in Claude Code, that is the finding,
  and it is a real one about the product rather than about the founder's discipline.
- **A worktree now inherits `.mneia/config.json`** because it is tracked. `docs/WORKSTREAMS.md` §0
  previously said a worktree shares no `.mneia/` with the others; the binding is now the exception,
  while the credential and the dogfood state remain per-machine and per-worktree.
