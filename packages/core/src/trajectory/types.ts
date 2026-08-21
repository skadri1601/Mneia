export const TRAJECTORY_SOURCES = [
  'claude-code',
  'claude-desktop',
  'codex',
  'cursor',
  'gemini',
  'warp',
  'file',
] as const;

export type TrajectorySource = (typeof TRAJECTORY_SOURCES)[number];

export const TURN_ROLES = ['user', 'assistant'] as const;

export type TurnRole = (typeof TURN_ROLES)[number];

export const TURN_KINDS = ['text', 'thinking', 'tool_call', 'tool_result'] as const;

export type TurnKind = (typeof TURN_KINDS)[number];

export interface TrajectoryTurn {
  readonly ref: string;
  readonly role: TurnRole;
  readonly kind: TurnKind;
  readonly text: string;
  readonly toolName: string | null;
  readonly at: Date | null;
}

export interface Trajectory {
  readonly source: TrajectorySource;
  readonly sessionRef: string;
  readonly cwd: string | null;
  readonly turns: readonly TrajectoryTurn[];
}

export interface TrajectorySummary {
  readonly source: TrajectorySource;
  readonly sessionRef: string;
  readonly cwd: string | null;
  readonly startedAt: Date | null;
  readonly lastActivityAt: Date | null;
}

export interface TrajectoryUnavailable {
  readonly source: TrajectorySource;
  readonly sessionRef: string | null;
  readonly code: TrajectoryErrorCode;
  readonly reason: string;
}

export type TrajectoryUnavailableReporter = (failure: TrajectoryUnavailable) => void;

export interface ListTrajectoriesRequest {
  readonly cwd?: string | undefined;
  readonly limit?: number | undefined;
  readonly onUnavailable?: TrajectoryUnavailableReporter | undefined;
}

export interface TrajectoryReader {
  readonly source: TrajectorySource;
  list(request?: ListTrajectoriesRequest): Promise<readonly TrajectorySummary[]>;
  read(sessionRef: string): Promise<Trajectory>;
}

export type TrajectoryErrorCode =
  | 'not_found'
  | 'unreadable'
  | 'unsupported_runtime'
  | 'unrecognised_format';

export class TrajectoryError extends Error {
  readonly code: TrajectoryErrorCode;
  readonly source: TrajectorySource;

  constructor(
    code: TrajectoryErrorCode,
    source: TrajectorySource,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TrajectoryError';
    this.code = code;
    this.source = source;
  }
}

const timeRank = (value: Date | null): number =>
  value === null ? Number.NEGATIVE_INFINITY : value.getTime();

const newestFirst = (left: number, right: number): number => {
  if (left === right) {
    return 0;
  }
  return left > right ? -1 : 1;
};

export function compareByRecency(left: TrajectorySummary, right: TrajectorySummary): number {
  const byActivity = newestFirst(timeRank(left.lastActivityAt), timeRank(right.lastActivityAt));
  if (byActivity !== 0) {
    return byActivity;
  }
  const byStart = newestFirst(timeRank(left.startedAt), timeRank(right.startedAt));
  if (byStart !== 0) {
    return byStart;
  }
  return left.sessionRef.localeCompare(right.sessionRef);
}

export function reportUnplaced(
  request: ListTrajectoriesRequest,
  source: TrajectorySource,
  unplaced: readonly string[],
  remedy: string,
): void {
  if (unplaced.length === 0 || request.cwd === undefined) {
    return;
  }
  const named = unplaced.slice(0, 3).join(', ');
  const rest = unplaced.length > 3 ? `, and ${unplaced.length - 3} more` : '';
  request.onUnavailable?.({
    source,
    sessionRef: null,
    code: 'not_found',
    reason: `expected every ${source} session to record the working directory it ran in; ${unplaced.length} of them record none (${named}${rest}), so they cannot be matched against ${request.cwd} — ${remedy}`,
  });
}

export function unavailableFrom(
  source: TrajectorySource,
  sessionRef: string | null,
  fallbackCode: TrajectoryErrorCode,
  cause: unknown,
): TrajectoryUnavailable {
  if (cause instanceof TrajectoryError) {
    return { source: cause.source, sessionRef, code: cause.code, reason: cause.message };
  }
  return {
    source,
    sessionRef,
    code: fallbackCode,
    reason: cause instanceof Error ? cause.message : String(cause),
  };
}

export interface TurnsSinceResult {
  readonly turns: readonly TrajectoryTurn[];
  readonly resolved: boolean;
}

export function turnsSince(
  turns: readonly TrajectoryTurn[],
  watermark: string | null,
): TurnsSinceResult {
  if (watermark === null) {
    return { turns, resolved: true };
  }

  const index = turns.findIndex((turn) => turn.ref === watermark);
  if (index >= 0) {
    return { turns: turns.slice(index + 1), resolved: true };
  }

  return { turns, resolved: false };
}
