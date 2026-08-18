import type { DocPage } from './types';

export const REHYDRATE: DocPage = {
  slug: 'rehydrate',
  name: 'Rehydrate',
  title: 'Rehydrate',
  description:
    'How Mneia assembles a context slice for a stated task: the scoring function, per-kind quotas, the guaranteed-inclusion pass for load-bearing constraints, the token budget, the rendered format, and the 300ms latency budget.',
  eyebrow: 'Operations',
  heading: 'Selection, not compaction and not search.',
  lead: 'Given a task and a token budget, rehydration returns the minimal slice that lets the work proceed correctly. The hard part is not finding relevant items. It is guaranteeing that the one nobody searched for still arrives.',
  minutes: 9,
  sections: [
    {
      id: 'not',
      heading: 'What it is not',
      blocks: [
        {
          kind: 'table',
          head: ['Approach', 'What it optimises for', 'Why it is not this'],
          rows: [
            [
              'Compaction',
              'Fitting inside the window',
              'Task-blind and lossy by design. It shrinks what is already there rather than choosing what should be.',
            ],
            [
              'Semantic search',
              'Similarity to the query',
              'Returns what is *like* the task. A constraint the task never mentions is exactly what gets missed, and it is exactly what must not be.',
            ],
            [
              'Replay everything',
              'Completeness',
              'Recall degrades well before a window fills. A slice nobody can act on is not better than a small one.',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Rehydration is a selection problem with a hard constraint attached. Similarity gets a vote; it does not get a veto.',
          ],
        },
      ],
    },
    {
      id: 'scoring',
      heading: 'Scoring',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Each candidate item is scored against the stated task. The weights are tuned empirically and are not gospel — the shape is what matters:',
          ],
        },
        {
          kind: 'code',
          label: 'scoring',
          lines: [
            'score(item, task) =',
            '    w1 * semantic_relevance(item, task)   // embedding similarity',
            '  + w2 * recency_decay(item.assertedAt)',
            '  + w3 * item.confidence',
            '  + w4 * (item.humanConfirmed ? 1 : 0)',
            '  + w5 * (item.loadBearing    ? 1 : 0)',
            '  + w6 * freshness(item)                  // penalise past decayAfter',
            '  - w7 * (item.status = disputed ? 1 : 0)',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Human confirmation is a term, not a tiebreak.** An item a person ratified outranks an equally relevant item an agent guessed at.',
            '**Disputed items are penalised, not hidden.** An unresolved disagreement that is highly relevant should still be visible — as disputed.',
            '**Freshness is separate from recency.** An old standing rule is not stale. A fact past its `decayAfter` is, however recently it was restated.',
          ],
        },
      ],
    },
    {
      id: 'packing',
      heading: 'Packing under the budget',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Scored items are packed greedily under the token budget, with **per-kind quotas** so that one prolific kind cannot crowd out the others. A project accumulates far more facts than constraints, and a pure ranking would return a slice made almost entirely of facts.',
          ],
        },
        {
          kind: 'table',
          head: ['Kind', 'Default share of a 4k budget'],
          rows: [
            ['`constraint`', '30%'],
            ['`decision`', '30%'],
            ['`open_question`', '20%'],
            ['`fact`', '15%'],
            ['`artifact_ref`', '5%'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Unused quota is not wasted — a project with no open questions gives that share back to the kinds that have candidates. The quotas are a floor against crowding out, not a fixed layout.',
          ],
        },
      ],
    },
    {
      id: 'guarantee',
      heading: 'The guarantee',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every active, load-bearing constraint is included, whatever its score and whatever the budget pressure. This runs as its own pass, after packing, and it is the reason rehydration can be trusted at all.',
            'A dropped constraint is not a slightly worse slice. It is how an agent confidently redoes the approach a human already rejected — which is the exact failure the product exists to prevent, arriving from the tool that was supposed to prevent it.',
          ],
        },
        {
          kind: 'note',
          text: 'This is enforced by a test, not by a convention or a comment. Any new filter, limit, ranking change, or truncation step in this path has to exempt load-bearing active constraints, and the test fails if it does not.',
        },
        {
          kind: 'text',
          paragraphs: [
            'Recent supersessions are included on the same principle. What was tried and rejected is precisely what a fresh agent proposes again, and it is cheap to prevent and expensive to discover.',
          ],
        },
      ],
    },
    {
      id: 'render',
      heading: 'What comes back',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The slice is rendered as markdown, grouped by kind, with provenance on every line and a short id you can cite:',
          ],
        },
        {
          kind: 'code',
          label: 'slice',
          lines: [
            '# Context slice: migrate the ledger writes to v2',
            'Generated 2026-08-17 09:14 UTC · 3 items · 412/4000 tokens',
            'Cite an item as `#id` when you use it.',
            '',
            '## Constraints (do not violate)',
            '- **LOAD-BEARING** [#4c1f7a2e · 2026-08-11 · human-confirmed] The cutover must be online',
            '- **LOAD-BEARING** [#9b3d0155 · 2026-08-12 · human-confirmed] Writes stay idempotent under retry',
            '',
            '## Superseded recently (do not re-propose)',
            '- [#e7a4b019 · 2026-08-14 · unconfirmed · superseded] Read from the shadow table in the worker',
            '  Replaced by reading from v2 directly.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The sections are fixed and appear in a fixed order: constraints, decisions and why, open questions, facts, artifacts, and superseded recently. A section with no items is omitted rather than rendered empty.',
            'Alongside the markdown, the response carries the slice id and the ids of the items in it. That is what lets a later checkpoint say which items the agent actually used — see the reference detection below.',
          ],
        },
        {
          kind: 'note',
          text: 'Item titles and task text are rendered inline-safe. Content that looks like a markdown heading cannot inject a section into the slice it appears in.',
        },
      ],
    },
    {
      id: 'budget',
      heading: 'The token budget',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The budget is yours to set — `--budget` on the CLI, a parameter on the MCP tool. The default suits a session that has other things to hold; raise it when rehydrating into a fresh window and lower it when the slice is one input among several.',
            'When items do not fit, the count of what was left out is reported in the header rather than silently omitted. A slice that says *3 more not shown* is telling you something a slice that just ends is not.',
          ],
        },
      ],
    },
    {
      id: 'latency',
      heading: 'The 300ms budget',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Rehydration holds a p95 latency budget of 300 milliseconds, and it is treated as a product requirement rather than a performance goal. The reasoning is blunt: if it is slow, nobody calls it unconditionally, and a rehydration nobody calls is a product that does not work.',
            'That budget is what makes *call it every time* honest advice. It is one indexed query, it is not metered, and there is no reason for an agent to reason about whether to spend it.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'The guaranteed-inclusion pass has its own index, so the constraint guarantee is cheap rather than merely correct.',
            'Embedding vectors live in their own table and never load on this path.',
            'The budget is measured, not assumed, and a regression in it is a defect.',
          ],
        },
      ],
    },
    {
      id: 'feedback',
      heading: 'Which items actually got used',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every slice records that it was shown, and every item in it is subsequently marked as referenced or ignored. Referenced items are ground truth for ranking; ignored ones are equally valuable as negative examples.',
            'The percentage of rehydrated items that get referenced is the number the whole system is judged on. If it climbs per team over time, selection is learning from real corrections. If it stays flat, the product is a nicer markdown file, and that is worth knowing early rather than late.',
          ],
        },
        {
          kind: 'note',
          text: 'Pass the slice id back when you checkpoint, along with the ids of the items that actually changed what you did. That correlation cannot be reconstructed afterwards — it exists only if the client reports it.',
        },
      ],
    },
  ],
};
