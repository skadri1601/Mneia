# Client compatibility matrix

§3 Corollary B: *"If it only works inside Claude Code, it is not a handoff, it is a session feature."*
This file is the evidence behind that claim. MNE-79 exists because a README saying "works with any
MCP client" that has only ever been run in one is the single-vendor product we are trying not to be.

**Every row says how it was checked.** Where something was not run, it says so rather than implying it.

Last verified **2026-08-22** against `@mneia/mcp-server` **0.12.0**, both the workspace build and the
published registry package.

## Re-run it instead of retyping it

**This file went three releases stale because the previous check was a hand-driven JSON-RPC session.**
It was pinned at 0.5.0 and four tools while the registry moved to 0.12.0 and eleven. Nothing was
wrong with the checking — it just could not be repeated cheaply, so it was not.

```
pnpm verify:mcp                              # workspace build, baseline handshake
pnpm verify:mcp -- --as claude-code          # replay a captured client handshake
pnpm verify:mcp -- --as codex
pnpm verify:mcp -- --as cursor
pnpm verify:mcp -- --published --version 0.12.0
pnpm verify:mcp -- --url https://app.mneia.dev/api/mcp   # the remote transport
pnpm verify:mcp -- --protocol 2024-11-05     # pin the negotiation
pnpm verify:mcp -- --json                    # machine-readable report
```

`scripts/mcp-conformance.mjs` speaks real JSON-RPC to the server the way a client does — over stdio
to a local binary, or over Streamable HTTP with `--url` — and
reports what a client would see: the negotiated protocol, the declared capabilities, the tools
actually discoverable, and the error returned for the methods we do not implement. Run it before
citing anything below.

### Client profiles are captured, not guessed

The `--as` profiles are real handshakes recorded from real clients, checked in under
`docs/handshakes/`. The same script captures them:

```
node scripts/mcp-conformance.mjs --record docs/handshakes/<client>.jsonl
```

Point a client's MCP config at that instead of the server, start the client, and its own
`initialize` frame is written verbatim. **This works even when the client cannot reach its model** —
which is how the Codex profile below was captured through an active usage limit, and it is the way
to close the Cursor row without guessing at what Cursor sends.

Writing a profile by hand is how the previous matrix got the Claude Code protocol version wrong.
Capture it.

## What the three clients actually send

| | **Claude Code** 2.1.239 | **Codex CLI** 0.149.0 | **Cursor Agent** 2026.08.11 |
|---|---|---|---|
| `protocolVersion` requested | `2025-11-25` | `2025-06-18` | `2025-11-25` |
| `roots` | `{listChanged: true}` | — | — |
| `elicitation` | `{}` | `{form: {}, url: {}}` | `{form: {}}` |
| `clientInfo` | `name`, `title`, `version`, `description`, `websiteUrl` | `name`, `title`, `version` | `name`, `version` |
| `clientInfo.name` | `claude-code` | `codex-mcp-client` | `Cursor` |
| `tools/list` `_meta` | — | `{progressToken: 0}` | — |

Two things worth carrying:

- **Claude Code requests `2025-11-25`**, not the `2025-06-18` this file claimed for three releases.
  The old figure was the version the hand-driven probe happened to ask for, recorded as though it
  were the client's.
- **All three declare `elicitation`, and we advertise nothing that uses it.** Not a defect — but it
  is the one capability every client has and we do not, so it is where a richer integration would go.
- **Two of the three now ask for `2025-11-25`.** Codex is the laggard at `2025-06-18`. Nothing
  degrades either way, but a change gated on the newer revision would reach Codex last.

## Protocol negotiation

Driven against the workspace build. The server mirrors any version it supports and falls back to the
SDK's latest for anything it does not, which is correct behaviour:

| Client requests | Server negotiates | Tools discovered |
|---|---|---|
| `2025-11-25` | `2025-11-25` | 11 |
| `2025-06-18` | `2025-06-18` | 11 |
| `2025-03-26` | `2025-03-26` | 11 |
| `2024-11-05` | `2024-11-05` | 11 |
| `2099-01-01` (unsupported) | `2025-11-25` | 11 |

