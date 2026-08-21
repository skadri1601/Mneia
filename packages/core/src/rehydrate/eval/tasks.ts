import type { Uuid } from '../../domain/types.js';
import { idOf, topicEmbedding } from './corpus.js';
import type { GoldenTask, RelevanceGrade } from './types.js';

export const GROUND_TRUTH_RULE = [
  'Relevance was assigned by hand, before any configuration was scored, using one rule.',
  'Grade 2 means an agent that does not see the item produces wrong work on this task —',
  'it violates a rule, rebuilds a rejected approach, or contradicts a measured number.',
  'Grade 1 means the item saves the agent a lookup but its absence does not cause a defect.',
  'Everything else is grade 0. intendedTop orders the head of the ranking by the same rule:',
  'an active load_bearing constraint the task can violate first, then human_confirmed',
  'decisions on the task topic, then agent decisions and artifact refs on the topic; ties',
  'inside a tier break on closer topical match and then on recency. It is a judgement about',
  'what a rehydration slice owes the task, not a transcript of what any ranker produced.',
].join(' ');

type SlugGrades = Readonly<Record<string, RelevanceGrade>>;

function relevanceOf(grades: SlugGrades): Readonly<Record<Uuid, RelevanceGrade>> {
  const byId: Record<Uuid, RelevanceGrade> = {};
  for (const [slug, grade] of Object.entries(grades)) {
    byId[idOf(slug)] = grade;
  }
  return byId;
}

function topOf(slugs: readonly string[]): readonly Uuid[] {
  return slugs.map(idOf);
}

export const GOLDEN_TASKS: readonly GoldenTask[] = [
  {
    id: 'payments-retry-path',
    task: 'Wire the retry path in the charge worker to the new idempotency key.',
    taskEmbedding: topicEmbedding({ payments: 1, database: 0.2 }),
    tokenBudget: 800,
    relevance: relevanceOf({
      'c-idempotency-namespaced': 2,
      'a-adr-017': 2,
      'd-stripe-webhook-ordering': 2,
      'c-no-downtime': 2,
      'c-pii-never-logged': 2,
      'd-advisory-lock': 1,
      'c-dual-read-14d': 1,
      'a-pr-2841': 1,
      'f-webhook-latency': 1,
      'q-eu-dual-read': 1,
      'q-backfill-owner': 1,
      'd-redis-lock': 1,
      'c-dual-read-7d': 1,
    }),
    intendedTop: topOf([
      'c-idempotency-namespaced',
      'c-no-downtime',
      'c-pii-never-logged',
      'a-adr-017',
    ]),
    groundTruth: GROUND_TRUTH_RULE,
  },
  {
    id: 'workspace-index-migration',
    task: 'Add a workspace-scoped index to the context_item table and ship the migration.',
    taskEmbedding: topicEmbedding({ database: 1, deploy: 0.4 }),
    tokenBudget: 800,
    relevance: relevanceOf({
      'c-rls-mandatory': 2,
      'd-direct-connection-migrations': 2,
      'd-neon-postgres': 2,
      'c-no-downtime': 2,
      'f-ledger-row-count': 1,
      'f-migration-0031-runtime': 1,
      'q-rls-hot-path-cost': 1,
      'd-advisory-lock': 1,
      'c-node-20': 1,
      'f-production-region': 1,
    }),
    intendedTop: topOf([
      'c-rls-mandatory',
      'c-no-downtime',
      'd-neon-postgres',
      'd-direct-connection-migrations',
    ]),
    groundTruth: GROUND_TRUTH_RULE,
  },
  {
    id: 'metered-billing',
    task: 'Turn on Stripe metered billing for the team plan.',
    taskEmbedding: topicEmbedding({ billing: 1, payments: 0.5 }),
    tokenBudget: 800,
    relevance: relevanceOf({
      'd-stripe-billing': 2,
      'c-pii-never-logged': 2,
      'f-mrr-zero': 2,
      'q-seat-or-project-metering': 1,
      'c-idempotency-namespaced': 1,
      'd-stripe-webhook-ordering': 1,
      'f-webhook-latency': 1,
    }),
    intendedTop: topOf([
      'c-pii-never-logged',
      'd-stripe-billing',
      'f-mrr-zero',
      'q-seat-or-project-metering',
    ]),
    groundTruth: GROUND_TRUTH_RULE,
  },
  {
    id: 'workspace-settings-page',
    task: 'Build the workspace settings page in the web app.',
    taskEmbedding: topicEmbedding({ frontend: 1, auth: 0.6 }),
    tokenBudget: 400,
    relevance: relevanceOf({
      'c-rls-mandatory': 2,
      'd-clerk-auth': 2,
      'd-design-tokens-css': 1,
      'f-clerk-jwt-ttl': 1,
      'q-mobile-nav-drawer': 1,
      'f-marketing-lighthouse': 1,
    }),
    intendedTop: topOf([
      'c-rls-mandatory',
      'd-clerk-auth',
      'd-design-tokens-css',
      'f-clerk-jwt-ttl',
    ]),
    groundTruth: GROUND_TRUTH_RULE,
  },
  {
    id: 'release-cut',
    task: 'Cut the release: run the deploy and verify the health gate.',
    taskEmbedding: topicEmbedding({ deploy: 1, testing: 0.4 }),
    tokenBudget: 800,
    relevance: relevanceOf({
      'c-node-20': 2,
      'd-blue-green-deploys': 2,
      'a-deploy-runbook': 2,
      'c-no-downtime': 2,
      'f-production-region': 1,
      'd-direct-connection-migrations': 1,
      'f-ci-build-minutes': 1,
      'd-vitest': 1,
      'c-biome-only': 1,
    }),
    intendedTop: topOf(['c-no-downtime', 'c-node-20', 'd-blue-green-deploys', 'a-deploy-runbook']),
    groundTruth: GROUND_TRUTH_RULE,
  },
];
