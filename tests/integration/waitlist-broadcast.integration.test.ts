import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../../packages/core/src/index.js';
import { selectRecipientsSql } from '../../scripts/waitlist-notify.mjs';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const CAMPAIGN = 'access-open';

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

let schemaCounter = 0;

async function withSchema<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const schema = `mne218_${process.pid}_${++schemaCounter}`;
  const client = await connect();

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

const seedSignups = async (client: Client, emails: readonly string[]): Promise<string[]> => {
  const ids: string[] = [];

  for (const email of emails) {
    const inserted = await client.query(
      'INSERT INTO waitlist_signup (email, source) VALUES ($1, $2) RETURNING id',
      [email, 'site'],
    );
    ids.push(inserted.rows[0]?.id as string);
  }

  return ids;
};

const recipients = async (client: Client): Promise<string[]> => {
  const { rows } = await client.query(selectRecipientsSql(undefined), [CAMPAIGN]);
  return rows.map((row: { email: string }) => row.email);
};

const claim = (client: Client, signupId: string) =>
  client.query(
    `INSERT INTO waitlist_broadcast_send (campaign, signup_id)
     VALUES ($1, $2)
     ON CONFLICT (campaign, signup_id) DO NOTHING
     RETURNING id`,
    [CAMPAIGN, signupId],
  );

describe.skipIf(connectionString === undefined)('waitlist broadcast against Postgres', () => {
  afterAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$
       DECLARE s TEXT;
       BEGIN
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne218_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.end();
  });

  it('offers every signup before a campaign has run, and none after', async () => {
    await withSchema(async (client) => {
      const ids = await seedSignups(client, ['a@example.com', 'b@example.com']);
      expect(await recipients(client)).toEqual(['a@example.com', 'b@example.com']);

      for (const id of ids) await claim(client, id);

      expect(await recipients(client)).toEqual([]);
    });
  });

  it('leaves a subscriber selectable when only someone else was sent to', async () => {
    await withSchema(async (client) => {
      const [first] = await seedSignups(client, ['first@example.com', 'second@example.com']);
      await claim(client, first);

      expect(await recipients(client)).toEqual(['second@example.com']);
    });
  });

  it('refuses a second claim for the same campaign, which is what stops a double send', async () => {
    await withSchema(async (client) => {
      const [id] = await seedSignups(client, ['once@example.com']);

      expect((await claim(client, id)).rows).toHaveLength(1);
      expect((await claim(client, id)).rows).toHaveLength(0);

      const { rows } = await client.query(
        'SELECT count(*)::int AS n FROM waitlist_broadcast_send WHERE campaign = $1',
        [CAMPAIGN],
      );
      expect(rows[0]?.n).toBe(1);
    });
  });

  it('lets a released claim be retried after a failed delivery', async () => {
    await withSchema(async (client) => {
      const [id] = await seedSignups(client, ['retry@example.com']);
      const claimed = await claim(client, id);

      await client.query('DELETE FROM waitlist_broadcast_send WHERE id = $1', [
        claimed.rows[0]?.id,
      ]);

      expect(await recipients(client)).toEqual(['retry@example.com']);
      expect((await claim(client, id)).rows).toHaveLength(1);
    });
  });

  it('keeps campaigns independent of one another', async () => {
    await withSchema(async (client) => {
      const [id] = await seedSignups(client, ['both@example.com']);
      await claim(client, id);

      await client.query(
        'INSERT INTO waitlist_broadcast_send (campaign, signup_id) VALUES ($1, $2)',
        ['some-other-campaign', id],
      );

      const { rows } = await client.query(
        'SELECT count(*)::int AS n FROM waitlist_broadcast_send WHERE signup_id = $1',
        [id],
      );
      expect(rows[0]?.n).toBe(2);
    });
  });

  it('suppresses a subscriber held as unresolved, so an ambiguous send is never repeated', async () => {
    await withSchema(async (client) => {
      const [id] = await seedSignups(client, ['ambiguous@example.com']);
      const claimed = await claim(client, id);

      await client.query("UPDATE waitlist_broadcast_send SET status = 'unknown' WHERE id = $1", [
        claimed.rows[0]?.id,
      ]);

      expect(await recipients(client)).toEqual([]);
    });
  });

  it('refuses a sent row with no delivery time, and an unsent row that claims one', async () => {
    await withSchema(async (client) => {
      const [id] = await seedSignups(client, ['checked@example.com']);
      const claimed = await claim(client, id);
      const rowId = claimed.rows[0]?.id;

      await expect(
        client.query("UPDATE waitlist_broadcast_send SET status = 'sent' WHERE id = $1", [rowId]),
      ).rejects.toThrow(/waitlist_broadcast_send_delivered_when_sent/);

      await expect(
        client.query('UPDATE waitlist_broadcast_send SET delivered_at = now() WHERE id = $1', [
          rowId,
        ]),
      ).rejects.toThrow(/waitlist_broadcast_send_delivered_when_sent/);

      await client.query(
        "UPDATE waitlist_broadcast_send SET status = 'sent', delivered_at = now() WHERE id = $1",
        [rowId],
      );

      const { rows } = await client.query(
        'SELECT status FROM waitlist_broadcast_send WHERE id = $1',
        [rowId],
      );
      expect(rows[0]?.status).toBe('sent');
    });
  });

  it('rejects a status outside the three the sender writes', async () => {
    await withSchema(async (client) => {
      const [id] = await seedSignups(client, ['bogus@example.com']);
      const claimed = await claim(client, id);

      await expect(
        client.query("UPDATE waitlist_broadcast_send SET status = 'queued' WHERE id = $1", [
          claimed.rows[0]?.id,
        ]),
      ).rejects.toThrow(/status/);
    });
  });

  it('takes send history with the address when an unsubscribe deletes it', async () => {
    await withSchema(async (client) => {
      const [id] = await seedSignups(client, ['gone@example.com']);
      await claim(client, id);

      await client.query('DELETE FROM waitlist_signup WHERE id = $1', [id]);

      const { rows } = await client.query('SELECT count(*)::int AS n FROM waitlist_broadcast_send');
      expect(rows[0]?.n).toBe(0);
    });
  });
});
