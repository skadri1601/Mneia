import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/web/node_modules/server-only/index.js', () => ({}));

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
const tenantRole = `mne181_tok_${runId}`;
const schemaPrefix = `mne181_tok_${runId}`;

const OWNER = 'user_token_owner';
const COLLEAGUE = 'user_token_colleague';
const COLLEAGUE_EMAIL = 'colleague@example.com';
const OUTSIDER = 'user_token_outsider';

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

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
    for (const client of open) await client.end();
  }
}

let schemaCounter = 0;

async function withSchema<T>(
  run: (fixture: { admin: Client; source: RoleConnectionSource }) => Promise<T>,
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
    return await run({ admin, source });
  } finally {
    await source.close();
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

async function stores(source: RoleConnectionSource) {
  const { PostgresAccountStore } = await import(
    '../../apps/web/src/server/store/postgres-account-store.js'
  );
  const { PostgresTokenStore } = await import(
    '../../apps/web/src/server/store/postgres-token-store.js'
  );
  const { PostgresDeviceStore } = await import(
    '../../apps/web/src/server/store/postgres-device-store.js'
  );
  return {
    accounts: new PostgresAccountStore(source),
    tokens: new PostgresTokenStore(source),
    devices: new PostgresDeviceStore(source),
  };
}

interface MintedFor {
  readonly workspaceId: string;
  readonly actorId: string;
}

async function mintToken(
  devices: Awaited<ReturnType<typeof stores>>['devices'],
  who: MintedFor,
  secret: string,
  label: string,
): Promise<string> {
  const deviceCodeHash = hash(`device:${secret}`);
  const userCode = secret.slice(0, 4).toUpperCase().padEnd(4, 'A');
  const confirmationCode = '1234';

  await devices.start({
    deviceCodeHash,
    userCode,
    confirmationCode,
    clientLabel: label,
    lifetimeSeconds: 600,
  });
  await devices.decide({
    workspaceId: who.workspaceId,
    actorId: who.actorId,
    userCode,
    confirmationCode,
    approve: true,
  });
  const tokenHash = hash(`token:${secret}`);
  await devices.redeem({ deviceCodeHash, tokenHash, label });
  return tokenHash;
}

const inSevenDays = (): Date => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

describe.skipIf(connectionString === undefined)('API token management against Postgres', () => {
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
      `DO $$ DECLARE schema_name TEXT; BEGIN
         FOR schema_name IN SELECT nspname FROM pg_namespace WHERE starts_with(nspname, '${schemaPrefix}_')
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name); END LOOP; END $$`,
    );
    await admin.query(`DROP ROLE IF EXISTS ${tenantRole}`);
    await admin.end();
  });

  it('lists a minted token with the actor who holds it, and never another workspace’s', async () => {
    await withSchema(async ({ source }) => {
      const { accounts, tokens, devices } = await stores(source);

      const owner = await accounts.bootstrapSoloAccount({
        subject: OWNER,
        displayName: 'Ada Lovelace',
      });
      const outsider = await accounts.bootstrapSoloAccount({
        subject: OUTSIDER,
        displayName: 'Someone Else',
      });

      await mintToken(
        devices,
        { workspaceId: owner.workspace.id, actorId: owner.actor.id },
        'ownr',
        'ada-laptop',
      );
      await mintToken(
        devices,
        { workspaceId: outsider.workspace.id, actorId: outsider.actor.id },
        'outs',
        'their-laptop',
      );

      const mine = await tokens.listTokens({ workspaceId: owner.workspace.id });
      expect(mine).toHaveLength(1);
      expect(mine[0]?.label).toBe('ada-laptop');
      expect(mine[0]?.actorId).toBe(owner.actor.id);
      expect(mine[0]?.actorDisplayName).toBe('Ada Lovelace');
      expect(mine[0]?.issuedByDeviceFlow).toBe(true);
      expect(mine[0]?.scopes).toEqual(['*']);
      expect(mine[0]?.lastUsedAt).toBeNull();

      const theirs = await tokens.listTokens({ workspaceId: outsider.workspace.id });
      expect(theirs.map((token) => token.label)).toEqual(['their-laptop']);
    });
  });

  it('GUARD: a revoked token stops identifying the caller', async () => {
    await withSchema(async ({ source }) => {
      const { accounts, tokens, devices } = await stores(source);

      const owner = await accounts.bootstrapSoloAccount({
        subject: OWNER,
        displayName: 'Ada Lovelace',
      });
      const tokenHash = await mintToken(
        devices,
        { workspaceId: owner.workspace.id, actorId: owner.actor.id },
        'ownr',
        'ada-laptop',
      );

      const before = await devices.identify(tokenHash);
      expect(before.workspaceId).toBe(owner.workspace.id);

      const live = await tokens.listTokens({ workspaceId: owner.workspace.id });
      const revoked = await tokens.revokeToken({
        workspaceId: owner.workspace.id,
        tokenId: live[0]?.id ?? '',
      });
      expect(revoked.label).toBe('ada-laptop');

      await expect(devices.identify(tokenHash)).rejects.toMatchObject({ code: 'unknown_token' });
      expect(await tokens.listTokens({ workspaceId: owner.workspace.id })).toEqual([]);
    });
  });

  it('records last_used_at once the token has been used', async () => {
    await withSchema(async ({ source }) => {
      const { accounts, tokens, devices } = await stores(source);

      const owner = await accounts.bootstrapSoloAccount({
        subject: OWNER,
        displayName: 'Ada Lovelace',
      });
      const tokenHash = await mintToken(
        devices,
        { workspaceId: owner.workspace.id, actorId: owner.actor.id },
        'ownr',
        'ada-laptop',
      );

      await devices.identify(tokenHash);

      const listed = await tokens.listTokens({ workspaceId: owner.workspace.id });
      expect(listed[0]?.lastUsedAt).toBeInstanceOf(Date);
    });
  });

  it('GUARD: one workspace cannot revoke another workspace’s token', async () => {
    await withSchema(async ({ source }) => {
      const { accounts, tokens, devices } = await stores(source);

      const owner = await accounts.bootstrapSoloAccount({
        subject: OWNER,
        displayName: 'Ada Lovelace',
      });
      const outsider = await accounts.bootstrapSoloAccount({
        subject: OUTSIDER,
        displayName: 'Someone Else',
      });

      const tokenHash = await mintToken(
        devices,
        { workspaceId: owner.workspace.id, actorId: owner.actor.id },
        'ownr',
        'ada-laptop',
      );
      const live = await tokens.listTokens({ workspaceId: owner.workspace.id });
      const tokenId = live[0]?.id ?? '';

      await expect(
        tokens.revokeToken({ workspaceId: outsider.workspace.id, tokenId }),
      ).rejects.toMatchObject({ code: 'token_not_found' });

      const stillLive = await devices.identify(tokenHash);
      expect(stillLive.workspaceId).toBe(owner.workspace.id);

      const session = await source.acquire();
      try {
        await session.execute('BEGIN');
        await session.execute('SELECT set_config($1, $2, true)', [
          WORKSPACE_SETTING,
          outsider.workspace.id,
        ]);
        const unscoped = await session.execute<{ id: string }>('SELECT id FROM api_token');
        expect(unscoped.rows).toEqual([]);
        await session.execute('ROLLBACK');
      } finally {
        await session.release();
      }
    });
  });

  it('shows a teammate’s token to the workspace, so a lead can revoke a departing colleague', async () => {
    await withSchema(async ({ source }) => {
      const { accounts, tokens, devices } = await stores(source);

      const owner = await accounts.bootstrapSoloAccount({
        subject: OWNER,
        displayName: 'Ada Lovelace',
      });
      await accounts.inviteToWorkspace({
        workspaceId: owner.workspace.id,
        teamId: owner.team.id,
        invitedByActorId: owner.actor.id,
        invitedEmail: COLLEAGUE_EMAIL,
        role: 'member',
        tokenHash: hash('join'),
        expiresAt: inSevenDays(),
      });
      const joined = await accounts.redeemInvitation({
        subject: COLLEAGUE,
        verifiedEmail: COLLEAGUE_EMAIL,
        displayName: 'Grace Hopper',
        tokenHash: hash('join'),
      });
      expect(joined).not.toBeNull();

      const colleagueToken = await mintToken(
        devices,
        { workspaceId: owner.workspace.id, actorId: joined?.actor.id ?? '' },
        'coll',
        'grace-laptop',
      );

      const listed = await tokens.listTokens({ workspaceId: owner.workspace.id });
      expect(listed.map((token) => token.actorDisplayName)).toEqual(['Grace Hopper']);

      await tokens.revokeToken({
        workspaceId: owner.workspace.id,
        tokenId: listed[0]?.id ?? '',
      });
      await expect(devices.identify(colleagueToken)).rejects.toMatchObject({
        code: 'unknown_token',
      });
    });
  });

  it('refuses to revoke the same token twice', async () => {
    await withSchema(async ({ source }) => {
      const { accounts, tokens, devices } = await stores(source);

      const owner = await accounts.bootstrapSoloAccount({
        subject: OWNER,
        displayName: 'Ada Lovelace',
      });
      await mintToken(
        devices,
        { workspaceId: owner.workspace.id, actorId: owner.actor.id },
        'ownr',
        'ada-laptop',
      );

      const live = await tokens.listTokens({ workspaceId: owner.workspace.id });
      const tokenId = live[0]?.id ?? '';

      await tokens.revokeToken({ workspaceId: owner.workspace.id, tokenId });
      await expect(
        tokens.revokeToken({ workspaceId: owner.workspace.id, tokenId }),
      ).rejects.toMatchObject({ code: 'token_not_found' });
    });
  });
});
