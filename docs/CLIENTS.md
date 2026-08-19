# Client compatibility matrix

§3 Corollary B: *"If it only works inside Claude Code, it is not a handoff, it is a session feature."*
This file is the evidence behind that claim. MNE-79 exists because a README saying "works with any
MCP client" that has only ever been run in one is the single-vendor product we are trying not to be.

**Every row says how it was checked.** Where something was not run, it says so rather than implying it.

Last verified **2026-08-19** against `@mneia/mcp-server` **0.5.0**, protocol `2025-06-18`.

**Verified against the published registry tarball**, installed into an empty directory with plain
`npm install @mneia/mcp-server@0.5.0` — not the workspace build, and not a locally packed tarball.
That is the strongest available check because it is byte-for-byte what `npx -y @mneia/mcp-server`
serves a stranger. The plain `npm install` succeeded, which confirms the published dependency block
carries `"@mneia/core": "^0.5.0"` and not `workspace:^`.

**If you are re-checking before a release**, when there is no published version to install yet, use a
`pnpm pack` tarball. `npm pack` leaves `workspace:^` in the dependency block and the install fails
outright with `EUNSUPPORTEDPROTOCOL`; `pnpm pack` rewrites it. `release.yml` uses `pnpm pack`.

## 🔴 The documented config exceeds Claude Code's startup timeout on a cold cache

**This is a first-run install failure in the flagship client, and it is new in this check.**

`claude mcp add --scope user mneia-published -- npx -y @mneia/mcp-server`, followed immediately by
`claude mcp get`, reported:

```
Status: ✘ Failed to connect
Issue: MCP server "mneia-published" connection timed out after 30000ms
```

The identical command reported `✔ Connected` on the next attempt. The difference is the npx cache.
Measured on this machine, time from spawn to the first `initialize` result:

| Launch | Time to first response |
|---|---|
| `node .../@mneia/mcp-server/dist/bin.js`, already installed | **4.6s** |
| `npx -y @mneia/mcp-server`, warm npx cache | **10.1s** |
| `npx -y @mneia/mcp-server`, cold npx cache | **>30s — Claude Code gives up** |

Two separate causes, and both are ours:

- **npx adds ~5.5s even warm**, and on a cold cache it must resolve and download 110 packages first.
- **The server itself takes 4.6s before it answers anything**, because it resolves the store during
  startup — the banner it prints already names the workspace and the actor, so it has made a network
  round trip to `app.mneia.dev` before serving its first frame.

So a new user pasting the documented JSON block gets a server their client reports as failed, and it
only works when they retry. Cursor and Codex did not hit this, because neither health-checks with a
30s ceiling — which means **Claude Code is the client where our own install instructions fail first.**

Until that is fixed, the honest install instruction for Claude Code is a global install, which skips
the npx resolve entirely:

```
npm install -g @mneia/mcp-server
claude mcp add --scope user mneia -- mneia-mcp
```

**Not yet ticketed** — Linear is at its free issue limit. This belongs on MNE-79, and the fix is
either to cut the startup round trip or to publish the global-install form as the default.

## What the server offers, verified by a real stdio session

Driven by writing JSON-RPC frames to the server's stdin and reading its stdout — no client involved,
so this half is client-independent:

| Probe | Result |
|---|---|
| `initialize` | `protocolVersion: 2025-06-18`, `serverInfo: {name: "mneia", version: "0.5.0"}` |
| Advertised capabilities | `{"tools":{}}` — tools only |
| `instructions` on `initialize` | **Now returned** — a ~1,100 character usage brief. New since 0.1.1 |
| `tools/list` | `mneia_rehydrate`, `mneia_assert`, `mneia_checkpoint`, `mneia_search` — still four |
| `title` on each tool | **Now present** — e.g. `"Rehydrate project context"`. New since 0.1.1 |
| `tools/call` → `mneia_rehydrate` | Returned a rendered slice plus `structuredContent` carrying `sliceId`, `projectId`, `itemIds`, `mandatoryItemIds`, `droppedItemIds`, `tokenBudget`, `tokensUsed` |
| `tools/call` → `mneia_search` | Returned `structuredContent` carrying `status`, `projectId`, `matchCount`, `limit`, `limitReached`, `items` |
| `project` argument omitted | Resolved anyway, from `.mneia/config.json` in the cwd |
| `resources/list`, `prompts/list` | `-32601` method not found — correct, they are not advertised |
| `outputSchema` on tools | **Still not published.** Structured output arrives as `structuredContent` without a declared schema |

