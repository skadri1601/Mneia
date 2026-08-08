import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { matchesCwd, roamingAppDataDir } from './paths.js';
import { createRefFactory } from './refs.js';
import { fileUriToPath, openReadOnly, type SqliteDatabase } from './sqlite.js';
import {
  type ListTrajectoriesRequest,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySummary,
  type TrajectoryTurn,
  type TurnRole,
} from './types.js';

const USER_BUBBLE = 1;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const parseJson = (value: unknown): Record<string, unknown> | null => {
  const raw = typeof value === 'string' ? value : null;
  if (raw === null) {
    return null;
  }
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
};

const parseDate = (value: unknown): Date | null => {
  if (typeof value === 'number') {
    const fromEpoch = new Date(value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  const raw = asString(value);
  if (raw === null) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const thinkingText = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => thinkingText(entry))
      .filter((text) => text.length > 0)
      .join('\n');
  }
  const block = asRecord(value);
  if (block === null) {
    return asString(value) ?? '';
  }
  return asString(block.text) ?? '';
};

interface ToolCallEntry {
  readonly name: string | null;
  readonly call: string;
  readonly result: string;
}

const toolCall = (value: unknown): ToolCallEntry | null => {
  const block = asRecord(value);
  if (block === null) {
    return null;
  }
  return {
    name: asString(block.name),
    call: asString(block.rawArgs) ?? asString(block.params) ?? '',
    result: asString(block.result) ?? asString(block.error) ?? '',
  };
};

export interface CursorReaderOptions {
  readonly globalStoragePath?: string | undefined;
  readonly workspaceStoragePath?: string | undefined;
}

const defaultGlobalStorage = (env: NodeJS.ProcessEnv = process.env): string =>
  join(roamingAppDataDir(env), 'Cursor', 'User', 'globalStorage', 'state.vscdb');

const defaultWorkspaceStorage = (env: NodeJS.ProcessEnv = process.env): string =>
  join(roamingAppDataDir(env), 'Cursor', 'User', 'workspaceStorage');

export async function composerFolders(
  workspaceStoragePath: string,
): Promise<ReadonlyMap<string, string>> {
  const mapping = new Map<string, string>();

  let directories: readonly string[];
  try {
    directories = await readdir(workspaceStoragePath);
  } catch {
    return mapping;
  }

  for (const directory of directories) {
    let folder: string | null = null;
    try {
      const meta = asRecord(
        JSON.parse(await readFile(join(workspaceStoragePath, directory, 'workspace.json'), 'utf8')),
      );
      folder = meta === null ? null : fileUriToPath(asString(meta.folder) ?? '');
    } catch {
      folder = null;
    }
    if (folder === null) {
      continue;
    }

    let database: SqliteDatabase;
    try {
      database = await openReadOnly(join(workspaceStoragePath, directory, 'state.vscdb'), 'cursor');
    } catch {
      continue;
    }

    try {
      const rows = database
        .prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%omposer%'")
        .all();
      for (const row of rows) {
        const parsed = parseJson(row.value);
        if (parsed === null) {
          continue;
        }
        const list = parsed.allComposers ?? parsed.composers;
        if (!Array.isArray(list)) {
          continue;
        }
        for (const entry of list) {
          const composer = asRecord(entry);
          const id = composer === null ? null : asString(composer.composerId);
          if (id !== null) {
            mapping.set(id, folder);
          }
        }
      }
    } catch {
    } finally {
      database.close();
    }
  }

  return mapping;
}

