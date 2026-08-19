import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TELEMETRY_EVENT_NAMES } from './types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const STORE_TYPES = 'packages/core/src/store/adapter/types.ts';

const SURFACES = [
  'apps/web/src/server',
  'packages/mcp-server/src/tools',
  'packages/cli/src/commands',
];

const READS = [
  'getActor',
  'getProjectBySlug',
  'getProject',
  'getContextItem',
  'listContextItems',
  'searchContextItems',
  'getCheckpoint',
  'listCheckpoints',
  'getHandoff',
  'listOpenConflicts',
] as const;

const WRITES: Readonly<Record<string, readonly string[]>> = {
  writeCheckpoint: ['checkpoint.item_extracted', 'item.superseded'],
  insertContextItem: ['checkpoint.item_extracted'],
  supersedeContextItem: ['item.superseded'],
  confirmContextItem: ['checkpoint.item_confirmed'],
  createHandoff: ['handoff.created'],
  assembleHandoff: ['handoff.created'],
  receiveHandoff: ['handoff.received'],
  recordConflict: ['conflict.detected'],
  resolveConflict: ['conflict.resolved'],
};

const EXEMPT: Readonly<Record<string, string>> = {
  createProject:
    'control-plane, not the product loop — §17 has no administrative event name and TelemetryContext requires a projectId that does not exist until the row does (MNE-271)',
  createSession:
    'session lifecycle — §17 names no session event; the checkpoint carries the session',
  endSession: 'session lifecycle — see createSession',
};

const readScopedStoreMethods = async (): Promise<readonly string[]> => {
  const source = await readFile(join(REPO_ROOT, STORE_TYPES), 'utf8');
  const block = /export interface ScopedStore\s*\{([\s\S]*?)\n\}/.exec(source);
  if (block === null) {
    throw new Error(
      `expected ${STORE_TYPES} to declare an exported ScopedStore interface; found none`,
    );
  }
  return [...block[1].matchAll(/^\s{2}(\w+)\s*\(/gm)].map((match) => match[1] as string);
};

const sourceFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(join(REPO_ROOT, directory), { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return [];
      if (entry.name.includes('.test.')) return [];
      return [path];
    }),
  );
  return found.flat();
};

const allSurfaceFiles = async (): Promise<readonly { path: string; source: string }[]> => {
  const paths = (await Promise.all(SURFACES.map(sourceFiles))).flat();
  return Promise.all(
    paths.map(async (path) => ({ path, source: await readFile(join(REPO_ROOT, path), 'utf8') })),
  );
};

const callsWrite = (source: string, method: string): boolean =>
  new RegExp(`(?:\\.|\\b)${method}\\s*\\(`).test(source);

const emitsAnyEvent = (source: string): boolean =>
  TELEMETRY_EVENT_NAMES.some((name) => source.includes(`'${name}'`));

describe('§17 coverage — every write path emits its event', () => {
  it('classifies every ScopedStore method as a read, a write, or an exemption with a reason', async () => {
    const methods = await readScopedStoreMethods();
    const classified = new Set([...READS, ...Object.keys(WRITES), ...Object.keys(EXEMPT)]);

    expect(methods.length).toBeGreaterThan(0);
    expect(methods.filter((method) => !classified.has(method))).toEqual([]);
  });

  it('maps every write to event names that exist in the §17 spine', () => {
    const declared = Object.values(WRITES).flat();
    expect(declared.filter((name) => !TELEMETRY_EVENT_NAMES.includes(name))).toEqual([]);
  });

  it('fails when a surface calls a write and emits nothing', async () => {
    const files = await allSurfaceFiles();

    const silent = files
      .filter((file) => Object.keys(WRITES).some((method) => callsWrite(file.source, method)))
      .filter((file) => !emitsAnyEvent(file.source))
      .map((file) => relative('.', file.path));

    expect(silent).toEqual([]);
  });

  it('requires each calling surface to emit an event its write actually maps to', async () => {
    const files = await allSurfaceFiles();

    const mismatched = files.flatMap((file) =>
      Object.entries(WRITES)
        .filter(([method]) => callsWrite(file.source, method))
        .filter(([, required]) => !required.some((name) => file.source.includes(`'${name}'`)))
        .map(
          ([method]) => `${file.path} calls ${method} without emitting one of ${WRITES[method]}`,
        ),
    );

    expect(mismatched).toEqual([]);
  });

  it('keeps at least one instrumented write path, so the scan cannot pass by finding nothing', async () => {
    const files = await allSurfaceFiles();
    const instrumented = files.filter(
      (file) =>
        Object.keys(WRITES).some((method) => callsWrite(file.source, method)) &&
        emitsAnyEvent(file.source),
    );

    expect(instrumented.length).toBeGreaterThan(0);
  });
});