### The four tools are four on purpose

`dist/registry.js` also contains `mneia_handoff_create`, `mneia_handoff_receive`, and
`mneia_conflicts`. **They are not advertised, and that is deliberate** — they sit in a
`DEFERRED_TOOL_MILESTONES` map tagged `M2`, `M2`, and `M4`. A live `tools/list` returns four.

Grepping the bundle for tool names suggests seven and is wrong. Drive a session.

### The token budget is a soft target under a hard floor

Worth knowing before you integrate. `tokenBudget: 500` — the schema minimum — returned:

```
tokenBudget 500   tokensUsed 1321
itemIds 33        mandatoryItemIds 33        droppedItemIds 35
```

Every item returned was mandatory and every optional item was dropped. That is **standing rule 2
working exactly as written** — load-bearing active constraints appear regardless of budget pressure,
because a dropped constraint is how an agent redoes the approach a human already rejected. A client
must not assume `tokensUsed <= tokenBudget`; the floor is whatever the project's load-bearing set
costs.

## Per client

| Client | Config format | Registers | Tools discovered | Tool call driven | Verified how |
|---|---|---|---|---|---|
| **Claude Code** | JSON, `mcpServers` key | **Yes** — `✔ Connected`, but see the cold-cache failure above | Yes | **Yes** | `claude mcp add --scope user` against `npx -y @mneia/mcp-server`, then `claude mcp get` health check. Tool calls driven over stdio against the same published bin, returning a real slice from the hosted store |
| **Cursor** 2026.01.28 (`cursor-agent`) | JSON, `mcpServers` key | **Yes** — `mneia: ready` | **Yes — all four, with argument names** | **Not run** | Registered by adding the documented JSON block verbatim to `~/.cursor/mcp.json`, then `cursor-agent mcp enable mneia` and `cursor-agent mcp list-tools mneia`. Driving an agent turn needs model access this account does not have: `cursor-agent --list-models` reports *"No models available for this account"* |
| **Codex CLI** 0.147.0 | **TOML**, `[mcp_servers.<name>]` | **Yes** — `enabled: true`, `transport: stdio` | Not run — Codex exposes no tool-listing command | **Not run** | `codex mcp add` accepted it and `codex mcp get` reports it enabled. `codex exec` reached the model and stopped: *"You've hit your usage limit … try again at Aug 23rd, 2026"* |

**The documented JSON block worked verbatim in Cursor on Windows** — plain `npx`, no `cmd /c`
wrapper. That was worth checking; several other servers in the same config file need the wrapper.

### Two client-side differences that matter

- **Codex uses TOML, not JSON.** A copy-pasted JSON block silently does nothing there. This is the
  most likely setup failure and it is why the install instructions are written per client rather than
  once.
- **Codex reports `Auth: Unsupported`.** That is correct, not a defect: the server authenticates with
  `MNEIA_TOKEN` or `~/.mneia/`, not MCP OAuth. Nothing is broken by it.

## Configuration

Both a hosted and a direct-Postgres binding exist. Hosted is the normal one.

**Claude Code and Cursor** — JSON:

```json
{
  "mcpServers": {
    "mneia": {
      "command": "npx",
      "args": ["-y", "@mneia/mcp-server"],
      "env": { "MNEIA_TOKEN": "<token from mneia login>" }
    }
  }
}
```

⚠️ In Claude Code, prefer the global install shown above until the cold-start timeout is fixed.

`MNEIA_TOKEN` is optional when `mneia login` has already written `~/.mneia/credentials` — **that is
the path both the Cursor and Claude Code checks above actually exercised**, with no `env` block at
all, and it is the one a user who ran `mneia login` will hit.

**Codex CLI** — TOML in `~/.codex/config.toml`, or let the CLI write it:

