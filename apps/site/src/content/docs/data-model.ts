import type { DocPage } from './types';

export const DATA_MODEL: DocPage = {
  slug: 'data-model',
  name: 'Data model',
  title: 'Data model',
  description:
    'The schema underneath Mneia: identities and actors, teams and projects, the context item with its provenance and bi-temporal columns, embeddings, checkpoints, handoffs, conflicts, and the event spine.',
  eyebrow: 'Reference',
  heading: 'Postgres, bi-temporal where it matters, provenance on everything.',
  lead: 'One store, one dependency. The shape of the schema is the shape of the product, so it is documented rather than hidden - the parts that carry our judgement are meant to be inspectable and arguable.',
  minutes: 11,
  sections: [
    {
      id: 'one-store',
      heading: 'One store',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Everything lives in Postgres with pgvector. Not Postgres plus a graph database plus a cache plus a queue - one engine, transactional, with hybrid retrieval good enough at this scale.',
            'That is a deliberate constraint rather than minimalism for its own sake. A single-dependency system is one an enterprise buyer can deploy inside their own boundary as a conversation rather than a procurement project, and it keeps the whole store inside one transaction where it belongs.',
          ],
        },
        {
          kind: 'note',
          text: 'A full graph database is judged premature here. Bi-temporal columns plus supersede links cover the need, and the question is revisited if multi-hop reasoning ever becomes a demonstrated bottleneck rather than an anticipated one.',
        },
      ],
    },
    {
      id: 'people',
      heading: 'Identities, actors, teams',
      blocks: [
        {
          kind: 'code',
          label: 'sql',
          lines: [
            'identity          -- a person, once, across every workspace',
            'workspace         -- the tenant',
            'workspace_member  -- identity × workspace, with role owner|admin|member',
            'actor             -- a person or agent *inside* one workspace',
            'team              -- a group, carrying a function',
            'team_member       -- actor × team, with role lead|member',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`identity` is separate from `actor`, and the separation is load-bearing. An actor is a person within one workspace, which is what keeps `asserted_by` workspace-local and every provenance foreign key working. Collapsing the two into one global row per human would silently cap a person at one workspace, and unwinding that after real items exist means rewriting the provenance column.',
            '`actor_kind` distinguishes `human` from `agent`, and it is not cosmetic. It is how rehydration decides what to trust and how conflict resolution decides who arbitrates.',
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
          paragraphs: ['The heart of the system. Every column earns its place.'],
        },
        {
          kind: 'code',
          label: 'sql',
          lines: [
            'CREATE TABLE context_item (',
            '  id                UUID PRIMARY KEY,',
            '  workspace_id      UUID NOT NULL,',
            '  project_id        UUID NOT NULL,',
            '  kind              item_kind NOT NULL,   -- decision | constraint |',
            '                                          -- open_question | fact | artifact_ref',
            '  title             TEXT NOT NULL,',
            '  body              TEXT,',
            '  status            item_status NOT NULL, -- active | superseded |',
            '                                          -- disputed | retired',
            '',
            '  -- provenance: who said this, and on what basis',
            '  asserted_by       UUID NOT NULL REFERENCES actor(id),',
            '  asserted_at       TIMESTAMPTZ NOT NULL,',
            '  source_session_id UUID REFERENCES session(id),',
            '  source_ref        TEXT,                 -- git sha, PR url, permalink',
            '',
            '  -- trust and freshness',
            '  confidence        REAL NOT NULL,',
            '  human_confirmed   BOOLEAN NOT NULL,',
            '  load_bearing      BOOLEAN NOT NULL,     -- if wrong, work goes wrong',
            '  last_verified_at  TIMESTAMPTZ,',
            '  decay_after       INTERVAL,             -- null = does not go stale',
            '',
            '  -- bi-temporal validity',
            '  valid_from        TIMESTAMPTZ NOT NULL,',
            '  valid_to          TIMESTAMPTZ,          -- null = still valid',
            '  supersedes_id     UUID REFERENCES context_item(id),',
            '  superseded_by_id  UUID REFERENCES context_item(id),',
            '  supersede_reason  TEXT,',
            '',
            '  access_scope      access_scope NOT NULL -- private | project | team |',
            ');                                        -- workspace | restricted',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**`load_bearing`** decides whether a contradiction blocks or merely logs. Getting it right is most of the product quality.',
            '**`asserted_at` is not `valid_from`.** When somebody said a thing and when it was true of the project are different facts, and keeping both is what answers *what did we believe on the third of March*.',
            '**Supersede links point both ways** and carry a reason, so a decision’s history reads as a sequence rather than a pile of rows.',
            '**`purge_after`** carries retention down to the individual item, so a retention policy is enforced by the store rather than by a promise.',
          ],
        },
        {
          kind: 'note',
          text: 'The guaranteed-inclusion pass in rehydration has its own partial index - active, load-bearing, still valid, keyed by workspace and project. Without it the constraint guarantee would be correct but not cheap, and a guarantee that costs latency gets negotiated away.',
        },
      ],
    },
    {
      id: 'embeddings',
      heading: 'Embeddings',
      blocks: [
        {
          kind: 'code',
          label: 'sql',
          lines: [
            'CREATE TABLE context_item_embedding (',
            '  workspace_id  UUID NOT NULL,',
            '  item_id       UUID NOT NULL,',
            '  model         TEXT NOT NULL,   -- provider-qualified',
            '  dim           INTEGER NOT NULL,',
            '  embedding     VECTOR(1536) NOT NULL,',
            '  PRIMARY KEY (item_id, model)',
            ');',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Vectors live in their own table, keyed by item **and model**. A vector is meaningless without the model that produced it: two vectors from different models in one index give a cosine distance that means nothing, and the result is retrieval that is subtly wrong rather than broken - degradation that reads as bad ranking rather than as a bug.',
            'The composite key is what lets two models be queryable at once during a backfill, which is the exact moment the guarantee is the only thing standing. It also keeps vectors off the rehydration read path by construction, rather than by a filter flag somebody can forget.',
          ],
        },
        {
          kind: 'note',
          text: 'The index is HNSW rather than ivfflat. ivfflat trains its centroids when the index is built; built against an empty table it learns nothing and recall stays poor until somebody remembers to reindex. HNSW needs no training data and handles incremental inserts, which is the shape of every write here.',
        },
      ],
    },
    {
      id: 'operations-tables',
      heading: 'Checkpoints, handoffs, conflicts',
      blocks: [
        {
          kind: 'table',
          head: ['Table', 'What it records'],
          rows: [
            [
              '`checkpoint`',
              'One capture: its trigger, its summary, its review state, and the model, tokens, cost, and duration of the extraction call',
            ],
            [
              '`checkpoint_item`',
              'One row per item touched, with the action taken - created, updated, superseded, or rejected',
            ],
            [
              '`handoff`',
              'From, to (null for an open handoff), the next action, and the frozen rendered markdown',
            ],
            [
              '`handoff_item`',
              'The item set behind the frozen prose, by section - what backs the live link',
            ],
            [
              '`conflict`',
              'Both items, when it was detected, who resolved it, the outcome, and **the rationale**',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Cost is recorded on the checkpoint because that is where it is incurred - the extraction call is the one real marginal cost in the system, and measuring it anywhere else would be an estimate.',
            '`conflict.rationale` is not optional metadata. The resolution without the reason is the half that could have been derived from the rows anyway.',
          ],
        },
      ],
    },
    {
      id: 'events',
      heading: 'The event spine',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every write path emits a typed event carrying actor, project, timestamp, and item ids - never content. The table is partitioned by month from the beginning, because attaching partitioning to a large table later is a rewrite rather than a migration.',
          ],
        },
        {
          kind: 'table',
          head: ['Event', 'What it is for'],
          rows: [
            ['`rehydration.slice_shown`', 'The denominator for slice quality'],
            ['`rehydration.item_referenced`', 'Which items actually got used - ground truth'],
            ['`rehydration.item_ignored`', 'Negative examples, equally valuable'],
            ['`checkpoint.item_extracted`', 'Extractor precision'],
            ['`checkpoint.item_confirmed` / `edited` / `rejected`', 'The human correction signal'],
            ['`conflict.detected` / `resolved`', 'Which side a human chose, and why'],
            ['`item.superseded`', 'How a decision evolved'],
            ['`handoff.created` / `received`', 'Whether the differentiating artifact gets used'],
            ['`handoff.time_to_first_action`', 'Whether it actually reduces pickup cost'],
          ],
        },
        {
          kind: 'note',
          text: 'Coverage is enforced by a test, not by convention. A new write path with no event is a defect even when every other test passes - the record it feeds cannot be reconstructed after the fact.',
        },
      ],
    },
    {
      id: 'audit',
      heading: 'Audit is not telemetry',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Audit events live in their own table, deliberately. Telemetry is opt-out and redacted; an audit log that can be either is not an audit log.',
            'Usage accounting is a third thing again - a materialised projection of the event spine, incremented inside the checkpoint transaction so it cannot drift from the thing it counts. It is never a second source of truth.',
          ],
        },
      ],
    },
    {
      id: 'migrations',
      heading: 'Migrations and the checked-in schema',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Migrations are numbered, applied in order under an advisory lock, and never edited once applied. The schema they add up to is generated and checked in, so a reviewer sees the resulting shape in the diff instead of replaying every migration file in their head.',
            'The two are verified against each other on every change. A migration that lands without its row-level security policy, or a schema that has drifted from its migrations, fails rather than merging.',
          ],
        },
      ],
    },
  ],
};
