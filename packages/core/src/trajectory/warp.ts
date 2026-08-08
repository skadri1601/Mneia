import { join } from 'node:path';
import { localAppDataDir, matchesCwd } from './paths.js';
import { createRefFactory } from './refs.js';
import { openReadOnly, type SqliteDatabase } from './sqlite.js';
import {
  type ListTrajectoriesRequest,
  type Trajectory,
  TrajectoryError,
  type TrajectoryReader,
  type TrajectorySummary,
  type TrajectoryTurn,
  type TurnRole,
} from './types.js';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const parseDate = (value: unknown): Date | null => {
  if (typeof value === 'number') {
    const fromEpoch = new Date(value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  const raw = asString(value);
  if (raw === null) {
    return null;
  }
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const textOf = (value: unknown): string => {
  const direct = asString(value);
  if (direct !== null) {
    return direct;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const block = asRecord(entry);
        return block === null ? (asString(entry) ?? '') : (asString(block.text) ?? '');
      })
      .filter((text) => text.length > 0)
      .join('\n');
  }
  const block = asRecord(value);
  return block === null ? '' : (asString(block.text) ?? '');
};

function findMessageArray(value: unknown, depth = 0): readonly unknown[] | null {
  if (depth > 4) {
    return null;
  }
  if (Array.isArray(value)) {
    const looksLikeMessages = value.some((entry) => {
      const block = asRecord(entry);
      return (
        block !== null &&
        (block.role !== undefined || block.author !== undefined || block.sender !== undefined)
      );
    });
    return looksLikeMessages ? value : null;
  }
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  for (const nested of Object.values(record)) {
    const found = findMessageArray(nested, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export function parseWarpConversation(
  conversationData: string,
  conversationId: string,
  cwd: string | null,
): Trajectory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(conversationData);
  } catch (cause) {
    throw new TrajectoryError(
      'unrecognised_format',
      'warp',
      `expected Warp conversation ${conversationId} to hold JSON in agent_conversations.conversation_data; it did not parse — report this with your Warp version so the reader can be updated`,
      { cause },
    );
  }

  const messages = findMessageArray(parsed);
  if (messages === null) {
    const keys = Object.keys(asRecord(parsed) ?? {})
      .slice(0, 12)
      .join(', ');
    throw new TrajectoryError(
      'unrecognised_format',
      'warp',
      `expected Warp conversation ${conversationId} to contain a list of messages carrying a role; found top-level keys [${keys}] and no such list — report this with your Warp version so the reader can be updated`,
    );
  }

  const ref = createRefFactory();
  const turns: TrajectoryTurn[] = [];

  messages.forEach((entry, index) => {
    const message = asRecord(entry);
    if (message === null) {
      return;
    }
    const rawRole = (
      asString(message.role) ??
      asString(message.author) ??
      asString(message.sender) ??
      ''
    ).toLowerCase();
    const role: TurnRole =
      rawRole.includes('user') || rawRole.includes('human') ? 'user' : 'assistant';
    const at = parseDate(message.timestamp ?? message.created_at ?? message.ts);
    const identity = asString(message.id) ?? `${index}`;

    const text = textOf(message.content ?? message.text ?? message.body);
    if (text.trim().length > 0) {
      turns.push({ ref: ref(identity), role, kind: 'text', text, toolName: null, at });
    }
  });

  return { source: 'warp', sessionRef: conversationId, cwd, turns };
}

export interface WarpReaderOptions {
  readonly databasePath?: string | undefined;
}

const defaultDatabasePath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(localAppDataDir(env), 'warp', 'Warp', 'data', 'warp.sqlite');

const workingDirectoryFor = (database: SqliteDatabase, conversationId: string): string | null => {
  try {
    const row = database
      .prepare(
        'SELECT working_directory FROM ai_queries WHERE conversation_id = ? AND working_directory IS NOT NULL ORDER BY start_ts DESC LIMIT 1',
      )
      .get(conversationId);
    return row === undefined ? null : asString(row.working_directory);
  } catch {
    return null;
  }
};

export function createWarpReader(options: WarpReaderOptions = {}): TrajectoryReader {
  const path = options.databasePath ?? defaultDatabasePath();

  return {
    source: 'warp',

    async list(request: ListTrajectoriesRequest = {}): Promise<readonly TrajectorySummary[]> {
      const database = await openReadOnly(path, 'warp');
      const summaries: TrajectorySummary[] = [];

      try {
        const rows = database
          .prepare(
            'SELECT conversation_id, last_modified_at FROM agent_conversations ORDER BY last_modified_at DESC',
          )
          .all();

        for (const row of rows) {
          const conversationId = asString(row.conversation_id);
          if (conversationId === null) {
            continue;
          }
          const cwd = workingDirectoryFor(database, conversationId);
          if (!matchesCwd(cwd, request.cwd)) {
            continue;
          }
          const lastActivityAt = parseDate(row.last_modified_at);
          summaries.push({
            source: 'warp',
            sessionRef: conversationId,
            cwd,
            startedAt: null,
            lastActivityAt,
          });
        }
      } finally {
        database.close();
      }

      return request.limit === undefined ? summaries : summaries.slice(0, request.limit);
    },

    async read(sessionRef: string): Promise<Trajectory> {
      const database = await openReadOnly(path, 'warp');

      try {
        const row = database
          .prepare(
            'SELECT conversation_data FROM agent_conversations WHERE conversation_id = ? ORDER BY last_modified_at DESC LIMIT 1',
          )
          .get(sessionRef);

        const data = row === undefined ? null : asString(row.conversation_data);
        if (data === null) {
          throw new TrajectoryError(
            'not_found',
            'warp',
            `expected a Warp conversation with id ${sessionRef} in ${path}; found none — check the id with mneia checkpoint --list`,
          );
        }

        return parseWarpConversation(data, sessionRef, workingDirectoryFor(database, sessionRef));
      } finally {
        database.close();
      }
    },
  };
}
