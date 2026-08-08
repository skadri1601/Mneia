#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const envFile = new URL('../.env', import.meta.url);

if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  process.stderr.write(
    'funnel-report: expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      `  Copy ${repoRoot}.env.example to .env and fill in a connection string,\n` +
      '  or prefix the command: DATABASE_URL=postgres://... pnpm funnel:report\n',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const ACTIVE_USE_CHECKPOINTS = 3;
const RETENTION_DAY = 8;
const KILL_CRITERION_RATE = 0.01;

const { Client } = require('pg');

const rowsOf = async (client, sql, params = []) => (await client.query(sql, params)).rows;

const num = (value) => (value === null || value === undefined ? 0 : Number(value));

const STAGE_SQL = `
WITH activity AS (
  SELECT workspace_id, min(created_at) AS first_at, max(created_at) AS last_at, count(*) AS checkpoints
    FROM checkpoint
   GROUP BY workspace_id
),
shared_writes AS (
  SELECT workspace_id
    FROM (
      SELECT workspace_id, project_id, count(DISTINCT asserted_by) AS writers
        FROM context_item
       GROUP BY workspace_id, project_id
    ) AS per_project
   WHERE writers >= 2
   GROUP BY workspace_id
),
invited AS (
  SELECT DISTINCT workspace_id FROM workspace_invitation
)
SELECT w.id,
       w.slug,
       w.plan,
       w.billing_status,
       w.created_at,
       coalesce(a.checkpoints, 0)                         AS checkpoints,
       a.first_at,
       a.last_at,
       (i.workspace_id IS NOT NULL)                       AS invited,
       (s.workspace_id IS NOT NULL)                       AS shared_write
  FROM workspace AS w
  LEFT JOIN activity      AS a ON a.workspace_id = w.id
  LEFT JOIN invited       AS i ON i.workspace_id = w.id
  LEFT JOIN shared_writes AS s ON s.workspace_id = w.id
 ORDER BY w.created_at ASC`;

const stagesFor = (row) => {
  const checkpoints = num(row.checkpoints);
  const installed = checkpoints > 0;
  const activeUse = checkpoints >= ACTIVE_USE_CHECKPOINTS;

  const retained =
    row.first_at !== null &&
    row.last_at !== null &&
    (row.last_at.getTime() - row.first_at.getTime()) / 86_400_000 >= RETENTION_DAY - 1;

  const pays = row.plan === 'team' && ['active', 'trialing'].includes(row.billing_status);

  return {
    installed,
    activeUse,
    retained,
    invited: row.invited === true,
    sharedWrite: row.shared_write === true,
    pays,
  };
};

const STAGES = [
  ['signed up', () => true],
  ['installed and checkpointed', (s) => s.installed],
  [`active use (${ACTIVE_USE_CHECKPOINTS}+ checkpoints)`, (s) => s.activeUse],
  [`retained past day ${RETENTION_DAY}`, (s) => s.retained],
  ['invited a teammate', (s) => s.invited],
  ['a second actor wrote to a shared project', (s) => s.sharedWrite],
  ['pays', (s) => s.pays],
];

const pct = (part, whole) => (whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`);

function render(report) {
  const lines = [];
  const w = (line = '') => lines.push(line);

  w('Individual-to-team conversion funnel (MNE-143)');
  w();
  w('§17 names this one of two business metrics that decide funding, and §18 makes it the');
  w('primary kill criterion: under 1% conversion after 12 months with meaningful top of funnel.');
  w('The stage where it collapses says what to fix.');
  w();

  const total = report.workspaces;
  if (total === 0) {
    w('No workspaces yet, so there is no funnel to read.');
    return lines.join('\n');
  }

  let previous = total;
  for (const stage of report.stages) {
    const dropFromPrevious = previous === 0 ? 'n/a' : pct(stage.count, previous);
    w(
      `  ${stage.name.padEnd(42)} ${String(stage.count).padStart(5)}   ${pct(stage.count, total).padStart(7)} of all   ${dropFromPrevious.padStart(7)} of previous`,
    );
    previous = stage.count;
  }

  w();
  const conversion = report.conversionRate;
  w(
    `  conversion, signed up to paying   ${conversion === null ? 'n/a' : pct(report.paying, total)}`,
  );

  if (report.paying === 0) {
    w('  Nothing pays yet. Stripe is wired but not live, so this is the expected reading and');
    w('  the §18 criterion cannot be evaluated from it.');
  } else if (conversion !== null && conversion < KILL_CRITERION_RATE) {
    w(
      `  Below the §18 threshold of ${KILL_CRITERION_RATE * 100}%. That is a kill criterion, not a metric to watch.`,
    );
  }

  const worst = report.biggestDrop;
  if (worst !== null) {
    w();
    w(`  Biggest drop: ${worst.from} to ${worst.to}, losing ${worst.lost} of ${worst.entered}.`);
  }

  return lines.join('\n');
}

const client = new Client({ connectionString });

try {
  await client.connect();
  const rows = await rowsOf(client, STAGE_SQL);
  const flags = rows.map(stagesFor);
  const total = rows.length;

  const stages = STAGES.map(([name, predicate]) => ({
    name,
    count: flags.filter((entry) => predicate(entry)).length,
  }));

  let biggestDrop = null;
  for (let index = 1; index < stages.length; index += 1) {
    const entered = stages[index - 1].count;
    const lost = entered - stages[index].count;
    if (entered > 0 && (biggestDrop === null || lost > biggestDrop.lost)) {
      biggestDrop = {
        from: stages[index - 1].name,
        to: stages[index].name,
        lost,
        entered,
      };
    }
  }

  const paying = stages[stages.length - 1].count;

  const report = {
    workspaces: total,
    stages,
    paying,
    conversionRate: total === 0 ? null : paying / total,
    biggestDrop,
  };

  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
} catch (error) {
  process.stderr.write(
    `funnel-report: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
