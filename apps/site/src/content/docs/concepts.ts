import type { DocPage } from './types';

export const CONCEPTS: DocPage = {
  slug: 'concepts',
  name: 'Concepts',
  title: 'Concepts',
  description:
    'The three operations, the vocabulary Mneia uses for a context item, how provenance and superseding work, and why conflicts between a human and an agent are resolved the way they are.',
  eyebrow: 'Documentation',
  heading: 'The model underneath the commands.',
  lead: 'Mneia has a small vocabulary and it is used precisely. Knowing these seven ideas is enough to predict what any command will do.',
  minutes: 10,
  sections: [
    {
      id: 'operations',
      heading: 'Three operations',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Everything Mneia does serves one of three operations. If a feature does not, it does not belong in the product.',
          ],
        },
        {
          kind: 'table',
          head: ['Operation', 'When it runs', 'What it produces'],
          rows: [
            [
              '**Checkpoint**',
              'At a task or day boundary',
              'Typed items written to project memory, with the load-bearing ones held for human confirmation',
            ],
            [
              '**Rehydrate**',
              'At the start of a task, and whenever the task changes',
              'The minimal high-signal context slice for that task, under a token budget',
            ],
            [
              '**Handoff**',
              'When work changes hands',
              'A receivable artifact: what is done, current state, open questions, constraints, next action',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The third is the one that decides the shape of the other two. Most context products are a place to *store* things and a way to *query* them, which is a database posture. The actual job is a transfer: work stops with one actor and resumes with another - the same person tomorrow, a colleague next week, a different agent on the next task. Mneia is built around the artifact produced at the moment of stopping and consumed at the moment of resuming.',
            'Conflict arbitration is not a fourth operation. It is what happens when two of these three collide, and it has its own page.',
          ],
        },
      ],
    },
    {
      id: 'context-item',
      heading: 'The context item',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A context item is the unit of project memory. It has a kind, and the kind decides how it is treated during rehydration - a constraint is not scored against a fact and cannot be crowded out by one.',
          ],
        },
        {
          kind: 'table',
          head: ['Kind', 'What it holds'],
          rows: [
            ['`decision`', 'Something settled, with the reasoning and the alternative it beat'],
            [
              '`constraint`',
              'Something that must hold. The kind that must never be dropped from a slice',
            ],
            ['`open_question`', 'Something unresolved, with an owner and an age'],
            ['`fact`', 'Something true about the project that is neither a ruling nor a rule'],
            ['`artifact_ref`', 'A pointer to the real work - a PR, an ADR, a ticket, a file'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Every item carries a **load-bearing** flag. Load-bearing means the work goes wrong without it, and it is the flag that drives both the confirmation requirement and the rehydration guarantee. Getting it right is most of the product quality, which is why an agent may suggest it and only a human may settle it.',
            'Items also carry a **confidence** score from the extractor, a **status**, and the scope they are visible at. Status moves between `active`, `superseded`, `disputed`, and `retired`; nothing is deleted to change status.',
          ],
        },
      ],
    },
    {
      id: 'provenance',
      heading: 'Provenance, and why it is on every line',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every item records who asserted it - a human or an agent, which one, when, and on what basis. That distinction is rendered everywhere the item appears, because it is the distinction that decides what to trust.',
            'A human-confirmed constraint and an unconfirmed agent assertion are not the same object and must not look the same. Most memory products flatten them into one list of facts, which is how a guess acquires the authority of a ruling.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Human-confirmed** - a person read it and said yes. It carries authority.',
            '**Agent-asserted** - extracted from a session and not yet confirmed. Useful, and visibly provisional.',
            '**Disputed** - an assertion that contradicts a human-confirmed item. Stored, flagged, and never silently applied.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Provenance also reaches back to where the claim came from. An item names the session it was extracted from, and a session names the client that produced it - the tool, its version, and a deep link back to the original conversation where the client exposes one. When a client exposes only part of that, the missing part is reported as partial provenance rather than guessed at.',
          ],
        },
        {
          kind: 'note',
          text: 'Actor kind is read from the record, never from the caller. A client cannot assert that it is a human, and the flag that says a human confirmed something cannot be set by the thing asking for it.',
        },
      ],
    },
    {
      id: 'superseding',
      heading: 'Superseding, not deleting',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'When something is replaced, the replacement points at what it replaced with `supersedesId`, and records why. The old item stays, marked superseded, with its reasoning intact.',
            'This is the single highest-value behaviour in the product. What was tried and rejected is exactly what a fresh agent will otherwise propose again on Tuesday, and a deleted item cannot warn anyone. Rehydration includes recent supersessions for that reason, and so does the handoff artifact.',
          ],
        },
        {
          kind: 'note',
          text: 'A replacement of a human-confirmed item is **never** written automatically. It comes back pending, for a human to confirm. An agent may not overrule a person by writing a row.',
        },
      ],
    },
    {
      id: 'bitemporal',
      heading: 'Two clocks, not one',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Items are bi-temporal. `assertedAt` records when somebody said it; `validFrom` and `validTo` record the window in which it was true of the project. The two are not the same, and collapsing them loses the question worth asking.',
            'Keeping both is what makes it possible to answer *what did we believe on the third of March* - separately from *what do we believe now*. That is the question a postmortem asks, and the question an audit asks, and neither can be reconstructed from a store that overwrites.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '`decayAfter` marks an item that goes stale on its own - a fact about a dependency version, say, rather than a standing rule. A null value means it does not go stale.',
            '`lastVerifiedAt` records the last time somebody checked. Freshness lowers an item’s score before it is ever dropped.',
            'A supersede chain is walkable in both directions, so the history of one decision reads as a sequence rather than a pile.',
          ],
        },
      ],
    },
    {
      id: 'rehydration',
      heading: 'How a slice is chosen',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Rehydration is selection, not compaction and not search. Compaction shrinks the window without knowing the task; semantic search returns what is similar rather than what is load-bearing. Neither is what you want when the thing that must not be dropped is a constraint nobody mentioned in the query.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'The slice is assembled for a **stated task**, under a **token budget** you control.',
            'Per-kind quotas apply, so a pile of similar facts cannot crowd out every constraint.',
            'Load-bearing active constraints are **always included**, whatever the budget pressure. This is a rule, not a heuristic, and it is enforced by a test.',
            'Recent supersessions are included so the agent does not re-propose what was ruled out.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The scoring function and the packer have their own page. The short version: relevance to the stated task, weighted by how much authority the item carries and how fresh it is, penalised if it is disputed - and then a guaranteed pass that puts the constraints back regardless.',
          ],
        },
      ],
    },
    {
      id: 'conflict',
      heading: 'When two sources disagree',
      blocks: [
        {
          kind: 'table',
          head: ['Disagreement', 'What Mneia does'],
          rows: [
            [
              'Agent contradicts a human-confirmed item',
              'The human wins, always. The agent assertion is stored as disputed rather than applied.',
            ],
            [
              'Agent contradicts an agent assertion',
              'Higher confidence wins, ties broken by recency. Logged, and no human is interrupted unless the item is load-bearing.',
            ],
            [
              'Human contradicts a human',
              '**Never auto-resolved.** Both are marked disputed and surfaced to the two people to settle.',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The last row is the one that matters and the one nobody else implements. Arbitrating between two colleagues is not a decision software should make on their behalf, and quietly picking the newer row is how a team discovers weeks later that a ruling was overwritten.',
          ],
        },
      ],
    },
    {
      id: 'scope',
      heading: 'Workspaces, projects, and who can see what',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A **workspace** is the tenant - one company. A **team** sits inside it and carries a function, which is what makes a support engineer’s default view different from a backend team’s. A **project** is a body of work, usually but not necessarily one repository. A **session** is one run of an agent against a project, and it is what a checkpoint summarises. An **actor** is a person or an agent inside one workspace; the same person in two workspaces is two actors and one identity.',
            'Every item carries an access scope, ordered from the individual outward: private, project, team, workspace, and an explicit grant list. Every row carries the workspace it belongs to, and the database enforces isolation with Postgres row-level security rather than relying on the application to remember.',
            'Privacy is enforced by controls - scope, retention, residency - not by keeping data on your laptop, because a hosted service cannot honestly promise the latter.',
          ],
        },
      ],
    },
  ],
};
