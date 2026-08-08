import { redactSecrets } from './secrets.js';
import type { Trajectory, TrajectoryTurn, TurnKind } from './types.js';

export const DEFAULT_TOOL_CALL_CHARS = 2000;
export const DEFAULT_TOOL_RESULT_CHARS = 2000;
export const DEFAULT_MAX_CHARS = 700_000;

const TRUNCATION_NOTE = '\n… truncated by mneia, %n more characters';

export const DROP_ORDER: readonly TurnKind[] = ['tool_result', 'tool_call', 'thinking'];

export interface ReduceOptions {
  readonly maxToolCallChars?: number | undefined;
  readonly maxToolResultChars?: number | undefined;
  readonly maxChars?: number | undefined;
  readonly redact?: boolean | undefined;
}

export interface ReducedTrajectory {
  readonly trajectory: Trajectory;
  readonly originalChars: number;
  readonly reducedChars: number;
  readonly truncatedTurns: number;
  readonly droppedTurns: number;
  readonly redactions: readonly string[];
}

const charsIn = (turns: readonly TrajectoryTurn[]): number =>
  turns.reduce((total, turn) => total + turn.text.length, 0);

const capFor = (kind: TurnKind, options: ReduceOptions): number | null => {
  if (kind === 'tool_call') {
    return options.maxToolCallChars ?? DEFAULT_TOOL_CALL_CHARS;
  }
  if (kind === 'tool_result') {
    return options.maxToolResultChars ?? DEFAULT_TOOL_RESULT_CHARS;
  }
  return null;
};

const truncate = (text: string, cap: number): string =>
  `${text.slice(0, cap)}${TRUNCATION_NOTE.replace('%n', String(text.length - cap))}`;

export function reduceTrajectory(
  trajectory: Trajectory,
  options: ReduceOptions = {},
): ReducedTrajectory {
  const originalChars = charsIn(trajectory.turns);
  const redactions: string[] = [];
  let truncatedTurns = 0;

  let turns: TrajectoryTurn[] = trajectory.turns.map((turn) => {
    let text = turn.text;

    const cap = capFor(turn.kind, options);
    if (cap !== null && text.length > cap) {
      text = truncate(text, cap);
      truncatedTurns += 1;
    }

    if (options.redact !== false) {
      const redacted = redactSecrets(text);
      redactions.push(...redacted.redactions);
      text = redacted.text;
    }

    return text === turn.text ? turn : { ...turn, text };
  });

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  let droppedTurns = 0;

  let running = charsIn(turns);

  for (const kind of DROP_ORDER) {
    if (running <= maxChars) {
      break;
    }
    const kept: TrajectoryTurn[] = [];
    for (const turn of turns) {
      if (turn.kind === kind && running > maxChars) {
        running -= turn.text.length;
        droppedTurns += 1;
        continue;
      }
      kept.push(turn);
    }
    turns = kept;
  }

  while (running > maxChars) {
    const index = turns.findIndex((turn) => !(turn.role === 'user' && turn.kind === 'text'));
    if (index === -1) {
      break;
    }
    running -= turns[index]?.text.length ?? 0;
    turns.splice(index, 1);
    droppedTurns += 1;
  }

  return {
    trajectory: { ...trajectory, turns },
    originalChars,
    reducedChars: charsIn(turns),
    truncatedTurns,
    droppedTurns,
    redactions,
  };
}