**No version-gated degradation** — every protocol version sees the same eleven tools. The server
pins nothing itself; `@modelcontextprotocol/sdk` 1.30.0 negotiates.

## What the server offers

Client-independent — driven straight over stdio:

| Probe | Result |
|---|---|
| `initialize` | `serverInfo: {name: "mneia", version: "0.12.0"}` |
| Advertised capabilities | `{"tools":{}}` — tools only. No `resources`, `prompts`, `logging`, `completions` |
| `instructions` on `initialize` | Returned, 1,611 characters |
| `tools/list` | **Eleven**, listed below |
| `resources/list`, `prompts/list` | `-32601` method not found — correct, they are not advertised |
| `outputSchema` on tools | **Still not published — 0 of 11.** Structured output arrives as `structuredContent` with no declared schema |
| `tools/call` → `mneia_sessions` | Returned one `text` block plus `structuredContent` |

The eleven, from `SHIPPED_TOOL_NAMES` in `packages/mcp-server/src/registry.ts` and confirmed live:

`mneia_assert`, `mneia_checkpoint`, `mneia_handoff_create`, `mneia_handoff_inbox`,
`mneia_handoff_receive`, `mneia_rehydrate`, `mneia_retire`, `mneia_review_queue`, `mneia_search`,
`mneia_sessions`, `mneia_team`

Only `mneia_conflicts` is still deferred (M4). **Grepping the bundle for tool names counts the
deferred ones too and overstates the surface** — drive a session, or read `SHIPPED_TOOL_NAMES`.

### `structuredContent` without `outputSchema` is the one real interop risk

Every tool returns both a text block and `structuredContent`, built in one place —
`toCallToolResult`, `packages/mcp-server/src/server.ts:125-136`. No tool declares an `outputSchema`.
A strict client is entitled to ignore or reject structured output that no schema describes, so
**the text block is the only half guaranteed to render.**

For `mneia_rehydrate` that degrades cleanly: the text block is the whole slice. It is
`mneia_review_queue`, `mneia_sessions` and `mneia_team` where a client that drops
`structuredContent` should be checked against, and that has not been done.

## 🔴 The documented config still exceeds Claude Code's startup timeout on a cold cache

**Unchanged since the 2026-08-19 check, and still a first-run install failure in the flagship client.**

Time from spawn to the first `initialize` result, re-measured 2026-08-22 on this machine:

| Launch | Time to first response |
|---|---|
| `node packages/mcp-server/dist/bin.js`, workspace build | **~1.4s** steady |
| `npx -y @mneia/mcp-server@0.12.0`, warm npx cache | **~9.8s** |
| `npx -y @mneia/mcp-server@0.12.0`, cold npx cache | **>45s — the harness timed out; Claude Code gives up at 30s** |

Two causes, both ours: npx must resolve and download the tree before anything runs, and the server
itself makes a network round trip to `app.mneia.dev` during startup — the banner it prints already
names the workspace and the actor.

So a new user pasting the documented JSON block gets a server their client reports as failed, and it
works only on retry. Until that is fixed the honest instruction for Claude Code is a global install,
which skips the npx resolve:

```
npm install -g @mneia/mcp-server
claude mcp add --scope user mneia -- mneia-mcp
```

**Codex is not exposed to this**, and not by luck: `startup_timeout_sec` is a per-server key in
`~/.codex/config.toml`, so a slow server is a configuration problem there rather than a failure.
Claude Code's 30s ceiling is not configurable.

## Remote MCP, for clients that cannot spawn a process

`POST /api/mcp` serves Streamable HTTP. This is the only way a web client reaches us at all: none of
claude.ai, ChatGPT, Grok or Gemini Enterprise can run a local binary, so stdio is unreachable from
any of them regardless of configuration.

One transport covers all four. **Gemini Enterprise accepts Streamable HTTP and explicitly refuses
SSE**, and SSE is deprecated as of the 2026-07-28 revision, so there is nothing to gain by serving it.

