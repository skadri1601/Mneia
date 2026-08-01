#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const envFile = new URL('../.env', import.meta.url);
const coreDist = new URL('../packages/core/dist/index.js', import.meta.url);

if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  process.stderr.write(
    'db:migrate: expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      `  Copy ${repoRoot}.env.example to .env and fill in the Neon connection string,\n` +
      '  or prefix the command: DATABASE_URL=postgres://... pnpm db:migrate\n',
  );
  process.exit(1);
}

if (!existsSync(coreDist)) {
  process.stderr.write(
    'db:migrate: expected packages/core/dist to be built; found none. Run pnpm build first.\n',
  );
  process.exit(1);
}

const { MIGRATIONS, migrate } = await import(coreDist.href);
const { Client } = require('pg');

class PgDriver {
  constructor(client) {
    this.client = client;
  }

  async execute(sql, params = []) {
    const result =
      params.length === 0
        ? await this.client.query(sql)
        : await this.client.query(sql, [...params]);
    return { rows: result.rows };
  }

  async transaction(run) {
    await this.client.query('BEGIN');
    try {
      const result = await run(this);
      await this.client.query('COMMIT');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }
}

function describe(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'the configured database';
  }
}

const appliedBy = process.env.GITHUB_ACTIONS
  ? `github-actions:${process.env.GITHUB_SHA ?? ''}`
  : 'cli';
const client = new Client({ connectionString });

process.stdout.write(`db:migrate: connecting to ${describe(connectionString)}\n`);
await client.connect();

try {
  const result = await migrate(new PgDriver(client), { appliedBy });

  for (const migration of result.applied) {
    process.stdout.write(`  applied ${migration.version} ${migration.name}\n`);
  }

  process.stdout.write(
    `db:migrate: ${result.applied.length} applied, ${result.alreadyApplied} already present, ` +
      `${MIGRATIONS.length} known; schema version ${result.schemaVersion}\n`,
  );
} catch (error) {
  process.stderr.write(`db:migrate: ${error instanceof Error ? error.message : String(error)}\n`);
  if (error instanceof Error && error.cause instanceof Error) {
    process.stderr.write(`  caused by: ${error.cause.message}\n`);
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
