#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const coreDist = new URL('../packages/core/dist/index.js', import.meta.url);

if (!existsSync(coreDist)) {
  throw new Error(
    'expected packages/core/dist to be built, because this script reads the row-level security ' +
      'guard from it rather than restating the query; found no dist. Run pnpm build first.',
  );
}

const { WORKSPACE_SETTING, inspectRlsPosture } = await import(coreDist.href);

export const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const HEALTHY = 'healthy';
export const MISSING_OWNER = 'missing_owner';
export const NON_OWNER_ONLY = 'non_owner_only';
export const NO_IDENTIFIED_HUMAN = 'no_identified_human';
export const SEVERAL_OWNERS = 'several_owners';

export class UsageError extends Error {}

function readWorkspaceId(raw) {
  if (raw === undefined || !UUID_PATTERN.test(raw)) {
    throw new UsageError(
      `expected --workspace to be followed by a workspace uuid; received ${raw ?? 'nothing'}`,
    );
  }

  return raw;
}

function rejectArg(arg) {
  throw new UsageError(
    arg.startsWith('-')
      ? `unrecognised option ${arg} — run with --help for the accepted ones`
      : `expected no positional arguments; received ${arg} — name a workspace with --workspace <uuid>`,
  );
}

export function parseArgs(argv) {
  const options = { apply: false, help: false, workspaces: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--workspace') {
      const id = readWorkspaceId(argv[index + 1]);
      if (!options.workspaces.includes(id)) options.workspaces.push(id);
      index += 1;
    } else rejectArg(arg);
  }

  return options;
}

export const usage = () =>
  [
    'Usage: pnpm audit:workspace-membership [--apply] [--workspace <uuid> ...]',
    '',
    'Reports every workspace that does not have exactly one workspace_member row with role',
    "'owner', and repairs the ones a query can repair. MNE-275: bootstrapSoloAccount wrote no",
    'membership row, and migration 0030 only reached actors that already carried an identity.',
    '',
    'Each workspace is read and written in its own transaction with the mneia.workspace_id',
    'setting bound to it, so row-level security applies exactly as it does to the application.',
    'One cross-tenant statement would be hidden by that policy and would report a clean bill of',
    'health, which is the failure this shape exists to avoid.',
    '',
    'Without --apply nothing is written: every read runs inside a transaction that is rolled',
    'back. --apply inserts the owner row for the workspaces named in the plan it just printed,',
    "binding each write to that workspace id and that identity id. The role is always 'owner';",
    'the creator is the earliest human actor carrying an identity, ordered by created_at then id,',
    'which is how migration 0030 derived it.',
    '',
    'A workspace whose humans carry no identity cannot be repaired by any query — inventing one',
    'would invent a person. Those are reported and left alone.',
    '',
    'No email address and no identity subject is printed. Rows are named by id, because this can',
    'run in a CI log.',
  ].join('\n');

export const LIST_WORKSPACES_SQL = `
  SELECT w.id
    FROM workspace w
   ORDER BY w.created_at ASC, w.id ASC
`;

export const AUDIT_SQL = `
  SELECT w.id AS workspace_id,
         w.slug,
         w.created_at,
         count(m.identity_id) FILTER (WHERE m.role = 'owner'::workspace_role) AS owner_rows,
         count(m.identity_id) AS member_rows,
         (SELECT count(*) FROM actor a
           WHERE a.workspace_id = w.id
             AND a.kind = 'human'::actor_kind) AS human_actors,
         (SELECT count(*) FROM actor a
           WHERE a.workspace_id = w.id
             AND a.kind = 'human'::actor_kind
             AND a.identity_id IS NULL) AS humans_without_identity,
         (SELECT a.id FROM actor a
           WHERE a.workspace_id = w.id
             AND a.kind = 'human'::actor_kind
           ORDER BY a.created_at ASC, a.id ASC LIMIT 1) AS presumed_creator,
         (SELECT a.identity_id FROM actor a
           WHERE a.workspace_id = w.id
             AND a.kind = 'human'::actor_kind
             AND a.identity_id IS NOT NULL
           ORDER BY a.created_at ASC, a.id ASC LIMIT 1) AS creator_identity_id
    FROM workspace w
    LEFT JOIN workspace_member m ON m.workspace_id = w.id
   WHERE w.id = $1::uuid
   GROUP BY w.id, w.slug, w.created_at
`;