| Probe, driven with `--url` against a local instance | Result |
|---|---|
| `initialize` | `2025-06-18` negotiated, `serverInfo: {name: "mneia", version: "0.12.0"}` **359ms** |
| `tools/list` | Eleven — the same eleven, from the same registry | 
| `resources/list`, `prompts/list` | `-32601`, as over stdio |
| `tools/call` → `mneia_sessions` | **95ms** |
| `tools/call` → `mneia_assert` | Wrote an item and a checkpoint, `human_confirmed` true |
| No `Authorization` header | `401` with `WWW-Authenticate` carrying `resource_metadata` |

**It is faster than stdio** — 359ms to initialize against ~1.4s — because there is no process to
spawn and no npx resolve. The cold-start problem above is a property of launching a binary, and the
remote transport does not have it.

**Authentication is the existing bearer token**, the one `mneia login` writes. No OAuth is required
to connect: claude.ai accepts allowlisted request headers and ChatGPT developer mode accepts an API
key. OAuth 2.1 is a *publication* requirement — the Anthropic Connectors Directory and the OpenAI
Plugin Directory both mandate it, and the latter mandates dynamic client registration — so it is
tracked as its own work rather than folded into a transport change.

RFC 9728 metadata is published at `/.well-known/oauth-protected-resource` so a 401 tells a client
where to authenticate instead of being opaque.

### What stateless costs

The endpoint issues no session id and keeps no per-connection state, so any container may answer and
a deploy cannot strand a client. Two consequences worth knowing before relying on it:

- **Client attribution degrades.** `clientInfo` arrives on `initialize`, which in stateless mode is
  a different HTTP request from the `tools/call` that follows, so a `session` row written over the
  remote transport records an empty `client_name`. Over stdio it records `claude-code` or `Cursor`.
  This is the one place the remote surface is genuinely worse, and it is worth fixing before the
  matrix leans on remote sessions as evidence of which clients are in use.
- **Server-initiated messages have nowhere to go.** Nothing we ship uses them — all eleven tools are
  request/response — but sampling or elicitation would need a session.

## Per client

| Client | Config format | Registers | Handshake captured | Tools discovered | Tool call driven | Verified how |
|---|---|---|---|---|---|---|
| **Claude Code** 2.1.239 | JSON, `mcpServers` key | **Yes** | **Yes** — `docs/handshakes/claude-code.jsonl` | **Yes — 11** | **Yes** | `claude mcp add-json` pointed at the recorder to capture the handshake, then `claude -p` to drive it. Tool calls driven throughout this session against the hosted store |
| **Codex CLI** 0.149.0 | **TOML**, `[mcp_servers.<name>]` | **Yes** — `enabled`, `transport: stdio` | **Yes** — `docs/handshakes/codex.jsonl` | **Yes — Codex issues `tools/list` itself**, before it reaches the model | **Not run** | `codex mcp add` into an isolated `CODEX_HOME`, then `codex exec`. Codex launched the server, initialized and requested `tools/list` before failing at the model on a usage limit |
| **Cursor Agent** 2026.08.11 | JSON, `mcpServers` key | **Yes** — `mneia: ready` | **Yes** — `docs/handshakes/cursor.jsonl` | **Yes — 11, with argument names** | **Not run** | Installed during this check. `cursor-agent mcp enable`, then `cursor-agent mcp list-tools mneia`, which enumerates tools without needing the model. `cursor-agent -p` stops at *"Authentication required. Please run 'agent login'"* — an interactive browser flow |

All three clients now register, hand shake, and enumerate the full eleven. The one thing no client
but Claude Code has done is take an agent turn: Codex is blocked on an OpenAI usage limit that
resets 2026-08-23 11:20, and Cursor on `agent login`, which needs a browser. **Both are account
limits on this machine, not defects in the server** — every one of them reached `tools/list` and got
the same eleven tools back.

### Production has only ever seen one client

`mneia_sessions` against the live project returns four MCP sessions, total:

| `clientName` | Sessions |
|---|---|
| `claude-code` | 3 |
| `stdio-probe` | 1 — the hand-driven probe from the 2026-08-19 check |

**No Cursor session and no Codex session has ever reached production.** A session opens on first
write, so discovery alone would not create one — but it means the neutrality claim currently rests
on protocol conformance and captured handshakes, not on a second client having ever written
anything. That is the gap MNE-79 is really about.

