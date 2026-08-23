import type { DocPage } from './types';

export const MCP: DocPage = {
  slug: 'mcp',
  name: 'MCP server reference',
  title: 'MCP server reference',
  description:
    'The Mneia MCP tools — mneia_rehydrate, mneia_assert, mneia_retire, mneia_checkpoint, mneia_search, mneia_handoff_create, mneia_handoff_receive, mneia_handoff_inbox, mneia_team, mneia_sessions, and mneia_review_queue — how to configure the server, and when to call each one.',
  eyebrow: 'Reference',
  heading: 'The tools your agent can call.',
  lead: 'The MCP server is client-neutral by design. It speaks stdio, it works in Claude Code, Cursor, Codex, or anything else that speaks MCP, and it exposes no vendor-specific behaviour.',
  minutes: 9,
  sections: [
    {
      id: 'configure',
      heading: 'Configuring the server',
      blocks: [
        {
          kind: 'code',
          label: 'shell',
          lines: ['mneia mcp install', 'mneia mcp list'],
        },
        {
          kind: 'text',
          paragraphs: [
            'The installer detects supported clients and writes each native configuration. Use **mneia mcp install --client codex --yes** to target one explicitly. See **/docs/integrations#mcp-clients** for Codex, Claude Code, Claude Desktop, Cursor, Gemini CLI, VS Code, Windsurf, and generic MCP instructions, including a complete prompt to paste into the selected agent.',
            'The server reads the same `~/.mneia/credentials` written by **mneia login**. The project binding comes from `.mneia/config.json` in the working directory, so an agent working in a bound repository needs no further configuration.',
            'Configuration is resolved before the server accepts a connection. A missing token, an empty token, a malformed endpoint, or an unparseable project config stops the server at startup with a message naming the variable at fault.',
          ],
        },
      ],
    },
    {
      id: 'tools',
      heading: 'The tools',
      blocks: [
        {
          kind: 'table',
          head: ['Tool', 'Call it when'],
          rows: [
            [
              '`mneia_rehydrate`',
              'Starting a task, and whenever the task changes. Cheap, safe to call unconditionally',
            ],
            ['`mneia_assert`', 'One thing is settled mid-session and should not be lost'],
            ['`mneia_checkpoint`', 'A batch of items is being captured at a task or day boundary'],
            ['`mneia_search`', 'You already know the specific thing you are looking for'],
            ['`mneia_handoff_create`', 'Work is stopping and somebody else will resume it'],
            [
              '`mneia_handoff_receive`',
              'Picking work up — fetch the artifact and mark it received',
            ],
            [
              '`mneia_retire`',
              'An item was never right, or stopped being true, and nothing replaces it',
            ],
            ['`mneia_handoff_inbox`', 'Checking whether work was handed to you before you start'],
            ['`mneia_team`', 'Resolving the names and ids a handoff can be addressed to'],
            ['`mneia_sessions`', 'Finding out who has worked in this repository before you'],
            ['`mneia_review_queue`', 'Surfacing the items still waiting on a human to confirm'],
          ],
        },
        {
          kind: 'note',
          text: 'Every surface is a translation of the same verbs. If a tool would need a verb that is not rehydrate, assert, checkpoint, handoff, or conflict, that is the signal it belongs to a different product rather than a new tool here.',
        },
      ],
    },
    {
      id: 'rehydrate',
      heading: 'mneia_rehydrate',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Loads the minimal high-signal slice for the task about to start: the active constraints that must not be violated, the decisions already made and why, the open questions, and what was recently superseded so it is not re-proposed.',
            'Returns rendered markdown plus the slice id and the ids of the included items, so a later checkpoint can be correlated with what the agent was actually shown. Its p95 latency budget is 300ms — a rehydration nobody waits for is a rehydration nobody calls.',
          ],
        },
        {
          kind: 'note',
          text: 'Reach for `mneia_search` instead when you already know what you are after. Rehydration answers "what do I need to know here?"; search answers "where is this one thing?".',
        },
      ],
    },
    {
      id: 'assert',
      heading: 'mneia_assert',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Records one durable item as soon as it is settled, without waiting for a checkpoint. Use it the moment a decision is made, a constraint is stated, or a question is left open.',
            'Pass `supersedesId` when the item replaces an existing one. A replacement of a human-confirmed item is never written automatically — it comes back pending for a human to confirm.',
          ],
        },
      ],
    },
    {
      id: 'checkpoint',
      heading: 'mneia_checkpoint',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Records a batch of already-extracted items as one atomic checkpoint. Hand it the candidate decisions, constraints, open questions, facts, and artifact refs extracted from the session.',
            '**It does not read the transcript itself.** Extraction is the agent’s job, and the boundary is explicit for the same reason: ambient capture produces noise, and a batch a human can review produces a record worth trusting.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'Candidates that are load-bearing are held in a pending queue rather than written.',
            'Candidates that supersede an existing item are held too.',
            'The pending queue must be surfaced to a human **verbatim** — summarising it is how the disagreement a person needed to settle gets erased.',
          ],
        },
        {
          kind: 'note',
          text: 'Pass the slice id from your rehydration back with the checkpoint, along with the ids of the items that actually changed what you did. That is the only signal of whether the slice was worth loading, and it cannot be recovered afterwards.',
        },
      ],
    },
    {
      id: 'search',
      heading: 'mneia_search',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Looks up specific items by kind, status, load-bearing flag, and free text. Use it to check whether a constraint on a topic exists, to read what a decision said, or to find the id of the item you are about to supersede.',
            'Returns a compact list with full item ids and provenance — not a ranked slice. It competes for the same context window as a rehydration, so keep the limit small.',
          ],
        },
      ],
    },
    {
      id: 'handoff-tools',
      heading: 'mneia_handoff_create and mneia_handoff_receive',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '`mneia_handoff_create` renders the artifact for the current project and returns it with its id and link. Name a recipient to direct it, or leave it open for whoever picks the work up. The rendered markdown is frozen at that moment; the item links stay live.',
            '`mneia_handoff_receive` fetches one and marks it received. An agent resuming work should call this before rehydrating — the handoff says what the sender thought mattered, and the slice says what the store thinks matters now. They are different questions and both are worth asking.',
          ],
        },
      ],
    },
    {
      id: 'review-queue',
      heading: 'mneia_review_queue',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Lists the items waiting on a human to confirm. An agent assertion that would overrule a human-confirmed item is never applied silently — it queues here instead, and stays queued until a person rules on it.',
            'Surfacing unresolved disagreement is a tool an agent may read and must not settle. Where the disagreement is between two people, resolution is theirs to make; the useful thing an agent can do is surface it and stop, rather than picking the newer row and continuing. A dedicated mneia_conflicts tool is deferred to M4.',
          ],
        },
      ],
    },
    {
      id: 'errors',
      heading: 'How failures come back',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Arguments are validated before anything is read or written, so an invalid call changes nothing. Every failure carries a code, a summary of what went wrong, and a remedy stated in terms of what to do next.',
          ],
        },
        {
          kind: 'table',
          head: ['Code', 'Meaning'],
          rows: [
            ['`invalid_arguments`', 'The arguments did not validate. Nothing was read or written'],
            ['`tool_not_available`', 'A real Mneia tool that this server did not load'],
            ['`unknown_tool`', 'Not a Mneia tool at all'],
            [
              '`tool_failed`',
              'A fault in the server. Retry once; then continue without it and report the failure rather than assuming the answer',
            ],
          ],
        },
        {
          kind: 'note',
          text: 'The distinction between the middle two is there so an agent can tell a name it got wrong from a tool this server is not carrying, and stop retrying in the second case.',
        },
      ],
    },
  ],
};
