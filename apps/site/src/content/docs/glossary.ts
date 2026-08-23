import type { DocPage, DocSection } from './types';

export type GlossaryTerm = {
  id: string;
  term: string;
  aliases: readonly string[];
  definition: string;
  detail: string;
  seeAlso: readonly string[];
};

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    id: 'checkpoint',
    term: 'Checkpoint',
    aliases: ['mneia checkpoint', 'mneia_checkpoint'],
    definition:
      'The operation that captures an agent session into project memory at a task or day boundary, extracting typed decisions, constraints, open questions, facts, and artifact references.',
    detail:
      'A checkpoint runs at a boundary rather than at a threshold. Ambient capture produces noise nobody trusts; compaction fires when the window is full, which is the point of maximum pressure and least judgement. Items that are load-bearing or that contradict something already recorded are held for a human to confirm rather than written on an agent’s say-so.',
    seeAlso: ['load-bearing', 'confirmation-queue', 'watermark'],
  },
  {
    id: 'rehydrate',
    term: 'Rehydrate',
    aliases: ['rehydration', 'mneia brief', 'mneia_rehydrate', 'context slice'],
    definition:
      'The operation that assembles the minimal high-signal context slice for a stated task, under a token budget.',
    detail:
      'Rehydration is selection, not compaction and not semantic search. Compaction shrinks what is already there without knowing the task; search returns what is similar rather than what is load-bearing. Its p95 latency budget is 300 milliseconds, because a rehydration nobody waits for is a rehydration nobody calls.',
    seeAlso: ['context-slice', 'load-bearing', 'token-budget'],
  },
  {
    id: 'handoff',
    term: 'Handoff',
    aliases: ['handoff artifact', 'mneia handoff', 'mneia_handoff_create'],
    definition:
      'A receivable artifact produced when work stops and consumed when it resumes, carrying the next action, current state, constraints, decisions, open questions, what was recently superseded, and the artifacts involved.',
    detail:
      'The handoff is the unit of value. Storing context and querying it is a database posture that puts the burden on whoever picks the work up - they have to know what to ask. A handoff inverts that: the actor stopping produces the object, and the receiver reads rather than searches. The rendered markdown is frozen at creation; the item links stay live.',
    seeAlso: ['superseded-recently', 'provenance', 'open-handoff'],
  },
  {
    id: 'context-item',
    term: 'Context item',
    aliases: ['context_item'],
    definition:
      'The unit of project memory in Mneia. One typed, attributed, bi-temporal record of something the project decided, requires, is unsure about, or points at.',
    detail:
      'Every context item has a kind - decision, constraint, open_question, fact, or artifact_ref - and the kind decides how it is treated during rehydration. It carries provenance, a confidence score, a load-bearing flag, a status, an access scope, and both an assertion time and a validity window.',
    seeAlso: ['load-bearing', 'provenance', 'access-scope'],
  },
  {
    id: 'load-bearing',
    term: 'Load-bearing',
    aliases: ['load_bearing', 'load-bearing constraint'],
    definition:
      'A flag on a context item meaning the work goes wrong if the item is wrong. Load-bearing active constraints are always included in a rehydration slice, whatever the token budget.',
    detail:
      'This is the flag that drives both the human confirmation requirement and the rehydration guarantee. An agent may suggest it; only a human settles it. A dropped load-bearing constraint is how an agent confidently redoes the approach a human already rejected, so the guarantee is enforced by a test rather than by convention.',
    seeAlso: ['rehydrate', 'checkpoint', 'human-confirmed'],
  },
  {
    id: 'human-confirmed',
    term: 'Human-confirmed',
    aliases: ['human_confirmed'],
    definition:
      'A flag meaning a person read a context item and ratified it. A human-confirmed item carries authority that an agent assertion cannot overrule.',
    detail:
      'The flag is derived from the authenticated actor rather than accepted from a caller, so it is a fact about the world rather than a claim a client made about itself. An agent assertion that contradicts a human-confirmed item is stored as disputed and surfaced, never silently applied.',
    seeAlso: ['provenance', 'disputed', 'conflict-resolution'],
  },
  {
    id: 'provenance',
    term: 'Provenance',
    aliases: ['asserted_by', 'actor attribution'],
    definition:
      'The record of who asserted a context item - a human or an agent, which one, when, from which session, and on what basis - rendered everywhere the item appears.',
    detail:
      'A human-confirmed constraint and an unconfirmed agent assertion are not the same object and must not look the same. Most memory products flatten them into one list of facts, which is how a guess acquires the authority of a ruling.',
    seeAlso: ['human-confirmed', 'actor', 'session'],
  },
  {
    id: 'superseding',
    term: 'Superseding',
    aliases: ['supersedes_id', 'supersede', 'superseded'],
    definition:
      'Replacing a context item by pointing a new item at the old one and recording why, instead of deleting or overwriting the old one.',
    detail:
      'The superseded item keeps its text, its reasoning, and its provenance. This is what makes it possible to warn a fresh agent away from an approach the team already rejected - a store that overwrites has thrown that information away at the moment it was replaced.',
    seeAlso: ['superseded-recently', 'bi-temporal', 'context-item'],
  },
  {
    id: 'superseded-recently',
    term: 'Superseded recently',
    aliases: ['do not re-propose'],
    definition:
      'The section of a rehydration slice and a handoff artifact listing what was tried and rejected, so it is not proposed again.',
    detail:
      'The highest-value block in the artifact, and the one no other product produces. What was tried and rejected is exactly what a fresh agent proposes again on Tuesday, and it is cheap to prevent and expensive to discover.',
    seeAlso: ['superseding', 'handoff', 'rehydrate'],
  },
  {
    id: 'context-slice',
    term: 'Context slice',
    aliases: ['slice', 'brief'],
    definition:
      'The output of a rehydration: a rendered, provenance-carrying selection of context items chosen for one stated task and fitted to a token budget.',
    detail:
      'Sections appear in a fixed order - constraints, decisions and why, open questions, facts, artifacts, superseded recently - and an empty section is omitted rather than rendered blank. The response also carries the slice id and the included item ids, so a later checkpoint can report which items were actually used.',
    seeAlso: ['rehydrate', 'token-budget', 'load-bearing'],
  },
  {
    id: 'token-budget',
    term: 'Token budget',
    aliases: ['--budget'],
    definition:
      'The ceiling you set on how much of the context window a rehydration slice may consume. Per-kind quotas apply within it so one prolific kind cannot crowd out the others.',
    detail:
      'Load-bearing active constraints are included regardless of what the budget is set to. When items do not fit, the count of what was left out is reported in the slice header rather than silently omitted.',
    seeAlso: ['context-slice', 'load-bearing', 'rehydrate'],
  },
  {
    id: 'disputed',
    term: 'Disputed',
    aliases: ['contradiction', 'conflict'],
    definition:
      'The status of a context item that contradicts another and has not been settled. Disputed items are penalised in ranking, surfaced rather than hidden, and - where two humans disagree - held out of rehydration until a person resolves it.',
    detail:
      'Feeding an agent a contested constraint is worse than feeding it nothing. The disagreement is recorded as its own object naming both items, and its resolution records the outcome and the reasoning behind it.',
    seeAlso: ['conflict-resolution', 'human-confirmed', 'context-item'],
  },
  {
    id: 'conflict-resolution',
    term: 'Conflict resolution',
    aliases: ['arbitration', 'mneia conflicts', 'mneia_conflicts'],
    definition:
      'How Mneia settles disagreements between writers. Agent versus agent resolves on confidence then recency; an agent never overrules a human-confirmed item; human versus human is never resolved automatically.',
    detail:
      'The asymmetry is the design. Two agents disagreeing is an ordinary ranking problem. An agent disagreeing with a person is not a tie to be broken. Two people disagreeing is not software’s decision at all - quietly preferring the newer row is indistinguishable from working correctly until a team discovers a ruling was overwritten.',
    seeAlso: ['disputed', 'human-confirmed', 'rationale'],
  },
  {
    id: 'rationale',
    term: 'Rationale',
    aliases: ['resolution reason'],
    definition:
      'The recorded reason a conflict was resolved the way it was - not merely which side won.',
    detail:
      'The outcome could be inferred from the rows afterwards; the reason could not. It is what explains a decision to whoever reads it a year later, and it is gone forever if it is not captured at the moment somebody decides.',
    seeAlso: ['conflict-resolution', 'disputed'],
  },
  {
    id: 'access-scope',
    term: 'Access scope',
    aliases: ['access_scope', 'visibility hierarchy'],
    definition:
      'The visibility level of a context item: private to the asserting actor, the project, the owning team, the whole workspace, or an explicit grant list.',
    detail:
      'Scope is ratified, never routed. The extractor suggests a scope and a human confirms or overrides it at the checkpoint, so widening an item to the whole company is a scope change with provenance rather than an approval workflow with its own state machine.',
    seeAlso: ['workspace', 'team', 'context-item'],
  },
  {
    id: 'workspace',
    term: 'Workspace',
    aliases: ['tenant'],
    definition:
      'The tenant boundary - one company. Every row in Mneia carries the workspace it belongs to, and Postgres row-level security enforces the isolation underneath the application.',
    detail:
      'A person can belong to several workspaces. The identity is shared; the actor, and therefore every item they assert, is not. An access token carries its workspace, so the token is the binding and the clients need no workspace flag.',
    seeAlso: ['actor', 'team', 'access-scope'],
  },
  {
    id: 'actor',
    term: 'Actor',
    aliases: ['actor_kind'],
    definition:
      'A person or an agent inside one workspace. Agents are first-class writers with their own identity in the record.',
    detail:
      'Actor kind distinguishes human from agent, and it is not cosmetic: it is how rehydration decides what to trust and how conflict resolution decides who arbitrates. Actor kind is read from the record, never from the caller, so a client cannot claim to be a human.',
    seeAlso: ['provenance', 'workspace', 'human-confirmed'],
  },
  {
    id: 'team',
    term: 'Team',
    aliases: ['team_function'],
    definition:
      'A group inside a workspace, carrying a function - engineering, product, design, sales, marketing, support, success, operations, or finance - which shapes what its members see by default.',
    detail:
      'Function lives on the team rather than the person, so it keeps one source of truth and survives people moving between teams. It is what keeps a support engineer out of a backend team’s debugging trail without per-person configuration.',
    seeAlso: ['workspace', 'access-scope', 'project'],
  },
  {
    id: 'project',
    term: 'Project',
    aliases: ['.mneia/config.json'],
    definition:
      'A body of work that context items belong to. Usually one repository, but a sales team’s quarterly motion is as valid a project as a backend service.',
    detail:
      'A repository is bound to a project by `.mneia/config.json`, which holds the workspace, the project slug, and the endpoint - no data and no credentials. It is meant to be committed, because the binding is a property of the repository rather than of one laptop.',
    seeAlso: ['workspace', 'team', 'session'],
  },
  {
    id: 'session',
    term: 'Session',
    aliases: ['trajectory'],
    definition:
      'One run of one actor against one project, carrying the client that produced it - the tool, its version, and a deep link back to the original conversation where the client exposes one.',
    detail:
      'A checkpoint summarises a session. Where a client exposes only part of that shape, the absence is reported as partial provenance rather than backfilled with a guess.',
    seeAlso: ['checkpoint', 'actor', 'provenance'],
  },
  {
    id: 'watermark',
    term: 'Watermark',
    aliases: ['checkpoint watermark'],
    definition:
      'The server-side marker of how far the previous checkpoint read into a session, so a rerun neither loses turns nor captures the same ones twice.',
    detail:
      'It moves only after a chunk of the transcript has been parsed successfully. A session too large for one extraction call is split rather than trimmed, and a run that stops half way resumes at the last chunk that actually landed.',
    seeAlso: ['checkpoint', 'session'],
  },
  {
    id: 'confirmation-queue',
    term: 'Confirmation queue',
    aliases: ['pending queue', 'review queue'],
    definition:
      'The set of checkpoint candidates held back for a human, containing exactly two categories: items that are load-bearing, and items that contradict something already recorded.',
    detail:
      'Everything else is written without interrupting you. Prompting for every extracted fact would train people to hold down a key, which is worse than not asking - a confirmation nobody read is a false signal in the record. The queue is surfaced verbatim rather than summarised.',
    seeAlso: ['checkpoint', 'load-bearing', 'disputed'],
  },
  {
    id: 'bi-temporal',
    term: 'Bi-temporal',
    aliases: ['valid_from', 'valid_to', 'asserted_at'],
    definition:
      'Keeping two clocks on every context item: when somebody asserted it, and the window in which it was true of the project.',
    detail:
      'Collapsing the two loses the question worth asking. Keeping both is what answers *what did we believe on the third of March*, separately from *what do we believe now* - which is the question a postmortem asks and the question an audit asks.',
    seeAlso: ['context-item', 'superseding'],
  },
  {
    id: 'open-handoff',
    term: 'Open handoff',
    aliases: ['mneia pickup', 'mneia_handoff_receive'],
    definition:
      'A handoff that names no recipient and may be picked up by whoever takes the work, as opposed to a directed handoff addressed to one person.',
    detail:
      'It is the shape that fits the end of a day, a rotation, or work being put down without a decision about who resumes it. Both kinds are received the same way, and receiving starts the clock on time to first action.',
    seeAlso: ['handoff', 'session'],
  },
];

