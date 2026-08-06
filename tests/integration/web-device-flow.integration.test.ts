import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/web/node_modules/server-only/index.js', () => ({}));

import { PostgresDeviceStore } from '../../apps/web/src/server/store/postgres-device-store.js';
import {
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
const tenantRole = `mne181_device_${runId}`;
const schemaPrefix = `mne181_${runId}`;

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TEAM_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const DEVICE_HASH = 'device-code-hash-a';
const USER_CODE = 'BCDF-GHJK';
const CONFIRMATION = '0417';
const TOKEN_HASH = 'api-token-hash-a';

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

let schemaCounter = 0;

async function withDeviceSchema<T>(
  run: (fixture: { admin: Client; store: PostgresDeviceStore }) => Promise<T>,
): Promise<T> {
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
    await seedTenants(admin);
    return await run({ admin, store: new PostgresDeviceStore(source) });
  } finally {
    await source.close();
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

async function seedTenants(admin: Client): Promise<void> {
  for (const [workspaceId, slug, actorId, actorName, teamId] of [
    [WORKSPACE_A, 'ascend', ACTOR_A, 'Ada Lovelace', TEAM_A],
    [WORKSPACE_B, 'rival', ACTOR_B, 'Grace Hopper', TEAM_B],
  ] as const) {
    await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
    await admin.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $3)', [
      workspaceId,
      slug,
      slug,
    ]);
    await admin.query(
      "INSERT INTO actor (id, workspace_id, kind, display_name, external_ref) VALUES ($1, $2, 'human', $3, $4)",
      [actorId, workspaceId, actorName, `subject_${slug}`],
    );
    await admin.query(
      "INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, 'default', 'Default')",
      [teamId, workspaceId],
    );
  }
  await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, '']);
}

const statusOf = async (admin: Client): Promise<string> => {
  const result = await admin.query('SELECT status FROM device_authorization WHERE user_code = $1', [
    USER_CODE,
  ]);
  return String(result.rows[0]?.status);
};

const describeSuite = connectionString === undefined ? describe.skip : describe;

if (connectionString === undefined && process.env.MNEIA_REQUIRE_DB === '1') {
  throw new Error(
    'MNEIA_REQUIRE_DB=1 but DATABASE_URL is unset — the device flow suite cannot run',
  );
}

