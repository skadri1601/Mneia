import type { ScopedStore, SessionClientProvenance, TrajectorySource, Uuid } from '@mneia/core';
import { TRAJECTORY_SOURCES } from '@mneia/core';
import type { SourceSession } from './source-session.js';

export interface McpClientInfo {
  readonly name: string;
  readonly version: string;
}

export interface ResolvedWriteSession {
  readonly sessionId: Uuid | null;
  readonly checkpointSource: string | null;
  readonly sourceSessionRef: string | null;
}

export interface WriteSessionResolver {
  sessionIdFor(projectId: Uuid): Uuid | null;
  resolve(
    store: ScopedStore,
    projectId: Uuid,
    sourceSession: SourceSession | undefined,
    legacySessionId: Uuid | null,
  ): Promise<ResolvedWriteSession>;
  close(store: ScopedStore): Promise<void>;
}

export interface WriteSessionResolverOptions {
  readonly client: () => McpClientInfo | undefined;
  readonly warn: (message: string) => void;
}

const SESSION_TOOL = 'mcp';

/**
 * Maps the client identity from the MCP initialize handshake onto a TrajectorySource.
 *
 * The hosted API validates checkpoint.source against TRAJECTORY_SOURCES, and the names clients
 * actually send do not match it. Only Claude Code did, by coincidence — it calls itself
 * `claude-code`, which is already a source. Cursor sends `Cursor` and Codex sends
 * `codex-mcp-client`, so **every write from either was rejected outright** with
 * `checkpoint.source: Invalid input`. That is why production had only ever seen claude-code write:
 * not because nobody tried, but because nobody else could.
 *
 * Found on 2026-08-23 by driving mneia_assert from Cursor (MNE-79).
 *
 * Lower-casing alone is not enough — it fixes Cursor and leaves Codex broken — so the aliases are
 * explicit. An unrecognised client yields null rather than a guess: losing attribution is a smaller
 * harm than recording a source that is wrong, and null is what the column already allows.
 */
const CLIENT_SOURCE_ALIASES: ReadonlyMap<string, TrajectorySource> = new Map([
  ['claude-code', 'claude-code'],
  ['claude-desktop', 'claude-desktop'],
  ['claude', 'claude-desktop'],
  ['codex', 'codex'],
  ['codex-mcp-client', 'codex'],
  ['codex-cli', 'codex'],
  ['cursor', 'cursor'],
  ['cursor-agent', 'cursor'],
  ['cursor-vscode', 'cursor'],
  ['gemini', 'gemini'],
  ['gemini-cli', 'gemini'],
  ['warp', 'warp'],
]);

export function checkpointSourceFor(client: McpClientInfo | undefined): TrajectorySource | null {
  if (client === undefined) {
    return null;
  }
  const normalized = client.name.trim().toLowerCase().replace(/\s+/g, '-');
  const aliased = CLIENT_SOURCE_ALIASES.get(normalized);
  if (aliased !== undefined) {
    return aliased;
  }
  // A client whose name is already a source needs no alias, and this keeps the map from having to
  // list every value of TRAJECTORY_SOURCES twice.
  return TRAJECTORY_SOURCES.includes(normalized as TrajectorySource)
    ? (normalized as TrajectorySource)
    : null;
}

function keyFor(
  projectId: Uuid,
  client: McpClientInfo | undefined,
  sourceSession: SourceSession | undefined,
): string {
  return JSON.stringify([
    projectId,
    client?.name ?? null,
    client?.version ?? null,
    sourceSession?.ref ?? null,
    // In the key because two sub-agents of different parents can share everything else and
    // must still get one session row each — otherwise the second one's writes are attributed
    // to the first one's parent.
    sourceSession?.parentRef ?? null,
  ]);
}

function provenanceFor(
  client: McpClientInfo | undefined,
  sourceSession: SourceSession | undefined,
): SessionClientProvenance {
  return {
    ...(client === undefined ? {} : { clientName: client.name, clientVersion: client.version }),
    ...(sourceSession?.ref === undefined ? {} : { clientSessionRef: sourceSession.ref }),
    ...(sourceSession?.name === undefined ? {} : { clientSessionName: sourceSession.name }),
    ...(sourceSession?.url === undefined ? {} : { clientSessionUrl: sourceSession.url }),
    ...(sourceSession?.parentRef === undefined
      ? {}
      : { parentClientSessionRef: sourceSession.parentRef }),
  };
}

export function createWriteSessionResolver(
  options: WriteSessionResolverOptions,
): WriteSessionResolver {
  const sessions = new Map<string, Promise<Uuid>>();
  const resolved = new Map<string, Uuid>();
  const opened = new Set<Uuid>();

  const resolve = async (
    store: ScopedStore,
    projectId: Uuid,
    sourceSession: SourceSession | undefined,
    legacySessionId: Uuid | null,
  ): Promise<ResolvedWriteSession> => {
    const client = options.client();
    const key = keyFor(projectId, client, sourceSession);
    let pending = sessions.get(key);
    if (pending === undefined) {
      pending = store
        .createSession(projectId, SESSION_TOOL, provenanceFor(client, sourceSession))
        .then((session) => {
          opened.add(session.id);
          resolved.set(key, session.id);
          return session.id;
        });
      sessions.set(key, pending);
    }

    try {
      return {
        sessionId: await pending,
        checkpointSource: checkpointSourceFor(client),
        sourceSessionRef: sourceSession?.ref ?? null,
      };
    } catch (cause) {
      sessions.delete(key);
      resolved.delete(key);
      const message = cause instanceof Error ? cause.message : String(cause);
      options.warn(
        `could not create a provenance session for project ${projectId}: ${message}. Mneia is continuing the write with ${legacySessionId === null ? 'null session provenance' : `legacy session ${legacySessionId}`}; retry on the next write.`,
      );
      return {
        sessionId: legacySessionId,
        checkpointSource: checkpointSourceFor(client),
        sourceSessionRef: sourceSession?.ref ?? null,
      };
    }
  };

  return {
    sessionIdFor(projectId) {
      return resolved.get(keyFor(projectId, options.client(), undefined)) ?? null;
    },
    resolve,
    async close(store) {
      for (const sessionId of opened) {
        try {
          await store.endSession(sessionId);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          options.warn(`session ${sessionId} was not closed cleanly: ${message}`);
        }
      }
      opened.clear();
      sessions.clear();
      resolved.clear();
    },
  };
}
