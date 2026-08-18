import type { DocPage } from './types';

export const SCOPE: DocPage = {
  slug: 'scope',
  name: 'Workspaces, teams, and scope',
  title: 'Workspaces, teams, and scope',
  description:
    'How Mneia is organised above the project: identities and actors, workspaces, teams and their function, roles, the five-value visibility hierarchy, and how a question crosses from one team to another.',
  eyebrow: 'Organisation',
  heading: 'Context does not stop at a team boundary.',
  lead: 'A decision made in payments changes what sales can promise. An open question in platform blocks three feature teams. The hierarchy exists so that is answerable without making every backend debugging trail company reading.',
  minutes: 9,
  sections: [
    {
      id: 'entities',
      heading: 'The entities',
      blocks: [
        {
          kind: 'table',
          head: ['Entity', 'What it is'],
          rows: [
            [
              '**Identity**',
              'A person, once, across every workspace they belong to. One human, one identity.',
            ],
            [
              '**Workspace**',
              'The tenant — one company. Every row in the system belongs to exactly one.',
            ],
            [
              '**Actor**',
              'A person or an agent *inside* one workspace. The same person in two workspaces is two actors and one identity, which is what keeps provenance workspace-local.',
            ],
            [
              '**Team**',
              'A group inside a workspace, carrying a function — engineering, product, design, sales, marketing, support, success, operations, finance.',
            ],
            [
              '**Project**',
              'A body of work. Usually a repository, but a sales team’s quarterly motion is as valid a project as a backend service.',
            ],
            [
              '**Session**',
              'One run of one actor against one project, carrying the client that produced it. A checkpoint summarises a session.',
            ],
          ],
        },
        {
          kind: 'note',
          text: 'Agents are actors too. `claude-code` working in your repository is a first-class writer with its own identity in the record — which is what makes *who asserted this* answerable rather than approximate.',
        },
      ],
    },
    {
      id: 'multi-workspace',
      heading: 'One person, several workspaces',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A person can belong to any number of workspaces — a contractor across clients, an advisor, somebody with a personal workspace and an employer’s. The identity is shared; the actor, and therefore every item they assert, is not.',
            'The clients need no workspace flag. A token carries its workspace, so the token *is* the binding: approving a device claims whichever workspace was active in the browser at the time. Signing the same machine in twice against two workspaces means two tokens, not a switch.',
          ],
        },
      ],
    },
    {
      id: 'function',
      heading: 'Function lives on the team',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A team carries a function, and the function is what shapes what its members see by default. A support engineer and a backend engineer are asking different questions of the same company, and a default view that hands a support engineer a root-cause analysis has failed both of them.',
            'Function sits on the team rather than the person deliberately. It keeps one source of truth and it survives people moving between teams — which they do, and which a per-person setting would quietly get wrong from that day onward.',
          ],
        },
      ],
    },
    {
      id: 'access-scope',
      heading: 'The visibility hierarchy',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every item carries an access scope. Four of the five are ordered narrowest to widest; the fifth sits outside the ordering because it is an explicit list rather than a level.',
          ],
        },
        {
          kind: 'table',
          head: ['Scope', 'Who sees it'],
          rows: [
            ['`private`', 'The asserting actor only'],
            ['`project`', 'This project. The default, and where most items stay'],
            ['`team`', 'The owning team, across all of its projects'],
            ['`workspace`', 'The whole company'],
            [
              '`restricted`',
              'An explicit grant list — named teams or actors, each grant attributed and dated',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The hierarchy is part of the schema from the first migration rather than something added when the second team arrives. Widening a visibility model after real multi-team data exists is a migration nobody survives cleanly, and the discipline it imposes early is cheaper than the one it would impose late.',
          ],
        },
        {
          kind: 'note',
          text: '`restricted` is backed by a real grant table. A visibility mode the schema advertises and the query layer silently denies would be worse than not offering it.',
        },
      ],
    },
    {
      id: 'ratified',
      heading: 'Scope is ratified, never routed',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The extractor suggests a scope; a human confirms or overrides it at the checkpoint, exactly as with the load-bearing flag. Widening an item to the whole company is a scope change with provenance — attributed, dated, visible in the checkpoint history.',
            'It is deliberately not an approval workflow with its own object, queue, and state machine. Escalation without new machinery, and every override becomes another labelled example of what a team actually thinks is worth sharing.',
          ],
        },
      ],
    },
    {
      id: 'roles',
      heading: 'Membership and roles',
      blocks: [
        {
          kind: 'table',
          head: ['Level', 'Roles'],
          rows: [
            [
              'Workspace',
              '`owner`, `admin`, `member` — carried on the membership row, alongside who invited them and when',
            ],
            ['Team', '`lead`, `member`'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Invitations are into the workspace; naming a team is optional. Accepting one always writes the workspace membership, and writes the team membership only when a team was named — so somebody can join a company before anybody has decided which team they sit on.',
            'A team lead is the person who decides whether something their team settled is worth widening past the team. That is a judgement, and the system gives them the mechanism rather than making the judgement for them.',
          ],
        },
      ],
    },
    {
      id: 'cross-team',
      heading: 'Crossing a team boundary',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The question this hierarchy exists to answer is the one nobody currently has a good route to. A customer asks a salesperson for a feature on a call. Is it on the roadmap? Is anybody building it? What state is it in, and who do they talk to?',
            'Every part of that answer is already in the model — a decision with its rationale and its author, an unresolved open question, a supersede chain showing what was tried. It needs no new object. It needs enough teams checkpointing, a query that crosses projects, and scope enforcement that makes the crossing safe.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'Non-engineering functions ask about **state and ownership** — what exists, where it is, who owns it.',
            'They do not want, and should not receive, the debugging trail underneath it. That is what the hierarchy is for.',
            'The answer names a point of contact, because the useful end of a cross-team question is usually a person rather than a document.',
          ],
        },
        {
          kind: 'note',
          text: 'Surfaces follow data. A cross-functional question can only be answered once several teams have been checkpointing for a while — the query is not the hard part, the record is.',
        },
      ],
    },
  ],
};
