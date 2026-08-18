import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mneiaHomeDir } from './config.js';

export const HISTORY_FILE = 'history';
export const HISTORY_LIMIT = 500;

export interface HistoryStore {
  read(): Promise<string[]>;
  append(line: string): Promise<void>;
}

export function historyPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return join(mneiaHomeDir(env), HISTORY_FILE);
}

export function parseHistory(contents: string): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];

  for (const line of contents.split('\n').reverse()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    entries.push(trimmed);
    if (entries.length === HISTORY_LIMIT) {
      break;
    }
  }

  return entries;
}

export function rememberLine(history: readonly string[], line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return [...history];
  }
  return [trimmed, ...history.filter((entry) => entry !== trimmed)].slice(0, HISTORY_LIMIT);
}

export function createHistoryStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HistoryStore {
  const path = historyPath(env);

  return {
    async read(): Promise<string[]> {
      try {
        return parseHistory(await readFile(path, 'utf8'));
      } catch {
        return [];
      }
    },

    async append(line: string): Promise<void> {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.includes('\n')) {
        return;
      }
      try {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${trimmed}\n`, { encoding: 'utf8', mode: 0o600 });
      } catch {
        return;
      }
    },
  };
}

export const memoryHistoryStore: HistoryStore = {
  read: () => Promise.resolve([]),
  append: () => Promise.resolve(),
};
