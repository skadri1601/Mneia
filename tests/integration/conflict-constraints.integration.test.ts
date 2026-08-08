import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BOOKKEEPING_TABLE,
  MIGRATIONS,
  MigrationError,
  migrate,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const WS = '77777777-7777-4777-8777-777777777777';

const PAIR_CONSTRAINTS_VERSION = 8;

const LATEST_VERSION = MIGRATIONS.reduce((highest, { version }) => Math.max(highest, version), 0);

type MigrationList = typeof MIGRATIONS;

const BEFORE_PAIR_CONSTRAINTS: MigrationList = MIGRATIONS.filter(
  ({ version }) => version < PAIR_CONSTRAINTS_VERSION,
);

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

const setWorkspace = async (client: Client, id: string): Promise<void> => {
  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, id]);
};

let schemaCounter = 0;

interface Seed {
  readonly actorId: string;
  readonly projectId: string;
  readonly otherProjectId: string;
  readonly itemA: string;
  readonly itemB: string;
  readonly itemC: string;
}

async function seedWorkspace(client: Client): Promise<Seed> {
  await setWorkspace(client, WS);
  await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
    WS,
    'acme',
  ]);

  const actor = await client.query(
    "INSERT INTO actor (id, workspace_id, kind, display_name) VALUES (gen_random_uuid(), $1, 'human', 'acme-human') RETURNING id",
    [WS],
  );
  const actorId = actor.rows[0]?.id as string;

  const projects: string[] = [];
  for (const slug of ['acme-proj', 'acme-other-proj']) {
    const project = await client.query(
      'INSERT INTO project (id, workspace_id, slug) VALUES (gen_random_uuid(), $1, $2) RETURNING id',
      [WS, slug],
    );
    projects.push(project.rows[0]?.id as string);
  }
  const projectId = projects[0] as string;

  const items: string[] = [];
  for (const title of ['acme ships on Postgres', 'acme ships on SQLite', 'acme ships on Dynamo']) {
    const item = await client.query(
      `INSERT INTO context_item (id, workspace_id, project_id, kind, title, asserted_by)
       VALUES (gen_random_uuid(), $1, $2, 'decision', $3, $4) RETURNING id`,
      [WS, projectId, title, actorId],
    );
    items.push(item.rows[0]?.id as string);
  }

  return {
    actorId,
    projectId,
    otherProjectId: projects[1] as string,
    itemA: items[0] as string,
    itemB: items[1] as string,
    itemC: items[2] as string,
  };
}

async function withSchema<T>(
  run: (client: Client, seed: Seed) => Promise<T>,
  migrations: MigrationList = MIGRATIONS,
): Promise<T> {
  const schema = `mne207_${process.pid}_${++schemaCounter}`;
  const client = await connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(client), { appliedBy: 'integration', migrations });
    const seed = await seedWorkspace(client);
    return await run(client, seed);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

const detect = async (
  client: Client,
  projectId: string,
  itemA: string,
  itemB: string,
): Promise<string> => {
  const result = await client.query(
    `INSERT INTO conflict (id, workspace_id, project_id, item_a, item_b)
     VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
    [WS, projectId, itemA, itemB],
  );
  return result.rows[0]?.id as string;
};

const detectFailure = (
  client: Client,
  projectId: string,
  itemA: string,
  itemB: string,
): Promise<unknown> => detect(client, projectId, itemA, itemB).catch((e: unknown) => e);

const resolveConflict = async (client: Client, id: string, actorId: string): Promise<void> => {
  const rationale = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'conflict' AND column_name = 'rationale'`,
  );
  const setsRationale = rationale.rows.length > 0;

  await client.query(
    `UPDATE conflict
        SET resolved_at = now(), resolved_by = $1, resolution = 'a_wins'
            ${setsRationale ? ", rationale = 'a was confirmed by a human'" : ''}
      WHERE id = $2`,
    [actorId, id],
  );
};

const storeVersion = async (client: Client): Promise<number> => {
  const result = await client.query(`SELECT max(version) AS version FROM ${BOOKKEEPING_TABLE}`);
  return Number(result.rows[0]?.version);
};

const openConflicts = async (client: Client): Promise<readonly Record<string, unknown>[]> => {
  const result = await client.query(
    'SELECT id, project_id FROM conflict WHERE resolved_at IS NULL ORDER BY id',
  );
  return result.rows;
};

