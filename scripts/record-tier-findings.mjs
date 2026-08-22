#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const envFile = new URL('../.env', import.meta.url);

if (existsSync(fileURLToPath(envFile))) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const flagValue = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const workspace = flagValue('--workspace');
const project = flagValue('--project');

const fail = (message) => {
  process.stderr.write(`record:tier-findings: ${message}\n`);
  process.exit(1);
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  fail(
    'expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      `  Copy ${repoRoot}.env.example to .env and fill in the direct (non-pooler) string.`,
  );
}
if (workspace === undefined) {
  fail('expected --workspace <uuid>; this writes tenant rows and will not run unscoped.');
}
if (project === undefined) {
  fail('expected --project <uuid> naming the project these items belong to.');
}

const describe = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'the configured database';
  }
};

const SOURCE_REF = 'feat/mne-103-tiers-and-the-meter';

const FINDINGS = [
  {
    kind: 'fact',
    loadBearing: true,
    confidence: 0.95,
    title:
      'gpt-5.6-luna is $0.20/$1.20 per MTok standard and $0.10/$0.60 on service_tier flex, and it is a reasoning model defaulting to medium effort that we never configure',
    body: [
      'Published rates verified 2026-08-22, superseding the earlier $0.286/M blended derivation.',
      'Standard $0.20/M in, $0.02/M cached in, $1.20/M out. Flex and Batch $0.10 / $0.01 / $0.60.',
      'Inputs over 272,000 tokens charge 2x input and 1.5x output ON THE WHOLE REQUEST, so chunk.ts must keep any single call under that ceiling.',
      '',
      'Four levers, descending. One: reasoning.effort - luna defaults to medium and createOpenAiExtractionProvider sends no reasoning parameter at all; reasoning bills as OUTPUT at 6x the input rate, worth about 34 percent. Two: service_tier flex - batch pricing on a SYNCHRONOUS /v1/responses call that stacks with cache discounts, worth 50 percent, which is why no async batch build is needed. Three: prompt_cache_key - required on GPT-5.6+ for reliable matching; cached input is 20x cheaper and the prefix is already byte-stable (extract.test.ts:331). Four: stay under the 272K cliff.',
      '',
      'Combined this takes a 160-turn checkpoint from $0.00847 to $0.00255, a 70 percent cut, changing nothing about what the product does.',
      '',
      'The 3,000 output-token figure in that chain is the only estimate. checkpoint_usage.output_tokens has recorded the real value since migration 0029 and nothing reads it. Read it before choosing between reasoning effort low and none.',
    ].join('\n'),
  },
  {
    kind: 'fact',
    loadBearing: true,
    confidence: 0.95,
    title:
      'Measured from .mneia/dogfood: 18,605 turns across 116 checkpoints is 160 turns per checkpoint, ranging 17 to 1,092 - a 64x spread',
    body: [
      'Peak 48 checkpoints in a day, mean 19, across up to 9 concurrent sessions, on the heaviest agent-driven repo we have.',
      '',
      'This is why the meter cannot be checkpoint count: the cheapest and dearest checkpoint differ 64x in what they cost us, so a count-based allowance is wrong by that factor depending on which shape a customer happens to produce.',
      '',
      'It also corrects an earlier claim that the hook fires every 6 turns. It does - but it mostly probes; it only extracts occasionally, batching about 160 turns. Counting hook firings as checkpoints produced a $0.0005 per-checkpoint figure that was 20x too low.',
    ].join('\n'),
  },
  {
    kind: 'fact',
    loadBearing: true,
    confidence: 0.95,
    title:
      'buildExtractionPrompt is 1,193 tokens of base plus about 29-35 tokens per existing item, most of it the rendered UUID',
    body: [
      'Measured directly against the real builder: 0 items 1,193 tok, 100 items 4,300, 200 items 7,400. Rendering short indices instead of UUIDs takes 200 items to 4,200.',
      '',
      'Consequence: cutting EXISTING_ITEM_LIMIT from 200 to 100 saves less than switching to short ids, and once the prefix is cached it saves almost nothing. Keep the limit at 200 and change the id rendering instead - it costs no recall.',
    ].join('\n'),
  },
  {
    kind: 'fact',
    loadBearing: true,
    confidence: 0.98,
    title:
      'mneia_assert is metered as a checkpoint and refused by the 200/day ceiling, despite running no extraction and costing nothing',
    body: [
      'Found 2026-08-22 when recording these very findings failed twice with store_unavailable at 248 then 249 checkpoints in a day.',
      '',
      'apps/web/src/app/api/v1/checkpoints/route.ts is marked cost checkpoint in serve(), and mneia_assert writes through it. Every single-item assertion consumes a slot from the workspace ceiling with no LLM call behind it.',
      '',
      'Worse, the counter went 248 to 249 on a REFUSED write: serve.ts calls limits.store.bump() before evaluateRateLimit, so refusals still consume the ceiling.',
      '',
      'Three request shapes each cost one slot and only the first costs money: propose with pending turns (correct), the propose watermark probe which returns at propose.ts:96 before any cost (wrong), and a checkpoints write or assert (wrong). The unit being metered is not the unit that costs money. The three-dial design fixes it by construction because extractions_used increments in recordUsage, which returns early when attempts.length is 0.',
    ].join('\n'),
  },
  {
    kind: 'decision',
    loadBearing: true,
    confidence: 0.95,
    title:
      'The meter is turns, extractions and embedding tokens - three dials - not checkpoint count',
    body: [
      'Founder ruling 2026-08-22. Each extraction dial is set at turns divided by 160, the measured mean, so neither dial silently caps the other at typical session shape.',
      '',
      'Both are needed. A turn allowance alone admits thousands of tiny extractions paying pure prompt overhead; an extraction allowance alone admits one enormous upload. Capping the pair is what makes worst-case COGS computable, and it is what replaces the rate limiter being removed from the checkpoint path.',
      '',
      'The customer never sees three dials. They see one percentage - the larger of turns used over turn allowance and extractions used over extraction allowance - with the checkpoint count beside it as context. The embedding dial is recorded, never shown.',
    ].join('\n'),
  },
  {
    kind: 'decision',
    loadBearing: true,
    confidence: 0.95,
    title:
      'Pro is a paid single-seat tier at $15/mo, Team is $25/seat, Enterprise is not sold, and internal accounts ride on the enterprise plan with a null allowance',
    body: [
      'Founder ruling 2026-08-22, from the Tiers and the Meter worksheet.',
      '',
      'Monthly allowances: Free 160,000 turns and 1,000 extractions; Pro 624,000 and 3,900; Team 896,000 and 5,600 per seat, pooled across seats_purchased. At the post-optimisation cost that is $2.60, $10.14 and $14.56 of COGS, so 32 percent margin on Pro and 42 percent on Team.',
      '',
      'Allowances are monthly and must be described that way in customer-facing copy. The pool is month-keyed, so a per-day figure is not a claim we can honour - anyone front-loading a week exhausts it early.',
      '',
      'The enterprise-plan-for-internal ruling is coherent only while enterprise is not sold. Revisit it when it is, or internal usage starts looking like customer revenue in every report.',
    ].join('\n'),
  },
  {
    kind: 'decision',
    loadBearing: true,
    confidence: 0.9,
    title:
      'gpt-5.6-luna stays the extraction primary; gpt-5-nano is rejected, and if revisited it must be a cascade rather than a swap',
    body: [
      'nano is $0.05/$0.40 against luna standard $0.20/$1.20, but nano is NOT listed for the flex tier while luna is. Against luna-on-flex at $0.10/$0.60 the gap is 2x, not the 4x the sticker prices suggest.',
      '',
      'At measured peak usage the swap saves $1.59 per seat per month; the flex plus reasoning plus caching optimisation saves $7.39. The optimisation is worth 4.6x the swap and carries no quality risk.',
      '',
      'Extraction is not a parse. It is judgment against up to 200 existing items - does this supersede item 47, duplicate it, or neither - and that judgment feeds standing rule 1 and the arbitration dataset BUSINESS.md calls the moat and says is not retrofittable. nano is a generation older (May 2024 cutoff) with 400K context against luna 1.05M.',
      '',
      'If revisited under MNE-180, build the cascade STACK.md:117 already sketches for Haiku: a cheap first pass with escalation to a larger model on low-confidence or contradiction candidates. Not a straight swap.',
      '',
      'The original luna-over-haiku choice was right and remains right: luna is 5x cheaper and has 5x the context. Haiku stays the fallback for vendor independence, which is a different property from being good at extraction - an OpenAI outage would otherwise take checkpoint down entirely, and checkpoint is the one operation that cannot degrade.',
    ].join('\n'),
  },
  {
    kind: 'decision',
    loadBearing: false,
    confidence: 0.9,
    title:
      'service_tier flex supersedes the async Batch API build, so no extraction job table, poller or queued-state UX is needed',
    body: [
      'Flex is the same price as batch, runs synchronously on /v1/responses, and the docs state it stacks with prompt-cache discounts. Batch would have required an extraction_job table, a poller with nothing in the app to run it, results writing into the review queue, and queued states across CLI and MCP - a PR on its own, landing on the checkpoint path MNE-100 just stabilised.',
      '',
      'Batch remains worth revisiting only for its separate rate-limit pool.',
    ].join('\n'),
  },
  {
    kind: 'constraint',
    loadBearing: true,
    confidence: 0.98,
    title:
      'Never enable the provider free-tokens-for-data-sharing programmes: transcripts are customer content',
    body: [
      'Both OpenAI and Anthropic offer free daily tokens in exchange for sharing prompts and completions for training. Session transcripts are customer content, so accepting would breach vision.md 11.1 and the published privacy policy.',
      '',
      'If it appears on a provider dashboard, the answer is no, and it is not a cost decision to be weighed.',
    ].join('\n'),
  },
  {
    kind: 'constraint',
    loadBearing: true,
    confidence: 0.95,
    title:
      'Redis is ruled out - the store is Postgres, and one dependency is what makes BYOC a conversation an enterprise buyer will have',
    body: [
      '.claude/rules/architecture.md is explicit: the store is Postgres, not Postgres plus a graph database plus Redis plus a queue. The stated reason is MNE-147, the M5 BYOC deployment.',
      '',
      'If a job queue is ever genuinely needed, Postgres-native options such as pg-boss or graphile-worker honour the rule. Choosing service_tier flex over the Batch API means we do not need one at all.',
    ].join('\n'),
  },
  {
    kind: 'fact',
    loadBearing: true,
    confidence: 0.95,
    title:
      'propose.ts ignores resolved from turnsSince, so a partial upload re-extracts turns already paid for - a 4-8x cost multiplier',
    body: [
      'Every cost figure in the tier model assumes each turn is extracted once. If this survives, multiply every COGS column by 4-8x and Pro goes underwater at any allowance.',
      '',
      'Fixing it naively re-creates MNE-100 and adds a worse bug. Two facts from the code. turnsSince with an empty array returns resolved false, because findIndex on an empty array is -1, and that is exactly the CLI watermark probe - so the guard must sit strictly AFTER the existing zero-pending-turns early return at propose.ts:96. And when a transcript has rotated, http-api.ts:664 uploads from index 0 with the watermark genuinely absent, so resolved is permanently false for that session and refusing to advance the watermark would mean it can never checkpoint again.',
      '',
      'The fix therefore needs an explicit escape hatch: CheckpointProposeWireSchema gains fromStart defaulting false, the CLI sets it where it computes start from marked, and the server refuses only when resolved is false AND fromStart is not true.',
    ].join('\n'),
  },
  {
    kind: 'fact',
    loadBearing: false,
    confidence: 0.85,
    title:
      'Anthropic runs a startup credits programme worth up to $100,000 with no equity and no VC requirement; OpenAI has no comparable self-serve equivalent',
    body: [
      'Applications are public and Anthropic states VC funding is not required. OpenAI routes credits through VCs and partners - roughly $2,500 via a Ramp account, $50,000 through the Grove programme.',
      '',
      'This is the most direct answer to the stated strategy of absorbing cost while acquiring customers: it is that absorption, paid by someone else, and it is an application form rather than an engineering task. It also makes the objection that Claude is 5x luna sticker price irrelevant for as long as the credits last.',
    ].join('\n'),
  },
  {
    kind: 'open_question',
    loadBearing: false,
    confidence: 0.9,
    title:
      'How many output tokens does an extraction actually use, and does prompt caching apply inside the flex tier?',
    body: [
      'checkpoint_usage.output_tokens has recorded the real value since migration 0029 and nothing reads it. The 3,000 estimate is the widest uncertainty in the cost model and it is the term the reasoning-effort lever acts on, so it decides whether effort low or none is right.',
      '',
      'Separately, the flex docs say tokens are priced at batch rates with additional discounts from prompt caching, but the batch docs do not state whether caching applies inside batch. The tier ladder is sized on flex-without-caching so that the answer is upside rather than a hole.',
    ].join('\n'),
  },
];

