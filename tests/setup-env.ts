import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = new URL('../.env', import.meta.url);

if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

if (process.env.MNEIA_REQUIRE_DB === '1' && !process.env.DATABASE_URL) {
  throw new Error(
    'expected DATABASE_URL because MNEIA_REQUIRE_DB=1; found none — the integration suites skip themselves without it, which would report green while asserting nothing',
  );
}
