import { createHmac } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/web/node_modules/server-only/index.js', () => ({}));

import {
  migrate,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlResult,
  type SqlValue,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import {
  canOpenPortal,
  canStartCheckout,
  checkoutRequestFor,
  portalRequestFor,
} from '../../apps/web/src/server/billing/checkout.js';
import { PostgresBillingStore } from '../../apps/web/src/server/billing/billing-store.js';
import { checkpointQuota } from '../../apps/web/src/server/billing/quota.js';
import { PostgresQuotaStore } from '../../apps/web/src/server/billing/quota-store.js';
import { handleStripeWebhook } from '../../apps/web/src/server/billing/webhook.js';
import { CheckpointSourceStore } from '../../apps/web/src/server/store/checkpoint-source-store.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;
const describeIf = connectionString === undefined ? describe.skip : describe;

const runId = `${process.pid}_${Date.now()}`;
const tenantRole = `mne141_journey_${runId}`;
const schemaPrefix = `mne141_${runId}`;

const WORKSPACE = '11111111-1111-4111-8111-1111111111a1';
const LEAD = '22222222-2222-4222-8222-2222222222a1';
const MEMBER = '22222222-2222-4222-8222-2222222222a2';
const THIRD = '22222222-2222-4222-8222-2222222222a3';
const TEAM = '33333333-3333-4333-8333-3333333333a1';

const CONFIG = {
  secretKey: 'sk_test_journey',
  priceId: 'price_journey',
  webhookSecret: 'whsec_journey',
} as const;

const NOW = new Date('2026-08-17T10:00:00.000Z');
const ORIGIN = 'https://app.mneia.dev';
const FIRST_CUSTOMER = 'cus_first';

const signed = (payload: string): string => {
  const timestamp = Math.floor(NOW.getTime() / 1000);
  const signature = createHmac('sha256', CONFIG.webhookSecret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
};

const subscriptionEvent = (input: {
  readonly status: string;
  readonly customerId: string;
  readonly seats: number;
  readonly eventType?: string;
}): string =>
  JSON.stringify({
    id: `evt_${input.customerId}_${input.status}`,
    type: input.eventType ?? 'customer.subscription.updated',
    data: {
      object: {
        id: `sub_${input.customerId}`,
        customer: input.customerId,
        status: input.status,
        metadata: { workspace_id: WORKSPACE },
        items: { data: [{ price: { id: CONFIG.priceId }, quantity: input.seats }] },
      },
    },
  });

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

class RoleSession implements PostgresSession {
  private done = false;
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
    if (this.done) return;
    this.done = true;
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

const openClients: Client[] = [];

afterAll(async () => {
  for (const client of openClients) await client.end().catch(() => undefined);
});

let schemaCounter = 0;

async function withWorkspace<T>(
  run: (fixture: {
    readonly admin: Client;
    readonly billing: PostgresBillingStore;
    readonly quota: PostgresQuotaStore;
    readonly usage: CheckpointSourceStore;
  }) => Promise<T>,
): Promise<T> {
  const schema = `${schemaPrefix}_${++schemaCounter}`;
  const admin = await connect();
  const source = new RoleConnectionSource(schema);

  try {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${tenantRole}') THEN
        CREATE ROLE ${tenantRole} NOLOGIN;
      END IF;
    END $$;`);
    await admin.query(`GRANT ${tenantRole} TO CURRENT_USER`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(admin), { appliedBy: 'integration' });
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${tenantRole}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${tenantRole}`,
    );

    await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE]);
    await admin.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $3)', [
      WORKSPACE,
      'acme',
      'Acme',
    ]);
    await admin.query(
      'INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, $3, $4)',
      [TEAM, WORKSPACE, 'default', 'Default'],
    );
    for (const [id, name] of [
      [LEAD, 'Ada'],
      [MEMBER, 'Grace'],
    ] as const) {
      await admin.query(
        'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
        [id, WORKSPACE, 'human', name],
      );
      await admin.query(
        'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
        [WORKSPACE, TEAM, id, id === LEAD ? 'lead' : 'member'],
      );
    }

    return await run({
      admin,
      billing: new PostgresBillingStore(source),
      quota: new PostgresQuotaStore(source),
      usage: new CheckpointSourceStore(source),
    });
  } finally {
    await source.close();
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

const applyWebhook = async (store: PostgresBillingStore, payload: string) =>
  handleStripeWebhook({
    payload,
    signatureHeader: signed(payload),
    configuration: CONFIG,
    store,
    now: NOW,
  });

const attempt = (snapshot: Awaited<ReturnType<PostgresBillingStore['snapshot']>>) => ({
  account: { workspaceId: WORKSPACE, role: 'lead' as const },
  snapshot: snapshot as NonNullable<typeof snapshot>,
  attemptToken: '11111111-1111-4111-8111-1111111111ff',
  origin: ORIGIN,
});

describeIf('MNE-141 the billing journey a two-member team actually walks', () => {
  it('goes from no subscription to paid, opens the portal, and cancels', async () => {
    await withWorkspace(async ({ billing, quota }) => {
      const unpaid = await billing.snapshot(WORKSPACE);
      expect(unpaid).toMatchObject({ plan: 'solo', memberCount: 2, billingCustomerRef: null });
      expect(canStartCheckout(attempt(unpaid))).toBe(true);

      const checkout = checkoutRequestFor(attempt(unpaid));
      expect(checkout).toMatchObject({ workspaceId: WORKSPACE, seats: 2 });
      expect(checkout.customerId).toBeUndefined();

      const activated = await applyWebhook(
        billing,
        subscriptionEvent({
          status: 'active',
          customerId: FIRST_CUSTOMER,
          seats: 2,
          eventType: 'customer.subscription.created',
        }),
      );
      expect(activated.applied).toBe(true);

      const paid = await billing.snapshot(WORKSPACE);
      expect(paid).toMatchObject({
        plan: 'team',
        billingStatus: 'active',
        seatsPurchased: 2,
        billingCustomerRef: FIRST_CUSTOMER,
      });

      const entitled = await quota.quotaFor(WORKSPACE, NOW);
      expect(entitled).not.toBeNull();
      expect(checkpointQuota(entitled as NonNullable<typeof entitled>)).toEqual({ allowed: true });

      expect(canOpenPortal(attempt(paid))).toBe(true);
      expect(portalRequestFor(attempt(paid))).toMatchObject({ customerId: FIRST_CUSTOMER });

      const cancelled = await applyWebhook(
        billing,
        subscriptionEvent({
          status: 'canceled',
          customerId: FIRST_CUSTOMER,
          seats: 2,
          eventType: 'customer.subscription.deleted',
        }),
      );
      expect(cancelled.applied).toBe(true);

      const lapsed = await billing.snapshot(WORKSPACE);
      expect(lapsed).toMatchObject({ plan: 'solo', billingStatus: 'canceled' });
    });
  }, 120_000);

  it('can resubscribe after cancelling, on a fresh Stripe customer', async () => {
    await withWorkspace(async ({ billing, quota }) => {
      await applyWebhook(
        billing,
        subscriptionEvent({ status: 'active', customerId: FIRST_CUSTOMER, seats: 2 }),
      );
      await applyWebhook(
        billing,
        subscriptionEvent({
          status: 'canceled',
          customerId: FIRST_CUSTOMER,
          seats: 2,
          eventType: 'customer.subscription.deleted',
        }),
      );

      const lapsed = await billing.snapshot(WORKSPACE);
      expect(canStartCheckout(attempt(lapsed))).toBe(true);

      const restart = checkoutRequestFor(attempt(lapsed));
      expect(restart.customerId).toBeUndefined();

      const resumed = await applyWebhook(
        billing,
        subscriptionEvent({
          status: 'active',
          customerId: 'cus_second',
          seats: 2,
          eventType: 'customer.subscription.created',
        }),
      );

      expect(resumed.applied).toBe(true);
      await expect(billing.snapshot(WORKSPACE)).resolves.toMatchObject({
        plan: 'team',
        billingStatus: 'active',
        billingCustomerRef: 'cus_second',
      });

      const state = await quota.quotaFor(WORKSPACE, NOW);
      expect(checkpointQuota(state as NonNullable<typeof state>)).toEqual({ allowed: true });
    });
  }, 120_000);

  it('closes the portal once cancelled, so nobody can pay through it and get nothing', async () => {
    await withWorkspace(async ({ billing }) => {
      await applyWebhook(
        billing,
        subscriptionEvent({ status: 'active', customerId: FIRST_CUSTOMER, seats: 2 }),
      );
      await applyWebhook(
        billing,
        subscriptionEvent({
          status: 'canceled',
          customerId: FIRST_CUSTOMER,
          seats: 2,
          eventType: 'customer.subscription.deleted',
        }),
      );

      const lapsed = await billing.snapshot(WORKSPACE);
      expect(canOpenPortal(attempt(lapsed))).toBe(false);
      expect(() => portalRequestFor(attempt(lapsed))).toThrow(/actionable billing status/);
    });
  }, 120_000);

  it('refuses a delayed event that would revive the cancelled subscription', async () => {
    await withWorkspace(async ({ billing }) => {
      await applyWebhook(
        billing,
        subscriptionEvent({ status: 'active', customerId: FIRST_CUSTOMER, seats: 2 }),
      );
      await applyWebhook(
        billing,
        subscriptionEvent({
          status: 'canceled',
          customerId: FIRST_CUSTOMER,
          seats: 2,
          eventType: 'customer.subscription.deleted',
        }),
      );

      const delayed = await applyWebhook(
        billing,
        subscriptionEvent({ status: 'active', customerId: FIRST_CUSTOMER, seats: 2 }),
      );

      expect(delayed.applied).toBe(false);
      await expect(billing.snapshot(WORKSPACE)).resolves.toMatchObject({
        billingStatus: 'canceled',
      });
    });
  }, 120_000);

  it('refuses checkout for a one-person workspace, so solo is never charged', async () => {
    await withWorkspace(async ({ admin, billing }) => {
      await admin.query('DELETE FROM team_member WHERE actor_id = $1', [MEMBER]);

      const solo = await billing.snapshot(WORKSPACE);
      expect(solo).toMatchObject({ memberCount: 1 });
      expect(canStartCheckout(attempt(solo))).toBe(false);
    });
  }, 120_000);

  it('refuses to checkpoint when the team has more members than purchased seats', async () => {
    await withWorkspace(async ({ admin, billing, quota }) => {
      await applyWebhook(
        billing,
        subscriptionEvent({ status: 'active', customerId: FIRST_CUSTOMER, seats: 2 }),
      );

      await admin.query(
        'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
        [THIRD, WORKSPACE, 'human', 'Alan'],
      );
      await admin.query(
        'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
        [WORKSPACE, TEAM, THIRD, 'member'],
      );

      const state = await quota.quotaFor(WORKSPACE, NOW);
      expect(state).toMatchObject({ memberCount: 3, seatsPurchased: 2 });
      expect(checkpointQuota(state as NonNullable<typeof state>)).toMatchObject({
        allowed: false,
        code: 'seats_exceeded',
      });
    });
  }, 120_000);
});

const PROJECT = '44444444-4444-4444-8444-4444444444a1';

const attemptRecord = {
  model: 'gpt-5.6-luna',
  outcome: 'succeeded' as const,
  inputTokens: 100,
  outputTokens: 20,
  durationMs: 5,
};

const periodRow = async (admin: Client) =>
  (
    await admin.query(
      `SELECT checkpoints_used FROM workspace_usage_period
        WHERE workspace_id = $1 AND period_start = date_trunc('month', now())::date`,
      [WORKSPACE],
    )
  ).rows[0] as { checkpoints_used: string } | undefined;

describeIf('§9 workspace_usage_period is the margin guard, not an estimate of one', () => {
  it('increments once per proposal, in the same transaction as the usage rows', async () => {
    await withWorkspace(async ({ admin, usage }) => {
      expect(await periodRow(admin)).toBeUndefined();

      await usage.recordUsage({
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        checkpointId: null,
        attempts: [attemptRecord, { ...attemptRecord, outcome: 'fell_back' as const }],
      });

      expect(Number((await periodRow(admin))?.checkpoints_used)).toBe(1);

      const rows = await admin.query(
        'SELECT count(*) AS n FROM checkpoint_usage WHERE workspace_id = $1',
        [WORKSPACE],
      );
      expect(Number(rows.rows[0].n)).toBe(2);
    });
  }, 120_000);

  it('records nothing at all when the usage write fails, so the counter cannot drift', async () => {
    await withWorkspace(async ({ admin, usage }) => {
      await expect(
        usage.recordUsage({
          workspaceId: WORKSPACE,
          projectId: PROJECT,
          checkpointId: null,
          attempts: [{ ...attemptRecord, outcome: 'exploded' as unknown as 'succeeded' }],
        }),
      ).rejects.toThrow();

      expect(await periodRow(admin)).toBeUndefined();
      const rows = await admin.query(
        'SELECT count(*) AS n FROM checkpoint_usage WHERE workspace_id = $1',
        [WORKSPACE],
      );
      expect(Number(rows.rows[0].n)).toBe(0);
    });
  }, 120_000);

  it('loses no count under concurrent proposals, which a read-time count would', async () => {
    await withWorkspace(async ({ admin, usage }) => {
      await Promise.all(
        Array.from({ length: 12 }, () =>
          usage.recordUsage({
            workspaceId: WORKSPACE,
            projectId: PROJECT,
            checkpointId: null,
            attempts: [attemptRecord],
          }),
        ),
      );

      expect(Number((await periodRow(admin))?.checkpoints_used)).toBe(12);
    });
  }, 120_000);

  it('is what the quota gate reads, and refuses at the allowance', async () => {
    await withWorkspace(async ({ admin, quota, usage }) => {
      await admin.query('UPDATE workspace SET checkpoint_allowance = 3 WHERE id = $1', [WORKSPACE]);

      for (let index = 0; index < 3; index += 1) {
        await usage.recordUsage({
          workspaceId: WORKSPACE,
          projectId: PROJECT,
          checkpointId: null,
          attempts: [attemptRecord],
        });
      }

      const state = await quota.quotaFor(WORKSPACE, NOW);
      expect(state).toMatchObject({ checkpointAllowance: 3, checkpointsUsed: 3 });
      expect(checkpointQuota(state as NonNullable<typeof state>)).toMatchObject({
        allowed: false,
        code: 'allowance_exhausted',
      });
    });
  }, 120_000);
});