function bubbleTurns(
  database: SqliteDatabase,
  composerId: string,
  headers: readonly unknown[],
): readonly TrajectoryTurn[] {
  const turns: TrajectoryTurn[] = [];
  const ref = createRefFactory();
  const statement = database.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');

  for (const rawHeader of headers) {
    const header = asRecord(rawHeader);
    if (header === null) {
      continue;
    }
    const bubbleId = asString(header.bubbleId);
    if (bubbleId === null) {
      continue;
    }

    const row = statement.get(`bubbleId:${composerId}:${bubbleId}`);
    const bubble = row === undefined ? null : parseJson(row.value);
    if (bubble === null) {
      continue;
    }

    const role: TurnRole = bubble.type === USER_BUBBLE ? 'user' : 'assistant';
    const at = parseDate(bubble.createdAt);

    const thinking = thinkingText(bubble.thinking ?? bubble.allThinkingBlocks);
    if (thinking.trim().length > 0) {
      turns.push({
        ref: ref(`${bubbleId}#thinking`),
        role: 'assistant',
        kind: 'thinking',
        text: thinking,
        toolName: null,
        at,
      });
    }

    const text = asString(bubble.text) ?? '';
    if (text.trim().length > 0) {
      turns.push({ ref: ref(bubbleId), role, kind: 'text', text, toolName: null, at });
    }

    const entry = toolCall(bubble.toolFormerData);
    if (entry !== null) {
      if (entry.call.trim().length > 0) {
        turns.push({
          ref: ref(`${bubbleId}#call`),
          role: 'assistant',
          kind: 'tool_call',
          text: entry.call,
          toolName: entry.name,
          at,
        });
      }
      if (entry.result.trim().length > 0) {
        turns.push({
          ref: ref(`${bubbleId}#result`),
          role: 'user',
          kind: 'tool_result',
          text: entry.result,
          toolName: entry.name,
          at,
        });
      }
    }
  }

  return turns;
}

export function createCursorReader(options: CursorReaderOptions = {}): TrajectoryReader {
  const globalPath = options.globalStoragePath ?? defaultGlobalStorage();
  const workspacePath = options.workspaceStoragePath ?? defaultWorkspaceStorage();

  const readComposer = (
    database: SqliteDatabase,
    composerId: string,
  ): { readonly data: Record<string, unknown>; readonly headers: readonly unknown[] } | null => {
    const row = database
      .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
      .get(`composerData:${composerId}`);
    const data = row === undefined ? null : parseJson(row.value);
    if (data === null) {
      return null;
    }
    const headers = data.fullConversationHeadersOnly;
    return { data, headers: Array.isArray(headers) ? headers : [] };
  };

  return {
    source: 'cursor',

    async list(request: ListTrajectoriesRequest = {}): Promise<readonly TrajectorySummary[]> {
      const folders = await composerFolders(workspacePath);
      const database = await openReadOnly(globalPath, 'cursor');
      const summaries: TrajectorySummary[] = [];

      try {
        const rows = database
          .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
          .all();

        for (const row of rows) {
          const key = asString(row.key);
          const data = parseJson(row.value);
          if (key === null || data === null) {
            continue;
          }
          const composerId = asString(data.composerId) ?? key.slice('composerData:'.length);
          const headers = data.fullConversationHeadersOnly;
          if (!Array.isArray(headers) || headers.length === 0) {
            continue;
          }
          const cwd = folders.get(composerId) ?? null;
          if (!matchesCwd(cwd, request.cwd)) {
            continue;
          }
          const createdAt = parseDate(data.createdAt);
          summaries.push({
            source: 'cursor',
            sessionRef: composerId,
            cwd,
            startedAt: createdAt,
            lastActivityAt: parseDate(data.lastUpdatedAt) ?? createdAt,
          });
        }
      } finally {
        database.close();
      }

      summaries.sort(
        (left, right) =>
          (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0),
      );
      return request.limit === undefined ? summaries : summaries.slice(0, request.limit);
    },

    async read(sessionRef: string): Promise<Trajectory> {
      const folders = await composerFolders(workspacePath);
      const database = await openReadOnly(globalPath, 'cursor');

      try {
        const composer = readComposer(database, sessionRef);
        if (composer === null) {
          throw new TrajectoryError(
            'not_found',
            'cursor',
            `expected a Cursor conversation with composer id ${sessionRef} in ${globalPath}; found none — check the id with mneia checkpoint --list`,
          );
        }
        return {
          source: 'cursor',
          sessionRef,
          cwd: folders.get(sessionRef) ?? null,
          turns: bubbleTurns(database, sessionRef, composer.headers),
        };
      } finally {
        database.close();
      }
    },
  };
}
