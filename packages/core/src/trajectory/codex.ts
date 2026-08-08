import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { matchesCwd } from './paths.js';
import { createRefFactory } from './refs.js';
import {
  type ListTrajectoriesRequest,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySummary,
  type TrajectoryTurn,
} from './types.js';

const TEXT_BLOCK_TYPES = new Set(['input_text', 'output_text', 'summary_text', 'text']);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const parseDate = (value: unknown): Date | null => {
  const raw = asString(value);
  if (raw === null) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const joinTextBlocks = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return '';
  }
  const parts: string[] = [];
  for (const entry of value) {
    const block = asRecord(entry);
    if (block === null) {
      continue;
    }
    const type = asString(block.type);
    if (type === null || !TEXT_BLOCK_TYPES.has(type)) {
      continue;
    }
    const text = asString(block.text);
    if (text !== null && text.trim().length > 0) {
      parts.push(text);
    }
  }
  return parts.join('\n');
};

export function parseCodexRollout(text: string, sessionRef: string): Trajectory {
  const turns: TrajectoryTurn[] = [];
  const ref = createRefFactory();
  let cwd: string | null = null;
  let resolvedRef = sessionRef;

  for (const line of text.split('\n')) {
    if (line.length === 0) {
      continue;
    }

    let record: Record<string, unknown> | null;
    try {
      record = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (record === null) {
      continue;
    }

    const payload = asRecord(record.payload);
    if (payload === null) {
      continue;
    }

    if (record.type === 'session_meta') {
      cwd = cwd ?? asString(payload.cwd);
      resolvedRef = asString(payload.id) ?? resolvedRef;
      continue;
    }

    if (record.type !== 'response_item') {
      continue;
    }

    const at = parseDate(record.timestamp);
    const payloadType = asString(payload.type);
    const identity = asString(payload.id) ?? asString(payload.call_id) ?? `${turns.length}`;

    const push = (
      role: TrajectoryTurn['role'],
      kind: TrajectoryTurn['kind'],
      value: string,
      toolName: string | null,
    ): void => {
      if (value.trim().length === 0) {
        return;
      }
      turns.push({ ref: ref(identity), role, kind, text: value, toolName, at });
    };

    switch (payloadType) {
      case 'message': {
        const role = asString(payload.role) === 'assistant' ? 'assistant' : 'user';
        push(role, 'text', joinTextBlocks(payload.content), null);
        break;
      }
      case 'reasoning': {
        const summary = joinTextBlocks(payload.summary);
        push(
          'assistant',
          'thinking',
          summary.length > 0 ? summary : joinTextBlocks(payload.content),
          null,
        );
        break;
      }
      case 'function_call': {
        push('assistant', 'tool_call', asString(payload.arguments) ?? '', asString(payload.name));
        break;
      }
      case 'custom_tool_call': {
        push('assistant', 'tool_call', asString(payload.input) ?? '', asString(payload.name));
        break;
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        push('user', 'tool_result', asString(payload.output) ?? '', null);
        break;
      }
      default:
        break;
    }
  }

  return { source: 'codex', sessionRef: resolvedRef, cwd, turns };
}

export interface CodexReaderOptions {
  readonly sessionsRoot?: string | undefined;
}

const defaultSessionsRoot = (): string => join(homedir(), '.codex', 'sessions');

async function listRolloutFiles(root: string): Promise<readonly string[]> {
  const found: string[] = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 4) {
      return;
    }
    let entries: readonly { name: string; isDirectory: () => boolean }[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
      } else if (entry.name.endsWith('.jsonl')) {
        found.push(path);
      }
    }
  };

  await walk(root, 0);
  return found;
}

export function createCodexReader(options: CodexReaderOptions = {}): TrajectoryReader {
  const root = options.sessionsRoot ?? defaultSessionsRoot();

  return {
    source: 'codex',

    async list(request: ListTrajectoriesRequest = {}): Promise<readonly TrajectorySummary[]> {
      const summaries: TrajectorySummary[] = [];

      for (const file of await listRolloutFiles(root)) {
        let raw: string;
        try {
          raw = await readFile(file, 'utf8');
        } catch {
          continue;
        }
        const parsed = parseCodexRollout(raw, file);
        if (parsed.turns.length === 0) {
          continue;
        }
        if (!matchesCwd(parsed.cwd, request.cwd)) {
          continue;
        }
        summaries.push({
          source: 'codex',
          sessionRef: parsed.sessionRef,
          cwd: parsed.cwd,
          startedAt: parsed.turns[0]?.at ?? null,
          lastActivityAt: parsed.turns[parsed.turns.length - 1]?.at ?? null,
        });
      }

      summaries.sort(
        (left, right) =>
          (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0),
      );
      return request.limit === undefined ? summaries : summaries.slice(0, request.limit);
    },

    async read(sessionRef: string): Promise<Trajectory> {
      for (const file of await listRolloutFiles(root)) {
        if (!file.includes(sessionRef)) {
          continue;
        }
        let raw: string;
        try {
          raw = await readFile(file, 'utf8');
        } catch (cause) {
          throw new TrajectoryError(
            'unreadable',
            'codex',
            `expected to read the Codex rollout at ${file}; the read failed — check the file is not locked by another process`,
            { cause },
          );
        }
        return parseCodexRollout(raw, sessionRef);
      }

      throw new TrajectoryError(
        'not_found',
        'codex',
        `expected a Codex rollout matching ${sessionRef} under ${root}; found none — check the session id with mneia checkpoint --list`,
      );
    },
  };
}
