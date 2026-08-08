#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  process.stderr.write(
    'db:provision-app-role: expected DATABASE_URL to hold a privileged Postgres connection string; found none.\n' +
      '  copy .env.example to .env and set it, or prefix the command.\n',
  );
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const roleName = process.env.MNEIA_APP_ROLE ?? 'mneia_app';

if (!/^[a-z_][a-z0-9_]*$/.test(roleName)) {
  process.stderr.write(
    `db:provision-app-role: expected MNEIA_APP_ROLE to be a plain lower-case identifier; found ${JSON.stringify(roleName)}\n`,
  );
  process.exit(1);
}

const password = process.env.MNEIA_APP_PASSWORD ?? randomBytes(24).toString('base64url');

const describe = (value) => {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.username ? `${url.username}@` : ''}${url.host}${url.pathname}`;
  } catch {
    return 'an unparseable connection string';
  }
};

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const client = new Client({ connectionString });

const quotedRole = `"${roleName}"`;

const statements = [
  `CREATE ROLE ${quotedRole} LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
  `GRANT CONNECT ON DATABASE <current> TO ${quotedRole}`,
  `GRANT USAGE ON SCHEMA public TO ${quotedRole}`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole}`,
  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole}`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRole}`,
];

process.stdout.write(`db:provision-app-role: target ${describe(connectionString)}\n`);
process.stdout.write(`db:provision-app-role: role ${roleName}\n\n`);

for (const statement of statements) {
  process.stdout.write(`  ${statement};\n`);
}

if (!apply) {
  process.stdout.write(
    '\ndb:provision-app-role: preview only — nothing was executed. Re-run with --apply to provision.\n',
  );
  process.exit(0);
}

await client.connect();

try {
  const { rows: existing } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
    roleName,
  ]);

  if (existing.length === 0) {
    await client.query(
      `CREATE ROLE ${quotedRole} LOGIN PASSWORD $1 NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`.replace(
        '$1',
        `'${password.replace(/'/g, "''")}'`,
      ),
    );
    process.stdout.write(`\ndb:provision-app-role: created ${roleName}\n`);
  } else {
    await client.query(
      `ALTER ROLE ${quotedRole} LOGIN PASSWORD '${password.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
    );
    process.stdout.write(
      `\ndb:provision-app-role: ${roleName} already existed — attributes reset\n`,
    );
  }

  const { rows: dbRows } = await client.query('SELECT current_database() AS name');
  const database = dbRows[0].name;

  await client.query(`GRANT CONNECT ON DATABASE "${database}" TO ${quotedRole}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole}`,
  );
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRole}`,
  );

  const { rows: posture } = await client.query(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
    [roleName],
  );

  const { rows: memberships } = await client.query(
    `SELECT granting.rolname AS name
       FROM pg_roles granting
      WHERE (granting.rolsuper OR granting.rolbypassrls)
        AND pg_has_role($1, granting.oid, 'MEMBER')
        AND granting.rolname <> $1`,
    [roleName],
  );

  process.stdout.write(
    `db:provision-app-role: rolsuper=${posture[0].rolsuper} rolbypassrls=${posture[0].rolbypassrls}\n`,
  );

  if (memberships.length > 0) {
    process.stderr.write(
      `\ndb:provision-app-role: ${roleName} inherits a bypass through ${memberships
        .map((row) => row.name)
        .join(', ')} — the guard will still refuse it.\n` +
        `  REVOKE ${memberships.map((row) => `"${row.name}"`).join(', ')} FROM ${quotedRole};\n`,
    );
    process.exitCode = 1;
  }

  const url = new URL(connectionString);
  url.username = roleName;
  url.password = password;

  process.stdout.write('\ndb:provision-app-role: point DATABASE_URL at\n\n');
  process.stdout.write(`${url.toString()}\n\n`);
  process.stdout.write(
    'db:provision-app-role: store it in .env and in the deploy secret. It is not written anywhere by this script.\n',
  );
} finally {
  await client.end();
}