const INSERT = `
  insert into context_item
    (id, workspace_id, project_id, kind, title, body, status,
     asserted_by, asserted_at, source_ref, confidence,
     human_confirmed, load_bearing, access_scope, valid_from)
  values
    ($1, $2, $3, $4, $5, $6, 'active',
     $7, now(), $8, $9,
     false, $10, 'project', now())
`;

const EXISTS = `
  select id from context_item
   where workspace_id = $1 and project_id = $2 and title = $3 and valid_to is null
`;

const { Client } = require('pg');
const client = new Client({ connectionString });

process.stdout.write(
  `record:tier-findings: ${apply ? 'WRITING to' : 'dry run against'} ${describe(connectionString)}\n` +
    `  workspace ${workspace}\n  project   ${project}\n\n`,
);

await client.connect();

try {
  await client.query('select set_config($1, $2, true)', ['mneia.workspace_id', workspace]);

  // Actor kind is read from the database, never taken from a payload. These are agent
  // assertions and are written human_confirmed = false, so a person still confirms them.
  const { rows: actors } = await client.query(
    `select id, kind, display_name from actor
      where workspace_id = $1
      order by kind asc, created_at asc`,
    [workspace],
  );

  const requested = flagValue('--actor');
  const createAgent = flagValue('--create-agent-actor');
  let agents = actors.filter((row) => row.kind === 'agent');

  // Provisioning an agent actor is the narrow repair this script is allowed to make:
  // without one, every assertion an agent makes is stored as a human's, which disables
  // the §10.1 and §10.4 supersede guards and writes human_confirmed = true on work no
  // human confirmed. The durable fix is device authorization provisioning one per client.
  if (createAgent !== undefined && agents.length === 0) {
    const id = randomUUID();
    process.stdout.write(
      `  ${apply ? 'creating' : 'would create'} agent actor "${createAgent}" (${id})\n`,
    );
    if (apply) {
      await client.query(
        `insert into actor (id, workspace_id, kind, display_name, external_ref, identity_id)
         values ($1, $2, 'agent', $3, $4, null)`,
        [id, workspace, createAgent, `agent:${createAgent.toLowerCase().replaceAll(/\s+/g, '-')}`],
      );
      agents = [{ id, kind: 'agent', display_name: createAgent }];
    } else {
      agents = [{ id: '(pending --apply)', kind: 'agent', display_name: createAgent }];
    }
  }

  const actor = requested === undefined ? agents[0] : actors.find((row) => row.id === requested);

  if (actor === undefined) {
    process.stderr.write('record:tier-findings: actors in this workspace\n');
    for (const row of actors) {
      process.stderr.write(`  ${row.kind.padEnd(6)} ${row.id}  ${row.display_name}\n`);
    }
    fail(
      requested === undefined
        ? '\n  found no actor of kind agent, and these are agent assertions.\n' +
            '  Pass --actor <uuid> naming the actor to attribute them to. Note that choosing a\n' +
            '  human actor makes them look human-asserted, which is what standing rule 1 and the\n' +
            '  arbitration dataset depend on being accurate - prefer an agent actor.'
        : `\n  --actor ${requested} is not an actor in this workspace.`,
    );
  }

  if (actor.kind !== 'agent') {
    process.stdout.write(
      `  WARNING: ${actor.display_name} is kind "${actor.kind}", not agent. These items are\n` +
        '  written human_confirmed = false regardless, so they still queue for review.\n',
    );
  }

  process.stdout.write(`  asserting as agent actor "${actor.display_name}" (${actor.id})\n\n`);

  let written = 0;
  let skipped = 0;

  for (const finding of FINDINGS) {
    const { rows } = await client.query(EXISTS, [workspace, project, finding.title]);
    if (rows.length > 0) {
      process.stdout.write(`  skip    [${finding.kind}] ${finding.title.slice(0, 76)}\n`);
      skipped += 1;
      continue;
    }

    const label = finding.loadBearing ? `${finding.kind}, load-bearing` : finding.kind;
    process.stdout.write(
      `  ${apply ? 'write ' : 'would '} [${label}] ${finding.title.slice(0, 76)}\n`,
    );

    if (apply) {
      await client.query(INSERT, [
        randomUUID(),
        workspace,
        project,
        finding.kind,
        finding.title,
        finding.body,
        actor.id,
        SOURCE_REF,
        finding.confidence,
        finding.loadBearing,
      ]);
    }
    written += 1;
  }

  process.stdout.write(
    `\nrecord:tier-findings: ${apply ? `wrote ${written}` : `${written} would be written`}, ${skipped} already present\n`,
  );
  if (!apply) {
    process.stdout.write('  Re-run with --apply to write them.\n');
  }
} finally {
  await client.end();
}
