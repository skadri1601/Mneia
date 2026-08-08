# Client compatibility matrix

§3 Corollary B: *"If it only works inside Claude Code, it is not a handoff, it is a session feature."*
This file is the evidence behind that claim. MNE-79 exists because a README saying "works with any
MCP client" that has only ever been run in one is the single-vendor product we are trying not to be.

**Every row says how it was checked.** Where something was not run, it says so rather than implying it.

Last verified **2026-08-08** against `@mneia/mcp-server` 0.1.1, protocol `2025-06-18`.

## What the server offers, verified by a real stdio session

Driven by writing JSON-RPC frames to the server's stdin and reading its stdout — no client involved,
so this half is client-independent:

| Probe | Result |
|---|---|
| `initialize` | `protocolVersion: 2025-06-18`, `serverInfo: {name: "mneia", version: "0.1.1"}` |
| Advertised capabilities | `{"tools":{}}` — tools only |
| `tools/list` | `mneia_rehydrate`, `mneia_assert`, `mneia_checkpoint`, `mneia_search` |
| `tools/call` → `mneia_rehydrate` | Returned a rendered slice plus `structuredContent` carrying `sliceId`, `projectId`, `itemIds`, `mandatoryItemIds`, `droppedItemIds`, `tokenBudget`, `tokensUsed` |
| `resources/list`, `prompts/list` | `-32601` method not found — correct, they are not advertised |
| `outputSchema` on tools | **Not published.** Structured output arrives as `structuredContent` without a declared schema |

## Per client

| Client | Config format | Registers | Tools callable | Verified how |
|---|---|---|---|---|
| **Claude Code** | JSON, `mcpServers` key | Yes | Yes | Server driven end-to-end over stdio; a real `mneia_rehydrate` returned a slice from a Postgres store |
| **Codex CLI** 0.147.0 | **TOML**, `[mcp_servers.<name>]` | Yes — `enabled: true`, `transport: stdio` | Not run | `codex mcp add` accepted it and `codex mcp get` reports it enabled. Driving a session needs model credentials this check did not have |
| **Cursor** | JSON, `mcpServers` key | **Not checked** | **Not checked** | Cursor is not installed on the machine this was verified from. The config below is from Cursor's documented format and has not been run |

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

Checked by removing each in turn:

1. `MNEIA_TOKEN` in the server's env → the hosted API at `MNEIA_API_URL`, default `https://app.mneia.dev`
2. `~/.mneia/credentials` → written by `mneia login`
3. `~/.mneia/local.json` → `databaseUrl`, `workspaceId`, `agentActorId`, binding straight to Postgres

With none of the three it **refuses to start** and names all three paths it looked at. That is the
right behaviour and the error is genuinely actionable — but note it exits rather than starting and
failing per call, so a client will report the server as failed rather than showing a message.

**The config directory cannot be relocated.** It is always `os.homedir() + /.mneia`, with no
environment override. Running two configurations side by side, or running in CI, means overriding
`USERPROFILE` or `HOME` for the process. Worth an env var later; noted here so it is not rediscovered.

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

## Not verified, and what it would take

- **Cursor end to end.** Needs Cursor installed. The config format above is documented, not observed.
- **A tool call inside Codex.** Needs Codex model credentials; the server is registered and enabled,
  which is as far as this check reached.
- **Claude Desktop.** A trajectory reader exists (`packages/core/src/trajectory/claude-desktop.ts`)
  but the MCP surface was not exercised there at all.

Anyone closing those gaps should update the rows above and the date, rather than adding a new file.
