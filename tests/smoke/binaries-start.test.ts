import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PublishedBinary {
  readonly packageName: string;
  readonly binName: string;
  readonly entry: string;
}

const binaries = (): readonly PublishedBinary[] => {
  const found: PublishedBinary[] = [];
  for (const workspace of ['cli', 'mcp-server']) {
    const manifestPath = join(repoRoot, 'packages', workspace, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      bin?: Record<string, string>;
    };
    for (const [binName, relative] of Object.entries(manifest.bin ?? {})) {
      found.push({
        packageName: manifest.name,
        binName,
        entry: join(repoRoot, 'packages', workspace, relative),
      });
    }
  }
  return found;
};

const CASES = binaries();

describe('every published binary starts', () => {
  it('finds a binary to check, so a rename cannot silently empty this suite', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(2);
  });

  it.each(CASES.map((entry) => [entry.binName, entry] as const))(
    '%s runs --version without throwing at module load',
    async (_name, entry) => {
      expect(
        existsSync(entry.entry),
        `${entry.packageName} declares a bin at ${entry.entry} and nothing is built there — run pnpm build`,
      ).toBe(true);

      const { stdout } = await run(process.execPath, [entry.entry, '--version'], {
        cwd: repoRoot,
        timeout: 60_000,
      });

      expect(stdout.trim()).not.toBe('');
    },
    60_000,
  );
});
