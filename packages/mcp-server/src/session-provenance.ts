import type { ScopedStore, SessionClientProvenance, Uuid } from '@mneia/core';
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
        checkpointSource: client?.name ?? null,
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
        checkpointSource: client?.name ?? null,
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
