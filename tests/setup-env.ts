import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = new URL('../.env', import.meta.url);

if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}
