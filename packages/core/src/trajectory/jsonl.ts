import { readFile } from 'node:fs/promises';
import { parseClaudeCodeJsonl } from './claude-code.js';
import { parseCodexRollout } from './codex.js';
import { createRefFactory } from './refs.js';
import {
  type Trajectory,
  TrajectoryError,
  type TrajectoryTurn,
  type TurnKind,
  type TurnRole,
} from './types.js';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const KINDS = new Set<string>(['text', 'thinking', 'tool_call', 'tool_result']);

function parsePlainJsonl(text: string, sessionRef: string): Trajectory {
  const ref = createRefFactory();
  const turns: TrajectoryTurn[] = [];

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

    const value = asString(record.text);
    if (value === null || value.trim().length === 0) {
      continue;
    }

    const rawRole = asString(record.role);
    const role: TurnRole = rawRole === 'assistant' ? 'assistant' : 'user';
    const rawKind = asString(record.kind);
    const kind: TurnKind = rawKind !== null && KINDS.has(rawKind) ? (rawKind as TurnKind) : 'text';
    const rawAt = asString(record.at);
    const at = rawAt === null ? null : new Date(rawAt);

    turns.push({
      ref: ref(asString(record.ref) ?? `${turns.length}`),
      role,
      kind,
      text: value,
      toolName: asString(record.toolName),
      at: at === null || Number.isNaN(at.getTime()) ? null : at,
    });
  }

  return { source: 'file', sessionRef, cwd: null, turns };
}

export async function readTrajectoryFile(path: string): Promise<Trajectory> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    throw new TrajectoryError(
      'unreadable',
      'file',
      `expected to read a trajectory from ${path}; the read failed — check the path exists and is readable`,
      { cause },
    );
  }

  for (const parse of [parseClaudeCodeJsonl, parseCodexRollout, parsePlainJsonl]) {
    const parsed = parse(raw, path);
    if (parsed.turns.length > 0) {
      return { ...parsed, source: 'file' };
    }
  }

  throw new TrajectoryError(
    'unrecognised_format',
    'file',
    `expected ${path} to be a Claude Code transcript, a Codex rollout, or JSON Lines of {role, kind, text, at}; none of those produced any turns — check the file is a session transcript rather than a log`,
  );
}
