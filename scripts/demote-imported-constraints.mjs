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

const INTEROP_SOURCES = ['AGENTS.md:%', 'CLAUDE.md:%', '.cursor/rules%'];

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const workspace = valueOf('--workspace');
const only = (valueOf('--only') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value !== '');

const fail = (message) => {
  process.stderr.write(`demote:imported-constraints: ${message}\n`);
  process.exit(1);
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  fail(
    'expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      `  Copy ${repoRoot}.env.example to .env and fill in the connection string,\n` +
      '  or prefix the command: DATABASE_URL=postgres://... pnpm demote:imported-constraints',
  );
}

if (workspace === undefined) {
  fail(
    'expected --workspace <uuid> naming the workspace to repair; found none.\n' +
      '  This writes to tenant rows, so it will not run across every workspace at once.',
  );
}

const describe = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'the configured database';
  }
};

const ONLY_CLAUSE = only.length === 0 ? '' : 'and id = any($5::uuid[])';

const SELECT = `
  select id, title, source_ref, asserted_at
    from context_item
   where workspace_id = $1
     and kind = 'constraint'
     and load_bearing = true
     and valid_to is null
     and (source_ref like $2 or source_ref like $3 or source_ref like $4)
     ${ONLY_CLAUSE}
   order by source_ref, asserted_at
`;

const UPDATE = `
  update context_item
     set load_bearing = false
   where workspace_id = $1
     and kind = 'constraint'
     and load_bearing = true
     and valid_to is null
     and (source_ref like $2 or source_ref like $3 or source_ref like $4)
     ${ONLY_CLAUSE}
`;

const { Client } = require('pg');
const client = new Client({ connectionString });

process.stdout.write(
  `demote:imported-constraints: reading ${describe(connectionString)}, workspace ${workspace}\n`,
);

await client.connect();

try {
  await client.query('begin');
  await client.query('select set_config($1, $2, true)', ['mneia.workspace_id', workspace]);

  const parameters =
    only.length === 0 ? [workspace, ...INTEROP_SOURCES] : [workspace, ...INTEROP_SOURCES, only];
  const { rows } = await client.query(SELECT, parameters);

  if (rows.length === 0) {
    process.stdout.write(
      '  nothing to demote — no load-bearing constraint carries an interop source_ref\n',
    );
    await client.query('rollback');
    process.exit(0);
  }

  process.stdout.write(`  ${rows.length} load-bearing constraint(s) came from a file scrape:\n`);
  for (const row of rows) {
    process.stdout.write(`    ${row.id}  ${row.source_ref}  ${row.title}\n`);
  }

  if (apply && only.length === 0) {
    await client.query('rollback');
    fail(
      'refusing to demote every scraped row at once.\n' +
        '  Most of them are real rules — the nine standing rules were imported this way too, and\n' +
        '  demoting those strips rule 2 from the rules rule 2 exists to protect.\n' +
        '  Re-run with --only <id,id,...> naming exactly the rows to demote.',
    );
  }

  if (!apply) {
    await client.query('rollback');
    process.stdout.write(
      '\n  Nothing was written. Re-run with --apply --only <id,id,...> to set load_bearing = false\n' +
        '  on exactly the rows you name. Title, body and status are never touched, so nothing is\n' +
        '  superseded.\n',
    );
    process.exit(0);
  }

  const { rowCount } = await client.query(UPDATE, parameters);
  await client.query('commit');

  process.stdout.write(`\n  demoted ${rowCount} row(s) to load_bearing = false\n`);
} catch (error) {
  await client.query('rollback').catch(() => {});
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await client.end();
}
