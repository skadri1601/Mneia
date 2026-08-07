#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGES = ['core', 'cli', 'mcp-server'];
const REGISTRY = process.env.NPM_CONFIG_REGISTRY ?? 'https://registry.npmjs.org';

const manifestOf = (directory) => {
  const path = fileURLToPath(new URL(`../packages/${directory}/package.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
};

const publishedVersions = async (name) => {
  const response = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`${REGISTRY} answered ${response.status} ${response.statusText} for ${name}`);
  }
  const payload = await response.json();
  return Object.keys(payload.versions ?? {});
};

const problems = [];
const plan = [];

for (const directory of PACKAGES) {
  const manifest = manifestOf(directory);
  const { name, version } = manifest;

  if (version === '0.0.0') {
    problems.push(`${name} is still at 0.0.0; give it a real version before publishing`);
    continue;
  }
  if (manifest.publishConfig?.access !== 'public') {
    problems.push(
      `${name} has no publishConfig.access of "public"; a scoped package defaults to restricted and nobody outside the org could install it`,
    );
  }
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (String(range).startsWith('workspace:')) {
      if (!String(range).startsWith('workspace:^') && range !== 'workspace:~') {
        problems.push(
          `${name} depends on ${dependency} as "${range}"; use "workspace:^" so the published manifest carries a real semver range`,
        );
      }
    }
  }

  const published = await publishedVersions(name);
  if (published.includes(version)) {
    problems.push(
      `${name}@${version} is already on the registry; npm versions are immutable, so bump the version instead`,
    );
    continue;
  }
  plan.push(`${name}@${version}${published.length === 0 ? ' (first publish)' : ''}`);
}

if (problems.length > 0) {
  process.stderr.write(`check:publish: refusing to publish\n`);
  for (const problem of problems) {
    process.stderr.write(`  - ${problem}\n`);
  }
  process.exit(1);
}

process.stdout.write(`check:publish: would publish ${plan.join(', ')}\n`);
