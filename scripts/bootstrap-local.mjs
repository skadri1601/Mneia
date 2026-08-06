#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  process.stderr.write(
    'bootstrap:local: expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      '  copy .env.example to .env and set it, or prefix the command.\n',
  );
  process.exit(1);
}

const apply = process.argv.includes('--apply');

const argValue = (name) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((entry) => entry.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
};

const workspaceSlug = argValue('workspace') ?? 'ascend';
const workspaceName = argValue('workspace-name') ?? 'Ascend';
const humanName = argValue('human') ?? 'founder';
const agentName = argValue('agent') ?? 'claude-code';
const teamSlug = argValue('team') ?? 'eng';
const projectSlug = argValue('project') ?? 'ascend-platform';
const projectName = argValue('project-name') ?? 'Ascend platform';

const configPath = process.env.MNEIA_LOCAL_CONFIG ?? join(homedir(), '.mneia', 'local.json');

const describe = (value) => {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.username ? `${url.username}@` : ''}${url.host}${url.pathname}`;
  } catch {
    return 'an unparseable connection string';
  }
};

const require = (await import('node:module')).createRequire(import.meta.url);
const { Client } = require('pg');

const WORKSPACE_SETTING = 'mneia.workspace_id';

const ids = {
  workspace: randomUUID(),
  human: randomUUID(),
  agent: randomUUID(),
  team: randomUUID(),
  project: randomUUID(),
};

const client = new Client({ connectionString });

const readExistingConfig = async () => {
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return null;
  }
};

async function main() {
  try {
    await client.connect();
  } catch (cause) {
    process.stderr.write(
      `bootstrap:local: could not connect to ${describe(connectionString)}: ${cause.message}\n` +
        '  Check DATABASE_URL, and use the direct connection string rather than the -pooler one.\n',
    );
    process.exitCode = 1;
    return;
  }

  const existingWorkspace = await client.query('SELECT id FROM workspace WHERE slug = $1', [
    workspaceSlug,
  ]);

  if (existingWorkspace.rows.length > 0) {
    const workspaceId = existingWorkspace.rows[0].id;
    await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
    const agents = await client.query(
      "SELECT id, display_name FROM actor WHERE workspace_id = $1 AND kind = 'agent' ORDER BY created_at",
      [workspaceId],
    );
    process.stderr.write(
      `bootstrap:local: workspace ${JSON.stringify(workspaceSlug)} already exists (${workspaceId}).\n` +
        `  agent actors: ${agents.rows.length === 0 ? 'none — this workspace cannot serve MCP writes' : agents.rows.map((row) => `${row.display_name} ${row.id}`).join(', ')}\n` +
        '  Pass --workspace=<slug> to bootstrap a different one. Nothing was written.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`bootstrap:local: ${describe(connectionString)}\n\n`);
  process.stdout.write(`  workspace   ${workspaceSlug} (${workspaceName})  ${ids.workspace}\n`);
  process.stdout.write(`  human actor ${humanName}  ${ids.human}\n`);
  process.stdout.write(`  agent actor ${agentName}  ${ids.agent}\n`);
  process.stdout.write(`  team        ${teamSlug}  ${ids.team}\n`);
  process.stdout.write(`  project     ${projectSlug} (${projectName})  ${ids.project}\n`);
  process.stdout.write(`  config      ${configPath}\n\n`);

  if (!apply) {
    process.stdout.write('This was a preview. Re-run with --apply to write it.\n');
    return;
  }

  const existingConfig = await readExistingConfig();
  if (existingConfig !== null) {
    process.stderr.write(
      `bootstrap:local: ${configPath} already exists and would be overwritten.\n` +
        '  Move it aside first, or set MNEIA_LOCAL_CONFIG to a different path. Nothing was written.\n',
    );
    process.exitCode = 1;
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $3)', [
      ids.workspace,
      workspaceSlug,
      workspaceName,
    ]);
    await client.query('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, ids.workspace]);

    await client.query(
      'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
      [ids.human, ids.workspace, 'human', humanName],
    );
    await client.query(
      'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
      [ids.agent, ids.workspace, 'agent', agentName],
    );
    await client.query(
      'INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, $3, $3)',
      [ids.team, ids.workspace, teamSlug],
    );
    for (const [actorId, role] of [
      [ids.human, 'lead'],
      [ids.agent, 'member'],
    ]) {
      await client.query(
        'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
        [ids.workspace, ids.team, actorId, role],
      );
    }
    await client.query(
      'INSERT INTO project (id, workspace_id, team_id, slug, display_name) VALUES ($1, $2, $3, $4, $5)',
      [ids.project, ids.workspace, ids.team, projectSlug, projectName],
    );
    await client.query('COMMIT');
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        databaseUrl: connectionString,
        workspaceId: ids.workspace,
        agentActorId: ids.agent,
        humanActorId: ids.human,
        projectId: ids.project,
        projectSlug,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  process.stdout.write(`Written. ${configPath} holds DATABASE_URL — it is a secret.\n`);
  process.stdout.write('Start an MCP client against mneia-mcp to use it.\n');
}

try {
  await main();
} finally {
  await client.end();
}
