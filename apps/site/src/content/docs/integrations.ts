import type { DocPage } from './types';

export const INTEGRATIONS: DocPage = {
  slug: 'integrations',
  name: 'Integrations',
  title: 'Integrations',
  description:
    'Where Mneia plugs in: MCP clients like Claude Code, Cursor, and Codex; the six transcript sources a checkpoint can read, including Claude Desktop and Warp; file interop with AGENTS.md, CLAUDE.md, and .cursor/rules; the web app; CI runners; and what is deliberately not built.',
  eyebrow: 'Reference',
  heading: 'Beside your tools, never above them.',
  lead: 'Mneia is not an agent, a runtime, or a framework. It is a context layer that every surface reaches through the same verbs, which is what lets a handoff survive crossing from one tool to another.',
  minutes: 8,
  sections: [
    {
      id: 'neutrality',
      heading: 'Why neutrality is structural',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A handoff that only works inside one vendor’s tool is not a handoff - it is a session feature. The whole claim depends on the artifact surviving the crossing: written by an agent in one client, received by a person in another, weeks later.',
            'Model providers are structurally incentivised against that. Every one of them wants its own instructions file and its own memory, and none of them has a reason to make your context portable to a competitor. That gap does not close.',
          ],
        },
      ],
    },
    {
      id: 'mcp-clients',
      heading: 'MCP clients',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The MCP server is the primary integration. It speaks stdio and exposes no vendor-specific behaviour, so any MCP-capable client can start it with the same configuration.',
          ],
        },
        {
          kind: 'client-setup',
        },
        {
          kind: 'text',
          paragraphs: [
            'Client differences are normalised at the edge rather than leaking inward. Each client identifies itself and its version on the session, and where it exposes a stable session reference or a deep link back to the original conversation, those are stored too - so provenance can point at the actual conversation rather than at a summary of it.',
          ],
        },
        {
          kind: 'note',
          text: 'Where a client exposes only part of that shape, the absence is reported as partial provenance rather than backfilled with a guess. A provenance chain with a hole in it is more useful than one with an invention in it.',
        },
      ],
    },
    {
      id: 'checkpoint-sources',
      heading: 'Checkpoint sources',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Connecting the MCP server is how an agent **calls** Mneia. Reading a transcript is how `mneia checkpoint` finds out what a session actually did, and the two are separate: a harness whose transcript Mneia can read does not have to be one Mneia is connected to.',
            'The CLI discovers sessions on the machine, works out which of them belong to this directory, and checkpoints from them. Six sources are read today.',
          ],
        },
        {
          kind: 'table',
          head: ['Source', 'Read from', 'Notes'],
          rows: [
            [
              '`claude-code`',
              'The JSONL transcripts under the projects directory',
              'The reference implementation. Carries a stable session reference',
            ],
            [
              '`claude-desktop`',
              'The local agent-mode session directories under the Claude application data folder',
              'Desktop keeps its agent sessions per working directory rather than in one place, so the reader walks for them and reads each with the same parser Claude Code uses. Same transcript format, different location',
            ],
            [
              '`codex`',
              'The Codex session files',
              'Recorded with the client name and version the session declared',
            ],
            ['`cursor`', 'Cursor’s local store', ''],
            ['`gemini`', 'The Gemini CLI session files', ''],
            [
              '`warp`',
              'The Warp SQLite database, opened **read-only**',
              'A terminal rather than an agent harness, so its shape is different: conversations rather than transcripts, and the working directory comes from the queries recorded against a conversation. When a conversation began is derived from its earliest query, because the table only records when it was last touched - and a conversation started months ago but touched today would otherwise look new',
            ],
            [
              '`file`',
              'A transcript you point at directly',
              'The escape hatch for a harness with no reader',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'A source that is not installed is not an error. Discovery reports it as unavailable, with the reason, and carries on with the ones that are - so a machine with two harnesses does not fail because it does not have the other four.',
            'With no flags, `mneia checkpoint` reads **the single most recently active** session and says how many others it found and did not read. `--all-sessions` sweeps them; `--session <ref>` names one, with `--source <harness>` where two harnesses use the same reference. Each session carries its own watermark, so one you skip today resumes where it was when you do read it.',
          ],
        },
        {
          kind: 'note',
          text: 'Discovery reads transcripts that already exist on your machine, at the moment you run a checkpoint. It is not a watcher, there is no background process, and nothing is uploaded until you ask for a checkpoint. A session that began before this repository was bound to a project is out of scope and is not read.',
        },
      ],
    },
    {
      id: 'file-interop',
      heading: 'File interop',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Teams already keep their constraints somewhere - `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`. Those files are read on `init` and the constraints in them are imported, so a project does not start empty and nobody has to retype what they already wrote down.',
            'A generated section is written back into `AGENTS.md` inside a fence Mneia owns. That is what makes the value show up even in a session where the MCP server is not connected at all.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'Nothing outside the fence is ever touched. It is your file, in your repository, in your git history.',
            'A hand-edit inside the fence is detected rather than overwritten - the boundary is a tested invariant, not a convention.',
            'If the fence has been damaged, `init` stops and says so rather than guessing where it used to be.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`.mneia/config.json` holds the project binding - workspace, project slug, endpoint. **No data and no credentials.** It is meant to be committed, because the binding is a property of the repository rather than of one laptop. Credentials live in `~/.mneia/credentials`, outside the repository, and never enter git.',
          ],
        },
      ],
    },
    {
      id: 'web',
      heading: 'The web app',
      blocks: [
        {
          kind: 'table',
          head: ['Surface', 'What it is for'],
          rows: [
            [
              '**Account plane**',
              'Signing up, accepting an invitation, and approving a device from `mneia login`',
            ],
            [
              '**Projects**',
              'Creating, renaming, and archiving the bodies of work a workspace is tracking',
            ],
            [
              '**Decision browser**',
              'Reading the project record - what was decided, by whom, and what it replaced',
            ],
            [
              '**Timeline**',
              'The bi-temporal view: what the project believed on a given date, rather than only what it believes now',
            ],
            [
              '**Review queue**',
              'Confirming the items a checkpoint held back, away from the terminal',
            ],
            [
              '**Handoffs**',
              'The project inbox, and the artifact page whose link you paste to a colleague',
            ],
            [
              '**Team**',
              'Membership, invitations, roles, and the join link. This is where a workspace is actually administered',
            ],
            [
              '**Tokens**',
              'Every live token in the workspace, and the one control that revokes any of them',
            ],
            ['**Billing**', 'The plan, the seats, the prepaid balance, and the usage meter'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '**/docs/web-app** covers each of those in full, including what the app deliberately does not do.',
            'The web app is deliberately thin. It is a view onto the same verbs rather than a second product - if a surface here needed a verb the CLI and the MCP server do not have, that would be the signal it had started becoming something else.',
          ],
        },
        {
          kind: 'note',
          text: 'Conflict **detection** runs and is recorded; conflict **resolution** does not yet have a surface in the app, and neither does the CLI. `/docs/conflicts` describes the rules it will follow, and says plainly what is not built.',
        },
      ],
    },
    {
      id: 'ci',
      heading: 'CI and automation',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'An ephemeral runner with no disk is an ordinary client rather than a special case. Set `MNEIA_TOKEN`, and every command behaves exactly as it does on a laptop - which matters as more work is done by agents inside pipelines rather than beside a person.',
          ],
        },
        {
          kind: 'code',
          label: 'ci',
          lines: [
            'env:',
            '  MNEIA_TOKEN: ${{ secrets.MNEIA_TOKEN }}',
            '',
            'steps:',
            '  - run: mneia brief "$TASK" --json > context.json',
            '  # ... agent runs ...',
            '  - run: mneia checkpoint --trigger task_boundary --json',
          ],
        },
        {
          kind: 'note',
          text: 'Exit codes separate a network failure from a missing binding from a bad token, so a pipeline can retry the first and fail fast on the other two rather than treating every non-zero exit as one event.',
        },
      ],
    },
    {
      id: 'not-built',
      heading: 'What is deliberately not here',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The boundary is as much a part of the design as the surface. Mneia sits beside orchestration frameworks and never above them.',
          ],
        },
        {
          kind: 'table',
          head: ['Not this', 'Why'],
          rows: [
            [
              'Agent orchestration or a runtime',
              'We sit beside LangGraph, CrewAI, and Claude Code. Locking your agents into our runtime would trade neutrality for control.',
            ],
            [
              'Observability, tracing, or evals',
              'Those capture what happened. They produce no receivable artifact, and rebuilding them would be a different company.',
            ],
            [
              'Enterprise document search',
              'Indexing documents is a different problem from recording live project decisions.',
            ],
            [
              'A chat interface, or an agent of our own',
              'You already have one, and it is better than ours would be.',
            ],
            [
              'Durable execution infrastructure',
              'Adopted if it is ever genuinely needed. Never built.',
            ],
            ['Model hosting or inference', 'Not our business, and not our advantage.'],
            ['A vector database', 'We use one. Building one is a decade of somebody else’s work.'],
          ],
        },
        {
          kind: 'note',
          text: 'A VS Code extension is not planned either, and the reasoning is the same shape: MCP already runs inside VS Code, Cursor, and Codex, so a developer there already has the tools. An extension would add chrome rather than capability.',
        },
      ],
    },
  ],
};