export const REPAIR_SQL = `
  INSERT INTO workspace_member (workspace_id, identity_id, role)
  SELECT w.id, $2::uuid, 'owner'::workspace_role
    FROM workspace w
   WHERE w.id = $1::uuid
     AND EXISTS (SELECT 1 FROM actor a
                  WHERE a.workspace_id = w.id
                    AND a.kind = 'human'::actor_kind
                    AND a.identity_id = $2::uuid)
     AND NOT EXISTS (SELECT 1 FROM workspace_member m
                      WHERE m.workspace_id = w.id
                        AND m.role = 'owner'::workspace_role)
  ON CONFLICT (workspace_id, identity_id) DO UPDATE SET role = 'owner'::workspace_role
  RETURNING workspace_id, identity_id
`;

const count = (value) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `expected the audit query to return a whole count; received ${JSON.stringify(value)}. ` +
        'Nothing was written — the query and this reader have drifted apart.',
    );
  }

  return parsed;
};

export function readRow(row) {
  return {
    workspaceId: row.workspace_id,
    slug: row.slug,
    createdAt: row.created_at,
    ownerRows: count(row.owner_rows),
    memberRows: count(row.member_rows),
    humanActors: count(row.human_actors),
    humansWithoutIdentity: count(row.humans_without_identity),
    presumedCreator: row.presumed_creator ?? null,
    creatorIdentityId: row.creator_identity_id ?? null,
  };
}

export function classify(entry) {
  if (entry.ownerRows === 1) return HEALTHY;
  if (entry.ownerRows > 1) return SEVERAL_OWNERS;
  if (entry.creatorIdentityId === null) return NO_IDENTIFIED_HUMAN;
  return entry.memberRows === 0 ? MISSING_OWNER : NON_OWNER_ONLY;
}

export const isRepairable = (verdict) => verdict === MISSING_OWNER || verdict === NON_OWNER_ONLY;

const VERDICTS = {
  [HEALTHY]: 'healthy',
  [MISSING_OWNER]: 'no membership row at all — repairable',
  [NON_OWNER_ONLY]: 'members but no owner — repairable',
  [NO_IDENTIFIED_HUMAN]: 'no human carries an identity — NOT repairable, needs a decision',
  [SEVERAL_OWNERS]: 'more than one owner — NOT repairable, needs a decision',
};

export const describe = (entry) =>
  `  ${entry.workspaceId}  ${String(entry.slug).slice(0, 24).padEnd(24)}  ` +
  `owners=${entry.ownerRows} members=${entry.memberRows} ` +
  `humans=${entry.humanActors} (${entry.humansWithoutIdentity} unidentified)  ` +
  `${VERDICTS[classify(entry)]}` +
  (entry.creatorIdentityId === null ? '' : `, identity ${entry.creatorIdentityId}`);

