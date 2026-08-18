import type { DocPage } from './types';

export const CHECKPOINT: DocPage = {
  slug: 'checkpoint',
  name: 'Checkpoint',
  title: 'Checkpoint',
  description:
    'How Mneia captures a session into project memory: triggers, extraction into the typed schema, deduplication, contradiction detection, the human confirmation queue, and the quality metric that governs the whole pipeline.',
  eyebrow: 'Operations',
  heading: 'Capture, at the boundary rather than the brink.',
  lead: 'A checkpoint turns a session into typed, attributed, reviewable items. It runs when a unit of work ends — not when a context window fills, which is the worst possible moment and produces nothing anybody can review.',
  minutes: 9,
  sections: [
    {
      id: 'why-boundaries',
      heading: 'Why a boundary and not a threshold',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Two things capture context today, and both are worse than they look. Ambient capture writes down everything, which produces noise nobody trusts and nobody reads. Threshold compaction fires when the window is nearly full, which is the point of maximum pressure and minimum judgement, and it leaves behind a summary rather than a record.',
            'Mneia captures at a boundary — the moment a unit of work is actually finished, when what mattered is still legible and there is time to review it. The output is a set of typed items with provenance, not a paragraph of prose.',
          ],
        },
      ],
    },
    {
      id: 'triggers',
      heading: 'Triggers',
      blocks: [
        {
          kind: 'table',
          head: ['Trigger', 'When it fires'],
          rows: [
            ['`task_boundary`', 'An agent finishes a unit of work and calls the checkpoint itself'],
            ['`day_boundary`', 'Scheduled, so a long-running piece of work is not lost overnight'],
            ['`manual`', '**mneia checkpoint**, or `/checkpoint` inside the interactive session'],
            [
              '`pre_compaction`',
              'A client hook fires immediately before its own compaction, capturing what compaction is about to lose',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The trigger is recorded on the checkpoint row, which is what lets you tell a habit from a hook later. A project where every checkpoint is `manual` is a project where the automation is not wired up, and that is worth knowing.',
          ],
        },
      ],
    },
    {
      id: 'pipeline',
      heading: 'The pipeline',
      blocks: [
        {
          kind: 'steps',
          items: [
            {
              title: 'Read the trajectory since the last checkpoint',
              body: 'A server-side watermark records how far the previous run got. Only the turns after it are read, so running twice does not capture the same session twice, and a run that fails part way through does not lose the turns it had already read.',
            },
            {
              title: 'Extract candidates into the typed schema',
              body: 'One model call turns the transcript into decisions, constraints, open questions, facts, and artifact refs. The prompt rejects conversational filler aggressively — precision beats recall here, because a store full of near-misses is a store people stop reading.',
            },
            {
              title: 'Deduplicate against what is already there',
              body: 'Each candidate is compared against its nearest existing items. A restatement of a constraint that is already recorded updates the existing item rather than creating a second copy of it.',
            },
            {
              title: 'Detect contradictions',
              body: 'A candidate that disagrees with an existing item is flagged before anything is written. What happens next depends entirely on who asserted the item it disagrees with — see conflict resolution.',
            },
            {
              title: 'Write what is safe, hold what is not',
              body: 'Non-contradicting, non-load-bearing items are written directly with the extractor confidence and human_confirmed false. Contradicting or load-bearing items go into the pending queue instead.',
            },
            {
              title: 'Record the checkpoint',
              body: 'A checkpoint row and one checkpoint_item link per item are written in the same transaction, so every item in the store is attributable to the checkpoint that created it and the action it took — created, updated, superseded, or rejected.',
            },
          ],
        },
        {
          kind: 'note',
          text: 'The whole write is atomic. A checkpoint either lands completely or not at all; there is no state where the items exist and the checkpoint that explains them does not.',
        },
      ],
    },
    {
      id: 'transcript-size',
      heading: 'Sessions larger than one request',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A long session can exceed what fits in a single extraction call. Mneia splits an oversized transcript into chunks and extracts each in turn rather than trimming it to fit, because trimming silently drops the part of the conversation nobody chose to lose.',
            'The watermark moves only after a chunk has been parsed successfully. If the run stops half way, the next run resumes at the last chunk that actually landed — not at the end of what was uploaded.',
          ],
        },
        {
          kind: 'note',
          text: 'The same applies on the way up. A session too large for one request is uploaded across successive runs, and the remainder is reported as pending rather than dropped.',
        },
      ],
    },
    {
      id: 'confirmation',
      heading: 'The confirmation queue',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'This is the part of the product that decides whether the record is worth trusting in a year, and it is deliberately narrow. You are asked about exactly two categories:',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Load-bearing items** — the ones where the work goes wrong if they are wrong.',
            '**Contradicting items** — anything that disagrees with something already recorded.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Everything else is written without interrupting you. Prompting for every extracted fact would train people to hold down `y`, which is worse than not asking at all — a confirmation that nobody read is a false signal in the record and a false signal in the dataset.',
            'Confirming is one keypress. Editing does not mean retyping the item. And the queue is surfaced verbatim rather than summarised, because summarising it is how the disagreement a person needed to settle gets erased before they see it.',
          ],
        },
        {
          kind: 'table',
          head: ['Action', 'What it records'],
          rows: [
            [
              'Confirm',
              '`human_confirmed` becomes true. The item now carries authority an agent cannot overrule.',
            ],
            [
              'Edit',
              'The corrected text is stored, and the correction itself is recorded — the difference between what was extracted and what was true.',
            ],
            [
              'Reject',
              'The candidate is not written, and the rejection is recorded against the checkpoint.',
            ],
          ],
        },
        {
          kind: 'note',
          text: 'All three outcomes are signal. A rejection is not a failure to write an item — it is a labelled example of the extractor being wrong, which is the thing that makes the extractor better.',
        },
      ],
    },
    {
      id: 'scope-ratified',
      heading: 'Scope is ratified, never routed',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The extractor suggests how widely an item should be visible — private to the person, the project, the team, or the whole workspace. The human confirms or overrides it at the checkpoint, exactly as with the load-bearing flag.',
            'Widening an item to company-wide is therefore a scope change with provenance: attributed, dated, and visible in the checkpoint history. It is not an approval workflow with its own object and state machine, and it deliberately never becomes one.',
          ],
        },
      ],
    },
    {
      id: 'cost',
      heading: 'What a checkpoint costs',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The extraction call is the one real marginal cost in the product, so it is measured where it is incurred. Every checkpoint records the model used, the input and output tokens, the cost, and how long extraction took.',
            'Rehydration, search, log, and status are all one indexed query and cost fractions of a cent, which is why the checkpoint is the only thing metered. Mneia pays for the inference — there is no provider key to supply and no line on your own model bill.',
          ],
        },
      ],
    },
    {
      id: 'quality',
      heading: 'The metric that governs it',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The number that decides whether the checkpoint pipeline is good is the fraction of extracted items that survive human review without an edit. It is tracked per project and over time.',
            'It is a demanding metric on purpose. It falls when the extractor gets chatty, when the precision filter is loosened, and when the prompt starts guessing at load-bearing. Optimising for volume moves it in the wrong direction, which is exactly what you want from the metric that governs a capture pipeline.',
          ],
        },
      ],
    },
  ],
};
