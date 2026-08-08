import { defaultTokenCounter, type TokenCounter } from '../rehydrate/tokens.js';
import type { TrajectoryTurn } from '../trajectory/types.js';
import { renderTurn } from './prompt.js';
import { ExtractionError } from './schema.js';

const CONTINUES_NOTE = '\n… this turn continues in the next part';

export interface ChunkOptions {
  readonly budgetTokens: number;
  readonly counter?: TokenCounter | undefined;
}

export interface TrajectoryChunk {
  readonly turns: readonly TrajectoryTurn[];
  readonly tokens: number;
  readonly endsMidTurn: boolean;
  readonly completedThrough: number;
}

export interface ChunkedTurns {
  readonly chunks: readonly TrajectoryChunk[];
  readonly splitTurns: number;
}

const longestPrefixWithin = (text: string, budget: number, counter: TokenCounter): number => {
  let low = 0;
  let high = text.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (counter.count(text.slice(0, middle)) <= budget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return Math.max(1, low);
};

const splitText = (text: string, budget: number, counter: TokenCounter): readonly string[] => {
  const noteTokens = counter.count(CONTINUES_NOTE);
  const segments: string[] = [];
  let rest = text;

  while (counter.count(rest) > budget) {
    const taken = longestPrefixWithin(rest, Math.max(1, budget - noteTokens), counter);
    segments.push(`${rest.slice(0, taken)}${CONTINUES_NOTE}`);
    rest = rest.slice(taken);
  }

  segments.push(rest);
  return segments;
};

export function chunkTurns(turns: readonly TrajectoryTurn[], options: ChunkOptions): ChunkedTurns {
  const counter = options.counter ?? defaultTokenCounter;
  const budget = options.budgetTokens;

  if (!Number.isFinite(budget) || budget < 1) {
    throw new ExtractionError(
      'invalid_options',
      `budgetTokens must be a positive finite number; received ${String(budget)}. Pass the chosen model's context window less the prompt overhead.`,
    );
  }

  const chunks: TrajectoryChunk[] = [];
  const cost = (turn: TrajectoryTurn): number => counter.count(renderTurn(turn));

  let current: TrajectoryTurn[] = [];
  let currentTokens = 0;
  let completedThrough = -1;
  let splitTurns = 0;

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push({ turns: current, tokens: currentTokens, endsMidTurn: false, completedThrough });
      current = [];
      currentTokens = 0;
    }
  };

  for (const [index, turn] of turns.entries()) {
    const tokens = cost(turn);

    if (tokens <= budget) {
      if (current.length > 0 && currentTokens + tokens > budget) {
        flush();
      }
      current.push(turn);
      currentTokens += tokens;
      completedThrough = index;
      continue;
    }

    flush();
    splitTurns += 1;

    const envelope = tokens - counter.count(turn.text);
    const segments = splitText(turn.text, Math.max(1, budget - envelope), counter);

    for (const [position, text] of segments.entries()) {
      const part = { ...turn, text };
      const final = position === segments.length - 1;
      if (final) {
        completedThrough = index;
      }
      chunks.push({
        turns: [part],
        tokens: cost(part),
        endsMidTurn: !final,
        completedThrough,
      });
    }
  }

  flush();

  return { chunks, splitTurns };
}
