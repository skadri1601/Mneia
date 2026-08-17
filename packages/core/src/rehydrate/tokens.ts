import { encode } from 'gpt-tokenizer';
import type { ContextItem } from '../domain/types.js';

export interface TokenCounter {
  readonly name: string;
  count(text: string): number;
}

export const WORD_CHARS_PER_TOKEN = 4;

export const LONG_WORD_CHARS_PER_TOKEN = 3;

export const LONG_WORD_LENGTH = 12;

export const ALPHANUMERIC_CHARS_PER_TOKEN = 2;

export const SPACE_RUN_CHARS_PER_TOKEN = 4;

export const ITEM_MARKUP_TOKENS = 6;

export const TRUNCATION_MARKER = ' [truncated]';

type RunClass = 'word' | 'space' | 'newline' | 'punctuation';

type CharClass = RunClass | 'wide';

const WHITESPACE = /\s/;

const isDigit = (code: number): boolean => code >= 48 && code <= 57;

const classify = (code: number): CharClass => {
  if (code === 0x0a || code === 0x0d) {
    return 'newline';
  }
  if (code === 0x20 || code === 0x09 || code === 0x0b || code === 0x0c) {
    return 'space';
  }
  if (
    isDigit(code) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 39
  ) {
    return 'word';
  }
  return code < 128 ? 'punctuation' : 'wide';
};

const utf8Length = (code: number): number => {
  if (code < 0x80) {
    return 1;
  }
  if (code < 0x800) {
    return 2;
  }
  return code < 0x10000 ? 3 : 4;
};

const wordRunTokens = (length: number, hasDigit: boolean): number => {
  if (hasDigit) {
    return Math.ceil(length / ALPHANUMERIC_CHARS_PER_TOKEN);
  }
  if (length > LONG_WORD_LENGTH) {
    return Math.ceil(length / LONG_WORD_CHARS_PER_TOKEN);
  }
  return Math.ceil(length / WORD_CHARS_PER_TOKEN);
};

const runTokens = (kind: RunClass | null, length: number, hasDigit: boolean): number => {
  if (kind === null || length === 0) {
    return 0;
  }
  switch (kind) {
    case 'word':
      return wordRunTokens(length, hasDigit);
    case 'space':
      return Math.ceil((length - 1) / SPACE_RUN_CHARS_PER_TOKEN);
    case 'newline':
      return length;
    case 'punctuation':
      return length;
  }
};

export function countHeuristicTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  let total = 0;
  let openClass: RunClass | null = null;
  let openLength = 0;
  let openHasDigit = false;

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const characterClass = classify(code);

    if (characterClass === 'wide') {
      total += runTokens(openClass, openLength, openHasDigit) + utf8Length(code);
      openClass = null;
      openLength = 0;
      openHasDigit = false;
      continue;
    }

    if (characterClass !== openClass) {
      total += runTokens(openClass, openLength, openHasDigit);
      openClass = characterClass;
      openLength = 0;
      openHasDigit = false;
    }

    openLength += 1;
    openHasDigit = openHasDigit || isDigit(code);
  }

  total += runTokens(openClass, openLength, openHasDigit);

  return Math.max(1, total);
}

export const heuristicTokenCounter: TokenCounter = {
  name: 'heuristic-v1',
  count: countHeuristicTokens,
};

export const bpeTokenCounter: TokenCounter = {
  name: 'cl100k_base',
  count: (text: string): number => (text.length === 0 ? 0 : encode(text).length),
};

export const defaultTokenCounter: TokenCounter = bpeTokenCounter;

export function countItemTokens(
  item: ContextItem,
  counter: TokenCounter = defaultTokenCounter,
): number {
  const body = item.body === null ? 0 : counter.count(item.body);
  return ITEM_MARKUP_TOKENS + counter.count(item.title) + body;
}

const boundaryOffsets = (text: string): number[] => {
  const offsets: number[] = [];

  for (let index = 1; index < text.length; index += 1) {
    const current = text[index];
    const previous = text[index - 1];
    if (current === undefined || previous === undefined) {
      continue;
    }
    if (WHITESPACE.test(current) && !WHITESPACE.test(previous)) {
      offsets.push(index);
    }
  }

  offsets.push(text.length);
  return offsets;
};

const prefixAt = (text: string, offsets: readonly number[], index: number): string => {
  const offset = offsets[index];
  return offset === undefined ? '' : text.slice(0, offset).trimEnd();
};

const largestFittingBoundary = (
  text: string,
  offsets: readonly number[],
  budget: number,
  counter: TokenCounter,
): number => {
  let low = 0;
  let high = offsets.length - 1;
  let best = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (counter.count(prefixAt(text, offsets, middle)) <= budget) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
};

export function truncateToTokens(
  text: string,
  maxTokens: number,
  counter: TokenCounter = defaultTokenCounter,
): string {
  if (maxTokens <= 0) {
    return '';
  }
  if (counter.count(text) <= maxTokens) {
    return text;
  }

  const budget = maxTokens - counter.count(TRUNCATION_MARKER);
  if (budget <= 0) {
    return '';
  }

  const offsets = boundaryOffsets(text);

  let index = largestFittingBoundary(text, offsets, budget, counter);

  while (index >= 0) {
    const candidate = `${prefixAt(text, offsets, index)}${TRUNCATION_MARKER}`;
    if (counter.count(candidate) <= maxTokens) {
      return candidate;
    }
    index -= 1;
  }

  const marker = TRUNCATION_MARKER.trim();
  return counter.count(marker) <= maxTokens ? marker : '';
}