describe.skipIf(connectionString === undefined)('conflict pair constraints', () => {
  afterAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$
       DECLARE s TEXT;
       BEGIN
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne207_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.end();
  });

  it('ships the pair constraints as a validated check and a partial unique index', async () => {
    expect(MIGRATIONS.find(({ version }) => version === PAIR_CONSTRAINTS_VERSION)?.name).toBe(
      'conflict-pair-constraints',
    );

    await withSchema(async (client) => {
      const constraint = await client.query(
        `SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'conflict_items_distinct'
            AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())`,
      );

      expect(constraint.rows).toHaveLength(1);
      expect(constraint.rows[0]?.convalidated).toBe(true);
      expect(constraint.rows[0]?.def).toBe('CHECK ((item_a <> item_b))');

      const index = await client.query(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'conflict'
            AND indexname = 'conflict_open_pair_unique'`,
      );

      expect(index.rows).toHaveLength(1);
      const indexdef = index.rows[0]?.indexdef as string;
      expect(indexdef).toContain('CREATE UNIQUE INDEX');
      expect(indexdef).toContain(
        '(workspace_id, project_id, LEAST(item_a, item_b), GREATEST(item_a, item_b))',
      );
      expect(indexdef).toContain('WHERE (resolved_at IS NULL)');
    });
  });

  it('rejects a conflict claiming an item contradicts itself', async () => {
    await withSchema(async (client, seed) => {
      const error = await detectFailure(client, seed.projectId, seed.itemA, seed.itemA);

      expect((error as { code?: string }).code).toBe('23514');
      expect((error as { constraint?: string }).constraint).toBe('conflict_items_distinct');
    });
  });

  it('rejects a second open conflict over the same pair, detected in either order', async () => {
    await withSchema(async (client, seed) => {
      await detect(client, seed.projectId, seed.itemA, seed.itemB);

      const mirrored = await detectFailure(client, seed.projectId, seed.itemB, seed.itemA);
      const repeated = await detectFailure(client, seed.projectId, seed.itemA, seed.itemB);

      for (const error of [mirrored, repeated]) {
        expect((error as { code?: string }).code).toBe('23505');
        expect((error as { constraint?: string }).constraint).toBe('conflict_open_pair_unique');
      }

      expect(await openConflicts(client)).toHaveLength(1);
    });
  });

  it('accepts a re-detection once the pair is resolved, while still allowing only one open at a time', async () => {
    await withSchema(async (client, seed) => {
      const first = await detect(client, seed.projectId, seed.itemA, seed.itemB);
      await resolveConflict(client, first, seed.actorId);

      const second = await detect(client, seed.projectId, seed.itemB, seed.itemA);
      expect(second).not.toBe(first);

      const third = await detectFailure(client, seed.projectId, seed.itemA, seed.itemB);
      expect((third as { code?: string }).code).toBe('23505');

      const all = await client.query('SELECT id FROM conflict');
      expect(all.rows).toHaveLength(2);
      expect(await openConflicts(client)).toHaveLength(1);
    });
  });

  it('keeps distinct pairs in one project independent', async () => {
    await withSchema(async (client, seed) => {
      await detect(client, seed.projectId, seed.itemA, seed.itemB);
      await detect(client, seed.projectId, seed.itemA, seed.itemC);
      await detect(client, seed.projectId, seed.itemC, seed.itemB);

      expect(await openConflicts(client)).toHaveLength(3);
    });
  });

  it('scopes open-pair uniqueness to the project', async () => {
    await withSchema(async (client, seed) => {
      await detect(client, seed.projectId, seed.itemA, seed.itemB);
      await detect(client, seed.otherProjectId, seed.itemB, seed.itemA);

      const open = await openConflicts(client);
      expect(new Set(open.map((row) => row.project_id as string))).toEqual(
        new Set([seed.projectId, seed.otherProjectId]),
      );
    });
  });

  it('refuses to apply over a self-pair written before the constraint existed', async () => {
    await withSchema(async (client, seed) => {
      await detect(client, seed.projectId, seed.itemA, seed.itemA);

      const error = await migrate(new PgDriver(client), { appliedBy: 'integration' }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).code).toBe('apply_failed');
      expect(((error as MigrationError).cause as { code?: string }).code).toBe('23514');
      expect(await storeVersion(client)).toBe(PAIR_CONSTRAINTS_VERSION - 1);
    }, BEFORE_PAIR_CONSTRAINTS);
  });

  it('refuses to apply over duplicate open pairs, and applies once one of them is resolved', async () => {
    await withSchema(async (client, seed) => {
      const first = await detect(client, seed.projectId, seed.itemA, seed.itemB);
      await detect(client, seed.projectId, seed.itemB, seed.itemA);

      const error = await migrate(new PgDriver(client), { appliedBy: 'integration' }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).code).toBe('apply_failed');
      expect(((error as MigrationError).cause as { code?: string }).code).toBe('23505');
      expect(await storeVersion(client)).toBe(PAIR_CONSTRAINTS_VERSION - 1);

      await resolveConflict(client, first, seed.actorId);
      const applied = await migrate(new PgDriver(client), { appliedBy: 'integration' });

      expect(applied.schemaVersion).toBe(LATEST_VERSION);
      expect(await storeVersion(client)).toBeGreaterThanOrEqual(PAIR_CONSTRAINTS_VERSION);
    }, BEFORE_PAIR_CONSTRAINTS);
  });
});
