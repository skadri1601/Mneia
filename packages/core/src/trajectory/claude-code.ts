import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { matchesCwd } from './paths.js';
import { createRefFactory } from './refs.js';
import {
  type ListTrajectoriesRequest,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySource,
  type TrajectorySummary,
  type TrajectoryTurn,
  type TurnKind,
  type TurnRole,
} from './types.js';

const IGNORED_LINE_TYPES = new Set([
  'ai-title',
  'attachment',
  'file-history-snapshot',
  'last-prompt',
  'mode',
  'permission-mode',
  'queue-operation',
  'summary',
  'system',
]);

export const projectSlug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-');

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

const blockText = (block: Record<string, unknown>): string => {
  const direct = asString(block.text);
  if (direct !== null) {
    return direct;
  }
  const thinking = asString(block.thinking);
  if (thinking !== null) {
    return thinking;
  }
  const content = block.content;
  if (typeof content === 'string') {
    return content;
  }
  if (content !== undefined) {
    return JSON.stringify(content);
  }
  const input = block.input;
  return input === undefined ? '' : JSON.stringify(input);
};

const blockKind = (type: string | null): TurnKind | null => {
  switch (type) {
    case 'text':
      return 'text';
    case 'thinking':
      return 'thinking';
    case 'tool_use':
      return 'tool_call';
    case 'tool_result':
      return 'tool_result';
    default:
      return null;
  }
};

export function parseClaudeCodeJsonl(text: string, sessionRef: string): Trajectory {
  const turns: TrajectoryTurn[] = [];
  const uniqueRef = createRefFactory();
  let cwd: string | null = null;

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

    cwd = cwd ?? asString(record.cwd);

    const lineType = asString(record.type);
    if (lineType === null || IGNORED_LINE_TYPES.has(lineType)) {
      continue;
    }
    if (lineType !== 'user' && lineType !== 'assistant') {
      continue;
    }
    if (record.isMeta === true) {
      continue;
    }

    const message = asRecord(record.message);
    if (message === null) {
      continue;
    }

    const role: TurnRole = lineType;
    const at = parseDate(record.timestamp);
    const uuid = asString(record.uuid) ?? `${turns.length}`;
    const content = message.content;

    if (typeof content === 'string') {
      if (content.trim().length > 0) {
        turns.push({ ref: uniqueRef(uuid), role, kind: 'text', text: content, toolName: null, at });
      }
      continue;
    }

    if (!Array.isArray(content)) {
      continue;
    }

    content.forEach((entry, index) => {
      const block = asRecord(entry);
      if (block === null) {
        return;
      }
      const kind = blockKind(asString(block.type));
      if (kind === null) {
        return;
      }
      const value = blockText(block);
      if (value.trim().length === 0) {
        return;
      }
      turns.push({
        ref: uniqueRef(`${uuid}#${index}`),
        role,
        kind,
        text: value,
        toolName: asString(block.name),
        at,
      });
    });
  }

  return { source: 'claude-code', sessionRef, cwd, turns };
}

export interface ClaudeCodeReaderOptions {
  readonly projectsRoot?: string | undefined;
  readonly source?: TrajectorySource | undefined;
}

const defaultProjectsRoot = (): string => join(homedir(), '.claude', 'projects');

async function listJsonlFiles(root: string): Promise<readonly string[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const directory = join(root, entry);
    let files: readonly string[];
    try {
      files = await readdir(directory);
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        found.push(join(directory, file));
      }
    }
  }
  return found;
}

export function createClaudeCodeReader(options: ClaudeCodeReaderOptions = {}): TrajectoryReader {
  const root = options.projectsRoot ?? defaultProjectsRoot();
  const source = options.source ?? 'claude-code';

  const pathFor = async (sessionRef: string): Promise<string> => {
    const files = await listJsonlFiles(root);
    const match = files.find((file) => basename(file, '.jsonl') === sessionRef);
    if (match === undefined) {
      throw new TrajectoryError(
        'not_found',
        source,
        `expected a ${source} transcript named ${sessionRef}.jsonl under ${root}; found none — check the session id with mneia checkpoint --list`,
      );
    }
    return match;
  };

  return {
    source,

    async list(request: ListTrajectoriesRequest = {}) {
      const files = await listJsonlFiles(root);
      const summaries: TrajectorySummary[] = [];

      for (const file of files) {
        let raw: string;
        let modified: Date | null;
        try {
          raw = await readFile(file, 'utf8');
          modified = (await stat(file)).mtime;
        } catch {
          continue;
        }
        const parsed = parseClaudeCodeJsonl(raw, basename(file, '.jsonl'));
        if (parsed.turns.length === 0) {
          continue;
        }
        if (!matchesCwd(parsed.cwd, request.cwd)) {
          continue;
        }
        summaries.push({
          source,
          sessionRef: parsed.sessionRef,
          cwd: parsed.cwd,
          startedAt: parsed.turns[0]?.at ?? null,
          lastActivityAt: parsed.turns[parsed.turns.length - 1]?.at ?? modified,
        });
      }

      summaries.sort(
        (left, right) =>
          (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0),
      );
      return request.limit === undefined ? summaries : summaries.slice(0, request.limit);
    },

    async read(sessionRef: string) {
      const file = await pathFor(sessionRef);
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch (cause) {
        throw new TrajectoryError(
          'unreadable',
          source,
          `expected to read the ${source} transcript at ${file}; the read failed — check the file is not locked by another process`,
          { cause },
        );
      }
      return { ...parseClaudeCodeJsonl(raw, sessionRef), source };
    },
  };
}
