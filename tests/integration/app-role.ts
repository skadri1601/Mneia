import type { Client } from 'pg';

export const APP_ROLE = 'mneia_app_test';

export async function ensureAppRole(client: Client): Promise<void> {
  await client.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
         CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
       END IF;
     END $$`,
  );
  await client.query(`GRANT ${APP_ROLE} TO CURRENT_USER`);
}

export async function grantSchemaToAppRole(client: Client, schema: string): Promise<void> {
  await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${APP_ROLE}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${APP_ROLE}`,
  );
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO ${APP_ROLE}`);
}
