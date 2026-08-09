import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

process.env.MNEIA_HOME = mkdtempSync(join(tmpdir(), 'mneia-test-home-'));
delete process.env.MNEIA_CREDENTIALS_PATH;
delete process.env.MNEIA_LOCAL_CONFIG;
delete process.env.MNEIA_TOKEN;
