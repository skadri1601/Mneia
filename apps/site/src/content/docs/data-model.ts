import type { DocPage } from './types';

export const DATA_MODEL: DocPage = {
  slug: 'data-model',
  name: 'Data model',
  title: 'Data model',
  description:
    'The schema underneath Mneia: identities and actors, teams and projects, the context item with its provenance and bi-temporal columns, embeddings, checkpoints, handoffs, conflicts, grants, credentials, metering, audit, and the event spine - every table in it.',
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
      id: 'table-index',
      heading: 'Every table, in one place',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The sections below go through these in detail. This is the index, so nothing in the store is a surprise.',
          ],
        },
        {
          kind: 'table',
          head: ['Group', 'Tables'],
          rows: [
            [
              'People and tenancy',
              '`identity` · `workspace` · `workspace_member` · `actor` · `team` · `team_member` · `workspace_invitation`',
            ],
            ['Work', '`project` · `project_file_binding` · `session`'],
            ['The record', '`context_item` · `context_item_embedding` · `context_item_grant`'],
            [
              'Operations',
              '`checkpoint` · `checkpoint_item` · `handoff` · `handoff_item` · `conflict`',
            ],
            [
              'Credentials',
              '`api_token` · `device_authorization` · `device_approval_attempt` · `oauth_client` · `oauth_authorization_code`',
            ],
            [
              'Metering',
              '`workspace_usage_period` · `checkpoint_usage` · `wallet_ledger` · `rate_limit_counter`',
            ],
            ['Records about records', '`telemetry_event` · `audit_event`'],
            ['The waitlist', '`waitlist_signup` · `waitlist_broadcast_send`'],
            ['Bookkeeping', '`mneia_schema_migration`'],
          ],
        },
        {
          kind: 'note',
          text: '**Every tenant table carries `workspace_id`, not nullable, and is isolated by a row-level security policy keyed on it.** A row that cannot name its workspace cannot be filtered, and that is a leak waiting for an occasion. Three tables sit outside that shape and are policed differently rather than left open: `identity` is global to a person and is readable only by the subject it belongs to, `device_authorization` is a credential in flight and is reachable only by the code being redeemed, and `oauth_client` is a registration holding nothing about anybody’s project. Only the migration ledger and the two waitlist tables carry no policy at all, because neither holds tenant data.',
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
            'workspace_invitation -- an outstanding invitation, by email or link',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`identity` is separate from `actor`, and the separation is load-bearing. An actor is a person within one workspace, which is what keeps `asserted_by` workspace-local and every provenance foreign key working. Collapsing the two into one global row per human would silently cap a person at one workspace, and unwinding that after real items exist means rewriting the provenance column.',
            '`actor_kind` distinguishes `human` from `agent`, and it is not cosmetic. It is how rehydration decides what to trust and how conflict resolution decides who arbitrates.',
            'Uniqueness on a human actor is `(workspace_id, external_ref)` rather than `external_ref` alone, and a constraint enforces that an identified human carries an identity. Looking a person up by external reference alone was a real bug: it silently capped every person at one workspace.',
          ],
        },
        {
          kind: 'table',
          head: ['Table', 'What it carries'],
          rows: [
            [
              '`identity`',
              'One person, once, across every workspace: the identity provider’s subject and an email. It has no `workspace_id`, and it is readable only by the subject it belongs to',
            ],
            [
              '`workspace`',
              'The tenant, and everything that is a property of the tenant rather than of a row inside it: slug, display name, plan, billing status and customer reference, purchased seats, trial end, company size, **retention window**, **region**, the three allowance overrides, and the prepaid wallet balance',
            ],
            [
              '`workspace_invitation`',
              'An invitation: the invited email, the hash of its token, the role and team it grants, who sent it, when it expires, and when it was accepted or revoked. The token is stored as a hash, so a leaked row cannot be redeemed',
            ],
          ],
        },
        {
          kind: 'note',
          text: '**Retention and region are columns on `workspace`, not policies in a document.** Region in particular is in the schema from the beginning: keying it after multi-region data already exists is a migration across regions rather than a schema change, and that is not a thing anybody survives cleanly.',
        },
      ],
    },
    {
      id: 'work',
      heading: 'Projects, files, and sessions',
      blocks: [
        {
          kind: 'table',
          head: ['Table', 'What it carries'],
          rows: [
            [
              '`project`',
              'A **body of work, not a repository**. Its repository URL is nullable on purpose, so a sales team’s "Q3 enterprise motion" is as valid a project as a backend service',
            ],
            [
              '`project_file_binding`',
              'One row per interop file - `AGENTS.md`, `CLAUDE.md`, a `.cursor/rules` file - with the checksum of the generated fence, when it was last imported, and when it was last written. The checksum is what detects a hand-edit inside the fence instead of overwriting it',
            ],
            [
              '`session`',
              'One agent session: the actor, the window it ran for, and the client provenance - the tool, the client name and version, and any stable session reference, name, or deep link the harness exposed',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Client provenance is stored where the client offers it and left null where it does not. The absence is reported as partial provenance rather than backfilled with a guess: a provenance chain with a hole in it is more useful than one with an invention in it.',
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
            '  access_scope      access_scope NOT NULL, -- private | project | team |',
            '                                           -- workspace | restricted',
            '  purge_after       TIMESTAMPTZ           -- retention, per item',
            ');',
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
      id: 'grants',
      heading: 'Restricted items and their grants',
      blocks: [
        {
          kind: 'code',
          label: 'sql',
          lines: [
            'CREATE TABLE context_item_grant (',
            '  workspace_id  UUID NOT NULL,',
            '  item_id       UUID NOT NULL,',
            '  grantee_kind  grantee_kind NOT NULL,  -- team | actor',
            '  grantee_id    UUID NOT NULL,',
            '  granted_by    UUID NOT NULL,',
            '  granted_at    TIMESTAMPTZ NOT NULL',
            ');',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Four of the five values in `access_scope` are a hierarchy - private, project, team, workspace - and are answered from the item’s own columns. The fifth, `restricted`, is answered from this table: an explicit list of named teams or actors, each grant attributed and dated.',
            '**A grant table nothing reads is a visibility mode the schema advertises and silently denies.** Two places read it: the visibility predicate that filters a query, and the single-item read check. Both live at the query layer, so an item outside your scope is not returned to be filtered afterwards - it is not returned.',
          ],
        },
      ],
    },
    {
      id: 'credentials-tables',
      heading: 'Credentials',
      blocks: [
        {
          kind: 'table',
          head: ['Table', 'What it records'],
          rows: [
            [
              '`api_token`',
              'One bearer token: **its hash**, never the token, plus the workspace and actor it resolves to, a label, its scopes, the device authorization that minted it, and when it was created, last used, expires, and was revoked',
            ],
            [
              '`device_authorization`',
              'One `mneia login` in flight: the hash of the device code, the user code and confirmation code a person reads off the screen, the client label, the status, and the workspace and actor it was claimed for',
            ],
            [
              '`device_approval_attempt`',
              'Failed approval attempts per actor in a window. A confirmation code somebody can guess by trying is not a confirmation code',
            ],
            [
              '`oauth_client`',
              'An application registered under RFC 7591: its generated client id, name, redirect URIs, grant and response types, auth method and application type, and the hash of a secret where it has one',
            ],
            [
              '`oauth_authorization_code`',
              'One issued authorization code: **its hash**, the client, the workspace and actor it was approved for, the redirect URI it is bound to, the PKCE challenge and method, the requested resource and scope, and when it expires or was redeemed',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Everything secret here is stored as a hash and nothing can be shown again - a leaked row is not a usable credential. The two flows converge deliberately: an OAuth exchange mints an ordinary `api_token` row, so bearer resolution, revocation, expiry, and the tokens page all keep working unchanged, and there is no second credential system to keep in step with the first. See `/docs/oauth`.',
            '`device_authorization` and `oauth_client` are the two tables here not keyed on a workspace, because at the moment they are written there is no workspace yet. Their policies are keyed on the code being redeemed instead, so a row is reachable only by whoever already holds the secret it is about.',
          ],
        },
      ],
    },
    {
      id: 'metering-tables',
      heading: 'Metering, the wallet, and rate limits',
      blocks: [
        {
          kind: 'table',
          head: ['Table', 'What it records'],
          rows: [
            [
              '`workspace_usage_period`',
              'One row per workspace per calendar month: checkpoints, turns, extractions, and embedding tokens used',
            ],
            [
              '`checkpoint_usage`',
              'One row per extraction attempt: the model, input and output tokens, duration, outcome - `succeeded`, `failed`, or `fell_back` - and cost in micros. A failed attempt still consumed tokens, and a record that kept only the successes would understate the bill it exists to explain',
            ],
            [
              '`wallet_ledger`',
              'Every movement of the prepaid balance: a `grant`, a `topup`, or a `debit`, with its amount in micros, its reason, and who caused it',
            ],
            [
              '`rate_limit_counter`',
              'Request counts per token per window. Old windows are discarded rather than kept, because a rate limiter is not a usage record',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Cost is in **micros** - millionths of a dollar - because a checkpoint costs single-digit thousandths of a dollar, which cents cannot express, and floating point drifts once a wallet has accumulated thousands of debits.',
            'The usage period is incremented inside the same transaction that records the checkpoint, so it cannot drift from the thing it counts. It is a projection of the event spine, **never a second source of truth**. `/docs/metering` has the dials and the allowances.',
          ],
        },
        {
          kind: 'note',
          text: 'Cost is recorded on the checkpoint as well as in `checkpoint_usage`, because the extraction call is the one real marginal cost in the system and measuring it anywhere else would be an estimate. A `wallet_ledger` debit exists only where the balance actually moved: a debit that took nothing is not a debit, and a check constraint refuses to record one.',
        },
      ],
    },
    {
      id: 'waitlist-tables',
      heading: 'The waitlist',
      blocks: [
        {
          kind: 'table',
          head: ['Table', 'What it records'],
          rows: [
            [
              '`waitlist_signup`',
              'An email address, where it came from, its unsubscribe token, its admission status, and when and by whom it was approved',
            ],
            [
              '`waitlist_broadcast_send`',
              'One row per campaign per signup, **unique on that pair**, with its delivery status',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'These two are not tenant data - a signup precedes any workspace - so they are the only tables besides the migration ledger with no row-level security policy.',
            'The unique constraint, rather than the loop that sends, is what stops a double send: re-running a campaign only reaches whoever it missed. Unsubscribing hard-deletes the address and cascades its send history away with it.',
          ],
        },
        {
          kind: 'note',
          text: '**The waitlist is not a newsletter.** The published privacy policy commits the address to one use - telling you when access opens - and the confirmation email promises one more email and nothing else. That is a commitment the schema is built to keep, not a preference.',
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
            'Every write path emits a typed event into `telemetry_event`, carrying actor, project, session, timestamp, and item ids - never content. The table is **partitioned by month** from the beginning, because attaching partitioning to a large table later is a rewrite rather than a migration.',
            'Its primary key is `(id, occurred_at)` rather than `id` alone, which is what partitioning by `occurred_at` requires, and the payload is a JSON object with a constraint saying so. Two indexes: one by workspace and event name for metering, one by workspace and project for reading a project’s history.',
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
            'Audit events live in their own table, `audit_event`, deliberately. Telemetry is opt-out and redacted; an audit log that can be either is not an audit log.',
            'Its shape is different for the same reason. A row is an actor, an action, a target kind and id, a timestamp, and a metadata object - **who did what to which object, and when**. Membership changes, scope changes, resolutions, deletions. It is indexed both by workspace and time, for reading the record, and by target, for answering what happened to one object.',
            'Usage accounting is a third thing again - a materialised projection of the event spine, incremented inside the checkpoint transaction so it cannot drift from the thing it counts. It is never a second source of truth. See `/docs/metering`.',
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
