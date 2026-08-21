import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { matchesCwd } from './paths.js';
import { createRefFactory } from './refs.js';
import {
  compareByRecency,
  type ListTrajectoriesRequest,
  reportUnplaced,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySummary,
  type TrajectoryTurn,
  unavailableFrom,
} from './types.js';

const LEGACY_PROJECT = /^[0-9a-f]{64}$/;

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

const messageText = (value: unknown): string => {
  const direct = asString(value);
  if (direct !== null) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return '';
  }
  const parts: string[] = [];
  for (const entry of value) {
    const part = asRecord(entry);
    const text = part === null ? asString(entry) : asString(part.text);
    if (text !== null && text.trim().length > 0) {
      parts.push(text);
    }
  }
  return parts.join('\n');
};

const roleOf = (type: string | null): 'user' | 'assistant' | null => {
  if (type === 'user') {
    return 'user';
  }
  return type === 'gemini' || type === 'model' || type === 'assistant' ? 'assistant' : null;
};

interface GeminiSessionFile {
  readonly sessionId: string | null;
  readonly startedAt: Date | null;
  readonly lastActivityAt: Date | null;
  readonly messages: readonly Record<string, unknown>[];
}

const mergeMessages = (
  into: Map<string, Record<string, unknown>>,
  order: string[],
  messages: unknown,
): void => {
  if (!Array.isArray(messages)) {
    return;
  }
  for (const entry of messages) {
    const message = asRecord(entry);
    if (message === null) {
      continue;
    }
    const id = asString(message.id) ?? `${order.length}`;
    if (!into.has(id)) {
      order.push(id);
    }
    into.set(id, message);
  }
};

export function parseGeminiSession(text: string, sessionRef: string): GeminiSessionFile {
  const messages = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  let sessionId: string | null = null;
  let startedAt: Date | null = null;
  let lastActivityAt: Date | null = null;

  const absorb = (value: unknown): void => {
    const record = asRecord(value);
    if (record === null) {
      return;
    }
    sessionId ??= asString(record.sessionId);
    startedAt ??= parseDate(record.startTime);
    const updated = parseDate(record.lastUpdated);
    if (updated !== null && (lastActivityAt === null || updated > lastActivityAt)) {
      lastActivityAt = updated;
    }
    mergeMessages(messages, order, record.messages);

    const patch = asRecord(record.$set);
    if (patch !== null) {
      const patched = parseDate(patch.lastUpdated);
      if (patched !== null && (lastActivityAt === null || patched > lastActivityAt)) {
        lastActivityAt = patched;
      }
      mergeMessages(messages, order, patch.messages);
    }
  };

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new TrajectoryError(
      'unrecognised_format',
      'gemini',
      `expected ${sessionRef} to hold a Gemini CLI session; the file is empty`,
    );
  }

  let recognised = false;
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      absorb(JSON.parse(line));
      recognised = true;
    } catch {
      recognised = false;
      break;
    }
  }

  if (!recognised) {
    try {
      absorb(JSON.parse(trimmed));
    } catch (cause) {
      throw new TrajectoryError(
        'unrecognised_format',
        'gemini',
        `expected ${sessionRef} to hold a Gemini CLI session as JSON or as one JSON object per line; neither parsed`,
        { cause },
      );
    }
  }

  return {
    sessionId,
    startedAt,
    lastActivityAt,
    messages: order.flatMap((id) => {
      const message = messages.get(id);
      return message === undefined ? [] : [message];
    }),
  };
}

export function geminiTurns(session: GeminiSessionFile): readonly TrajectoryTurn[] {
  const ref = createRefFactory();
  const turns: TrajectoryTurn[] = [];

  session.messages.forEach((message, index) => {
    const role = roleOf(asString(message.type));
    if (role === null) {
      return;
    }
    const text = messageText(message.content ?? message.message);
    if (text.trim().length === 0) {
      return;
    }
    turns.push({
      ref: ref(asString(message.id) ?? `turn-${index}`),
      role,
      kind: 'text',
      text,
      toolName: null,
      at: parseDate(message.timestamp),
    });
  });

  return turns;
}

const WORKSPACE_DIRECTORIES = /Workspace Directories:\*\*\s*(?:\r?\n\s*[-*]\s*(.+))/;

export function cwdFromTranscript(turns: readonly TrajectoryTurn[]): string | null {
  for (const turn of turns.slice(0, 3)) {
    const matched = WORKSPACE_DIRECTORIES.exec(turn.text);
    const directory = matched?.[1]?.trim();
    if (directory !== undefined && directory.length > 0) {
      return directory;
    }
  }
  return null;
}