### Two client-side differences that matter

- **Codex uses TOML, not JSON.** A copy-pasted JSON block silently does nothing there. This is the
  most likely setup failure, and `packages/mcp-server/README.md` and the site quickstart were both
  telling Codex users to paste JSON until this check — fixed in the same change as this file.
- **Codex reports `Auth: Unsupported`.** Correct, not a defect: the server authenticates with
  `MNEIA_TOKEN` or `~/.mneia/`, not MCP OAuth.

## Every client we know reads MCP

**Three of these are verified and the rest are documented-not-run.** The distinction is the whole
point of this file, so it is marked on every row rather than left to be inferred. Nothing here needs
per-client code — one binary over stdio, one HTTP endpoint for the rest — which is why breadth is a
documentation problem and not an engineering one.

**The config key is not the same everywhere, and that is the most common setup failure.** Three
clients depart from `mcpServers` and one cannot do stdio at all.

| Client | Config file | Format | Top-level key | Remote HTTP | Verified |
|---|---|---|---|---|---|
| **Claude Code** | `.mcp.json`, `~/.claude.json` | JSON | `mcpServers` | yes | **verified** |
| **Codex CLI** | `~/.codex/config.toml`, `.codex/config.toml` | **TOML** | `mcp_servers` | yes | **verified** |
| **Cursor** | `.cursor/mcp.json`, `~/.cursor/mcp.json` | JSON | `mcpServers` | yes | **verified** |
| **Claude Desktop** | mac `~/Library/Application Support/Claude/claude_desktop_config.json`, win `%APPDATA%\Claude\claude_desktop_config.json` | JSON | `mcpServers` | connectors only | documented |
| **VS Code** | `.vscode/mcp.json` | JSON | **`servers`** | yes | documented |
| **Zed** | `~/.config/zed/settings.json` | JSONC | **`context_servers`** | yes | documented |
| **Goose** | `~/.config/goose/config.yaml` | YAML | **`extensions`** | yes | documented |
| **Continue** | `.continue/mcpServers/*.yaml` | YAML | `mcpServers` — **a list** | yes | documented |
| **Cline** | `cline_mcp_settings.json`, CLI `~/.cline/mcp.json` | JSON | `mcpServers` | yes | documented |
| **Gemini CLI** | `~/.gemini/settings.json`, `.gemini/settings.json` | JSON | `mcpServers` | yes | documented |
| **Warp** | `~/.warp/.mcp.json` | JSON | `mcpServers` | yes | documented |
| **Windsurf / Devin Desktop** | `~/.config/devin/mcp_config.json`, legacy `~/.codeium/windsurf/mcp_config.json` | JSON | `mcpServers` | yes | documented |
| **JetBrains IDEs** | Settings → Tools → AI Assistant → MCP | JSON in dialog | `mcpServers` | yes | documented |
| **LibreChat** | `librechat.yaml` | YAML | `mcpServers` | yes | documented |
| **Open WebUI** | — | — | — | **HTTP only** | documented |

Four traps worth stating outright, because each silently produces "no tools" rather than an error:

- **VS Code uses `servers`, not `mcpServers`.** Pasting the standard block into `.vscode/mcp.json`
  does nothing at all.
- **Zed uses `context_servers`** and **Goose uses `extensions`.** Same story.
- **Continue's `mcpServers` is a YAML list**, not a map, so the JSON shape does not translate.
- **Open WebUI cannot launch a stdio server.** Its native support is Streamable HTTP only — so it
  needs `/api/mcp`, not the binary. That makes the remote transport the *only* route for it.

**Windsurf is now Devin Desktop.** An installer that writes only the `~/.codeium/windsurf` path is
writing to the legacy location.

Paths marked documented come from vendor documentation, not from a run on this machine, and Windows
paths in particular are the least reliable of them. **Capture before trusting:** point any of these
at `--record` and its real handshake lands in `docs/handshakes/`, which takes a minute and needs no
model access. That is how Cursor moved from documented to verified.

### Models are not clients

Groq, Qwen, Moonshot/Kimi and the rest are inference providers. A model never speaks MCP — the
harness around it does, and every harness above is already on this list.

