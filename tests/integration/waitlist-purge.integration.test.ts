import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { migrate } from '../../packages/core/src/index.js';
import { ACCESS_OPENED_CAMPAIGNS, purge } from '../../scripts/waitlist-purge.mjs';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const CAMPAIGN = ACCESS_OPENED_CAMPAIGNS[0] as string;
const APPLY = { apply: true, max: 100, help: false };
const DRY = { apply: false, max: 100, help: false };

let schemaCounter = 0;

async function withSchema<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const schema = `mne269_${process.pid}_${++schemaCounter}`;
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(client), { appliedBy: 'integration' });
    return await run(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

const signup = async (client: Client, email: string): Promise<string> => {
  const { rows } = await client.query(
    'INSERT INTO waitlist_signup (email, source) VALUES ($1, $2) RETURNING id',
    [email, 'site'],
  );
  return rows[0]?.id as string;
};

const admit = (client: Client, id: string, daysAgo: number) =>
  client.query(
    `UPDATE waitlist_signup
        SET status = 'approved',
            approved_by = 'integration',
            approved_at = now() - make_interval(days => $2::int)
      WHERE id = $1`,
    [id, daysAgo],
  );

const emailed = (client: Client, id: string, daysAgo: number) =>
  client.query(
    `INSERT INTO waitlist_broadcast_send (campaign, signup_id, status, claimed_at, delivered_at)
     VALUES ($1, $2, 'sent',
             now() - make_interval(days => $3::int),
             now() - make_interval(days => $3::int))`,
    [CAMPAIGN, id, daysAgo],
  );

const remaining = async (client: Client): Promise<string[]> => {
  const { rows } = await client.query('SELECT email FROM waitlist_signup ORDER BY email');
  return rows.map((row: { email: string }) => row.email);
};

const survivingIds = async (client: Client): Promise<string[]> => {
  const { rows } = await client.query('SELECT id FROM waitlist_signup ORDER BY id');
  return rows.map((row: { id: string }) => row.id);
};

const sendCount = async (client: Client): Promise<number> => {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM waitlist_broadcast_send');
  return rows[0]?.n as number;
};

describe.skipIf(connectionString === undefined)(
  'waitlist purge honours the published 30 days',
  () => {
    it('deletes the elapsed row, leaves the recent and the pending one, and cascades', async () => {
      await withSchema(async (client) => {
        const elapsed = await signup(client, 'elapsed@example.com');
        const recent = await signup(client, 'recent@example.com');
        const pending = await signup(client, 'pending@example.com');

        await admit(client, elapsed, 31);
        await emailed(client, elapsed, 31);
        await admit(client, recent, 29);
        await emailed(client, recent, 29);
        await client.query(
          `UPDATE waitlist_signup SET created_at = now() - make_interval(days => 60) WHERE id = $1`,
          [pending],
        );

        expect(await sendCount(client)).toBe(2);

        const first = await purge(client, APPLY);

        expect(first).toEqual({ due: 1, deleted: 1 });
        expect(await remaining(client)).toEqual(['pending@example.com', 'recent@example.com']);
        expect(await sendCount(client)).toBe(1);

        const second = await purge(client, APPLY);

        expect(second).toEqual({ due: 0, deleted: 0 });
        expect(await remaining(client)).toEqual(['pending@example.com', 'recent@example.com']);
      });
    });

    it('deletes nothing without --apply, and reports the same row the apply run takes', async () => {
      await withSchema(async (client) => {
        const elapsed = await signup(client, 'elapsed@example.com');
        const recent = await signup(client, 'recent@example.com');

        await admit(client, elapsed, 45);
        await admit(client, recent, 1);

        expect(await purge(client, DRY)).toEqual({ due: 1, deleted: 0 });
        expect(await remaining(client)).toEqual(['elapsed@example.com', 'recent@example.com']);

        expect(await purge(client, APPLY)).toEqual({ due: 1, deleted: 1 });
        expect(await remaining(client)).toEqual(['recent@example.com']);
      });
    });

    it('starts the clock at the access-open email even when the row was never approved', async () => {
      await withSchema(async (client) => {
        const mailed = await signup(client, 'mailed@example.com');
        const untouched = await signup(client, 'untouched@example.com');

        await emailed(client, mailed, 31);

        expect(await purge(client, APPLY)).toEqual({ due: 1, deleted: 1 });
        expect(await remaining(client)).toEqual(['untouched@example.com']);
        expect(await survivingIds(client)).toEqual([untouched]);
      });
    });

    it('ignores a claimed-but-undelivered send, because that address was never told', async () => {
      await withSchema(async (client) => {
        const claimed = await signup(client, 'claimed@example.com');

        await client.query(
          `INSERT INTO waitlist_broadcast_send (campaign, signup_id, status, claimed_at)
         VALUES ($1, $2, 'claimed', now() - make_interval(days => 60))`,
          [CAMPAIGN, claimed],
        );

        expect(await purge(client, APPLY)).toEqual({ due: 0, deleted: 0 });
        expect(await remaining(client)).toEqual(['claimed@example.com']);
      });
    });

    it('refuses the run and deletes nothing when more rows are due than --max allows', async () => {
      await withSchema(async (client) => {
        for (const name of ['a', 'b', 'c']) {
          const id = await signup(client, `${name}@example.com`);
          await admit(client, id, 40);
        }

        await expect(purge(client, { apply: true, max: 2, help: false })).rejects.toThrow(
          /expected at most 2 address\(es\) to be due; found 3/,
        );
        expect(await remaining(client)).toEqual([
          'a@example.com',
          'b@example.com',
          'c@example.com',
        ]);
      });
    });

    it('leaves every other table alone', async () => {
      await withSchema(async (client) => {
        const elapsed = await signup(client, 'elapsed@example.com');
        await admit(client, elapsed, 31);

        const { rows: before } = await client.query('SELECT count(*)::int AS n FROM workspace');

        await purge(client, APPLY);

        const { rows: after } = await client.query('SELECT count(*)::int AS n FROM workspace');
        expect(after[0]?.n).toBe(before[0]?.n);
      });
    });
  },
);
