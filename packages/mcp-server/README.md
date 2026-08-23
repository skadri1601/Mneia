# @mneia/mcp-server

The [Mneia](https://mneia.dev) MCP server - shared project memory and handoff for teams working with
AI agents, exposed as MCP tools to Claude Code, Cursor, Codex, and any other MCP client.

Your agent forgets between sessions. Your teammates never knew in the first place. Mneia captures
what a session decided, and gives the next session - or the next person - the part of it that
matters.

## Install

Install both customer clients once. Node 20.11 or newer.

```
npm install -g @mneia/cli @mneia/mcp-server
mneia login
mneia init
mneia mcp install
```

The last command detects installed MCP clients and writes each client’s native format. Target one
explicitly when an agent is doing the setup:

```
mneia mcp install --client codex --yes
mneia mcp list --client codex
```

Supported client ids include `codex`, `claude-code`, `claude-desktop`, `cursor`, `gemini-cli`,
`vscode`, and `windsurf`. Complete copyable agent prompts and manual fallbacks live in the
[client setup docs](https://mneia.dev/docs/integrations#mcp-clients).

Confirm the client picked it up - in Claude Code, `/mcp` should list `mneia` as connected with eleven
tools. Then ask the agent to rehydrate; on a fresh project it will say there is nothing stored yet
rather than erroring, which is how you tell "connected and empty" from "not connected".

The server speaks MCP over stdio. Run it from a client, not by hand - `mneia-mcp --help` and
`mneia-mcp --version` are the only things it does interactively.

## Tools

| Tool | When the agent should call it |
|---|---|
| `mneia_rehydrate` | Once at the start of every session, and again whenever the task changes. Loads the minimal high-signal slice: active constraints, decisions and their reasons, open questions, and what was recently superseded so it is not re-proposed. |
| `mneia_checkpoint` | At a task or day boundary. Records a batch of extracted items as one atomic checkpoint. |
| `mneia_assert` | The moment a single decision, constraint, or open question is settled mid-session. |
| `mneia_search` | When you already know what you are looking for - not as a substitute for rehydrate. |
| `mneia_retire` | An item was never right, or has stopped being true, and nothing replaces it. A correction, not a deletion: the row stays and the reason is recorded. Only a human actor may retire. |
| `mneia_handoff_create` | Work is stopping and somebody else will resume it. Freezes a receivable artifact; the rendered markdown is fixed at that moment, the item links stay live. |
| `mneia_handoff_receive` | Resuming work somebody handed over. Call it before rehydrating - the handoff says what the sender thought mattered, the slice says what the store thinks matters now. |
| `mneia_handoff_inbox` | Checking whether work was handed to the current actor before starting. |
| `mneia_team` | Resolving the names and ids a handoff can be addressed to. |
| `mneia_sessions` | Seeing which client sessions have worked in the bound repository. |
| `mneia_review_queue` | Surfacing items that still require a human decision. |

Two rules are enforced by the server, not left to the agent:

- **A load-bearing item, or one that supersedes an existing item, is never written automatically.**
  It comes back in a pending queue that the client must surface to a human verbatim. Auto-confirming
  it would erase the disagreement the human needs to settle.
- **An agent never overwrites something a human confirmed.** Provenance is read from the store, not
  from the tool call.

## Configuration

| Variable | Purpose |
|---|---|
| `MNEIA_TOKEN` | Mneia API token from `mneia login`. Set it in the MCP client's server config. |
| `MNEIA_API_URL` | API endpoint. Defaults to `https://app.mneia.dev`. |
| `MNEIA_HOME` | Absolute path to the directory holding the credentials and the local binding. Defaults to `~/.mneia`. `@mneia/cli` honours it too, so a login written under it is found here. |
| `MNEIA_CREDENTIALS_PATH` | Absolute path to the credentials file, instead of `<MNEIA_HOME>/credentials`. |
| `MNEIA_TELEMETRY` | Set to `off` to opt out of usage events. |

## Privacy

Mneia is hosted. Your context is stored in the service, and access to it is enforced by controls -
workspace scope on every row, Postgres row-level security, retention, and residency - not by where
the bytes happen to sit. Usage events carry ids and timings, never your content, and
`MNEIA_TELEMETRY=off` turns them off entirely.

Read the [privacy policy](https://mneia.dev/privacy) for what is kept and for how long.

## Stability

`0.1.x`. Tool names are stable; their argument and return shapes will move before `1.0`.

## See also

- [`@mneia/cli`](https://www.npmjs.com/package/@mneia/cli) - login, init, MCP client setup, brief,
  checkpoint, handoff, and project administration
- [`@mneia/core`](https://www.npmjs.com/package/@mneia/core) - the library underneath both

Apache-2.0.
