#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const RETENTION_DAYS = 30;
export const ACCESS_OPENED_CAMPAIGNS = ['access-open'];
export const DEFAULT_MAX = 100;

export const ADMITTED = 'admitted';
export const EMAILED = 'emailed';

export class UsageError extends Error {}

function readMax(raw) {
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(
      `expected --max to be followed by a whole number of at least 1; received ${raw ?? 'nothing'}`,
    );
  }

  return value;
}

export function parseArgs(argv) {
  const options = { apply: false, max: DEFAULT_MAX, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--max') {
      options.max = readMax(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unrecognised option ${arg} — run with --help for the accepted ones`);
    } else {
      throw new UsageError(
        `expected no positional arguments; received ${arg} — this command purges one thing and takes no target`,
      );
    }
  }

  return options;
}

export const usage = () =>
  [
    'Usage: pnpm waitlist:purge [--apply] [--max N]',
    '',
    'Deletes waitlist addresses whose published retention has elapsed. The privacy policy says',
    'the address is kept "until you unsubscribe or access opens, then deleted within 30 days",',
    'and the access-open email repeats it. Unsubscribe already deletes on the spot; this is the',
    'other half.',
    '',
    'Access is treated as open for a row the moment either clock starts, whichever came first:',
    `  ${ADMITTED}  status = 'approved', dated by approved_at`,
    `  ${EMAILED}   the ${ACCESS_OPENED_CAMPAIGNS.join(', ')} campaign was delivered to it`,
    '',
    `Without --apply this prints what is due and deletes nothing. --max refuses a run larger than`,
    `N rows (default ${DEFAULT_MAX}) rather than deleting them, so a widened predicate stops instead`,
    'of emptying the table. Deletion cascades the row’s waitlist_broadcast_send history away.',
    '',
    'No address is printed. Rows are identified by id, because this runs in CI logs.',
  ].join('\n');

export const SELECT_DUE_SQL = `
  SELECT s.id,
         s.status,
         CASE WHEN s.status = 'approved' THEN s.approved_at END AS admitted_at,
         o.emailed_at
    FROM waitlist_signup s
    LEFT JOIN LATERAL (
           SELECT min(b.delivered_at) AS emailed_at
             FROM waitlist_broadcast_send b
            WHERE b.signup_id = s.id
              AND b.campaign = ANY($1::text[])
              AND b.status = 'sent'
         ) o ON true
   WHERE least(
           CASE WHEN s.status = 'approved' THEN s.approved_at END,
           o.emailed_at
         ) < now() - make_interval(days => $2::int)
   ORDER BY s.id
`;

export const DELETE_SQL = `
  DELETE FROM waitlist_signup
   WHERE id = ANY($1::uuid[])
  RETURNING id
`;

export const accessOpenedAt = (row) => {
  const clocks = [row.admitted_at, row.emailed_at].filter((at) => at !== null && at !== undefined);

  if (clocks.length === 0) {
    throw new Error(
      `expected row ${row.id} to carry an approved_at or a delivered access-open send, because ` +
        'only those make an address due; it carries neither. Nothing was deleted — the selection ' +
        'query and this reader have drifted apart.',
    );
  }

  return clocks.reduce((earliest, at) => (at < earliest ? at : earliest));
};

export const reasonsFor = (row) => {
  const reasons = [];
  if (row.admitted_at !== null && row.admitted_at !== undefined) reasons.push(ADMITTED);
  if (row.emailed_at !== null && row.emailed_at !== undefined) reasons.push(EMAILED);
  return reasons;
};

export const elapsedDays = (row, now) =>
  Math.floor((now.getTime() - new Date(accessOpenedAt(row)).getTime()) / 86_400_000);

export function describe(rows, now) {
  return rows.map(
    (row) =>
      `  ${row.id}  ${String(row.status).padEnd(8)}  ${reasonsFor(row).join('+').padEnd(17)}  ${elapsedDays(row, now)}d since access opened`,
  );
}

async function deleteExactly(client, ids) {
  const { rows: gone } = await client.query(DELETE_SQL, [ids]);

  if (gone.length > ids.length) {
    await client.query('ROLLBACK');
    throw new Error(
      `expected to delete at most the ${ids.length} address(es) listed above; the statement ` +
        `reported ${gone.length}. Rolled back and deleted nothing.`,
    );
  }

  await client.query('COMMIT');

  process.stdout.write(
    `waitlist:purge: deleted ${gone.length} address(es) and their send history by cascade\n`,
  );

  const vanished = ids.length - gone.length;

  if (vanished > 0) {
    process.stdout.write(
      `waitlist:purge: ${vanished} had already gone — unsubscribing deletes on the spot, so a ` +
        'row can leave between the count and the delete. Nothing is wrong.\n',
    );
  }

  return gone.length;
}

export async function purge(client, options, now = new Date()) {
  await client.query('BEGIN');

  try {
    const { rows: due } = await client.query(SELECT_DUE_SQL, [
      ACCESS_OPENED_CAMPAIGNS,
      RETENTION_DAYS,
    ]);

    process.stdout.write(
      `waitlist:purge: ${due.length} address(es) past the published ${RETENTION_DAYS}-day deadline\n`,
    );

    if (due.length === 0) {
      await client.query('ROLLBACK');
      process.stdout.write('waitlist:purge: nothing to do\n');
      return { due: 0, deleted: 0 };
    }

    for (const line of describe(due, now)) process.stdout.write(`${line}\n`);

    if (due.length > options.max) {
      await client.query('ROLLBACK');
      throw new UsageError(
        `expected at most ${options.max} address(es) to be due; found ${due.length}. Nothing was ` +
          'deleted. Read the list above, then re-run with --max set higher once you believe it.',
      );
    }

    if (!options.apply) {
      await client.query('ROLLBACK');
      process.stdout.write(
        'waitlist:purge: dry run — nothing was deleted. Re-run with --apply to delete these rows.\n',
      );
      return { due: due.length, deleted: 0 };
    }

    const deleted = await deleteExactly(
      client,
      due.map((row) => row.id),
    );

    return { due: due.length, deleted };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const require = createRequire(import.meta.url);
  const envFile = new URL('../.env', import.meta.url);

  if (existsSync(envFile)) process.loadEnvFile(fileURLToPath(envFile));

  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new UsageError(
      'expected DATABASE_URL to hold the Neon connection string; found none — copy .env.example to .env',
    );
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await purge(client, options);
  } finally {
    await client.end();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`waitlist:purge: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write(`\n${usage()}\n`);
    process.exitCode = 1;
  }
}