```
codex mcp add mneia --env MNEIA_TOKEN=<token> -- npx -y @mneia/mcp-server
```

which produces:

```toml
[mcp_servers.mneia]
command = "npx"
args = ["-y", "@mneia/mcp-server"]
env = { MNEIA_TOKEN = "<token>" }
```

## How the server finds a store, in order

Re-checked at 0.5.0 by redirecting `MNEIA_HOME` at an empty directory:

1. `MNEIA_TOKEN` in the server's env → the hosted API at `MNEIA_API_URL`, default `https://app.mneia.dev`
2. `~/.mneia/credentials` → written by `mneia login`
3. `~/.mneia/local.json` → `databaseUrl`, `workspaceId`, `agentActorId`, binding straight to Postgres

With none of the three it **refuses to start** and names all three paths it looked at, verbatim:

```
mneia-mcp cannot start: this server has no store to talk to: MNEIA_TOKEN is unset,
<home>\credentials does not exist, and <home>\local.json does not exist either. Write
<home>\local.json with databaseUrl, workspaceId and agentActorId to run against a Postgres
store directly, or set MNEIA_TOKEN in the MCP client's server config to use the hosted API.
```

An empty `MNEIA_TOKEN` gets its own message rather than falling through to that one, which is the
better error of the two:

```
mneia-mcp cannot start: MNEIA_TOKEN is set but empty, so this server has no way to authenticate.
```

Both name what was expected, what was received, and what to do. Note that the server exits rather
than starting and failing per call, so a client reports it as failed rather than showing a message.

**`MNEIA_HOME` relocates the config directory**, which defaults to `os.homedir() + /.mneia`. It must
be absolute, and the CLI and the MCP server honour it together — `mneia login` writes the credential
the server reads, so moving one without the other would leave a working login the server cannot find.
That is how you run two configurations side by side, or run in CI, without overriding `USERPROFILE`
or `HOME` for the whole process (MNE-260, 2026-08-08). `MNEIA_CREDENTIALS_PATH` and
`MNEIA_LOCAL_CONFIG` still win over it where they name a single file. **Re-confirmed at 0.5.0** —
both refusal messages above name the redirected directory, not the real home.

## The RLS guard fires on the local path too

Pointing `local.json` at a superuser role — `postgres` on a local container is the obvious mistake —
is refused, not silently trusted:

```
expected DATABASE_URL to name a role that Postgres row-level security applies to;
found "postgres", which bypasses it
```

That is MNE-186 working outside the deployed app. Provision the non-bypass role with
`pnpm db:provision-app-role --apply` and use the connection string it prints. The tool call fails with
a store error rather than returning another workspace's rows, which is the outcome §11.3 asks for.

**Carried over from the 2026-08-08 check and not re-run at 0.5.0** — it needs a local Postgres, and
this machine has no `DATABASE_URL` set.

## Not verified, and what it would take

- **A tool call inside Cursor.** The server is registered, loaded, and all four tools are discovered
  through Cursor's own MCP client — but this Cursor account has no model access, so no agent turn can
  be taken. Needs a Cursor plan with an available model.
- **A tool call inside Codex.** Registered and enabled. Blocked on OpenAI usage credits, which reset
  **2026-08-23**. This is the one blocker with a known expiry date — recheck then.
- **The RLS guard at 0.5.0.** Needs a local Postgres and a `DATABASE_URL`.
- **Claude Desktop.** A trajectory reader exists (`packages/core/src/trajectory/claude-desktop.ts`)
  but the MCP surface was not exercised there at all.

### What this means for MNE-79 and MNE-106

**MNE-79's clause is not yet met.** It asks for *"verified behaviour in all three clients"*, and two
of the three have registration and discovery verified but no tool call driven. Both blockers are
account limits on this machine, not defects in the server — and Codex's clears on 2026-08-23.

This matters beyond the ticket: **MNE-106 depends on it.** Submitting to an MCP registry while the
matrix says a tool call was never driven outside Claude Code is submitting the single-vendor product
§3 Corollary B says we are not. The Cursor result moves that materially — Cursor's MCP client loads
our server and enumerates every tool — but it is discovery, not use.
