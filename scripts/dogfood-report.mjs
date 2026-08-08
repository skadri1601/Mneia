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
    'dogfood-report: expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      `  Copy ${repoRoot}.env.example to .env and fill in a connection string,\n` +
      '  or prefix the command: DATABASE_URL=postgres://... pnpm dogfood:report\n',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const daysArg = args.find((arg) => arg.startsWith('--days='));
const days = daysArg === undefined ? 30 : Number(daysArg.slice('--days='.length));

if (!Number.isInteger(days) || days < 1) {
  process.stderr.write(`dogfood-report: --days must be a positive integer; received ${daysArg}\n`);
  process.exit(1);
}

const { Client } = require('pg');

const rowsOf = async (client, sql, params = []) => (await client.query(sql, params)).rows;

const percentile = (sorted, fraction) => {
  if (sorted.length === 0) {
    return null;
  }
  const rank = Math.ceil(sorted.length * fraction) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
};

const num = (value) => (value === null || value === undefined ? 0 : Number(value));

const ratio = (part, whole) => (whole === 0 ? null : Number((part / whole).toFixed(4)));

async function readQuality(client, since) {
  const rows = await rowsOf(
    client,
    `SELECT name,
            occurred_at,
            payload->>'itemId'       AS item_id,
            payload->>'checkpointId' AS checkpoint_id,
            payload->'fieldsChanged' AS fields_changed
       FROM telemetry_event
      WHERE occurred_at >= $1
        AND name IN ('checkpoint.item_extracted',
                     'checkpoint.item_confirmed',
                     'checkpoint.item_edited',
                     'checkpoint.item_rejected')
      ORDER BY occurred_at ASC`,
    [since],
  );

  const extracted = new Map();
  const reviews = new Map();

  for (const row of rows) {
    const itemId = row.item_id;
    if (itemId === null) {
      continue;
    }
    if (row.name === 'checkpoint.item_extracted') {
      if (!extracted.has(itemId)) {
        extracted.set(itemId, { checkpointId: row.checkpoint_id, at: row.occurred_at });
      }
      continue;
    }
    reviews.set(itemId, {
      outcome: row.name.slice('checkpoint.item_'.length),
      at: row.occurred_at,
      checkpointId: row.checkpoint_id,
      fieldsChanged: Array.isArray(row.fields_changed) ? row.fields_changed : [],
    });
  }

  const byDay = new Map();
  const fields = new Map();
  let confirmed = 0;
  let edited = 0;
  let rejected = 0;

  for (const review of reviews.values()) {
    if (review.outcome === 'confirmed') confirmed += 1;
    else if (review.outcome === 'edited') edited += 1;
    else rejected += 1;

    const day = review.at.toISOString().slice(0, 10);
    const tally = byDay.get(day) ?? { confirmed: 0, reviewed: 0 };
    tally.reviewed += 1;
    if (review.outcome === 'confirmed') tally.confirmed += 1;
    byDay.set(day, tally);

    for (const field of review.fieldsChanged) {
      fields.set(field, (fields.get(field) ?? 0) + 1);
    }
  }

  const reviewed = confirmed + edited + rejected;

  return {
    extracted: extracted.size,
    reviewed,
    confirmed,
    edited,
    rejected,
    unreviewed: Math.max(extracted.size - reviewed, 0),
    survivalRate: ratio(confirmed, reviewed),
    trend: [...byDay.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([day, tally]) => ({
        day,
        reviewed: tally.reviewed,
        survivalRate: ratio(tally.confirmed, tally.reviewed),
      })),
    editedFields: [...fields.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([field, count]) => ({ field, count })),
  };
}

