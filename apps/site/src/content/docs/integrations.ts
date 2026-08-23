import type { DocPage } from './types';

export const INTEGRATIONS: DocPage = {
  slug: 'integrations',
  name: 'Integrations',
  title: 'Integrations',
  description:
    'Where Mneia plugs in: MCP clients like Claude Code, Cursor, and Codex; file interop with AGENTS.md, CLAUDE.md, and .cursor/rules; the web app; CI runners; and what is deliberately not built.',
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
            'A handoff that only works inside one vendor’s tool is not a handoff — it is a session feature. The whole claim depends on the artifact surviving the crossing: written by an agent in one client, received by a person in another, weeks later.',
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
            'Client differences are normalised at the edge rather than leaking inward. Each client identifies itself and its version on the session, and where it exposes a stable session reference or a deep link back to the original conversation, those are stored too — so provenance can point at the actual conversation rather than at a summary of it.',
          ],
        },
        {
          kind: 'note',
          text: 'Where a client exposes only part of that shape, the absence is reported as partial provenance rather than backfilled with a guess. A provenance chain with a hole in it is more useful than one with an invention in it.',
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
            'Teams already keep their constraints somewhere — `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`. Those files are read on `init` and the constraints in them are imported, so a project does not start empty and nobody has to retype what they already wrote down.',
            'A generated section is written back into `AGENTS.md` inside a fence Mneia owns. That is what makes the value show up even in a session where the MCP server is not connected at all.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'Nothing outside the fence is ever touched. It is your file, in your repository, in your git history.',
            'A hand-edit inside the fence is detected rather than overwritten — the boundary is a tested invariant, not a convention.',
            'If the fence has been damaged, `init` stops and says so rather than guessing where it used to be.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`.mneia/config.json` holds the project binding — workspace, project slug, endpoint. **No data and no credentials.** It is meant to be committed, because the binding is a property of the repository rather than of one laptop. Credentials live in `~/.mneia/credentials`, outside the repository, and never enter git.',
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
              'Signing up, approving a device from `mneia login`, and managing workspaces, projects, teams, and members',
            ],
            [
              '**Decision browser**',
              'Reading the project record — what was decided, by whom, and what it replaced',
            ],
            [
              '**Review queue**',
              'Confirming the items a checkpoint held back, away from the terminal',
            ],
            [
              '**Timeline**',
              'The bi-temporal view: what the project believed on a given date, rather than only what it believes now',
            ],
            [
              '**Conflict resolution**',
              'Two contradicting items side by side with full provenance, and the resolution written with its reasoning',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The web app is deliberately thin. It is a view onto the same verbs rather than a second product — if a surface here needed a verb the CLI and the MCP server do not have, that would be the signal it had started becoming something else.',
          ],
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
            'An ephemeral runner with no disk is an ordinary client rather than a special case. Set `MNEIA_TOKEN`, and every command behaves exactly as it does on a laptop — which matters as more work is done by agents inside pipelines rather than beside a person.',
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