export function geminiHome(home: string = homedir()): string {
  return join(home, '.gemini');
}

export async function readProjectDirectories(
  home: string,
): Promise<ReadonlyMap<string, string | null>> {
  const roots = new Map<string, string | null>();

  let listed: string[];
  try {
    listed = await readdir(join(home, 'tmp'));
  } catch (cause) {
    throw new TrajectoryError(
      'not_found',
      'gemini',
      `expected Gemini CLI sessions under ${join(home, 'tmp')}; that directory could not be read — run Gemini CLI at least once, or this machine has none`,
      { cause },
    );
  }

  for (const entry of listed) {
    roots.set(entry, null);
  }

  let mapping: Record<string, unknown> = {};
  try {
    const raw = await readFile(join(home, 'projects.json'), 'utf8');
    const parsed = asRecord(JSON.parse(raw));
    mapping = asRecord(parsed?.projects) ?? {};
  } catch {
    mapping = {};
  }

  for (const [directory, slug] of Object.entries(mapping)) {
    const name = asString(slug);
    if (name !== null && roots.has(name)) {
      roots.set(name, directory);
    }
  }

  return roots;
}

interface Located {
  readonly sessionRef: string;
  readonly path: string;
  readonly cwd: string | null;
  readonly legacy: boolean;
}

async function locateSessions(home: string): Promise<readonly Located[]> {
  const roots = await readProjectDirectories(home);
  const located: Located[] = [];

  for (const [project, directory] of roots) {
    const chats = join(home, 'tmp', project, 'chats');
    let files: string[];
    try {
      files = await readdir(chats);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.json') && !file.endsWith('.jsonl')) {
        continue;
      }
      located.push({
        sessionRef: `${project}/${file}`,
        path: join(chats, file),
        cwd: directory,
        legacy: LEGACY_PROJECT.test(project),
      });
    }
  }

  return located;
}

async function readLocated(entry: Located): Promise<Trajectory> {
  let text: string;
  try {
    text = await readFile(entry.path, 'utf8');
  } catch (cause) {
    throw new TrajectoryError(
      'unreadable',
      'gemini',
      `expected to read the Gemini CLI session at ${entry.path}; it could not be opened`,
      { cause },
    );
  }

  const session = parseGeminiSession(text, entry.sessionRef);
  const turns = geminiTurns(session);

  return {
    source: 'gemini',
    sessionRef: entry.sessionRef,
    cwd: entry.cwd ?? cwdFromTranscript(turns),
    turns,
  };
}

export function createGeminiReader(home: string = geminiHome()): TrajectoryReader {
  return {
    source: 'gemini',

    async list(request: ListTrajectoriesRequest = {}): Promise<readonly TrajectorySummary[]> {
      const located = await locateSessions(home);
      const summaries: TrajectorySummary[] = [];
      const unplaced: string[] = [];

      for (const entry of located) {
        let session: GeminiSessionFile;
        let cwd = entry.cwd;
        try {
          const text = await readFile(entry.path, 'utf8');
          session = parseGeminiSession(text, entry.sessionRef);
          cwd ??= cwdFromTranscript(geminiTurns(session));
        } catch (cause) {
          request.onUnavailable?.(unavailableFrom('gemini', entry.sessionRef, 'unreadable', cause));
          continue;
        }

        if (cwd === null) {
          unplaced.push(entry.sessionRef);
          continue;
        }

        if (!matchesCwd(cwd, request.cwd)) {
          continue;
        }

        summaries.push({
          source: 'gemini',
          sessionRef: entry.sessionRef,
          cwd,
          startedAt: session.startedAt,
          lastActivityAt: session.lastActivityAt ?? session.startedAt,
        });
      }

      reportUnplaced(
        request,
        'gemini',
        unplaced,
        'these are sessions from an older Gemini CLI layout, which names its project directory by a hash rather than by the path — pass one with mneia checkpoint --session <ref> to read it anyway',
      );

      summaries.sort(compareByRecency);
      return request.limit === undefined ? summaries : summaries.slice(0, request.limit);
    },

    async read(sessionRef: string): Promise<Trajectory> {
      const located = await locateSessions(home);
      const entry = located.find((candidate) => candidate.sessionRef === sessionRef);

      if (entry === undefined) {
        throw new TrajectoryError(
          'not_found',
          'gemini',
          `expected a Gemini CLI session with ref ${sessionRef} under ${join(home, 'tmp')}; found none of the ${located.length} sessions there matching it`,
        );
      }

      return readLocated(entry);
    },
  };
}