async function readUsage(client, since) {
  const rows = await rowsOf(
    client,
    `SELECT model, outcome, input_tokens, output_tokens, duration_ms, checkpoint_id
       FROM checkpoint_usage
      WHERE created_at >= $1
      ORDER BY created_at ASC`,
    [since],
  );

  const byModel = new Map();

  for (const row of rows) {
    const entry = byModel.get(row.model) ?? {
      model: row.model,
      calls: 0,
      failed: 0,
      fellBack: 0,
      inputTokens: [],
      outputTokens: [],
      durationsMs: [],
    };
    entry.calls += 1;
    if (row.outcome === 'failed') entry.failed += 1;
    if (row.outcome === 'fell_back') entry.fellBack += 1;
    entry.inputTokens.push(num(row.input_tokens));
    entry.outputTokens.push(num(row.output_tokens));
    entry.durationsMs.push(num(row.duration_ms));
    byModel.set(row.model, entry);
  }

  const models = [...byModel.values()].map((entry) => {
    const input = [...entry.inputTokens].sort((a, b) => a - b);
    const output = [...entry.outputTokens].sort((a, b) => a - b);
    const duration = [...entry.durationsMs].sort((a, b) => a - b);
    const total = (values) => values.reduce((sum, value) => sum + value, 0);
    return {
      model: entry.model,
      calls: entry.calls,
      failed: entry.failed,
      fellBack: entry.fellBack,
      inputTokens: {
        total: total(input),
        p50: percentile(input, 0.5),
        p95: percentile(input, 0.95),
        max: input[input.length - 1] ?? null,
      },
      outputTokens: {
        total: total(output),
        p50: percentile(output, 0.5),
        p95: percentile(output, 0.95),
        max: output[output.length - 1] ?? null,
      },
      durationMs: { p50: percentile(duration, 0.5), p95: percentile(duration, 0.95) },
    };
  });

  return { extractionCalls: rows.length, models };
}

async function readContinuity(client, since) {
  const checkpoints = await rowsOf(
    client,
    `SELECT date_trunc('day', created_at)::date AS day, count(*) AS count, "trigger"
       FROM checkpoint
      WHERE created_at >= $1
      GROUP BY 1, 3
      ORDER BY 1 ASC`,
    [since],
  );
  const slices = await rowsOf(
    client,
    `SELECT date_trunc('day', occurred_at)::date AS day, count(*) AS count
       FROM telemetry_event
      WHERE occurred_at >= $1 AND name = 'rehydration.slice_shown'
      GROUP BY 1
      ORDER BY 1 ASC`,
    [since],
  );

  const byDay = new Map();
  const triggers = new Map();

  for (const row of checkpoints) {
    const day =
      row.day.toISOString === undefined ? String(row.day) : row.day.toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { day, checkpoints: 0, rehydrates: 0 };
    entry.checkpoints += num(row.count);
    byDay.set(day, entry);
    triggers.set(row.trigger, (triggers.get(row.trigger) ?? 0) + num(row.count));
  }

  for (const row of slices) {
    const day =
      row.day.toISOString === undefined ? String(row.day) : row.day.toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { day, checkpoints: 0, rehydrates: 0 };
    entry.rehydrates += num(row.count);
    byDay.set(day, entry);
  }

  const daysUsed = [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day));

  let longestStreak = 0;
  let currentStreak = 0;
  let previous = null;
  for (const entry of daysUsed) {
    const at = Date.parse(`${entry.day}T00:00:00.000Z`);
    const consecutive = previous !== null && at - previous === 86_400_000;
    currentStreak = consecutive ? currentStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    previous = at;
  }

  return {
    daysWithActivity: daysUsed.length,
    longestConsecutiveStreak: longestStreak,
    byDay: daysUsed,
    triggers: [...triggers.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([trigger, count]) => ({ trigger, count })),
  };
}

const pct = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const int = (value) => (value === null || value === undefined ? 'n/a' : String(value));

