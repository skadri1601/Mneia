import type { DocPage } from './types';

export const HANDOFF_DOC: DocPage = {
  slug: 'handoff',
  name: 'Handoff',
  title: 'Handoff',
  description:
    'The handoff artifact: its sections, the superseded-recently block, freeze semantics and the live link, directed and open handoffs, receiving one, and the measurement that proves it works.',
  eyebrow: 'Operations',
  heading: 'The artifact you receive, not a store you query.',
  lead: 'A handoff is produced at the moment work stops and consumed at the moment it resumes. Everything else in Mneia exists to make this object accurate.',
  minutes: 8,
  sections: [
    {
      id: 'why',
      heading: 'Why an artifact rather than a query',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every context product gives you somewhere to put things and a way to look them up. That puts the entire burden on whoever picks the work up: they have to know what to ask, and they cannot know what they do not know. The questions that matter most on receiving work — *what was already tried and rejected?* — are the ones nobody thinks to type.',
            'A handoff inverts it. The person or agent stopping is the one who knows what mattered, and they are the one who produces the object. The receiver reads rather than searches.',
          ],
        },
      ],
    },
    {
      id: 'sections',
      heading: 'What the artifact contains',
      blocks: [
        {
          kind: 'table',
          head: ['Section', 'What it answers'],
          rows: [
            ['**Header**', 'Who from, who to, when. Open handoffs say `to: open`.'],
            [
              '**Next action**',
              'The single thing to do next, concretely enough to start. Not a summary — an instruction.',
            ],
            ['**State**', 'Where the work actually is right now, including what is half-done.'],
            [
              '**Constraints**',
              'What must not be violated, each with provenance and whether a human confirmed it.',
            ],
            ['**Decisions and why**', 'What was settled, and the reasoning that settled it.'],
            [
              '**Open questions**',
              'What is unresolved, who owns it, and how long it has been open.',
            ],
            [
              '**Superseded recently**',
              'What was tried and rejected, so it is not proposed again.',
            ],
            ['**Artifacts**', 'The real work — PRs, ADRs, tickets, files.'],
          ],
        },
        {
          kind: 'code',
          label: 'handoff/payments-migration.md',
          lines: [
            '# Handoff: payments-migration',
            'From: Saad (human) · 2026-07-26 18:40 UTC',
            'To: open',
            '',
            '## Next action',
            'Wire the retry path in `charges/worker.rb` to the new idempotency key.',
            'Nothing else is blocking.',
            '',
            '## Constraints (do not violate)',
            '- [human · confirmed 2026-07-14] No downtime window. Cutover must be online.',
            '- [agent · claude-code · unconfirmed] Stripe webhook ordering is not guaranteed.',
            '',
            '## Superseded recently (do not re-propose)',
            '- ~~Redis-based cutover lock~~ superseded 2026-07-11, see decision above.',
            '- ~~7-day dual-read window~~ superseded 2026-07-19.',
          ],
        },
      ],
    },
    {
      id: 'superseded',
      heading: 'The superseded-recently block',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'This is the highest-value section in the artifact and the one no other product produces. It is what stops a fresh agent — or a colleague who was not in the room — from confidently proposing the thing the team already rejected.',
            'It works because nothing is ever deleted. A superseded item keeps its text, its reasoning, and its provenance, and it points at what replaced it. A store that overwrites cannot render this block at all, because the information required to write it was thrown away at the moment it was replaced.',
          ],
        },
        {
          kind: 'note',
          text: 'Recency here is measured against the handoff, not against the whole project history. What matters is what was rejected during the work being handed over — an approach discarded eighteen months ago is history, not a warning.',
        },
      ],
    },
    {
      id: 'provenance',
      heading: 'Provenance on every line',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every constraint and decision carries who asserted it, whether that was a human or an agent, and whether a human confirmed it. The receiver can therefore tell a ruling from a guess without asking anybody.',
            'This matters most in the constraints section. An unconfirmed agent assertion and a constraint a person ratified two weeks ago place very different obligations on the receiver, and a format that renders them identically has quietly promoted the guess.',
          ],
        },
      ],
    },
    {
      id: 'freeze',
      heading: 'Frozen prose, live link',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The rendered markdown is frozen at creation. What the sender wrote is what the receiver reads, whatever happens to the project afterwards — an artifact that rewrites itself is not receivable, because the two people can no longer be sure they read the same thing.',
            'Alongside it, the item set is stored as data rather than only as prose. That is what backs the live link: the receiver can move from the frozen document to the current state of any item in it and see what has changed since.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'The frozen render is the record of what was communicated.',
            'The item links are the route to what is true now.',
            'Both are needed. Either alone is a worse object.',
          ],
        },
      ],
    },
    {
      id: 'directed-open',
      heading: 'Directed and open handoffs',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A handoff can name a recipient or leave it open. A directed handoff goes to one person and appears in their inbox. An open handoff names nobody and may be picked up by whoever takes the work — which is the shape that fits the end of a day, a rotation, or work being put down without a decision about who resumes it.',
            'Both are received the same way. Receiving marks the handoff, records who took it, and starts the clock described below.',
          ],
        },
      ],
    },
    {
      id: 'measurement',
      heading: 'Does it actually reduce pickup cost',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The product claim is that receiving a handoff is cheaper than reconstructing context, so the gap between receiving one and taking the first real action on the work is measured directly.',
            'It is measured across humans as well as within one person, because the two are different problems. Picking up your own work from yesterday is a memory problem; picking up a colleague’s is a transfer problem, and only the second one tests the claim.',
          ],
        },
        {
          kind: 'note',
          text: 'The handoff format is documented here and rendered by an open-source client, and the format specification is published once the reference implementation and its adopters are established. A specification published before that is a gift to whoever implements it faster.',
        },
      ],
    },
  ],
};
