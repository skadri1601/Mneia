#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = 'packages/core/src/store/migrations';

const FILE_PATTERN = /^(\d{4})-(.+)\.ts$/;

const VERSION_PATTERN = /^\s*version:\s*(\d+)\s*,/m;

export class SchemaSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaSourceError';
  }
}

export function readMigrationSources(repoRoot) {
  const directory = join(repoRoot, MIGRATIONS_DIR);

  let entries;
  try {
    entries = readdirSync(directory);
  } catch (cause) {
    throw new SchemaSourceError(
      `expected migration sources in ${MIGRATIONS_DIR}; the directory could not be read — run this from the repository root`,
      { cause },
    );
  }

  const migrations = [];

  for (const entry of entries) {
    if (entry.endsWith('.test.ts')) continue;

    const match = FILE_PATTERN.exec(entry);
    if (match === null) continue;

    const source = readFileSync(join(directory, entry), 'utf8');
    const declared = VERSION_PATTERN.exec(source);

    if (declared === null) {
      throw new SchemaSourceError(
        `expected ${entry} to declare a "version:" field; found none — this reader derives the schema version from source, so a migration it cannot parse would be silently skipped`,
      );
    }

    const version = Number(declared[1]);
    const fromName = Number(match[1]);

    if (version !== fromName) {
      throw new SchemaSourceError(
        `${entry} is named for version ${fromName} but declares version ${version}; fix one of them before anything trusts either`,
      );
    }

    migrations.push({ version, name: match[2] });
  }

  if (migrations.length === 0) {
    throw new SchemaSourceError(
      `found no migrations in ${MIGRATIONS_DIR}; refusing to report a schema version of 0`,
    );
  }

  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

const BOOKKEEPING_PATTERN = /export const BOOKKEEPING_TABLE\s*=\s*'([^']+)'/;

export function readBookkeepingTable(repoRoot) {
  const source = join(repoRoot, 'packages/core/src/store/migrate.ts');

  let contents;
  try {
    contents = readFileSync(source, 'utf8');
  } catch (cause) {
    throw new SchemaSourceError(
      `expected to read the bookkeeping table name from packages/core/src/store/migrate.ts; the file could not be read`,
      { cause },
    );
  }

  const match = BOOKKEEPING_PATTERN.exec(contents);
  if (match === null || match[1] === undefined) {
    throw new SchemaSourceError(
      'expected packages/core/src/store/migrate.ts to export BOOKKEEPING_TABLE as a string literal; found none — reading the name from source is what keeps this script from querying a table that was renamed',
    );
  }

  return match[1];
}

export function expectedSchemaVersion(repoRoot) {
  return readMigrationSources(repoRoot).reduce(
    (highest, migration) => (migration.version > highest ? migration.version : highest),
    0,
  );
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  try {
    process.stdout.write(`${String(expectedSchemaVersion(repoRoot))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
