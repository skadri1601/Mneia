import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/web/node_modules/server-only/index.js', () => ({}));

import {
  IDENTITY_SUBJECT_SETTING,
  migrate,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlResult,
  type SqlValue,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;
const runId = `${process.pid}_${Date.now()}`;
const tenantRole = `mne101_bootstrap_${runId}`;
const schemaPrefix = `mne101_${runId}`;

const SUBJECT_A = 'user_bootstrap_a';
const SUBJECT_B = 'user_bootstrap_b';
const SUBJECT_CONCURRENT = 'user_bootstrap_concurrent';
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEAM_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DENIED_ACTOR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

class RoleSession implements PostgresSession {
  private released = false;

  constructor(
    private readonly client: Client,
    private readonly forget: (client: Client) => void,
  ) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    const result =
      params.length === 0
        ? await this.client.query(sql)
        : await this.client.query(sql, [...params]);
    return { rows: result.rows as TRow[] };
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.forget(this.client);
    await this.client.end();
  }

  async discard(): Promise<void> {
    await this.release();
  }
}

class RoleConnectionSource implements PostgresConnectionSource {
  private readonly clients = new Set<Client>();

  constructor(private readonly schema: string) {}

  async acquire(): Promise<PostgresSession> {
    const client = await connect();
    await client.query(`SET search_path TO "${this.schema}", public`);
    await client.query(`SET ROLE ${tenantRole}`);
    this.clients.add(client);
    return new RoleSession(client, (released) => this.clients.delete(released));
  }

  async close(): Promise<void> {
    const open = [...this.clients];
    this.clients.clear();
    for (const client of open) {
      await client.end();
    }
  }
}

interface AccountFixture {
  readonly admin: Client;
  readonly source: RoleConnectionSource;
}

let schemaCounter = 0;

async function withAccountSchema<T>(run: (fixture: AccountFixture) => Promise<T>): Promise<T> {
  const schema = `${schemaPrefix}_${++schemaCounter}`;
  const admin = await connect();
  const source = new RoleConnectionSource(schema);

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(admin), { appliedBy: 'integration' });
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${tenantRole}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${tenantRole}`,
    );
    return await run({ admin, source });
  } finally {
    await source.close();
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

async function withRoleSession<T>(
  source: RoleConnectionSource,
  run: (session: PostgresSession) => Promise<T>,
): Promise<T> {
  const session = await source.acquire();
  try {
    return await run(session);
  } finally {
    await session.release();
  }
}

async function seedIdentityRows(admin: Client): Promise<void> {
  for (const [workspaceId, slug] of [
    [WORKSPACE_A, 'identity-a'],
    [WORKSPACE_B, 'identity-b'],
  ] as const) {
    await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
    await admin.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $3)', [
      workspaceId,
      slug,
      slug,
    ]);
  }

  await admin.query(
    `INSERT INTO actor (id, workspace_id, kind, display_name, external_ref)
     VALUES ($1, $2, 'human', 'Human A', $3),
            ($4, $5, 'human', 'Human B', $6),
            ($7, $2, 'agent', 'Agent A', $3)`,
    [ACTOR_A, WORKSPACE_A, SUBJECT_A, ACTOR_B, WORKSPACE_B, SUBJECT_B, AGENT_A],
  );
}

async function beginIdentityLookup(session: PostgresSession, subject: string): Promise<void> {
  await session.execute('BEGIN');
  await session.execute("SELECT set_config($1, '', true)", [WORKSPACE_SETTING]);
  await session.execute('SELECT set_config($1, $2, true)', [IDENTITY_SUBJECT_SETTING, subject]);
}

interface ActorIdentityRow {
  readonly id: string;
  readonly kind: string;
  readonly external_ref: string | null;
}

const visibleActors = async (session: PostgresSession): Promise<readonly ActorIdentityRow[]> =>
  (await session.execute<ActorIdentityRow>('SELECT id, kind, external_ref FROM actor ORDER BY id'))
    .rows;

interface AccountCounts {
  readonly workspaces: number;
  readonly actors: number;
  readonly teams: number;
  readonly memberships: number;
  readonly projects: number;
}

async function accountCounts(admin: Client): Promise<AccountCounts> {
  const result = await new PgDriver(admin).execute<AccountCounts>(
    `SELECT
       (SELECT count(*)::int FROM workspace) AS workspaces,
       (SELECT count(*)::int FROM actor) AS actors,
       (SELECT count(*)::int FROM team) AS teams,
       (SELECT count(*)::int FROM team_member) AS memberships,
       (SELECT count(*)::int FROM project) AS projects`,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('expected the account count query to return one row; received none');
  }
  return row;
}

const fixedIds = (values: readonly string[]): (() => string) => {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error(`expected an id at position ${index}; received none`);
    }
    index += 1;
    return value;
  };
};

async function accountStore(source: RoleConnectionSource, idFactory?: () => string) {
  const { PostgresAccountStore } = await import(
    '../../apps/web/src/server/store/postgres-account-store.js'
  );
  return idFactory === undefined
    ? new PostgresAccountStore(source)
    : new PostgresAccountStore(source, idFactory);
}

async function scopedEntityIds(
  source: RoleConnectionSource,
  workspaceId: string,
): Promise<{ readonly workspaces: readonly string[]; readonly teams: readonly string[] }> {
  return withRoleSession(source, async (session) => {
    await session.execute('BEGIN');
    try {
      await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
      const workspaces = await session.execute<{ id: string }>(
        'SELECT id FROM workspace ORDER BY id',
      );
      const teams = await session.execute<{ id: string }>('SELECT id FROM team ORDER BY id');
      await session.execute('COMMIT');
      return {
        workspaces: workspaces.rows.map(({ id }) => id),
        teams: teams.rows.map(({ id }) => id),
      };
    } catch (error) {
      await session.execute('ROLLBACK');
      throw error;
    }
  });
}

async function installWriteFailure(admin: Client, table: 'team' | 'team_member'): Promise<void> {
  const functionName = `fail_${table}_write`;
  await admin.query(
    `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'induced ${table} write failure';
     END;
     $$`,
  );
  await admin.query(
    `CREATE TRIGGER ${functionName} BEFORE INSERT ON ${table}
     FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
  );
}

