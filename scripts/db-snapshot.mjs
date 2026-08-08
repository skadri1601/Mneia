#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const envFile = new URL('../.env', import.meta.url);
const outputFile = fileURLToPath(new URL('../db/structure.sql', import.meta.url));

if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const check = process.argv.includes('--check');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  process.stderr.write(
    'db:snapshot: expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      `  Copy ${repoRoot}.env.example to .env and fill in a connection string,\n` +
      '  or prefix the command: DATABASE_URL=postgres://... pnpm db:snapshot\n',
  );
  process.exit(1);
}

const { Client } = require('pg');

const SCHEMA = 'public';

const rowsOf = async (client, sql, params = []) => (await client.query(sql, params)).rows;

async function schemaVersion(client) {
  const rows = await rowsOf(
    client,
    `SELECT max(version) AS version FROM mneia_schema_migration`,
  ).catch(() => []);
  const version = rows[0]?.version;

  if (version === undefined || version === null) {
    throw new Error(
      'db:snapshot: could not read a schema version from mneia_schema_migration. Run pnpm db:migrate against this database first.',
    );
  }

  return String(version);
}

async function extensions(client) {
  const rows = await rowsOf(
    client,
    `SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`,
  );
  return rows.map((row) => `CREATE EXTENSION IF NOT EXISTS ${row.extname};`);
}

async function enums(client) {
  const rows = await rowsOf(
    client,
    `SELECT t.typname,
            string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
      GROUP BY t.typname
      ORDER BY t.typname`,
    [SCHEMA],
  );
  return rows.map((row) => `CREATE TYPE ${row.typname} AS ENUM (${row.labels});`);
}

async function tableNames(client) {
  const rows = await rowsOf(
    client,
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
      ORDER BY c.relname`,
    [SCHEMA],
  );
  return rows.map((row) => row.relname);
}

async function partitionStrategyOf(client, table) {
  const rows = await rowsOf(
    client,
    `SELECT pg_get_partkeydef(c.oid) AS partition_by
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'p'`,
    [SCHEMA, table],
  );
  return rows.length > 0 ? rows[0].partition_by : null;
}

async function columnsOf(client, table) {
  return rowsOf(
    client,
    `SELECT a.attname,
            format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [SCHEMA, table],
  );
}

async function constraintsOf(client, table) {
  return rowsOf(
    client,
    `SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
      ORDER BY con.conname`,
    [SCHEMA, table],
  );
}

async function indexesOf(client, table) {
  return rowsOf(
    client,
    `SELECT i.indexname, i.indexdef
       FROM pg_indexes i
      WHERE i.schemaname = $1
        AND i.tablename = $2
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
           WHERE con.conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
             AND con.conname = i.indexname
        )
      ORDER BY i.indexname`,
    [SCHEMA, table],
  );
}

async function rowSecurityOf(client, table) {
  const rows = await rowsOf(
    client,
    `SELECT c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`,
    [SCHEMA, table],
  );
  return rows[0] ?? { relrowsecurity: false, relforcerowsecurity: false };
}

async function policiesOf(client, table) {
  return rowsOf(
    client,
    `SELECT policyname, cmd, qual, with_check, roles
       FROM pg_policies
      WHERE schemaname = $1 AND tablename = $2
      ORDER BY policyname`,
    [SCHEMA, table],
  );
}

function renderColumn(column) {
  const parts = [`  ${column.attname} ${column.type}`];
  if (column.default_expr !== null) {
    parts.push(`DEFAULT ${column.default_expr}`);
  }
  if (column.attnotnull) {
    parts.push('NOT NULL');
  }
  return parts.join(' ');
}

async function renderTable(client, table) {
  const lines = [`CREATE TABLE ${table} (`];
  const columns = await columnsOf(client, table);
  lines.push(columns.map(renderColumn).join(',\n'));
  const partitionBy = await partitionStrategyOf(client, table);
  lines.push(partitionBy === null ? ');' : `) PARTITION BY ${partitionBy};`);

  const constraints = await constraintsOf(client, table);
  for (const constraint of constraints) {
    lines.push(
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint.conname} ${constraint.definition};`,
    );
  }

  const indexes = await indexesOf(client, table);
  for (const index of indexes) {
    lines.push(`${index.indexdef};`);
  }

  const security = await rowSecurityOf(client, table);
  if (security.relrowsecurity) {
    lines.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
  }
  if (security.relforcerowsecurity) {
    lines.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
  }

  const policies = await policiesOf(client, table);
  for (const policy of policies) {
    const clauses = [`CREATE POLICY ${policy.policyname} ON ${table}`];
    if (policy.cmd !== null && policy.cmd !== 'ALL') {
      clauses.push(`FOR ${policy.cmd}`);
    }
    if (policy.qual !== null) {
      clauses.push(`USING (${policy.qual})`);
    }
    if (policy.with_check !== null) {
      clauses.push(`WITH CHECK (${policy.with_check})`);
    }
    lines.push(`${clauses.join(' ')};`);
  }

  return lines.join('\n');
}

function section(heading, body) {
  return body.length === 0 ? [] : [`-- ${heading}\n\n${body.join('\n')}`];
}

async function snapshot(client) {
  const version = await schemaVersion(client);
  const blocks = [
    [
      '-- Generated by `pnpm db:snapshot`. Do not edit by hand.',
      '--',
      '-- This is the schema the migrations add up to, checked in so a reviewer can',
      '-- see the resulting shape rather than replaying every migration, and so CI',
      '-- can fail when a migration lands without a regenerated snapshot.',
      '--',
      `-- schema version: ${version}`,
    ].join('\n'),
    ...section('extensions', await extensions(client)),
    ...section('enum types', await enums(client)),
  ];

  const tables = await tableNames(client);
  const rendered = [];
  for (const table of tables) {
    rendered.push(await renderTable(client, table));
  }
  blocks.push(...section('tables', [rendered.join('\n\n')]));

  return `${blocks.join('\n\n')}\n`;
}

const client = new Client({ connectionString });
await client.connect();

let generated;
try {
  generated = await snapshot(client);
} finally {
  await client.end();
}

if (!check) {
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, generated);
  process.stdout.write(`db:snapshot: wrote db/structure.sql\n`);
  process.exit(0);
}

if (!existsSync(outputFile)) {
  process.stderr.write(
    'db:snapshot --check: db/structure.sql does not exist. Run pnpm db:snapshot and commit it.\n',
  );
  process.exit(1);
}

const committed = readFileSync(outputFile, 'utf8');

if (committed === generated) {
  process.stdout.write('db:snapshot: db/structure.sql matches the migrations\n');
  process.exit(0);
}

const committedLines = committed.split('\n');
const generatedLines = generated.split('\n');
const differences = [];

for (let index = 0; index < Math.max(committedLines.length, generatedLines.length); index += 1) {
  if (committedLines[index] !== generatedLines[index]) {
    differences.push(`  line ${index + 1}:`);
    differences.push(`    committed: ${committedLines[index] ?? '(end of file)'}`);
    differences.push(`    actual:    ${generatedLines[index] ?? '(end of file)'}`);
  }
  if (differences.length >= 30) {
    differences.push('  ...');
    break;
  }
}

process.stderr.write(
  'db:snapshot --check: db/structure.sql does not match the schema the migrations produce.\n' +
    'Run pnpm db:snapshot and commit the result alongside the migration.\n\n' +
    `${differences.join('\n')}\n`,
);
process.exit(1);