Two exceptions that do matter, because both orchestrate MCP server-side and therefore need a public
HTTPS endpoint rather than a binary:

- **Groq** executes remote MCP tool calls itself, from the Responses and Chat Completions APIs.
- **Alibaba Qwen (Model Studio)** does the same, though **SSE only**, which `/api/mcp` does not serve.

**Ollama is not an MCP client** and never has been, despite the number of blog posts that say so.
Its tool-call support is what lets *other* MCP clients drive it as a backend.

## Configuration

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

`MNEIA_TOKEN` is optional when `mneia login` has already written `~/.mneia/credentials` — that is
the path the checks above actually exercised, with no `env` block at all.

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

Add `startup_timeout_sec = 120` to that block if you keep the `npx` form.

## How the server finds a store, in order

1. `MNEIA_TOKEN` in the server's env → the hosted API at `MNEIA_API_URL`, default `https://app.mneia.dev`
2. `~/.mneia/credentials` → written by `mneia login`
3. `~/.mneia/local.json` → `databaseUrl`, `workspaceId`, `agentActorId`, binding straight to Postgres

With none of the three it **refuses to start** and names all three paths it looked at. An empty
`MNEIA_TOKEN` gets its own message rather than falling through. Both name what was expected, what was
received, and what to do — but note the server *exits* rather than starting and failing per call, so
a client reports it as failed rather than surfacing the message.

**`MNEIA_HOME` relocates the config directory**, which defaults to `os.homedir() + /.mneia`. It must
be absolute, and the CLI and MCP server honour it together. `MNEIA_CREDENTIALS_PATH` and
`MNEIA_LOCAL_CONFIG` still win over it where they name a single file.

## The RLS guard fires on the local path too

Pointing `local.json` at a superuser role is refused, not silently trusted:

```
expected DATABASE_URL to name a role that Postgres row-level security applies to;
found "postgres", which bypasses it
```

That is MNE-186 working outside the deployed app. **Carried over from the 2026-08-08 check and not
re-run since** — it needs a local Postgres, and this machine has no `DATABASE_URL` set.

## The token budget is a soft target under a hard floor

Worth knowing before you integrate. At `tokenBudget: 500` — the schema minimum — every item returned
was mandatory and every optional item was dropped. That is **standing rule 2 working as written**:
load-bearing active constraints appear regardless of budget pressure. A client must not assume
`tokensUsed <= tokenBudget`; the floor is whatever the project's load-bearing set costs.

*Measured at 0.5.0 and not re-run at 0.12.0.*

## Not verified, and what it would take

- **A tool call inside Cursor.** Cursor is not installed here at all. Needs an install, plus a Cursor
  plan with an available model — the 2026-08-19 attempt was blocked by *"No models available for this
  account"* even once registered. Capture the handshake with `--record` first; that part needs no model.
- **A tool call inside Codex.** Registration, launch, `initialize` and `tools/list` are all verified.
  Only the model-driven call is missing, blocked on OpenAI usage credits that reset
  **2026-08-23 11:20**. This is the one blocker with a known expiry — recheck then.
- **A client that ignores `structuredContent`.** No client tested so far drops it, so the text-only
  degradation path is unexercised for `mneia_review_queue`, `mneia_sessions` and `mneia_team`.
- **The RLS guard at 0.12.0.** Needs a local Postgres and a `DATABASE_URL`.
- **Claude Desktop, Gemini CLI, Warp.** Trajectory readers exist for all three
  (`packages/core/src/trajectory/`) but no MCP surface was exercised in any of them.

### What this means for MNE-79 and MNE-106

**MNE-79's clause is still not met.** It asks for *"verified behaviour in all three clients"*. Codex
is now verified through discovery on a captured handshake and is one usage reset from complete.
Cursor has regressed from the last check — not because anything broke, but because the machine that
holds this matrix no longer has Cursor on it.

**MNE-106 depends on this.** Submitting to an MCP registry while production has only ever seen
`claude-code` write anything is submitting the single-vendor product §3 Corollary B says we are not.
Protocol conformance across four protocol versions and two captured client handshakes moves that
materially. A second client actually writing to the store would settle it.