describe.skipIf(connectionString === undefined)('web account bootstrap against Postgres', () => {
  beforeAll(async () => {
    const admin = await connect();
    await admin.query(
      `CREATE ROLE ${tenantRole}
       NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
    );
    await admin.query(`GRANT ${tenantRole} TO CURRENT_USER`);
    await admin.end();
  });

  afterAll(async () => {
    const admin = await connect();
    await admin.query(
      `DO $$
       DECLARE schema_name TEXT;
       BEGIN
         FOR schema_name IN
           SELECT nspname FROM pg_namespace WHERE starts_with(nspname, '${schemaPrefix}_')
         LOOP
           EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
         END LOOP;
       END $$`,
    );
    await admin.query(`DROP ROLE IF EXISTS ${tenantRole}`);
    await admin.end();
  });

  it('fails closed and exposes only the matching human actor during identity lookup', async () => {
    await withAccountSchema(async ({ admin, source }) => {
      await seedIdentityRows(admin);

      await withRoleSession(source, async (session) => {
        await session.execute('BEGIN');
        await session.execute("SELECT set_config($1, '', true)", [WORKSPACE_SETTING]);
        await session.execute("SELECT set_config($1, '', true)", [IDENTITY_SUBJECT_SETTING]);
        expect(await visibleActors(session)).toEqual([]);

        await session.execute('SELECT set_config($1, $2, true)', [
          IDENTITY_SUBJECT_SETTING,
          SUBJECT_A,
        ]);
        expect(await visibleActors(session)).toEqual([
          { id: ACTOR_A, kind: 'human', external_ref: SUBJECT_A },
        ]);

        await session.execute('SELECT set_config($1, $2, true)', [
          IDENTITY_SUBJECT_SETTING,
          SUBJECT_B,
        ]);
        expect(await visibleActors(session)).toEqual([
          { id: ACTOR_B, kind: 'human', external_ref: SUBJECT_B },
        ]);
        await session.execute('ROLLBACK');
      });
    });
  });

  it('rejects a duplicate human external reference across workspaces', async () => {
    await withAccountSchema(async ({ admin }) => {
      await seedIdentityRows(admin);
      await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE_B]);

      await expect(
        admin.query(
          `INSERT INTO actor (id, workspace_id, kind, display_name, external_ref)
           VALUES ($1, $2, 'human', 'Duplicate Human', $3)`,
          [DENIED_ACTOR, WORKSPACE_B, SUBJECT_A],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('denies subject-only actor inserts, updates, deletes, and row locks', async () => {
    await withAccountSchema(async ({ admin, source }) => {
      await seedIdentityRows(admin);

      await withRoleSession(source, async (session) => {
        await beginIdentityLookup(session, SUBJECT_A);
        await expect(
          session.execute(
            `INSERT INTO actor (id, workspace_id, kind, display_name, external_ref)
             VALUES ($1, $2, 'human', 'Denied', 'user_denied')`,
            [DENIED_ACTOR, WORKSPACE_A],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await session.execute('ROLLBACK');

        await beginIdentityLookup(session, SUBJECT_A);
        const updated = await session.execute<{ id: string }>(
          "UPDATE actor SET display_name = 'Changed' WHERE id = $1 RETURNING id",
          [ACTOR_A],
        );
        expect(updated.rows).toEqual([]);
        await session.execute('ROLLBACK');

        await beginIdentityLookup(session, SUBJECT_A);
        const deleted = await session.execute<{ id: string }>(
          'DELETE FROM actor WHERE id = $1 RETURNING id',
          [ACTOR_A],
        );
        expect(deleted.rows).toEqual([]);
        await session.execute('ROLLBACK');

        await beginIdentityLookup(session, SUBJECT_A);
        const locked = await session.execute<{ id: string }>(
          'SELECT id FROM actor WHERE id = $1 FOR UPDATE',
          [ACTOR_A],
        );
        expect(locked.rows).toEqual([]);
        await session.execute('ROLLBACK');
      });

      const unchanged = await admin.query('SELECT display_name FROM actor WHERE id = $1', [
        ACTOR_A,
      ]);
      expect(unchanged.rows[0]?.display_name).toBe('Human A');
    });
  });

  it('clears the transaction-local identity subject after commit and rollback', async () => {
    await withAccountSchema(async ({ source }) => {
      await withRoleSession(source, async (session) => {
        await beginIdentityLookup(session, SUBJECT_A);
        await session.execute('COMMIT');
        const afterCommit = await session.execute<{ value: string | null }>(
          'SELECT current_setting($1, true) AS value',
          [IDENTITY_SUBJECT_SETTING],
        );
        expect(afterCommit.rows[0]?.value === null || afterCommit.rows[0]?.value === '').toBe(true);

        await beginIdentityLookup(session, SUBJECT_B);
        await session.execute('ROLLBACK');
        const afterRollback = await session.execute<{ value: string | null }>(
          'SELECT current_setting($1, true) AS value',
          [IDENTITY_SUBJECT_SETTING],
        );
        expect(afterRollback.rows[0]?.value === null || afterRollback.rows[0]?.value === '').toBe(
          true,
        );
      });
    });
  });

  it('creates the exact solo account once and reuses it without creating a project', async () => {
    await withAccountSchema(async ({ admin, source }) => {
      const store = await accountStore(source, fixedIds([WORKSPACE_A, ACTOR_A, TEAM_A]));

      const created = await store.bootstrapSoloAccount({
        subject: SUBJECT_A,
        displayName: 'Ada Lovelace',
      });
      const reused = await store.bootstrapSoloAccount({
        subject: SUBJECT_A,
        displayName: 'Ignored Rename',
      });

      expect(created).toEqual({
        workspace: {
          id: WORKSPACE_A,
          slug: `workspace-${WORKSPACE_A}`,
          displayName: 'Ada Lovelace',
          plan: 'solo',
          billingStatus: 'active',
          billingCustomerRef: null,
          seatsPurchased: null,
          checkpointAllowance: null,
          trialEndsAt: null,
          createdAt: expect.any(Date),
        },
        actor: {
          id: ACTOR_A,
          workspaceId: WORKSPACE_A,
          kind: 'human',
          displayName: 'Ada Lovelace',
          externalRef: SUBJECT_A,
          createdAt: expect.any(Date),
        },
        team: {
          id: TEAM_A,
          workspaceId: WORKSPACE_A,
          slug: 'default',
          displayName: 'Default',
          function: 'engineering',
          createdAt: expect.any(Date),
        },
        membership: {
          workspaceId: WORKSPACE_A,
          teamId: TEAM_A,
          actorId: ACTOR_A,
          role: 'lead',
          addedAt: expect.any(Date),
        },
      });
      expect(reused).toEqual(created);
      expect(await accountCounts(admin)).toEqual({
        workspaces: 1,
        actors: 1,
        teams: 1,
        memberships: 1,
        projects: 0,
      });
    });
  });

  it('serializes concurrent bootstrap calls into one account', async () => {
    await withAccountSchema(async ({ admin, source }) => {
      const store = await accountStore(source);
      const [first, second] = await Promise.all([
        store.bootstrapSoloAccount({
          subject: SUBJECT_CONCURRENT,
          displayName: 'Concurrent Human',
        }),
        store.bootstrapSoloAccount({
          subject: SUBJECT_CONCURRENT,
          displayName: 'Concurrent Human',
        }),
      ]);

      expect(second.workspace.id).toBe(first.workspace.id);
      expect(second.actor.id).toBe(first.actor.id);
      expect(second.team.id).toBe(first.team.id);
      expect(second.membership).toEqual(first.membership);
      expect(await accountCounts(admin)).toEqual({
        workspaces: 1,
        actors: 1,
        teams: 1,
        memberships: 1,
        projects: 0,
      });
    });
  });

  it('isolates two bootstrapped subjects after workspace scope is established', async () => {
    await withAccountSchema(async ({ source }) => {
      const store = await accountStore(source);
      const accountA = await store.bootstrapSoloAccount({
        subject: SUBJECT_A,
        displayName: 'Human A',
      });
      const accountB = await store.bootstrapSoloAccount({
        subject: SUBJECT_B,
        displayName: 'Human B',
      });

      expect(accountA.workspace.id).not.toBe(accountB.workspace.id);
      expect(accountA.actor.externalRef).toBe(SUBJECT_A);
      expect(accountB.actor.externalRef).toBe(SUBJECT_B);

      const visibleToA = await scopedEntityIds(source, accountA.workspace.id);
      expect(visibleToA).toEqual({
        workspaces: [accountA.workspace.id],
        teams: [accountA.team.id],
      });
      expect(visibleToA.workspaces).not.toContain(accountB.workspace.id);
      expect(visibleToA.teams).not.toContain(accountB.team.id);

      const visibleToB = await scopedEntityIds(source, accountB.workspace.id);
      expect(visibleToB).toEqual({
        workspaces: [accountB.workspace.id],
        teams: [accountB.team.id],
      });
      expect(visibleToB.workspaces).not.toContain(accountA.workspace.id);
      expect(visibleToB.teams).not.toContain(accountA.team.id);
    });
  });

  it.each(['team', 'team_member'] as const)(
    'rolls back the entire account when the %s write fails',
    async (table) => {
      await withAccountSchema(async ({ admin, source }) => {
        await installWriteFailure(admin, table);
        const store = await accountStore(source);

        await expect(
          store.bootstrapSoloAccount({
            subject: `user_failed_${table}`,
            displayName: 'Failed Human',
          }),
        ).rejects.toThrow(`induced ${table} write failure`);

        expect(await accountCounts(admin)).toEqual({
          workspaces: 0,
          actors: 0,
          teams: 0,
          memberships: 0,
          projects: 0,
        });
      });
    },
  );
});