async function inTransaction(client, workspaceId, run, finish) {
  await client.query('BEGIN');

  try {
    await client.query('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
    const result = await run();
    await client.query(finish);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function readWorkspace(client, workspaceId) {
  return inTransaction(
    client,
    workspaceId,
    async () => {
      const { rows } = await client.query(AUDIT_SQL, [workspaceId]);
      const [first] = rows;

      if (first === undefined) {
        throw new Error(
          `expected workspace ${workspaceId} to be readable once mneia.workspace_id is bound to ` +
            'it; the scoped query returned no row. Either the id does not name a workspace, or ' +
            'the connected role has no SELECT on workspace. Nothing was written.',
        );
      }

      return readRow(first);
    },
    'ROLLBACK',
  );
}

export async function repairWorkspace(client, entry) {
  return inTransaction(
    client,
    entry.workspaceId,
    async () => {
      const { rows } = await client.query(REPAIR_SQL, [entry.workspaceId, entry.creatorIdentityId]);

      if (rows.length !== 1) {
        throw new Error(
          `expected the repair of workspace ${entry.workspaceId} to write exactly one owner row ` +
            `for identity ${entry.creatorIdentityId}; the statement reported ${rows.length}. ` +
            'Rolled back and wrote nothing. Re-run without --apply and read the plan again.',
        );
      }

      const { rows: after } = await client.query(AUDIT_SQL, [entry.workspaceId]);
      const [first] = after;
      const verified = first === undefined ? null : readRow(first);

      if (verified === null || verified.ownerRows !== 1) {
        throw new Error(
          `expected workspace ${entry.workspaceId} to hold exactly one owner row after the ` +
            `repair; it holds ${verified === null ? 'no readable row' : verified.ownerRows}. ` +
            'Rolled back and wrote nothing.',
        );
      }

      return verified;
    },
    'COMMIT',
  );
}

export async function listWorkspaceIds(client, posture) {
  const { rows } = await client.query(LIST_WORKSPACES_SQL);

  if (rows.length === 0 && !posture.bypassesRls) {
    throw new UsageError(
      `expected the unscoped workspace listing to return every workspace; it returned none, and ` +
        `the connected role ${JSON.stringify(posture.role)} is subject to row-level security. ` +
        'Zero rows is therefore not proof that there are zero workspaces — the workspace_isolation ' +
        'policy hides every row while mneia.workspace_id is unset, and reporting a clean bill of ' +
        'health from it would be a lie. Nothing was read and nothing was written.\n' +
        '  Name the workspaces instead: --workspace <uuid> --workspace <uuid> …\n' +
        '  Each named workspace is then read and repaired with the setting bound to it, which is\n' +
        '  the only way the policy admits it. Take the ids from an admin connection that is not\n' +
        `  subject to the policy; do not set MNEIA_ALLOW_RLS_BYPASS to make this run see them.`,
    );
  }

  return rows.map((row) => row.id);
}

export async function audit(client, options) {
  const posture = await inspectRlsPosture({
    execute: async (sql, params = []) => client.query(sql, [...params]),
  });

  process.stdout.write(
    `audit:workspace-membership: connected as ${JSON.stringify(posture.role)} — ` +
      `${posture.bypassesRls ? 'bypasses' : 'is subject to'} row-level security` +
      `${posture.bypassesRls ? ` (via ${posture.viaRoles.join(', ')})` : ''}\n`,
  );

  const ids =
    options.workspaces.length > 0 ? options.workspaces : await listWorkspaceIds(client, posture);

  process.stdout.write(
    `audit:workspace-membership: ${ids.length} workspace(s) to examine` +
      `${options.workspaces.length > 0 ? ', named on the command line' : ''}\n`,
  );

  const entries = [];
  for (const id of ids) entries.push(await readWorkspace(client, id));

  const unhealthy = entries.filter((entry) => classify(entry) !== HEALTHY);

  process.stdout.write(
    `audit:workspace-membership: ${entries.length - unhealthy.length} healthy, ` +
      `${unhealthy.length} without exactly one owner row\n`,
  );

  for (const entry of unhealthy) process.stdout.write(`${describe(entry)}\n`);

  const repairable = unhealthy.filter((entry) => isRepairable(classify(entry)));
  const undecidable = unhealthy.filter((entry) => !isRepairable(classify(entry)));

  if (undecidable.length > 0) {
    process.stdout.write(
      `audit:workspace-membership: ${undecidable.length} workspace(s) no query can repair. ` +
        'An owner has to be a real person, and this script will not invent one or choose between ' +
        'two. They are listed above and are left exactly as they are.\n',
    );
  }

  if (repairable.length === 0) {
    process.stdout.write('audit:workspace-membership: nothing to repair\n');
    return {
      examined: entries.length,
      healthy: entries.length - unhealthy.length,
      repairable: 0,
      repaired: 0,
      undecidable: undecidable.length,
      posture,
    };
  }

  if (!options.apply) {
    process.stdout.write(
      `audit:workspace-membership: dry run — nothing was written. Re-run with --apply to insert ` +
        `an owner row for the ${repairable.length} repairable workspace(s) above, bound to the ` +
        'workspace id and identity id printed on each line.\n',
    );
    return {
      examined: entries.length,
      healthy: entries.length - unhealthy.length,
      repairable: repairable.length,
      repaired: 0,
      undecidable: undecidable.length,
      posture,
    };
  }

  let repaired = 0;
  for (const entry of repairable) {
    await repairWorkspace(client, entry);
    repaired += 1;
    process.stdout.write(`  repaired ${entry.workspaceId} — owner ${entry.creatorIdentityId}\n`);
  }

  process.stdout.write(
    `audit:workspace-membership: repaired ${repaired} workspace(s). Re-run without --apply; a ` +
      'healthy database reports nothing to repair.\n',
  );

  return {
    examined: entries.length,
    healthy: entries.length - unhealthy.length,
    repairable: repairable.length,
    repaired,
    undecidable: undecidable.length,
    posture,
  };
}

const target = (value) => {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return 'the configured database';
  }
};

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
      'expected DATABASE_URL to hold a Postgres connection string; found none — copy ' +
        '.env.example to .env, or prefix the command with DATABASE_URL=postgres://…',
    );
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString });

  process.stdout.write(`audit:workspace-membership: reading ${target(connectionString)}\n`);
  await client.connect();

  try {
    await audit(client, options);
  } finally {
    await client.end();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`audit:workspace-membership: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write(`\n${usage()}\n`);
    process.exitCode = 1;
  }
}
