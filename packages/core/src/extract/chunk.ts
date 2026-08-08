import { defaultTokenCounter, type TokenCounter } from '../rehydrate/tokens.js';
import type { TrajectoryTurn } from '../trajectory/types.js';
import { renderTurn } from './prompt.js';
import { ExtractionError } from './schema.js';

const TRUNCATION_NOTE = '\n… truncated by mneia, %n more characters';

export interface ChunkOptions {
  readonly budgetTokens: number;
  readonly counter?: TokenCounter | undefined;
}

export interface TrajectoryChunk {
  readonly turns: readonly TrajectoryTurn[];
  readonly tokens: number;
}

export interface ChunkedTurns {
  readonly chunks: readonly TrajectoryChunk[];
  readonly truncatedTurns: number;
}

const truncateToTokens = (text: string, budgetTokens: number, counter: TokenCounter): string => {
  const noteTokens = counter.count(TRUNCATION_NOTE.replace('%n', String(text.length)));
  const textBudget = Math.max(1, budgetTokens - noteTokens);

  let low = 0;
  let high = text.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (counter.count(text.slice(0, middle)) <= textBudget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return `${text.slice(0, low)}${TRUNCATION_NOTE.replace('%n', String(text.length - low))}`;
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
  let current: TrajectoryTurn[] = [];
  let currentTokens = 0;
  let truncatedTurns = 0;

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push({ turns: current, tokens: currentTokens });
      current = [];
      currentTokens = 0;
    }
  };

  const cost = (turn: TrajectoryTurn): number => counter.count(renderTurn(turn));

  for (const turn of turns) {
    let candidate = turn;
    let tokens = cost(turn);

    if (tokens > budget) {
      const envelope = tokens - counter.count(turn.text);
      candidate = {
        ...turn,
        text: truncateToTokens(turn.text, Math.max(1, budget - envelope), counter),
      };
      tokens = cost(candidate);
      truncatedTurns += 1;
    }

    if (current.length > 0 && currentTokens + tokens > budget) {
      flush();
    }

    current.push(candidate);
    currentTokens += tokens;
  }

  flush();

  return { chunks, truncatedTurns };
}
