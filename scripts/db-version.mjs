#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { readBookkeepingTable, readMigrationSources } from './schema-version.mjs';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const envFile = new URL('../.env', import.meta.url);

if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  process.stderr.write(
    'db:version: expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      `  Copy ${repoRoot}.env.example to .env and fill in the connection string,\n` +
      '  or prefix the command: DATABASE_URL=postgres://... pnpm db:version\n',
  );
  process.exit(1);
}

const { Client } = require('pg');

const describe = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'the configured database';
  }
};

let migrations;
let BOOKKEEPING_TABLE;
try {
  migrations = readMigrationSources(repoRoot);
  BOOKKEEPING_TABLE = readBookkeepingTable(repoRoot);
} catch (error) {
  process.stderr.write(`db:version: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const expected = migrations.reduce(
  (highest, migration) => (migration.version > highest ? migration.version : highest),
  0,
);

const client = new Client({ connectionString });
process.stdout.write(`db:version: reading ${describe(connectionString)} — this applies nothing\n`);
await client.connect();

try {
  const present = await client.query('SELECT to_regclass($1) AS table', [BOOKKEEPING_TABLE]);

  if (present.rows[0]?.table === null) {
    process.stdout.write(`  applied schema version:  none — ${BOOKKEEPING_TABLE} does not exist\n`);
    process.stdout.write(`  this checkout expects:   ${expected}\n`);
    process.stdout.write(
      'db:version: BEHIND — no migration has ever run here, so every table this build queries is missing\n',
    );
    process.exitCode = 2;
    await client.end();
    process.exit(2);
  }

  const result = await client.query(
    `SELECT max(version) AS version, count(*)::int AS applied FROM ${BOOKKEEPING_TABLE}`,
  );
  const row = result.rows[0] ?? { version: null, applied: 0 };
  const applied = row.version === null ? null : Number(row.version);

  process.stdout.write(`  applied schema version:  ${applied ?? 'none — no migration has run'}\n`);
  process.stdout.write(`  this checkout expects:   ${expected}\n`);
  process.stdout.write(`  migrations recorded:     ${row.applied}\n`);

  if (applied === null) {
    process.stdout.write('db:version: BEHIND — nothing has been migrated here\n');
    process.exitCode = 2;
  } else if (applied < expected) {
    const pending = migrations
      .filter((migration) => migration.version > applied)
      .map((migration) => `${migration.version} ${migration.name}`)
      .join(', ');
    process.stdout.write(`db:version: BEHIND — pending: ${pending}\n`);
    process.stdout.write("  run 'pnpm db:migrate' against this database before deploying code\n");
    process.exitCode = 2;
  } else if (applied > expected) {
    process.stdout.write(
      'db:version: AHEAD — the database was migrated by a newer build than this checkout\n',
    );
  } else {
    process.stdout.write('db:version: CURRENT — safe to deploy this checkout\n');
  }
} catch (error) {
  process.stderr.write(`db:version: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
