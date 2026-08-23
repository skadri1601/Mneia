import 'server-only';

import type { ScopedStore, Uuid } from '@mneia/core';
import type {
  McpClientInfo,
  MneiaServer,
  ReviewQueue,
  SliceLog,
  SourceSession,
  ToolContext,
  ToolContextScope,
} from '@mneia/mcp-server';
import {
  createMneiaServer,
  createNoopReviewQueue,
  createSliceLog,
  createWriteSessionResolver,
  LINKED_TOOLS,
  ToolRegistry,
} from '@mneia/mcp-server';
import type { BearerIdentity } from '../store/device-store.js';
import { withWorkspaceScope } from '../store-runtime.js';
import { telemetry } from '../telemetry-runtime.js';

// One registry for the process. Construction is pure — it validates the tool list against
// SHIPPED_TOOL_NAMES and throws when they disagree — so rebuilding it per request would repeat
// the same work on every call. The throw is deliberate upstream behaviour: a tool registered but
// not shipped refuses the whole server rather than quietly serving a surface we never declared.
const registry = new ToolRegistry(LINKED_TOOLS);

// Rehydrate records the slice it returned so a later checkpoint can cite it, which is the only
// signal of whether a slice was worth loading and cannot be recovered afterwards. The log is
// bounded and in-memory, so it survives across requests on this container but not across a deploy
// or a second replica. We run a single container today (deploy/docker-compose.yml). Scaling out
// means moving this to Postgres, not running a second copy of it.
const slices: SliceLog = createSliceLog();

// The JSONL queue is an operator convenience for `mneia review --drain` on a developer's own
// machine, not the record of truth. Items awaiting human confirmation are rows the store already
// holds, which is what mneia_review_queue reads back through listPendingReviewItems. Writing a
// file inside a container nobody will ever read would be worse than writing none.
const reviewQueue: ReviewQueue = createNoopReviewQueue();

export interface RemoteMcpSession {
  readonly server: MneiaServer;
  readonly shutdown: () => Promise<void>;
}

/**
 * Reads a client identity out of an HTTP User-Agent.
 *
 * Stateless Streamable HTTP answers each request with a fresh server, so the clientInfo a client
 * sends on `initialize` belongs to a different request than the `tools/call` that follows it and
 * never reaches the write. Without a fallback every remote session records an empty client_name,
 * which is precisely the attribution docs/CLIENTS.md relies on as evidence.
 *
 * The User-Agent is the one identity that does travel on every request. Convention is
 * `name/version`, which most MCP clients follow; anything else is kept whole as the name rather
 * than being parsed into something wrong.
 */
export function clientFromUserAgent(userAgent: string | null): McpClientInfo | undefined {
  if (userAgent === null) {
    return undefined;
  }
  const trimmed = userAgent.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  const separator = first.lastIndexOf('/');
  if (separator <= 0 || separator === first.length - 1) {
    return { name: trimmed.slice(0, 120), version: 'unknown' };
  }
  return {
    name: first.slice(0, separator),
    version: first.slice(separator + 1),
  };
}

/**
 * Builds an MCP server bound to one caller's workspace.
 *
 * The identity is the one resolved from the verified bearer token, never anything the client put
 * in the MCP payload. That is the same rule the REST surface follows and the reason a tool cannot
 * reach another tenant's rows: withWorkspaceScope sets the Postgres RLS GUCs for the transaction,
 * and the store refuses a connection holding BYPASSRLS.
 */
export function createRemoteMcpSession(
  identity: BearerIdentity,
  transportClient?: McpClientInfo | undefined,
): RemoteMcpSession {
  // Seeded from the HTTP User-Agent so a write is attributed even though this request carries no
  // initialize. When a client does initialize and call within one request, onClientInfo overwrites
  // this with what MCP reported, which is the better of the two identities.
  let clientInfo: McpClientInfo | undefined = transportClient;

  // Attributes writes to the client that made them, so a session row records `cursor` or
  // `codex-mcp-client` rather than a bare id. The name arrives on the MCP initialize handshake,
  // which is why this is read lazily rather than captured up front.
  const sessions = createWriteSessionResolver({
    client: () => clientInfo,
    warn: () => {},
  });

  const buildContext = (store: ScopedStore): ToolContext => ({
    store,
    telemetry: telemetry(),
    now: () => new Date(),
    slices,
    reviewQueue,
    sessionIdFor: sessions.sessionIdFor,
    resolveWriteSession: (
      projectId: Uuid,
      sourceSession: SourceSession | undefined,
      legacySessionId: Uuid | null,
    ) => sessions.resolve(store, projectId, sourceSession, legacySessionId),
  });

  // Each tool call opens its own scoped transaction rather than holding one for the life of the
  // connection. A remote client can idle for minutes between calls, and pinning a Postgres
  // connection per idle client is how a pool gets exhausted by clients doing nothing.
  const context: ToolContextScope = <T>(
    run: (toolContext: ToolContext) => Promise<T>,
  ): Promise<T> =>
    withWorkspaceScope({ workspaceId: identity.workspaceId, actorId: identity.actorId }, (store) =>
      run(buildContext(store)),
    );

  // Deliberately NOT passing `telemetry` here. createMneiaServer takes ownership of an emitter it
  // is given and closes it on shutdown, which is right for the stdio binary that owns the process
  // and fatal here: the emitter is a process-wide singleton shared with every REST route, so the
  // first MCP request would close the Postgres sink and every §17 event after it — MCP and REST
  // alike — would be dropped for the life of the container. The tools emit through ToolContext,
  // which carries the same emitter without handing over its lifecycle.
  const server = createMneiaServer({
    registry,
    context,
    onClientInfo: (client) => {
      clientInfo = client;
    },
  });

  return {
    server,
    shutdown: () => server.shutdown(),
  };
}