describeSuite('device flow over a real engine', () => {
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
    await admin.query(`DROP ROLE IF EXISTS ${tenantRole}`);
    await admin.end();
  });

  it('walks the whole journey: start, approve, redeem, identify', async () => {
    await withDeviceSchema(async ({ admin, store }) => {
      await store.start({
        deviceCodeHash: DEVICE_HASH,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        clientLabel: 'mneia cli',
        lifetimeSeconds: 900,
      });
      expect(await statusOf(admin)).toBe('pending');
      expect(await store.poll(DEVICE_HASH)).toEqual({ status: 'pending', workspaceId: null });

      const pending = await store.findPendingByUserCode(USER_CODE);
      expect(pending?.clientLabel).toBe('mneia cli');
      expect(pending?.confirmationCode).toBe(CONFIRMATION);

      await store.decide({
        workspaceId: WORKSPACE_A,
        actorId: ACTOR_A,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        approve: true,
      });
      expect(await statusOf(admin)).toBe('approved');
      expect(await store.poll(DEVICE_HASH)).toEqual({
        status: 'approved',
        workspaceId: WORKSPACE_A,
      });

      const redeemed = await store.redeem({
        deviceCodeHash: DEVICE_HASH,
        tokenHash: TOKEN_HASH,
        label: 'mneia login',
      });
      expect(redeemed).toEqual({ workspaceId: WORKSPACE_A, actorId: ACTOR_A });
      expect(await statusOf(admin)).toBe('redeemed');

      const identity = await store.identify(TOKEN_HASH);
      expect(identity.workspaceId).toBe(WORKSPACE_A);
      expect(identity.actorId).toBe(ACTOR_A);
      expect(identity.workspaceName).toBe('ascend');
      expect(identity.actorName).toBe('Ada Lovelace');
      expect(identity.actorKind).toBe('human');
      expect(identity.teamId).toBe(TEAM_A);
    });
  });

  it('GUARD: a workspace cannot claim a code into another workspace name', async () => {
    await withDeviceSchema(async ({ admin, store }) => {
      await store.start({
        deviceCodeHash: DEVICE_HASH,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        clientLabel: '',
        lifetimeSeconds: 900,
      });

      await expect(
        store.decide({
          workspaceId: WORKSPACE_B,
          actorId: ACTOR_A,
          userCode: USER_CODE,
          confirmationCode: CONFIRMATION,
          approve: true,
        }),
      ).rejects.toThrow();

      expect(await statusOf(admin)).toBe('pending');
    });
  });

  it('GUARD: redeeming twice mints exactly one token', async () => {
    await withDeviceSchema(async ({ admin, store }) => {
      await store.start({
        deviceCodeHash: DEVICE_HASH,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        clientLabel: '',
        lifetimeSeconds: 900,
      });
      await store.decide({
        workspaceId: WORKSPACE_A,
        actorId: ACTOR_A,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        approve: true,
      });
      await store.redeem({
        deviceCodeHash: DEVICE_HASH,
        tokenHash: TOKEN_HASH,
        label: 'first',
      });

      await expect(
        store.redeem({ deviceCodeHash: DEVICE_HASH, tokenHash: 'second-hash', label: 'second' }),
      ).rejects.toMatchObject({ code: 'already_redeemed' });

      const tokens = await admin.query('SELECT count(*)::int AS n FROM api_token');
      expect(tokens.rows[0]?.n).toBe(1);
    });
  });

  it('refuses a wrong confirmation number and leaves the request pending', async () => {
    await withDeviceSchema(async ({ admin, store }) => {
      await store.start({
        deviceCodeHash: DEVICE_HASH,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        clientLabel: '',
        lifetimeSeconds: 900,
      });

      await expect(
        store.decide({
          workspaceId: WORKSPACE_A,
          actorId: ACTOR_A,
          userCode: USER_CODE,
          confirmationCode: '9999',
          approve: true,
        }),
      ).rejects.toMatchObject({ code: 'confirmation_mismatch' });

      expect(await statusOf(admin)).toBe('pending');
      const attempts = await admin.query(
        'SELECT failed_attempts FROM device_approval_attempt WHERE workspace_id = $1',
        [WORKSPACE_A],
      );
      expect(attempts.rows[0]?.failed_attempts).toBe(1);
    });
  });

  it('caps repeated wrong numbers, so a four digit code cannot be brute forced', async () => {
    await withDeviceSchema(async ({ store }) => {
      await store.start({
        deviceCodeHash: DEVICE_HASH,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        clientLabel: '',
        lifetimeSeconds: 900,
      });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          store.decide({
            workspaceId: WORKSPACE_A,
            actorId: ACTOR_A,
            userCode: USER_CODE,
            confirmationCode: '9999',
            approve: true,
          }),
        ).rejects.toMatchObject({ code: 'confirmation_mismatch' });
      }

      await expect(
        store.decide({
          workspaceId: WORKSPACE_A,
          actorId: ACTOR_A,
          userCode: USER_CODE,
          confirmationCode: CONFIRMATION,
          approve: true,
        }),
      ).rejects.toMatchObject({ code: 'too_many_attempts' });
    });
  });

  it('a denied request never mints a token', async () => {
    await withDeviceSchema(async ({ admin, store }) => {
      await store.start({
        deviceCodeHash: DEVICE_HASH,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        clientLabel: '',
        lifetimeSeconds: 900,
      });
      await store.decide({
        workspaceId: WORKSPACE_A,
        actorId: ACTOR_A,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        approve: false,
      });

      expect(await statusOf(admin)).toBe('denied');
      await expect(
        store.redeem({ deviceCodeHash: DEVICE_HASH, tokenHash: TOKEN_HASH, label: '' }),
      ).rejects.toMatchObject({ code: 'authorization_denied' });

      const tokens = await admin.query('SELECT count(*)::int AS n FROM api_token');
      expect(tokens.rows[0]?.n).toBe(0);
    });
  });

  it('an expired pending request cannot be approved or polled into a token', async () => {
    await withDeviceSchema(async ({ admin, store }) => {
      await admin.query(
        `INSERT INTO device_authorization
           (id, device_code_hash, user_code, confirmation_code, expires_at, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, now() - interval '1 minute', now() - interval '20 minutes')`,
        [DEVICE_HASH, USER_CODE, CONFIRMATION],
      );

      expect(await store.findPendingByUserCode(USER_CODE)).toBeNull();
      await expect(store.poll(DEVICE_HASH)).rejects.toMatchObject({
        code: 'authorization_expired',
      });
      await expect(
        store.decide({
          workspaceId: WORKSPACE_A,
          actorId: ACTOR_A,
          userCode: USER_CODE,
          confirmationCode: CONFIRMATION,
          approve: true,
        }),
      ).rejects.toMatchObject({ code: 'unknown_user_code' });
    });
  });

  it('a revoked token stops identifying, without the row being deleted', async () => {
    await withDeviceSchema(async ({ admin, store }) => {
      await store.start({
        deviceCodeHash: DEVICE_HASH,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        clientLabel: '',
        lifetimeSeconds: 900,
      });
      await store.decide({
        workspaceId: WORKSPACE_A,
        actorId: ACTOR_A,
        userCode: USER_CODE,
        confirmationCode: CONFIRMATION,
        approve: true,
      });
      await store.redeem({ deviceCodeHash: DEVICE_HASH, tokenHash: TOKEN_HASH, label: '' });
      expect((await store.identify(TOKEN_HASH)).workspaceId).toBe(WORKSPACE_A);

      await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE_A]);
      await admin.query('UPDATE api_token SET revoked_at = now() WHERE token_hash = $1', [
        TOKEN_HASH,
      ]);

      await expect(store.identify(TOKEN_HASH)).rejects.toMatchObject({ code: 'unknown_token' });

      const rows = await admin.query('SELECT count(*)::int AS n FROM api_token');
      expect(rows.rows[0]?.n).toBe(1);
    });
  });

  it('an unknown device code is refused rather than treated as pending', async () => {
    await withDeviceSchema(async ({ store }) => {
      await expect(store.poll('no-such-hash')).rejects.toMatchObject({
        code: 'unknown_device_code',
      });
      await expect(
        store.redeem({ deviceCodeHash: 'no-such-hash', tokenHash: TOKEN_HASH, label: '' }),
      ).rejects.toMatchObject({ code: 'unknown_device_code' });
    });
  });
});
