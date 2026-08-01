import { Client } from 'pg';

export default async function setup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined) return;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  } finally {
    await client.end();
  }
}
