import { createClaudeCodeReader } from './claude-code.js';
import { createClaudeDesktopReader } from './claude-desktop.js';
import { createCodexReader } from './codex.js';
import { createCursorReader } from './cursor.js';
import {
  type ListTrajectoriesRequest,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySource,
  type TrajectorySummary,
} from './types.js';
import { createWarpReader } from './warp.js';

export function createReaders(): readonly TrajectoryReader[] {
  return [
    createClaudeCodeReader(),
    createClaudeDesktopReader(),
    createCodexReader(),
    createCursorReader(),
    createWarpReader(),
  ];
}

export interface DiscoveredTrajectory extends TrajectorySummary {
  readonly unavailable: string | null;
}

export async function discoverTrajectories(
  request: ListTrajectoriesRequest = {},
  readers: readonly TrajectoryReader[] = createReaders(),
): Promise<readonly DiscoveredTrajectory[]> {
  const found: DiscoveredTrajectory[] = [];

  const listed = await Promise.all(
    readers.map(async (reader) => {
      try {
        return {
          source: reader.source,
          summaries: await reader.list({ ...request, limit: undefined }),
          unavailable: null as string | null,
        };
      } catch (error) {
        return {
          source: reader.source,
          summaries: [] as readonly TrajectorySummary[],
          unavailable: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  for (const entry of listed) {
    for (const summary of entry.summaries) {
      found.push({ ...summary, unavailable: null });
    }
  }

  found.sort(
    (left, right) => (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0),
  );

  const limited = request.limit === undefined ? found : found.slice(0, request.limit);
  const failures = listed
    .filter((entry) => entry.unavailable !== null)
    .map((entry) => ({
      source: entry.source,
      sessionRef: '',
      cwd: null,
      startedAt: null,
      lastActivityAt: null,
      unavailable: entry.unavailable,
    }));

  return [...limited, ...failures];
}

export async function readTrajectory(
  source: TrajectorySource,
  sessionRef: string,
  readers: readonly TrajectoryReader[] = createReaders(),
): Promise<Trajectory> {
  const reader = readers.find((candidate) => candidate.source === source);
  if (reader === undefined) {
    throw new TrajectoryError(
      'not_found',
      source,
      `expected a reader for ${source}; there is none — supported sources are ${readers.map((entry) => entry.source).join(', ')}`,
    );
  }
  return reader.read(sessionRef);
}
