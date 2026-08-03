import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_TOKEN_HASH_SETTING,
  DEVICE_CODE_HASH_SETTING,
  DEVICE_USER_CODE_SETTING,
  migrate,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;
const runId = `${process.pid}_${Date.now()}`;
const tenantRole = `mne181_device_${runId}`;
const schemaPrefix = `mne181_${runId}`;

const WORKSPACE_A = '11111111-1111-4111-8111-1111111111aa';
const WORKSPACE_B = '11111111-1111-4111-8111-1111111111bb';
const ACTOR_A = '22222222-2222-4222-8222-2222222222aa';
const ACTOR_B = '22222222-2222-4222-8222-2222222222bb';
const AUTH_A = '33333333-3333-4333-8333-3333333333aa';
const AUTH_B = '33333333-3333-4333-8333-3333333333bb';
const TOKEN_A = '44444444-4444-4444-8444-4444444444aa';

const CODE_HASH_A = 'a'.repeat(64);
const CODE_HASH_B = 'b'.repeat(64);
const USER_CODE_A = 'BCDF-GHJK';
const USER_CODE_B = 'LMNP-QRST';
const TOKEN_HASH_A = 'f'.repeat(64);

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

let schemaCounter = 0;

interface Fixture {
  readonly admin: Client;
  readonly schema: string;
}

/** A session running as the non-privileged tenant role, so RLS actually applies. */
async function tenantSession(schema: string): Promise<Client> {
  const client = await connect();
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`SET ROLE ${tenantRole}`);
  return client;
}

const setGuc = (client: Client, name: string, value: string): Promise<unknown> =>
  client.query('SELECT set_config($1, $2, false)', [name, value]);