export function glossaryTerm(id: string): GlossaryTerm {
  const term = GLOSSARY.find((entry) => entry.id === id);
  if (!term) {
    throw new Error(`expected a glossary term for "${id}"; found none`);
  }
  return term;
}

const termSection = (entry: GlossaryTerm): DocSection => ({
  id: entry.id,
  heading: entry.term,
  blocks: [
    { kind: 'text', paragraphs: [`**${entry.definition}**`, entry.detail] },
    ...(entry.aliases.length > 0
      ? ([
          {
            kind: 'note',
            text: `Also written: ${entry.aliases.map((alias) => `\`${alias}\``).join(', ')}.`,
          },
        ] as const)
      : []),
  ],
});

export const GLOSSARY_PAGE: DocPage = {
  slug: 'glossary',
  name: 'Glossary',
  title: 'Glossary',
  description:
    'Every term Mneia uses precisely, defined once: checkpoint, rehydrate, handoff, context item, load-bearing, human-confirmed, superseding, provenance, access scope, workspace, actor, and the rest.',
  eyebrow: 'Reference',
  heading: 'Every term, defined once.',
  lead: 'Mneia has a small vocabulary and uses it precisely. These are the definitions the product, the schema, and the rest of this documentation all mean.',
  minutes: 9,
  sections: [
    {
      id: 'how-to-read',
      heading: 'How to read this',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Domain terms match the schema exactly. Where a definition names a column - `load_bearing`, `human_confirmed`, `asserted_by`, `valid_from` - that is the literal column, and the mapping between the snake case in SQL and the camel case in TypeScript is mechanical.',
            'Synonyms are not invented. "Memory", "note", and "entry" are not a context item, and a vocabulary that drifts between the specification and the code makes every later reference ambiguous.',
          ],
        },
      ],
    },
    ...GLOSSARY.map(termSection),
  ],
};
