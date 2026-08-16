import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/web/node_modules/server-only/index.js', () => ({}));

import {
  INVITATION_EMAIL_SETTING,
  INVITATION_TOKEN_HASH_SETTING,
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
const tenantRole = `mne126_invite_${runId}`;
const schemaPrefix = `mne126_${runId}`;

const INVITER = 'user_invite_inviter';
const INVITEE = 'user_invite_invitee';
const OUTSIDER = 'user_invite_outsider';
const INVITEE_EMAIL = 'grace@example.com';
const OUTSIDER_EMAIL = 'outsider@elsewhere.test';

const hash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

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

interface Fixture {
  readonly admin: Client;
  readonly source: RoleConnectionSource;
}

let schemaCounter = 0;

async function withSchema<T>(run: (fixture: Fixture) => Promise<T>): Promise<T> {
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

async function accountStore(source: RoleConnectionSource) {
  const { PostgresAccountStore } = await import(
    '../../apps/web/src/server/store/postgres-account-store.js'
  );
  return new PostgresAccountStore(source);
}

const inSevenDays = (): Date => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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

async function seedProject(
  source: RoleConnectionSource,
  workspaceId: string,
  teamId: string,
  slug: string,
): Promise<string> {
  return withRoleSession(source, async (session) => {
    await session.execute('BEGIN');
    try {
      await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
      const rows = await session.execute<{ id: string }>(
        `INSERT INTO project (id, workspace_id, team_id, slug)
         VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
        [workspaceId, teamId, slug],
      );
      await session.execute('COMMIT');
      const id = rows.rows[0]?.id;
      if (id === undefined) throw new Error('expected the project insert to return an id');
      return id;
    } catch (error) {
      await session.execute('ROLLBACK');
      throw error;
    }
  });
}

async function writeSession(
  source: RoleConnectionSource,
  workspaceId: string,
  projectId: string,
  actorId: string,
): Promise<void> {
  await withRoleSession(source, async (session) => {
    await session.execute('BEGIN');
    try {
      await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
      await session.execute(
        `INSERT INTO session (id, workspace_id, project_id, actor_id, tool, started_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'integration', now())`,
        [workspaceId, projectId, actorId],
      );
      await session.execute('COMMIT');
    } catch (error) {
      await session.execute('ROLLBACK');
      throw error;
    }
  });
}

async function visibleProjectSlugs(
  source: RoleConnectionSource,
  workspaceId: string,
): Promise<readonly string[]> {
  return withRoleSession(source, async (session) => {
    await session.execute('BEGIN');
    try {
      await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
      const rows = await session.execute<{ slug: string }>(
        'SELECT slug FROM project ORDER BY slug',
      );
      await session.execute('COMMIT');
      return rows.rows.map(({ slug }) => slug);
    } catch (error) {
      await session.execute('ROLLBACK');
      throw error;
    }
  });
}

describe.skipIf(connectionString === undefined)('workspace invitations against Postgres', () => {
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

  it('lets someone who already signed up solo accept a team invitation and stay there', async () => {
    await withSchema(async ({ admin, source }) => {
      const store = await accountStore(source);

      const evaluator = await store.bootstrapSoloAccount({
        subject: INVITEE,
        displayName: 'Grace Hopper',
      });
      const inviter = await store.bootstrapSoloAccount({
        subject: INVITER,
        displayName: 'Ada Lovelace',
      });

      const owners = await admin.query(
        `SELECT wm.workspace_id, wm.role, i.subject
           FROM workspace_member wm JOIN identity i ON i.id = wm.identity_id`,
      );
      expect(
        owners.rows.map((row) => ({ workspace: row.workspace_id, role: row.role })).sort(),
      ).toEqual(
        [
          { workspace: evaluator.workspace.id, role: 'owner' },
          { workspace: inviter.workspace.id, role: 'owner' },
        ].sort(),
      );

      await store.inviteToWorkspace({
        workspaceId: inviter.workspace.id,
        teamId: inviter.team.id,
        invitedByActorId: inviter.actor.id,
        invitedEmail: INVITEE_EMAIL,
        role: 'member',
        tokenHash: hash('join-token'),
        expiresAt: inSevenDays(),
      });

      const joined = await store.redeemInvitation({
        subject: INVITEE,
        verifiedEmail: INVITEE_EMAIL,
        displayName: 'Grace Hopper',
        tokenHash: hash('join-token'),
      });

      expect(joined?.workspace.id).toBe(inviter.workspace.id);
      expect(joined?.membership.role).toBe('member');
      expect([...(joined?.workspaces ?? [])].map((choice) => choice.id).sort()).toEqual(
        [evaluator.workspace.id, inviter.workspace.id].sort(),
      );

      const nextRequest = await store.bootstrapSoloAccount({
        subject: INVITEE,
        displayName: 'Grace Hopper',
      });
      expect(nextRequest.workspace.id).toBe(inviter.workspace.id);
      expect([...nextRequest.workspaces].map((choice) => choice.id).sort()).toEqual(
        [evaluator.workspace.id, inviter.workspace.id].sort(),
      );

      const stillTheirs = await store.bootstrapSoloAccount({
        subject: INVITEE,
        displayName: 'Grace Hopper',
        preferredWorkspaceId: evaluator.workspace.id,
      });
      expect(stillTheirs.workspace.id).toBe(evaluator.workspace.id);
    });
  });

  it('gives every human actor an identity and its workspace a membership row', async () => {
    await withSchema(async ({ admin, source }) => {
      const store = await accountStore(source);
      const solo = await store.bootstrapSoloAccount({
        subject: INVITER,
        displayName: 'Ada Lovelace',
      });

      const actors = await admin.query(
        `SELECT identity_id FROM actor WHERE kind = 'human' AND external_ref = $1`,
        [INVITER],
      );
      expect(actors.rows).toHaveLength(1);
      expect(actors.rows[0]?.identity_id).not.toBeNull();

      const members = await admin.query(
        'SELECT role FROM workspace_member WHERE workspace_id = $1 AND identity_id = $2',
        [solo.workspace.id, actors.rows[0]?.identity_id],
      );
      expect(members.rows.map((row) => row.role)).toEqual(['owner']);
    });
  });

  it('lands an invited teammate in the inviting workspace, and nobody else sees it', async () => {
    await withSchema(async ({ source }) => {
      const store = await accountStore(source);

      const inviter = await store.bootstrapSoloAccount({
        subject: INVITER,
        displayName: 'Ada Lovelace',
      });
      const outsider = await store.bootstrapSoloAccount({
        subject: OUTSIDER,
        displayName: 'Someone Else',
      });

      const invitation = await store.inviteToWorkspace({
        workspaceId: inviter.workspace.id,
        teamId: inviter.team.id,
        invitedByActorId: inviter.actor.id,
        invitedEmail: INVITEE_EMAIL,
        role: 'member',
        tokenHash: hash('join-token'),
        expiresAt: inSevenDays(),
      });
      expect(invitation.workspaceId).toBe(inviter.workspace.id);

      const joined = await store.redeemInvitation({
        subject: INVITEE,
        verifiedEmail: INVITEE_EMAIL,
        displayName: 'Grace Hopper',
        tokenHash: hash('join-token'),
      });

      expect(joined).not.toBeNull();
      expect(joined?.workspace.id).toBe(inviter.workspace.id);
      expect(joined?.team.id).toBe(inviter.team.id);
      expect(joined?.membership.role).toBe('member');
      expect(joined?.actor.workspaceId).toBe(inviter.workspace.id);
      expect(joined?.actor.id).not.toBe(inviter.actor.id);

      const sharedProject = await seedProject(
        source,
        inviter.workspace.id,
        inviter.team.id,
        'shared',
      );
      await writeSession(source, inviter.workspace.id, sharedProject, inviter.actor.id);
      await writeSession(
        source,
        inviter.workspace.id,
        sharedProject,
        joined?.actor.id ?? inviter.actor.id,
      );

      const outsiderProject = await seedProject(
        source,
        outsider.workspace.id,
        outsider.team.id,
        'private',
      );
      expect(outsiderProject).not.toBe(sharedProject);

      expect(await visibleProjectSlugs(source, inviter.workspace.id)).toEqual(['shared']);
      expect(await visibleProjectSlugs(source, outsider.workspace.id)).toEqual(['private']);

      const resolvedAgain = await store.bootstrapSoloAccount({
        subject: INVITEE,
        displayName: 'Grace Hopper',
      });
      expect(resolvedAgain.workspace.id).toBe(inviter.workspace.id);
      expect(resolvedAgain.membership.role).toBe('member');
    });
  });

  it('refuses a token whose invitation was sent to a different verified address', async () => {
    await withSchema(async ({ source }) => {
      const store = await accountStore(source);
      const inviter = await store.bootstrapSoloAccount({
        subject: INVITER,
        displayName: 'Ada Lovelace',
      });

      await store.inviteToWorkspace({
        workspaceId: inviter.workspace.id,
        teamId: inviter.team.id,
        invitedByActorId: inviter.actor.id,
        invitedEmail: INVITEE_EMAIL,
        role: 'member',
        tokenHash: hash('join-token'),
        expiresAt: inSevenDays(),
      });

      await expect(
        store.redeemInvitation({
          subject: OUTSIDER,
          verifiedEmail: OUTSIDER_EMAIL,
          displayName: 'Someone Else',
          tokenHash: hash('join-token'),
        }),
      ).resolves.toBeNull();
    });
  });

  it('spends an invitation exactly once', async () => {
    await withSchema(async ({ source }) => {
      const store = await accountStore(source);
      const inviter = await store.bootstrapSoloAccount({
        subject: INVITER,
        displayName: 'Ada Lovelace',
      });
      await store.inviteToWorkspace({
        workspaceId: inviter.workspace.id,
        teamId: inviter.team.id,
        invitedByActorId: inviter.actor.id,
        invitedEmail: INVITEE_EMAIL,
        role: 'member',
        tokenHash: hash('join-token'),
        expiresAt: inSevenDays(),
      });

      await expect(
        store.redeemInvitation({
          subject: INVITEE,
          verifiedEmail: INVITEE_EMAIL,
          displayName: 'Grace Hopper',
        }),
      ).resolves.not.toBeNull();

      expect(await store.listPendingInvitations({ workspaceId: inviter.workspace.id })).toEqual([]);

      await expect(
        store.redeemInvitation({
          subject: 'user_invite_second',
          verifiedEmail: INVITEE_EMAIL,
          displayName: 'Impostor',
        }),
      ).resolves.toBeNull();
    });
  });

  it('never lets an expired or revoked invitation be redeemed', async () => {
    await withSchema(async ({ source }) => {
      const store = await accountStore(source);
      const inviter = await store.bootstrapSoloAccount({
        subject: INVITER,
        displayName: 'Ada Lovelace',
      });

      const expired = await store.inviteToWorkspace({
        workspaceId: inviter.workspace.id,
        teamId: inviter.team.id,
        invitedByActorId: inviter.actor.id,
        invitedEmail: 'expired@example.com',
        role: 'member',
        tokenHash: hash('expired-token'),
        expiresAt: new Date(Date.now() + 500),
      });
      expect(expired.expiresAt.getTime()).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 700));

      await expect(
        store.redeemInvitation({
          subject: 'user_invite_expired',
          verifiedEmail: 'expired@example.com',
          displayName: 'Too Late',
        }),
      ).resolves.toBeNull();

      const revoked = await store.inviteToWorkspace({
        workspaceId: inviter.workspace.id,
        teamId: inviter.team.id,
        invitedByActorId: inviter.actor.id,
        invitedEmail: 'revoked@example.com',
        role: 'member',
        tokenHash: hash('revoked-token'),
        expiresAt: inSevenDays(),
      });
      await store.revokeInvitation({
        workspaceId: inviter.workspace.id,
        invitationId: revoked.id,
      });

      await expect(
        store.redeemInvitation({
          subject: 'user_invite_revoked',
          verifiedEmail: 'revoked@example.com',
          displayName: 'Too Late',
        }),
      ).resolves.toBeNull();
      await expect(
        store.revokeInvitation({ workspaceId: inviter.workspace.id, invitationId: revoked.id }),
      ).rejects.toMatchObject({ code: 'invitation_not_found' });
    });
  });

  it('hides another workspace invitation from a scoped listing and from a scoped revoke', async () => {
    await withSchema(async ({ source }) => {
      const store = await accountStore(source);
      const inviter = await store.bootstrapSoloAccount({
        subject: INVITER,
        displayName: 'Ada Lovelace',
      });
      const outsider = await store.bootstrapSoloAccount({
        subject: OUTSIDER,
        displayName: 'Someone Else',
      });

      const invitation = await store.inviteToWorkspace({
        workspaceId: inviter.workspace.id,
        teamId: inviter.team.id,
        invitedByActorId: inviter.actor.id,
        invitedEmail: INVITEE_EMAIL,
        role: 'member',
        tokenHash: hash('join-token'),
        expiresAt: inSevenDays(),
      });

      expect(
        (await store.listPendingInvitations({ workspaceId: inviter.workspace.id })).map(
          ({ id }) => id,
        ),
      ).toEqual([invitation.id]);
      expect(await store.listPendingInvitations({ workspaceId: outsider.workspace.id })).toEqual(
        [],
      );

      await expect(
        store.revokeInvitation({
          workspaceId: outsider.workspace.id,
          invitationId: invitation.id,
        }),
      ).rejects.toMatchObject({ code: 'invitation_not_found' });
    });
  });

  it('shows nothing to a secret-keyed lookup that carries a workspace scope', async () => {
    await withSchema(async ({ source }) => {
      const store = await accountStore(source);
      const inviter = await store.bootstrapSoloAccount({
        subject: INVITER,
        displayName: 'Ada Lovelace',
      });
      await store.inviteToWorkspace({
        workspaceId: inviter.workspace.id,
        teamId: inviter.team.id,
        invitedByActorId: inviter.actor.id,
        invitedEmail: INVITEE_EMAIL,
        role: 'member',
        tokenHash: hash('join-token'),
        expiresAt: inSevenDays(),
      });

      const outsider = await store.bootstrapSoloAccount({
        subject: OUTSIDER,
        displayName: 'Someone Else',
      });

      await withRoleSession(source, async (session) => {
        await session.execute('BEGIN');
        await session.execute('SELECT set_config($1, $2, true)', [
          INVITATION_EMAIL_SETTING,
          INVITEE_EMAIL,
        ]);
        await session.execute('SELECT set_config($1, $2, true)', [
          INVITATION_TOKEN_HASH_SETTING,
          hash('join-token'),
        ]);
        await session.execute('SELECT set_config($1, $2, true)', [
          WORKSPACE_SETTING,
          outsider.workspace.id,
        ]);

        const leaked = await session.execute<{ id: string }>('SELECT id FROM workspace_invitation');
        expect(leaked.rows).toEqual([]);
        await session.execute('ROLLBACK');
      });
    });
  });
});
