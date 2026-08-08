import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createClaudeCodeReader } from './claude-code.js';
import { roamingAppDataDir } from './paths.js';
import {
  type ListTrajectoriesRequest,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySummary,
} from './types.js';

const SESSIONS_DIRNAME = 'local-agent-mode-sessions';
const MAX_SCAN_DEPTH = 6;

export const claudeDesktopSessionsRoot = (env: NodeJS.ProcessEnv = process.env): string =>
  join(roamingAppDataDir(env), 'Claude', SESSIONS_DIRNAME);

export async function findProjectsRoots(
  root: string,
  maxDepth: number = MAX_SCAN_DEPTH,
): Promise<readonly string[]> {
  const found: string[] = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth) {
      return;
    }
    let entries: readonly { name: string; isDirectory: () => boolean }[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === '.claude') {
        found.push(join(directory, entry.name, 'projects'));
        continue;
      }
      await walk(join(directory, entry.name), depth + 1);
    }
  };

  await walk(root, 0);
  return found;
}

export interface ClaudeDesktopReaderOptions {
  readonly sessionsRoot?: string | undefined;
}

export function createClaudeDesktopReader(
  options: ClaudeDesktopReaderOptions = {},
): TrajectoryReader {
  const root = options.sessionsRoot ?? claudeDesktopSessionsRoot();

  const readers = async (): Promise<readonly TrajectoryReader[]> => {
    const roots = await findProjectsRoots(root);
    return roots.map((projectsRoot) =>
      createClaudeCodeReader({ projectsRoot, source: 'claude-desktop' }),
    );
  };

  return {
    source: 'claude-desktop',

    async list(request: ListTrajectoriesRequest = {}): Promise<readonly TrajectorySummary[]> {
      const all: TrajectorySummary[] = [];
      for (const reader of await readers()) {
        all.push(...(await reader.list({ ...request, limit: undefined })));
      }
      all.sort(
        (left, right) =>
          (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0),
      );
      return request.limit === undefined ? all : all.slice(0, request.limit);
    },

    async read(sessionRef: string): Promise<Trajectory> {
      for (const reader of await readers()) {
        try {
          return await reader.read(sessionRef);
        } catch (error) {
          if (error instanceof TrajectoryError && error.code === 'not_found') {
            continue;
          }
          throw error;
        }
      }
      throw new TrajectoryError(
        'not_found',
        'claude-desktop',
        `expected a Claude Desktop transcript named ${sessionRef}.jsonl under ${root}; found none — check the session id with mneia checkpoint --list`,
      );
    },
  };
}
