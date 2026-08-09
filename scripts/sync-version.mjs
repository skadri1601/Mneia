#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = new URL('packages/core/package.json', root);
const source = new URL('packages/core/src/index.ts', root);

const DECLARATION = /^export const VERSION = '([^']*)';$/m;

const { version } = JSON.parse(await readFile(manifest, 'utf8'));
const text = await readFile(source, 'utf8');
const found = DECLARATION.exec(text);

if (found === null) {
  process.stderr.write(
    `expected ${fileURLToPath(source)} to declare VERSION as a single-quoted string literal on its own line; found no such line\n`,
  );
  process.exit(1);
}

if (found[1] === version) {
  process.stdout.write(`sync:version: VERSION is already ${version}\n`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  process.stderr.write(
    `VERSION is "${found[1]}" but @mneia/core is ${version}. Every surface that reports a version reads this constant — mneia --version, mneia-mcp --version, the MCP serverInfo, and the API user-agent — so a published client would misreport itself. Run: pnpm sync:version\n`,
  );
  process.exit(1);
}

await writeFile(source, text.replace(DECLARATION, `export const VERSION = '${version}';`), 'utf8');
process.stdout.write(`sync:version: VERSION ${found[1]} -> ${version}\n`);
