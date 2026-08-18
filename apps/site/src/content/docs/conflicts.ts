import type { DocPage } from './types';

export const CONFLICTS: DocPage = {
  slug: 'conflicts',
  name: 'Conflict resolution',
  title: 'Conflict resolution',
  description:
    'How Mneia arbitrates when two sources disagree: agent versus agent, agent versus a human-confirmed item, and human versus human — plus rationale capture and why the three rules are deliberately not symmetrical.',
  eyebrow: 'Operations',
  heading: 'Three rules, and only one of them is automatic.',
  lead: 'A store with several writers has disagreements. What matters is not detecting them — it is being disciplined about which ones software is allowed to settle on your behalf.',
  minutes: 7,
  sections: [
    {
      id: 'detection',
      heading: 'Detection',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Contradiction detection runs inside the checkpoint pipeline, before anything is written. Each candidate item is compared against the existing items nearest to it, and a candidate that disagrees with one is flagged rather than stored.',
            'A detected conflict is recorded as its own row naming both items, when it was detected, and — once settled — who resolved it, how, and why. The disagreement is a first-class object, not a transient state inside a write.',
          ],
        },
      ],
    },
    {
      id: 'rules',
      heading: 'The three rules',
      blocks: [
        {
          kind: 'table',
          head: ['Disagreement', 'Resolution', 'Human interrupted'],
          rows: [
            [
              '**Agent vs agent**',
              'Higher confidence wins; ties break on recency. Both are kept and the outcome is logged.',
              'Only if the item is load-bearing',
            ],
            [
              '**Agent vs human-confirmed**',
              'The human wins, always. The agent assertion is stored as `disputed` and surfaced.',
              'Surfaced, not blocking',
            ],
            [
              '**Human vs human**',
              '**Never auto-resolved.** Both are marked `disputed` and the item is held out of rehydration until it is settled.',
              'Yes — both actors',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The asymmetry is the design. Two agents disagreeing is an ordinary ranking problem and interrupting a person over it would train them to stop reading the interruptions. An agent disagreeing with a person is not a tie to be broken — the answer is already known, and the only question is whether the assertion is worth surfacing. Two people disagreeing is not software’s decision at all.',
          ],
        },
      ],
    },
    {
      id: 'never-overrule',
      heading: 'An agent never overrules a person',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'This is the rule the rest of the system is arranged around. An agent assertion cannot supersede a human-confirmed item, in any code path, under any confidence score, ever.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'Actor kind is read from the record, never from the caller — a client cannot claim to be a human.',
            '`humanConfirmed` and `assertedBy` are derived from the authenticated scope, never accepted from an input payload.',
            'One arbiter decides supersession. A write path that made the decision for itself would be the whole hole.',
            'It is enforced by a test rather than a convention, because a convention is a comment with better marketing.',
          ],
        },
        {
          kind: 'note',
          text: 'The consequence is a store where authority is legible. If an item says a human confirmed it, that is a fact about the world rather than a claim some caller made about itself.',
        },
      ],
    },
    {
      id: 'human-human',
      heading: 'Why human versus human is never settled automatically',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Quietly preferring the newer row is the most tempting behaviour in this entire system, and it is the one that does the most damage. It looks like a sensible default and it is indistinguishable from working correctly, right up until a team discovers weeks later that a ruling was overwritten by somebody who did not know it existed.',
            'So the disagreement is made loud instead. Both items are marked disputed, both actors are told, and the item is held out of rehydration until a person settles it — because feeding an agent a contested constraint is worse than feeding it nothing.',
            'Silence here is how teams get burned, and it is precisely the failure that a system of record exists to prevent.',
          ],
        },
      ],
    },
    {
      id: 'rationale',
      heading: 'Rationale capture',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every resolution records an outcome — one side wins, the two are merged, or both are retired — and, crucially, **why**.',
            'The outcome alone could have been inferred from the rows afterwards. The reason could not. It is the part that explains what the team actually values, and it is the part that is gone forever if it is not captured at the moment somebody decides.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'For the team, it is the answer to *why is it like this* eighteen months later, when everybody who was in the room has moved on.',
            'For selection, it is a labelled example of a human correcting the system, which is what makes ranking improve on your project rather than in general.',
          ],
        },
      ],
    },
    {
      id: 'resolving',
      heading: 'Resolving one',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Conflicts are listed and resolved from the CLI, from an agent through the MCP tool, and in the web app — where two contradicting items are shown side by side with full provenance and the resolution is written with its reasoning.',
            '**mneia status** reports what is disputed alongside what is stale and unanswered, which is why it is the command worth running before a planning meeting rather than after one.',
          ],
        },
        {
          kind: 'note',
          text: 'Resolution is a human act with a machine record, in that order. There is no automatic pass that clears the queue, because a queue that clears itself is a queue that was never load-bearing.',
        },
      ],
    },
  ],
};
