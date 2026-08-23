#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const USAGE = `usage: node scripts/check-doc-tools.mjs

Fails when instructional documentation disagrees with SHIPPED_TOOL_NAMES.

MNE-79 found docs/CLIENTS.md pinned at four tools while the registry shipped eleven,
the MCP server README promising seven, and the published site advertising
mneia_conflicts — a deferred tool the registry refuses to start with. A reader
following any of those is told about a surface that does not exist.

Two checks, both against packages/mcp-server/src/registry.ts as the only source:

  1. No instructional file may present a tool the registry does not ship.
  2. A file that states a tool count must state the shipped count.

Files that record a past run — a dated matrix, a launch log — are history, not
instructions, and are not checked. The list of what counts as instructional is
LIVE_DOCS below; add to it rather than loosening the checks.`;

const REGISTRY = join('packages', 'mcp-server', 'src', 'registry.ts');

const LIVE_DOCS = [
  join('docs', 'INSTALL.md'),
  join('docs', 'CLIENTS.md'),
  join('packages', 'mcp-server', 'README.md'),
  join('apps', 'site', 'src', 'content', 'docs', 'mcp.ts'),
  join('apps', 'site', 'src', 'content', 'docs', 'integrations.ts'),
  join('apps', 'site', 'src', 'content', 'docs', 'quickstart.ts'),
  join('apps', 'site', 'src', 'content', 'support.ts'),
  join('apps', 'site', 'src', 'content', 'faq.ts'),
];

const COUNT_WORDS = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
]);

// A dated matrix or launch log legitimately records a count that was true then. These words
// mark a sentence as describing the past rather than instructing the reader.
const HISTORICAL = /\b(?:was|were|then|at 0\.\d+|of the day|previously|used to|no longer)\b/i;

// A line explaining that a tool is deferred is not offering it. Without this, the very
// sentence documenting mneia_conflicts as unavailable would be reported as advertising it.
const DESCRIBES_ABSENCE =
  /\b(?:deferred|not (?:yet )?(?:shipped|advertised|available)|refuses|M4)\b/i;

const readRegistry = async () => {
  const source = await readFile(REGISTRY, 'utf8');
  const shippedBlock = source.match(/SHIPPED_TOOL_NAMES\s*=\s*\[([^\]]*)\]/);
  if (shippedBlock === null) {
    throw new Error(`could not find SHIPPED_TOOL_NAMES in ${REGISTRY}`);
  }
  const shipped = [...shippedBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (shipped.length === 0) throw new Error(`SHIPPED_TOOL_NAMES in ${REGISTRY} parsed as empty`);

  const deferredBlock = source.match(/DEFERRED_TOOL_MILESTONES[^=]*=\s*new Map\(\[([\s\S]*?)\]\)/);
  const deferred =
    deferredBlock === null
      ? []
      : [...deferredBlock[1].matchAll(/\['([^']+)'\s*,/g)].map((match) => match[1]);

  return { shipped: new Set(shipped), deferred: new Set(deferred), count: shipped.length };
};

const main = async () => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const registry = await readRegistry();
  const failures = [];

  for (const file of LIVE_DOCS) {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      const where = `${file}:${index + 1}`;

      // The lookbehind keeps Postgres role names and connection strings out of this:
      // mneia_app in postgres://mneia_app:... is not a tool. Beyond the deferred list, a
      // name only counts as advertised when it is backticked, which is how every real tool
      // reference in these files is written.
      if (!DESCRIBES_ABSENCE.test(line)) {
        for (const [name] of line.matchAll(/(?<![/:\w])mneia_[a-z_]+\b/g)) {
          if (registry.shipped.has(name)) continue;
          const presentedAsTool = registry.deferred.has(name) || line.includes(`\`${name}\``);
          if (!presentedAsTool) continue;
          const why = registry.deferred.has(name)
            ? 'is deferred — the registry refuses to start when it is registered'
            : 'is not in SHIPPED_TOOL_NAMES at all';
          failures.push(`${where}\n    presents ${name}, which ${why}\n    ${line.trim()}`);
        }
      }

      for (const match of line.matchAll(/\b([a-z]+|\d+) tools\b/gi)) {
        const raw = match[1].toLowerCase();
        const stated = COUNT_WORDS.get(raw) ?? Number.parseInt(raw, 10);
        if (!Number.isFinite(stated)) continue;
        if (stated === registry.count) continue;
        if (HISTORICAL.test(line)) continue;
        failures.push(
          `${where}\n    says "${match[0]}" but the registry ships ${registry.count}\n    ${line.trim()}`,
        );
      }
    });
  }

  process.stdout.write(
    `${registry.count} shipped tools, ${registry.deferred.size} deferred, ${LIVE_DOCS.length} instructional files checked\n`,
  );

  if (failures.length === 0) {
    process.stdout.write('documentation agrees with the registry\n');
    return;
  }

  process.stdout.write(`\n${failures.length} disagreement(s):\n\n`);
  for (const failure of failures) process.stdout.write(`  ${failure}\n\n`);
  process.stdout.write(
    'Fix the documentation, or add the tool to SHIPPED_TOOL_NAMES if it genuinely ships.\n',
  );
  process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