async function withSchema<T>(run: (fixture: Fixture) => Promise<T>): Promise<T> {
  const schema = `${schemaPrefix}_${++schemaCounter}`;
  const admin = await connect();

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(admin), { appliedBy: 'integration' });
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${tenantRole}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${tenantRole}`,
    );
    await seed(admin);
    return await run({ admin, schema });
  } finally {
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

async function seed(admin: Client): Promise<void> {
  for (const [id, slug] of [
    [WORKSPACE_A, 'alpha'],
    [WORKSPACE_B, 'beta'],
  ] as const) {
    await admin.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
      id,
      slug,
    ]);
  }

  for (const [id, workspaceId, name] of [
    [ACTOR_A, WORKSPACE_A, 'Ada'],
    [ACTOR_B, WORKSPACE_B, 'Bruno'],
  ] as const) {
    await admin.query(
      'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3::actor_kind, $4)',
      [id, workspaceId, 'human', name],
    );
  }

  for (const [id, hash, userCode] of [
    [AUTH_A, CODE_HASH_A, USER_CODE_A],
    [AUTH_B, CODE_HASH_B, USER_CODE_B],
  ] as const) {
    await admin.query(
      `INSERT INTO device_authorization (id, device_code_hash, user_code, confirmation_code, expires_at)
       VALUES ($1, $2, $3, '4217', now() + interval '10 minutes')`,
      [id, hash, userCode],
    );
  }
}

describe.skipIf(connectionString === undefined)('device authorization RLS', () => {
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
           SELECT nspname FROM pg_namespace WHERE starts_with(nspname, '${schemaPrefix}')
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
         END LOOP;
       END $$`,
    );
    await admin.query(`DROP ROLE IF EXISTS ${tenantRole}`);
    await admin.end();
  });

  it('fails closed: with no setting at all the table reads empty', async () => {
    await withSchema(async ({ schema }) => {
      const session = await tenantSession(schema);
      try {
        const rows = await session.query('SELECT id FROM device_authorization');
        expect(rows.rows).toEqual([]);
      } finally {
        await session.end();
      }
    });
  });

  it('shows the holder of a device code exactly their own authorization', async () => {
    await withSchema(async ({ schema }) => {
      const session = await tenantSession(schema);
      try {
        await setGuc(session, DEVICE_CODE_HASH_SETTING, CODE_HASH_A);
        const rows = await session.query('SELECT id FROM device_authorization');

        expect(rows.rows.map((row) => row.id)).toEqual([AUTH_A]);
      } finally {
        await session.end();
      }
    });
  });

  it('contains the device-code read: a session already in a workspace cannot use it', async () => {
    await withSchema(async ({ schema }) => {
      const session = await tenantSession(schema);
      try {
        await setGuc(session, WORKSPACE_SETTING, WORKSPACE_B);
        await setGuc(session, DEVICE_CODE_HASH_SETTING, CODE_HASH_A);
        const rows = await session.query('SELECT id FROM device_authorization');

        expect(rows.rows).toEqual([]);
      } finally {
        await session.end();
      }
    });
  });

  it('hides a pending authorization from a workspace that does not present its user code', async () => {
    await withSchema(async ({ schema }) => {
      const session = await tenantSession(schema);
      try {
        await setGuc(session, WORKSPACE_SETTING, WORKSPACE_B);
        const rows = await session.query('SELECT id FROM device_authorization');

        expect(rows.rows).toEqual([]);
      } finally {
        await session.end();
      }
    });
  });

  it('refuses to let one workspace claim a code into another workspace', async () => {
    await withSchema(async ({ schema }) => {
      const session = await tenantSession(schema);
      try {
        await setGuc(session, WORKSPACE_SETTING, WORKSPACE_B);
        await setGuc(session, DEVICE_USER_CODE_SETTING, USER_CODE_A);

        await expect(
          session.query(
            `UPDATE device_authorization
                SET status = 'approved', claimed_workspace_id = $1, claimed_actor_id = $2
              WHERE user_code = $3`,
            [WORKSPACE_A, ACTOR_A, USER_CODE_A],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await session.end();
      }
    });
  });

  it('stops a device code holder from approving their own authorization', async () => {
    await withSchema(async ({ schema }) => {
      const session = await tenantSession(schema);
      try {
        await setGuc(session, DEVICE_CODE_HASH_SETTING, CODE_HASH_A);

        const updated = await session.query(
          `UPDATE device_authorization
              SET status = 'approved', claimed_workspace_id = $1, claimed_actor_id = $2
            WHERE device_code_hash = $3`,
          [WORKSPACE_B, ACTOR_B, CODE_HASH_A],
        );

        expect(updated.rowCount).toBe(0);
      } finally {
        await session.end();
      }
    });
  });

  it('documents the boundary RLS cannot hold: a workspace may claim a code it was shown', async () => {
    await withSchema(async ({ admin, schema }) => {
      const session = await tenantSession(schema);
      try {
        await setGuc(session, WORKSPACE_SETTING, WORKSPACE_B);
        await setGuc(session, DEVICE_USER_CODE_SETTING, USER_CODE_A);

        const updated = await session.query(
          `UPDATE device_authorization
              SET status = 'approved', claimed_workspace_id = $1, claimed_actor_id = $2
            WHERE user_code = $3`,
          [WORKSPACE_B, ACTOR_B, USER_CODE_A],
        );

        expect(updated.rowCount).toBe(1);
      } finally {
        await session.end();
      }

      const stamped = await admin.query(
        'SELECT claimed_workspace_id, claimed_at FROM device_authorization WHERE id = $1',
        [AUTH_A],
      );
      expect(stamped.rows[0]?.claimed_workspace_id).toBe(WORKSPACE_B);
      expect(stamped.rows[0]?.claimed_at).not.toBeNull();
    });
  });

  it('closes the user-code lookup once a code is no longer pending', async () => {
    await withSchema(async ({ admin, schema }) => {
      await admin.query(
        `UPDATE device_authorization
            SET status = 'approved', claimed_workspace_id = $1, claimed_actor_id = $2
          WHERE id = $3`,
        [WORKSPACE_A, ACTOR_A, AUTH_A],
      );

      const session = await tenantSession(schema);
      try {
        await setGuc(session, WORKSPACE_SETTING, WORKSPACE_B);
        await setGuc(session, DEVICE_USER_CODE_SETTING, USER_CODE_A);
        const rows = await session.query('SELECT id FROM device_authorization');

        expect(rows.rows).toEqual([]);
      } finally {
        await session.end();
      }
    });
  });

  it('refuses to mutate the secrets or the lifetime of an authorization', async () => {
    await withSchema(async ({ schema }) => {
      const session = await tenantSession(schema);
      try {
        await setGuc(session, WORKSPACE_SETTING, WORKSPACE_B);
        await setGuc(session, DEVICE_USER_CODE_SETTING, USER_CODE_A);

        await expect(
          session.query(
            `UPDATE device_authorization
                SET status = 'approved', claimed_workspace_id = $1, claimed_actor_id = $2,
                    expires_at = now() + interval '10 years'
              WHERE user_code = $3`,
            [WORKSPACE_B, ACTOR_B, USER_CODE_A],
          ),
        ).rejects.toMatchObject({ message: expect.stringMatching(/immutable/i) });
      } finally {
        await session.end();
      }
    });
  });

  it('refuses a decision that does not name the deciding actor', async () => {
    await withSchema(async ({ admin }) => {
      await expect(
        admin.query(`UPDATE device_authorization SET status = 'approved' WHERE id = $1`, [AUTH_A]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('refuses to move an approved authorization back to pending', async () => {
    await withSchema(async ({ admin }) => {
      await admin.query(
        `UPDATE device_authorization
            SET status = 'approved', claimed_workspace_id = $1, claimed_actor_id = $2
          WHERE id = $3`,
        [WORKSPACE_A, ACTOR_A, AUTH_A],
      );

      await expect(
        admin.query(
          `UPDATE device_authorization
              SET status = 'pending', claimed_workspace_id = NULL, claimed_actor_id = NULL
            WHERE id = $1`,
          [AUTH_A],
        ),
      ).rejects.toMatchObject({ message: expect.stringMatching(/cannot move from/i) });
    });
  });

  it('redeems an approved authorization exactly once', async () => {
    await withSchema(async ({ admin, schema }) => {
      await admin.query(
        `UPDATE device_authorization
            SET status = 'approved', claimed_workspace_id = $1, claimed_actor_id = $2
          WHERE id = $3`,
        [WORKSPACE_A, ACTOR_A, AUTH_A],
      );

      const redeem = async (): Promise<number> => {
        const session = await tenantSession(schema);
        try {
          await setGuc(session, WORKSPACE_SETTING, WORKSPACE_A);
          await setGuc(session, DEVICE_CODE_HASH_SETTING, CODE_HASH_A);
          const result = await session.query(
            `UPDATE device_authorization SET status = 'redeemed'
              WHERE device_code_hash = $1 AND status = 'approved' RETURNING id`,
            [CODE_HASH_A],
          );
          return result.rowCount ?? 0;
        } finally {
          await session.end();
        }
      };

      expect(await redeem()).toBe(1);
      expect(await redeem()).toBe(0);
    });
  });

  it('hides an expired authorization without any sweeper having run', async () => {
    await withSchema(async ({ admin, schema }) => {
      const expiredId = '33333333-3333-4333-8333-3333333333cc';
      const expiredCode = 'VWXZ-BCDF';

      // Seeded already expired: the transition guard makes expires_at immutable,
      // so an expired row cannot be manufactured by updating a live one.
      await admin.query(
        `INSERT INTO device_authorization
           (id, device_code_hash, user_code, confirmation_code, created_at, expires_at)
         VALUES ($1, $2, $3, '4217', now() - interval '20 minutes', now() - interval '1 minute')`,
        [expiredId, 'c'.repeat(64), expiredCode],
      );

      const session = await tenantSession(schema);
      try {
        await setGuc(session, WORKSPACE_SETTING, WORKSPACE_B);
        await setGuc(session, DEVICE_USER_CODE_SETTING, expiredCode);
        const visible = await session.query('SELECT id FROM device_authorization');
        expect(visible.rows).toEqual([]);

        const claimed = await session.query(
          `UPDATE device_authorization
              SET status = 'approved', claimed_workspace_id = $1, claimed_actor_id = $2
            WHERE user_code = $3`,
          [WORKSPACE_B, ACTOR_B, expiredCode],
        );
        expect(claimed.rowCount).toBe(0);
      } finally {
        await session.end();
      }
    });
  });

  it('shows a bearer token only to the holder of its hash, and never across a workspace', async () => {
    await withSchema(async ({ admin, schema }) => {
      await admin.query(
        `INSERT INTO api_token (id, workspace_id, actor_id, token_hash)
         VALUES ($1, $2, $3, $4)`,
        [TOKEN_A, WORKSPACE_A, ACTOR_A, TOKEN_HASH_A],
      );

      const bearer = await tenantSession(schema);
      try {
        await setGuc(bearer, API_TOKEN_HASH_SETTING, TOKEN_HASH_A);
        const rows = await bearer.query('SELECT workspace_id FROM api_token');
        expect(rows.rows.map((row) => row.workspace_id)).toEqual([WORKSPACE_A]);
      } finally {
        await bearer.end();
      }

      const other = await tenantSession(schema);
      try {
        await setGuc(other, WORKSPACE_SETTING, WORKSPACE_B);
        await setGuc(other, API_TOKEN_HASH_SETTING, TOKEN_HASH_A);
        const rows = await other.query('SELECT id FROM api_token');
        expect(rows.rows).toEqual([]);
      } finally {
        await other.end();
      }
    });
  });

  it('makes a revoked token invisible rather than merely filtered', async () => {
    await withSchema(async ({ admin, schema }) => {
      await admin.query(
        `INSERT INTO api_token (id, workspace_id, actor_id, token_hash, revoked_at)
         VALUES ($1, $2, $3, $4, now())`,
        [TOKEN_A, WORKSPACE_A, ACTOR_A, TOKEN_HASH_A],
      );

      const session = await tenantSession(schema);
      try {
        await setGuc(session, API_TOKEN_HASH_SETTING, TOKEN_HASH_A);
        const rows = await session.query('SELECT id FROM api_token');

        expect(rows.rows).toEqual([]);
      } finally {
        await session.end();
      }
    });
  });

  it('refuses to mint a token into another workspace', async () => {
    await withSchema(async ({ schema }) => {
      const session = await tenantSession(schema);
      try {
        await setGuc(session, WORKSPACE_SETTING, WORKSPACE_A);

        await expect(
          session.query(
            `INSERT INTO api_token (id, workspace_id, actor_id, token_hash)
             VALUES ($1, $2, $3, $4)`,
            [TOKEN_A, WORKSPACE_B, ACTOR_B, TOKEN_HASH_A],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await session.end();
      }
    });
  });
});
