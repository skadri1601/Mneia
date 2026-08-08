import type { TrajectorySource } from './types.js';
import { TrajectoryError } from './types.js';

export interface SqliteRow {
  readonly [column: string]: unknown;
}

export interface SqliteStatement {
  all(...parameters: readonly unknown[]): readonly SqliteRow[];
  get(...parameters: readonly unknown[]): SqliteRow | undefined;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

const MINIMUM_NODE = '22.5';

export async function openReadOnly(
  path: string,
  source: TrajectorySource,
): Promise<SqliteDatabase> {
  let module: NodeSqliteModule;
  try {
    module = (await import('node:sqlite')) as unknown as NodeSqliteModule;
  } catch (cause) {
    throw new TrajectoryError(
      'unsupported_runtime',
      source,
      `reading ${source} sessions needs the built-in node:sqlite module, which requires Node ${MINIMUM_NODE} or newer; this process is running ${process.version} — upgrade Node, or pass a transcript explicitly with --from-file`,
      { cause },
    );
  }

  try {
    return new module.DatabaseSync(path, { readOnly: true });
  } catch (cause) {
    throw new TrajectoryError(
      'unreadable',
      source,
      `expected to open the ${source} database at ${path}; the open failed — check the file exists and the application is not holding an exclusive lock`,
      { cause },
    );
  }
}

export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file:///')) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri.slice('file:///'.length));
  } catch {
    return null;
  }
  if (decoded.length === 0) {
    return null;
  }
  if (!/^[A-Za-z]:/.test(decoded)) {
    return `/${decoded}`;
  }
  const windowsPath = decoded.replace(/\//g, '\\');
  return `${windowsPath.charAt(0).toUpperCase()}${windowsPath.slice(1)}`;
}
