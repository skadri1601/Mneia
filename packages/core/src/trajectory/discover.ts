import { createClaudeCodeReader } from './claude-code.js';
import { createClaudeDesktopReader } from './claude-desktop.js';
import { createCodexReader } from './codex.js';
import { createCursorReader } from './cursor.js';
import { createGeminiReader } from './gemini.js';
import {
  compareByRecency,
  type ListTrajectoriesRequest,
  type Trajectory,
  TrajectoryError,
  type TrajectoryErrorCode,
  type TrajectoryReader,
  type TrajectorySource,
  type TrajectorySummary,
  type TrajectoryUnavailable,
  unavailableFrom,
} from './types.js';
import { createWarpReader } from './warp.js';

export function createReaders(sources?: readonly TrajectorySource[]): readonly TrajectoryReader[] {
  const readers = [
    createClaudeCodeReader(),
    createClaudeDesktopReader(),
    createCodexReader(),
    createCursorReader(),
    createGeminiReader(),
    createWarpReader(),
  ];
  if (sources === undefined) {
    return readers;
  }
  const wanted = new Set(sources);
  return readers.filter((reader) => wanted.has(reader.source));
}

export interface DiscoveredTrajectory extends TrajectorySummary {
  readonly unavailable: string | null;
  readonly unavailableCode: TrajectoryErrorCode | null;
}

export interface TrajectoryDiscovery {
  readonly sessions: readonly TrajectorySummary[];
  readonly unavailable: readonly TrajectoryUnavailable[];
}

const identityOf = (summary: TrajectorySummary): string =>
  `${summary.source}:${summary.sessionRef}`;

function deduplicate(summaries: readonly TrajectorySummary[]): readonly TrajectorySummary[] {
  const byIdentity = new Map<string, TrajectorySummary>();
  for (const summary of summaries) {
    const identity = identityOf(summary);
    const existing = byIdentity.get(identity);
    if (existing === undefined || compareByRecency(summary, existing) < 0) {
      byIdentity.set(identity, summary);
    }
  }
  return [...byIdentity.values()];
}

export async function discoverTrajectorySessions(
  request: ListTrajectoriesRequest = {},
  readers: readonly TrajectoryReader[] = createReaders(),
): Promise<TrajectoryDiscovery> {
  const unavailable: TrajectoryUnavailable[] = [];
  const report = (failure: TrajectoryUnavailable): void => {
    unavailable.push(failure);
    request.onUnavailable?.(failure);
  };

  const listed = await Promise.all(
    readers.map(async (reader) => {
      try {
        return await reader.list({ ...request, limit: undefined, onUnavailable: report });
      } catch (error) {
        report(unavailableFrom(reader.source, null, 'unreadable', error));
        return [] as readonly TrajectorySummary[];
      }
    }),
  );

  const sessions = [...deduplicate(listed.flat())].sort(compareByRecency);

  return {
    sessions: request.limit === undefined ? sessions : sessions.slice(0, request.limit),
    unavailable,
  };
}

export async function discoverTrajectories(
  request: ListTrajectoriesRequest = {},
  readers: readonly TrajectoryReader[] = createReaders(),
): Promise<readonly DiscoveredTrajectory[]> {
  const { sessions, unavailable } = await discoverTrajectorySessions(request, readers);

  const available: DiscoveredTrajectory[] = sessions.map((summary) => ({
    ...summary,
    unavailable: null,
    unavailableCode: null,
  }));

  const failures: DiscoveredTrajectory[] = unavailable.map((failure) => ({
    source: failure.source,
    sessionRef: failure.sessionRef ?? '',
    cwd: null,
    startedAt: null,
    lastActivityAt: null,
    unavailable: failure.reason,
    unavailableCode: failure.code,
  }));

  return [...available, ...failures];
}

export async function readTrajectory(
  source: TrajectorySource,
  sessionRef: string,
  readers: readonly TrajectoryReader[] = createReaders(),
  cwd?: string,
): Promise<Trajectory> {
  const reader = readers.find((candidate) => candidate.source === source);
  if (reader === undefined) {
    throw new TrajectoryError(
      'not_found',
      source,
      `expected a reader for ${source}; there is none — supported sources are ${readers.map((entry) => entry.source).join(', ')}`,
    );
  }
  return reader.read(sessionRef, cwd);
}
