import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { matchesCwd } from './paths.js';
import { createRefFactory } from './refs.js';
import {
  compareByRecency,
  type ListTrajectoriesRequest,
  reportUnplaced,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySource,
  type TrajectorySummary,
  type TrajectoryTurn,
  type TurnKind,
  type TurnRole,
  unavailableFrom,
} from './types.js';
import { readTranscriptWindows } from './windows.js';

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

export function slugCouldHoldCwd(directoryName: string, cwd: string | undefined): boolean {
  if (cwd === undefined) {
    return true;
  }
  const left = directoryName.toLowerCase();
  const right = projectSlug(cwd).toLowerCase();
  return left === right || left.startsWith(`${right}-`) || right.startsWith(`${left}-`);
}

async function listProjectDirectories(
  root: string,
  cwd: string | undefined,
): Promise<readonly string[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const narrowed = entries.filter((entry) => slugCouldHoldCwd(entry, cwd));
  return (narrowed.length === 0 ? entries : narrowed).map((entry) => join(root, entry));
}

async function listJsonlFiles(
  root: string,
  cwd: string | undefined = undefined,
): Promise<readonly string[]> {
  const found: string[] = [];
  for (const directory of await listProjectDirectories(root, cwd)) {
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

async function summariseTranscript(
  file: string,
  source: TrajectorySource,
  request: ListTrajectoriesRequest,
  unplaced: string[],
): Promise<TrajectorySummary | null> {
  const sessionRef = basename(file, '.jsonl');

  let windows: Awaited<ReturnType<typeof readTranscriptWindows>>;
  try {
    windows = await readTranscriptWindows(file);
  } catch (cause) {
    request.onUnavailable?.(
      unavailableFrom(
        source,
        sessionRef,
        'unreadable',
        new TrajectoryError(
          'unreadable',
          source,
          `expected to read the ${source} transcript at ${file}; the read failed — check the file is not locked by another process`,
          { cause },
        ),
      ),
    );
    return null;
  }

  const opening = parseClaudeCodeJsonl(windows.head, sessionRef);
  const closing =
    windows.tail.length === 0 ? opening : parseClaudeCodeJsonl(windows.tail, sessionRef);
  const cwd = opening.cwd ?? closing.cwd;

  if (opening.turns.length === 0 && closing.turns.length === 0) {
    if (windows.bytes > 0) {
      request.onUnavailable?.({
        source,
        sessionRef,
        code: 'unrecognised_format',
        reason: `expected ${file} to hold ${source} transcript lines; ${windows.bytes} bytes produced no turns — report this with your client version so the reader can be updated`,
      });
    }
    return null;
  }

  if (cwd === null && request.cwd !== undefined) {
    unplaced.push(sessionRef);
    return null;
  }

  if (!matchesCwd(cwd, request.cwd)) {
    return null;
  }

  const lastTurn = closing.turns[closing.turns.length - 1] ?? null;
  return {
    source,
    sessionRef,
    cwd,
    startedAt: opening.turns[0]?.at ?? null,
    lastActivityAt: lastTurn?.at ?? windows.modified,
  };
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
      const files = await listJsonlFiles(root, request.cwd);
      const summaries: TrajectorySummary[] = [];
      const unplaced: string[] = [];

      for (const file of files) {
        const summary = await summariseTranscript(file, source, request, unplaced);
        if (summary !== null) {
          summaries.push(summary);
        }
      }

      reportUnplaced(
        request,
        source,
        unplaced,
        'open one with --from-file if it belongs to this repository',
      );

      summaries.sort(compareByRecency);
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