function render(report) {
  const lines = [];
  const w = (line = '') => lines.push(line);

  w(`Dogfood report — last ${report.windowDays} days, from ${report.since.slice(0, 10)}`);
  w();

  w('Extractor quality (MNE-66) — what fraction of reviewed items survived unedited');
  w(`  extracted        ${report.quality.extracted}`);
  w(
    `  reviewed         ${report.quality.reviewed} (${report.quality.unreviewed} still unreviewed)`,
  );
  w(
    `  confirmed        ${report.quality.confirmed}   edited ${report.quality.edited}   rejected ${report.quality.rejected}`,
  );
  w(`  survival rate    ${pct(report.quality.survivalRate)}`);
  if (report.quality.reviewed === 0) {
    w(
      '  No reviews yet, so there is no baseline. This number only means something once a human reviews.',
    );
  }
  if (report.quality.trend.length > 0) {
    w('  trend by day');
    for (const point of report.quality.trend) {
      w(`    ${point.day}   ${pct(point.survivalRate)}   over ${point.reviewed} reviewed`);
    }
  }
  if (report.quality.editedFields.length > 0) {
    w('  fields editors changed');
    for (const entry of report.quality.editedFields) {
      w(`    ${entry.field.padEnd(16)} ${entry.count}`);
    }
  }
  w();

  w('Checkpoint cost inputs (MNE-180 step 1) — measured tokens, not an estimate');
  w(`  extraction calls ${report.usage.extractionCalls}`);
  for (const model of report.usage.models) {
    w(`  ${model.model}`);
    w(`    calls          ${model.calls} (${model.failed} failed, ${model.fellBack} fell back)`);
    w(
      `    input tokens   p50 ${int(model.inputTokens.p50)}   p95 ${int(model.inputTokens.p95)}   max ${int(model.inputTokens.max)}   total ${model.inputTokens.total}`,
    );
    w(
      `    output tokens  p50 ${int(model.outputTokens.p50)}   p95 ${int(model.outputTokens.p95)}   max ${int(model.outputTokens.max)}   total ${model.outputTokens.total}`,
    );
    w(`    duration       p50 ${int(model.durationMs.p50)}ms   p95 ${int(model.durationMs.p95)}ms`);
  }
  if (report.usage.extractionCalls === 0) {
    w('  Nothing measured yet. MNE-180 is blocked on MNE-86 for exactly this reason.');
  } else {
    w('  §14.1 sizes the allowance off the p95 session, not the median one. Apply contracted');
    w('  per-token rates to the p95 row above; this script deliberately does not guess a price.');
  }
  w();

  w('Dogfood continuity (MNE-86) — §13 asks for seven consecutive days');
  w(`  days with activity          ${report.continuity.daysWithActivity}`);
  w(`  longest consecutive streak  ${report.continuity.longestConsecutiveStreak} day(s)`);
  if (report.continuity.triggers.length > 0) {
    w('  checkpoints by trigger');
    for (const entry of report.continuity.triggers) {
      w(`    ${entry.trigger.padEnd(16)} ${entry.count}`);
    }
  }
  if (report.continuity.byDay.length > 0) {
    w('  by day');
    for (const entry of report.continuity.byDay) {
      w(`    ${entry.day}   ${entry.checkpoints} checkpoint(s)   ${entry.rehydrates} rehydrate(s)`);
    }
  }
  w(
    report.continuity.longestConsecutiveStreak >= 7
      ? '  The seven-day run is present. MNE-88 is a written ruling on it, not a number.'
      : '  Not seven consecutive days yet, so MNE-86 has not passed and MNE-88 cannot be ruled.',
  );

  return lines.join('\n');
}

const client = new Client({ connectionString });

try {
  await client.connect();
  const since = new Date(Date.now() - days * 86_400_000);

  const quality = await readQuality(client, since);
  const usage = await readUsage(client, since);
  const continuity = await readContinuity(client, since);

  const report = { windowDays: days, since: since.toISOString(), quality, usage, continuity };

  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
} catch (error) {
  process.stderr.write(
    `dogfood-report: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
