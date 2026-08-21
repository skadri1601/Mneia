import type { ContextItem, Embedding, IntervalMs, Uuid } from '../../domain/types.js';
import type { ItemKind, ItemStatus } from '../../store/schema.js';
import type { GoldenCorpus } from './types.js';

export const EVAL_NOW = new Date('2026-08-01T00:00:00.000Z');

export const EVAL_WORKSPACE_ID: Uuid = '0eva1000-0000-4000-8000-000000000001';
export const EVAL_PROJECT_ID: Uuid = '0eva1000-0000-4000-8000-000000000002';
export const EVAL_HUMAN_ACTOR_ID: Uuid = '0eva1000-0000-4000-8000-000000000003';
export const EVAL_AGENT_ACTOR_ID: Uuid = '0eva1000-0000-4000-8000-000000000004';

export const EVAL_EMBEDDING_MODEL = 'mneia-eval-topic-v1';

export const TOPIC_AXES = [
  'payments',
  'auth',
  'database',
  'frontend',
  'deploy',
  'testing',
  'billing',
  'docs',
] as const;

export type Topic = (typeof TOPIC_AXES)[number];

export const SHARED_LANGUAGE_AXIS = 0.6;

export type TopicWeights = Partial<Record<Topic, number>>;

export function topicEmbedding(topics: TopicWeights): Embedding {
  return [...TOPIC_AXES.map((axis) => topics[axis] ?? 0), SHARED_LANGUAGE_AXIS];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const fnv1a = (text: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const hex8 = (value: number): string => value.toString(16).padStart(8, '0');

export function evalItemId(slug: string): Uuid {
  const a = hex8(fnv1a(slug, 0x811c9dc5));
  const b = hex8(fnv1a(slug, 0x1b873593));
  const c = hex8(fnv1a(slug, 0x85ebca6b));
  const d = hex8(fnv1a(slug, 0xc2b2ae35));
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${d}`;
}

interface ItemSpec {
  readonly slug: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body: string;
  readonly topics: TopicWeights;
  readonly ageDays: number;
  readonly confidence: number;
  readonly by: 'human' | 'agent';
  readonly humanConfirmed: boolean;
  readonly loadBearing?: boolean;
  readonly status?: ItemStatus;
  readonly decayAfterDays?: number;
  readonly lastVerifiedAgeDays?: number;
  readonly validToAgeDays?: number;
  readonly supersedesSlug?: string;
  readonly supersedeReason?: string;
}

const SPECS: readonly ItemSpec[] = [
  {
    slug: 'c-no-downtime',
    kind: 'constraint',
    title: 'Cutover must be online; no downtime window is available',
    body: 'Merchants settle continuously, so the ledger cutover has to run against live traffic. Any plan that needs a maintenance window is rejected.',
    topics: { payments: 0.9, deploy: 0.5 },
    ageDays: 40,
    confidence: 0.95,
    by: 'human',
    humanConfirmed: true,
    loadBearing: true,
  },
  {
    slug: 'c-idempotency-namespaced',
    kind: 'constraint',
    title: 'Idempotency keys are namespaced per merchant, never global',
    body: 'Two merchants may legitimately submit the same client-supplied key. Collisions across merchants silently drop a charge, so the namespace is part of the key.',
    topics: { payments: 1 },
    ageDays: 32,
    confidence: 0.9,
    by: 'human',
    humanConfirmed: true,
    loadBearing: true,
  },
  {
    slug: 'c-pii-never-logged',
    kind: 'constraint',
    title: 'Card PAN and CVV never enter logs, telemetry, or error payloads',
    body: 'Redaction happens before the value reaches a logger. A stack trace carrying a PAN is a reportable incident, not a debugging convenience.',
    topics: { payments: 0.6, auth: 0.4, billing: 0.3 },
    ageDays: 120,
    confidence: 1,
    by: 'human',
    humanConfirmed: true,
    loadBearing: true,
  },
  {
    slug: 'c-rls-mandatory',
    kind: 'constraint',
    title: 'Every tenant table carries workspace_id and row-level security is mandatory',
    body: 'Isolation is enforced by Postgres policies keyed on a session GUC, not by query discipline. A table without a policy is not shippable.',
    topics: { database: 1, auth: 0.5 },
    ageDays: 25,
    confidence: 0.95,
    by: 'human',
    humanConfirmed: true,
    loadBearing: true,
  },
  {
    slug: 'c-node-20',
    kind: 'constraint',
    title: 'The deploy image is pinned to Node 20',
    body: 'The native pg build in the image is compiled against Node 20. Bumping the runtime without rebuilding the image breaks the container at boot.',
    topics: { deploy: 0.9, testing: 0.2 },
    ageDays: 60,
    confidence: 0.7,
    by: 'agent',
    humanConfirmed: false,
    loadBearing: true,
  },
  {
    slug: 'c-dual-read-14d',
    kind: 'constraint',
    title: 'The dual-read window is 14 days, not 7',
    body: 'Month-end reconciliation needs a full cycle inside the window. Shortening it strands the reconciliation job on the old read path.',
    topics: { payments: 0.8, database: 0.4 },
    ageDays: 22,
    confidence: 0.9,
    by: 'human',
    humanConfirmed: true,
    loadBearing: true,
    supersedesSlug: 'c-dual-read-7d',
  },
  {
    slug: 'c-dual-read-7d',
    kind: 'constraint',
    title: 'The dual-read window is 7 days',
    body: 'Original cutover plan assumed a week of dual reads was enough to catch drift.',
    topics: { payments: 0.8, database: 0.4 },
    ageDays: 45,
    confidence: 0.7,
    by: 'human',
    humanConfirmed: true,
    status: 'superseded',
    supersedeReason: 'reconciliation needs a full month-end cycle inside the window',
  },
  {
    slug: 'c-biome-only',
    kind: 'constraint',
    title: 'Formatting and lint are Biome; do not add Prettier or ESLint',
    body: 'Two formatters fight over the same files and make every diff unreadable. CI runs biome only.',
    topics: { testing: 0.4, docs: 0.3 },
    ageDays: 15,
    confidence: 0.6,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'c-dependency-review',
    kind: 'constraint',
    title: 'A new runtime dependency needs review before it lands',
    body: 'Every added dependency is a supply-chain surface and a bundle cost. Dev dependencies are exempt.',
    topics: { deploy: 0.4, docs: 0.3, testing: 0.2 },
    ageDays: 70,
    confidence: 0.8,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'd-advisory-lock',
    kind: 'decision',
    title: 'Postgres advisory locks over Redis for the cutover lock',
    body: 'We already page on Postgres. Adding Redis to the critical path was rejected because it doubles the number of things that can take payments down.',
    topics: { payments: 0.7, database: 0.8 },
    ageDays: 30,
    confidence: 0.9,
    by: 'human',
    humanConfirmed: true,
    supersedesSlug: 'd-redis-lock',
  },
  {
    slug: 'd-redis-lock',
    kind: 'decision',
    title: 'Redis-based cutover lock',
    body: 'Redis SETNX with a TTL was the first proposal for coordinating the cutover across workers.',
    topics: { payments: 0.6, database: 0.7 },
    ageDays: 48,
    confidence: 0.6,
    by: 'agent',
    humanConfirmed: false,
    status: 'superseded',
    supersedeReason: 'rejected: adds a second datastore to the payments critical path',
  },
  {
    slug: 'd-stripe-webhook-ordering',
    kind: 'decision',
    title: 'Treat Stripe webhook delivery as unordered',
    body: 'Ordering is not guaranteed and retries interleave. The worker reconciles by event id and timestamp instead of assuming arrival order.',
    topics: { payments: 1, billing: 0.3 },
    ageDays: 18,
    confidence: 0.75,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'd-clerk-auth',
    kind: 'decision',
    title: 'Clerk for authentication rather than rolling our own',
    body: 'Session handling, MFA, and the org model are all bought rather than built. The tradeoff is a hard dependency on their availability.',
    topics: { auth: 1, frontend: 0.3 },
    ageDays: 55,
    confidence: 0.9,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'd-neon-postgres',
    kind: 'decision',
    title: 'Neon serverless Postgres is the hosted engine',
    body: 'Branching per pull request and scale-to-zero decided it. There is no second engine and no local database.',
    topics: { database: 1, deploy: 0.4 },
    ageDays: 90,
    confidence: 0.95,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'd-direct-connection-migrations',
    kind: 'decision',
    title: 'Migrations use the direct Neon connection, never the pooler',
    body: 'The runner holds a session-level advisory lock for the whole run and the pooled endpoint can move the server connection between statements.',
    topics: { database: 0.9, deploy: 0.5 },
    ageDays: 8,
    confidence: 0.9,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'd-design-tokens-css',
    kind: 'decision',
    title: 'Design tokens live in CSS custom properties, not a theme library',
    body: 'The app renders in the viewer theme without a runtime, and tokens stay readable in devtools.',
    topics: { frontend: 1 },
    ageDays: 12,
    confidence: 0.7,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'd-vitest',
    kind: 'decision',
    title: 'Vitest over Jest as the test runner',
    body: 'ESM support and the shared transform pipeline with the build made it the cheaper option.',
    topics: { testing: 1 },
    ageDays: 100,
    confidence: 0.9,
    by: 'human',
    humanConfirmed: true,
    supersedesSlug: 'd-jest',
  },
  {
    slug: 'd-jest',
    kind: 'decision',
    title: 'Jest as the test runner',
    body: 'Chosen early for familiarity before the workspace moved to native ESM.',
    topics: { testing: 1 },
    ageDays: 140,
    confidence: 0.6,
    by: 'agent',
    humanConfirmed: false,
    status: 'superseded',
    supersedeReason: 'ESM transform cost was not worth the familiarity',
  },
  {
    slug: 'd-stripe-billing',
    kind: 'decision',
    title: 'Stripe Billing for subscriptions with metered usage layered on top',
    body: 'Seats are a subscription item and usage is reported per period. Invoicing and dunning are not ours to build.',
    topics: { billing: 1, payments: 0.6 },
    ageDays: 20,
    confidence: 0.85,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'd-blue-green-deploys',
    kind: 'decision',
    title: 'Blue-green deploys behind a health gate',
    body: 'The new container must answer the health endpoint before traffic moves. A failed gate leaves the old container serving.',
    topics: { deploy: 1, testing: 0.3 },
    ageDays: 35,
    confidence: 0.7,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'd-keep-monolith',
    kind: 'decision',
    title: 'Keep the monolith rather than splitting services',
    body: 'Retired after the hosted rewrite made the deployment shape irrelevant.',
    topics: { deploy: 0.6, database: 0.3 },
    ageDays: 300,
    confidence: 0.5,
    by: 'human',
    humanConfirmed: true,
    status: 'retired',
  },
  {
    slug: 'q-backfill-owner',
    kind: 'open_question',
    title: 'Who owns the backfill for pre-2024 charges?',
    body: 'Unassigned since the cutover plan was written. The backfill blocks retiring the old read path.',
    topics: { payments: 0.8, database: 0.4 },
    ageDays: 28,
    confidence: 0.5,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'q-eu-dual-read',
    kind: 'open_question',
    title: 'Do EU entities need a longer dual-read window?',
    body: 'Raised by an agent while reading the settlement calendar. Unverified against the actual EU reconciliation schedule.',
    topics: { payments: 0.7, database: 0.3 },
    ageDays: 10,
    confidence: 0.4,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'q-seat-or-project-metering',
    kind: 'open_question',
    title: 'Do we meter seats or active projects?',
    body: 'Seats are easier to explain; active projects track value more closely. Pricing page copy is blocked on this.',
    topics: { billing: 1 },
    ageDays: 14,
    confidence: 0.5,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'q-mobile-nav-drawer',
    kind: 'open_question',
    title: 'Does the mobile navigation need a drawer?',
    body: 'The current inline nav wraps to three lines under 380px. A drawer is one option; a condensed row is another.',
    topics: { frontend: 1 },
    ageDays: 6,
    confidence: 0.4,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'q-rls-hot-path-cost',
    kind: 'open_question',
    title: 'Does forcing row-level security cost us on the hot read path?',
    body: 'No measurement yet. The policy predicate is an equality on an indexed column, so the expectation is that it is cheap.',
    topics: { database: 0.9, testing: 0.3 },
    ageDays: 5,
    confidence: 0.45,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'f-webhook-latency',
    kind: 'fact',
    title: 'Stripe webhook p95 delivery latency is 4.2 seconds',
    body: 'Measured over a week of production traffic. The retry worker budget assumes this number.',
    topics: { payments: 0.9, billing: 0.3 },
    ageDays: 3,
    confidence: 0.8,
    by: 'agent',
    humanConfirmed: false,
    decayAfterDays: 14,
  },
  {
    slug: 'f-webhook-latency-restated',
    kind: 'fact',
    title: 'Webhook delivery p95 measured at 4.2s',
    body: 'Re-extracted from a later session; same measurement, different wording.',
    topics: { payments: 0.9, billing: 0.3 },
    ageDays: 2,
    confidence: 0.75,
    by: 'agent',
    humanConfirmed: false,
    decayAfterDays: 14,
  },
  {
    slug: 'f-ledger-row-count',
    kind: 'fact',
    title: 'The ledger table holds 41 million rows',
    body: 'Any migration that rewrites the table is an hours-long operation, not a minutes-long one.',
    topics: { database: 0.9, payments: 0.5 },
    ageDays: 9,
    confidence: 0.8,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'f-migration-0031-runtime',
    kind: 'fact',
    title: 'Migration 0031 took 11 minutes on staging',
    body: 'The index build dominated. Production has roughly three times the rows.',
    topics: { database: 0.8, deploy: 0.4 },
    ageDays: 4,
    confidence: 0.85,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'f-ci-build-minutes',
    kind: 'fact',
    title: 'CI build takes 6 minutes',
    body: 'Measured before the workspace was split into packages and apps.',
    topics: { testing: 0.6, deploy: 0.5 },
    ageDays: 200,
    confidence: 0.7,
    by: 'agent',
    humanConfirmed: false,
    decayAfterDays: 14,
  },
  {
    slug: 'f-clerk-jwt-ttl',
    kind: 'fact',
    title: 'The Clerk session JWT has a 60 second TTL',
    body: 'Server components must tolerate a token that expires mid-render and refresh rather than throw.',
    topics: { auth: 1, frontend: 0.3 },
    ageDays: 26,
    confidence: 0.8,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'f-marketing-lighthouse',
    kind: 'fact',
    title: 'Marketing site Lighthouse performance is 96',
    body: 'Measured on the deployed Worker, mobile profile.',
    topics: { frontend: 0.8, docs: 0.3 },
    ageDays: 33,
    confidence: 0.7,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'f-mrr-zero',
    kind: 'fact',
    title: 'MRR is zero; nothing is charged yet',
    body: 'Billing is wired end to end in test mode. No live customer has been invoiced.',
    topics: { billing: 1 },
    ageDays: 16,
    confidence: 1,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'f-production-region',
    kind: 'fact',
    title: 'Production runs in aws-us-east-1',
    body: 'Database, app container, and object storage are all in the same region.',
    topics: { deploy: 0.9, database: 0.4 },
    ageDays: 75,
    confidence: 0.95,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'f-refund-window',
    kind: 'fact',
    title: 'The refund window is 90 days',
    body: 'One session asserted 90 days and another asserted 60. Both are human assertions and neither has been resolved.',
    topics: { payments: 0.8, billing: 0.5 },
    ageDays: 11,
    confidence: 0.6,
    by: 'human',
    humanConfirmed: true,
    status: 'disputed',
  },
  {
    slug: 'f-worker-rate-limit',
    kind: 'fact',
    title: 'The charge worker is rate limited to 100 requests per second',
    body: 'Superseded by an infrastructure change; the row is no longer valid as of five days ago.',
    topics: { payments: 0.7, deploy: 0.4 },
    ageDays: 60,
    confidence: 0.7,
    by: 'agent',
    humanConfirmed: false,
    validToAgeDays: 5,
  },
  {
    slug: 'a-pr-2841',
    kind: 'artifact_ref',
    title: 'PR #2841 — ledger cutover',
    body: 'The dual-write path and the reconciliation job land here.',
    topics: { payments: 0.8, database: 0.4 },
    ageDays: 7,
    confidence: 0.7,
    by: 'agent',
    humanConfirmed: false,
  },
  {
    slug: 'a-adr-017',
    kind: 'artifact_ref',
    title: 'ADR-017 — idempotency key namespacing',
    body: 'The written form of the per-merchant namespace rule, including the migration that backfills existing keys.',
    topics: { payments: 0.9, docs: 0.4 },
    ageDays: 34,
    confidence: 0.9,
    by: 'human',
    humanConfirmed: true,
  },
  {
    slug: 'a-deploy-runbook',
    kind: 'artifact_ref',
    title: 'Runbook — blue-green deploy and rollback',
    body: 'Step order for promoting a container and for reverting when the health gate fails.',
    topics: { deploy: 1, docs: 0.4 },
    ageDays: 44,
    confidence: 0.85,
    by: 'human',
    humanConfirmed: true,
  },
];

const daysAgo = (days: number): Date => new Date(EVAL_NOW.getTime() - days * DAY_MS);

const intervalOrNull = (days: number | undefined): IntervalMs | null =>
  days === undefined ? null : days * DAY_MS;

const dateOrNull = (days: number | undefined): Date | null =>
  days === undefined ? null : daysAgo(days);

function toContextItem(spec: ItemSpec): ContextItem {
  const assertedAt = daysAgo(spec.ageDays);
  return {
    id: evalItemId(spec.slug),
    workspaceId: EVAL_WORKSPACE_ID,
    projectId: EVAL_PROJECT_ID,
    kind: spec.kind,
    title: spec.title,
    body: spec.body,
    status: spec.status ?? 'active',
    assertedBy: spec.by === 'human' ? EVAL_HUMAN_ACTOR_ID : EVAL_AGENT_ACTOR_ID,
    assertedAt,
    sourceSessionId: null,
    sourceRef: spec.slug,
    confidence: spec.confidence,
    humanConfirmed: spec.humanConfirmed,
    loadBearing: spec.loadBearing ?? false,
    lastVerifiedAt: dateOrNull(spec.lastVerifiedAgeDays),
    decayAfter: intervalOrNull(spec.decayAfterDays),
    validFrom: assertedAt,
    validTo: dateOrNull(spec.validToAgeDays),
    supersedesId: spec.supersedesSlug === undefined ? null : evalItemId(spec.supersedesSlug),
    supersededById: null,
    accessScope: 'project',
    embedding: topicEmbedding(spec.topics),
    embeddingModel: EVAL_EMBEDDING_MODEL,
    supersedeReason: spec.supersedeReason ?? null,
  };
}

function linkSupersessions(items: readonly ContextItem[]): readonly ContextItem[] {
  const successorByPredecessor = new Map<Uuid, Uuid>();
  for (const item of items) {
    if (item.supersedesId !== null) {
      successorByPredecessor.set(item.supersedesId, item.id);
    }
  }
  return items.map((item) => {
    const successor = successorByPredecessor.get(item.id);
    return successor === undefined ? item : { ...item, supersededById: successor };
  });
}

export const CORPUS_CONSTRUCTION = [
  'Forty context_item rows shaped like one quarter of a payments-platform project memory:',
  'nine constraints (six active and load_bearing, one superseded by its replacement),',
  'twelve decisions across two supersession chains, five open questions, eleven facts',
  '(including one near-duplicate pair, one stale fact past its decay_after, one disputed',
  'row and one row whose valid_to has passed) and three artifact refs.',
  'Every timestamp is a fixed offset in whole days from EVAL_NOW, every id is an FNV-1a',
  'hash of the item slug, and every embedding is a hand-authored vector over eight topic',
  'axes plus a constant shared-language axis of 0.6, so cosine similarity between unrelated',
  'items floors near 0.3 the way a real sentence embedding does instead of at 0.',
  'Nothing here reads the clock, a random source, or an embedding provider.',
].join(' ');

export const GOLDEN_CORPUS: GoldenCorpus = {
  id: 'payments-platform-q3',
  now: EVAL_NOW,
  embeddingModel: EVAL_EMBEDDING_MODEL,
  construction: CORPUS_CONSTRUCTION,
  items: linkSupersessions(SPECS.map(toContextItem)),
};

export function itemBySlug(slug: string): ContextItem {
  const id = evalItemId(slug);
  const found = GOLDEN_CORPUS.items.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(
      `no golden corpus item has the slug "${slug}"; expected one of the slugs declared in corpus.ts — add the item or fix the slug in the golden task`,
    );
  }
  return found;
}

export function idOf(slug: string): Uuid {
  return itemBySlug(slug).id;
}

export function slugOf(id: Uuid): string {
  const found = GOLDEN_CORPUS.items.find((item) => item.id === id);
  if (found === undefined || found.sourceRef === null) {
    throw new Error(
      `no golden corpus item has the id "${id}"; ids come from evalItemId(slug) — pass an id produced by the corpus, not a literal`,
    );
  }
  return found.sourceRef;
}
