import type {
  Actor,
  ContextItem,
  DiscoveredTrajectory,
  Handoff,
  HostedIdentity,
  HttpTransport,
  NewContextItem,
  RemoteStore,
  ScopedStore,
  Trajectory,
  TrajectorySource,
  TrajectoryTurn,
  Uuid,
} from '@mneia/core';
import {
  ApiError,
  CheckpointProposalWireSchema,
  createHttpTransport,
  createReaders,
  createRemoteStore,
  decodePendingReviewItem,
  discoverTrajectories,
  fetchIdentity,
  MAX_TRAJECTORY_TURNS,
  MAX_TURN_TEXT_LENGTH,
  PendingReviewItemWireSchema,
  REVIEW_PATH,
  REVIEW_PENDING_PATH,
  ReviewPendingItemsResultWireSchema,
  readTrajectory,
  readTrajectoryFile,
  reduceTrajectory,
  resolveProject,
} from '@mneia/core';
import { z } from 'zod';
import { CliError } from './command.js';
import type { BriefApi, BriefRequest, ProjectConfig } from './commands/brief.js';
import type {
  CheckpointApi,
  CheckpointCandidate,
  CheckpointProposal,
  CheckpointReceipt,
  CommitRequest,
  DiscoverRequest,
  ProposeRequest,
  ReviewedCandidate,
  SessionDiscovery,
} from './commands/checkpoint.js';
import type {
  CreateHandoffRequest,
  HandoffApi,
  HandoffInbox,
  InboxRequest,
  PickupRequest,
} from './commands/handoff.js';
import type { AttachRequest, AttachResult, InitApi } from './commands/init.js';
import type { LogApi, LogChainPage, LogChainRequest, LogPage, LogRequest } from './commands/log.js';
import type {
  PendingQueue,
  PendingQueueRequest,
  ReviewApi,
  ReviewReceipt,
  SubmitReviewRequest,
} from './commands/review.js';
import type { SessionsApi, SessionsReport, SessionsRequest } from './commands/sessions.js';
import type { StatusApi, StatusReport, StatusRequest } from './commands/status.js';
import type { Roster, RosterRequest, TeamApi } from './commands/team.js';
import type {
  StaleList,
  StaleListRequest,
  VerifyApi,
  VerifyOutcome,
  VerifyRequest,
} from './commands/verify.js';
import { resolveToken } from './config.js';
import { MAX_CHAIN_REVISIONS, matchItemIds } from './item-ids.js';

const STATUS_ITEM_LIMIT = 500;

interface Connection {
  readonly store: RemoteStore;
  readonly identity: HostedIdentity;
  readonly transport: HttpTransport;
}

async function connect(config: ProjectConfig): Promise<Connection> {
  const token = await resolveToken(process.env);
  const transport = createHttpTransport({ endpoint: config.endpoint, token });
  const identity = await fetchIdentity(transport);
  const store = createRemoteStore({
    transport,
    scope: { workspaceId: identity.workspaceId, actorId: identity.actorId },
  });
  return { store, identity, transport };
}

const ProposalEnvelope = z.object({ proposal: CheckpointProposalWireSchema });

export const SESSION_DISCOVERY_LIMIT = 50;

const blockedReasons = (discovered: readonly DiscoveredTrajectory[]): readonly string[] =>
  discovered
    .filter((entry) => entry.unavailable !== null)
    .map((entry) => `${entry.source}: ${entry.unavailable ?? 'unavailable'}`);

export async function selectTrajectory(
  cwd: string,
  sessionRef?: string,
  source?: TrajectorySource,
): Promise<Trajectory> {
  if (source !== undefined && sessionRef !== undefined) {
    return readTrajectory(source, sessionRef, createReaders([source]), cwd);
  }

  const discovered = await discoverTrajectories(
    { cwd, limit: SESSION_DISCOVERY_LIMIT },
    createReaders(source === undefined ? undefined : [source]),
  );
  const usable = discovered.filter((entry) => entry.unavailable === null);
  const chosen =
    sessionRef === undefined ? usable[0] : usable.find((entry) => entry.sessionRef === sessionRef);

  if (chosen === undefined) {
    const blocked = blockedReasons(discovered);
    const suffix = blocked.length === 0 ? '' : ` (${blocked.join('; ')})`;

    if (sessionRef !== undefined) {
      throw new CliError(
        'not_configured',
        `mneia checkpoint expected an agent session with ref ${sessionRef} under ${cwd}, and found ${usable.length === 0 ? 'none at all' : `only ${usable.map((entry) => entry.sessionRef).join(', ')}`}${suffix}`,
        'run mneia checkpoint --all-sessions to see and cover every session discovered here',
      );
    }

    throw new CliError(
      'not_configured',
      `mneia checkpoint found no agent session for ${cwd}${suffix}`,
      'run this from the directory your agent session is working in, or pass a transcript with --from-file',
    );
  }

  return readTrajectory(chosen.source, chosen.sessionRef);
}

async function requireProject(store: ScopedStore, config: ProjectConfig, command: string) {
  if (config.project.length === 0) {
    throw new CliError(
      'not_configured',
      `mneia ${command} has no project to read: ${config.configPath} names none`,
      'add a project to .mneia/config.json, or run mneia init',
    );
  }
  const project = await resolveProject(store, config.project);
  if (project === null) {
    throw new CliError(
      'not_configured',
      `mneia ${command} found no project matching "${config.project}" in workspace ${config.workspace}`,
      'check the slug with mneia status, or create the project in the web app first',
    );
  }
  return project;
}

async function actorsFor(store: ScopedStore, ids: readonly Uuid[]): Promise<readonly Actor[]> {
  const unique = [...new Set(ids)];
  const resolved = await Promise.all(unique.map((id) => store.getActor(id)));
  return resolved.filter((actor): actor is Actor => actor !== null);
}

const displayNameFor = (slug: string): string =>
  slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');

export const httpInitApi: InitApi = {
  async attach(request: AttachRequest): Promise<AttachResult> {
    const transport = createHttpTransport({ endpoint: request.endpoint, token: request.token });
    const identity = await fetchIdentity(transport);

    if (request.workspace !== null && request.workspace !== identity.workspaceSlug) {
      throw new CliError(
        'failed',
        `this token belongs to workspace "${identity.workspaceSlug}", but the binding names "${request.workspace}"`,
        'run mneia init without --workspace to attach to the workspace your token belongs to',
      );
    }

    const store = createRemoteStore({
      transport,
      scope: { workspaceId: identity.workspaceId, actorId: identity.actorId },
    });

    const before = await store.getProjectBySlug(request.project);
    const project =
      before ??
      (await store.createProject({
        slug: request.project,
        displayName: displayNameFor(request.project),
        repoUrl: null,
      }));

    const constraintsImported =
      request.constraints.length === 0
        ? 0
        : (
            await store.writeCheckpoint({
              checkpoint: {
                projectId: project.id,
                sessionId: null,
                actorId: identity.actorId,
                trigger: 'manual',
                summary: `Imported ${request.constraints.length} constraints while attaching ${request.project}`,
                source: null,
                sourceSessionRef: null,
                sourceWatermark: null,
              },
              items: request.constraints.map((constraint) => ({
                action: 'created' as const,
                item: {
                  projectId: project.id,
                  kind: 'constraint' as const,
                  title: constraint.title,
                  body: constraint.body,
                  sourceRef: constraint.sourceRef,
                  loadBearing: false,
                },
              })),
            })
          ).written.length;

    return {
      workspace: identity.workspaceSlug,
      project: project.slug,
      created: before === null,
      constraintsImported,
    };
  },
};

export const httpBriefApi: BriefApi = {
  async rehydrate(request: BriefRequest) {
    const { store } = await connect(request.config);
    return store.rehydrate({
      project: request.config.project,
      task: request.task,
      tokenBudget: request.tokenBudget,
    });
  },
};

export const httpHandoffApi: HandoffApi = {
  async create(request: CreateHandoffRequest) {
    const { store } = await connect(request.config);
    await requireProject(store, request.config, 'handoff');
    return store.handoff({
      project: request.config.project,
      nextAction: request.nextAction,
      toActor: request.toActor,
      ...(request.supersededWindowDays === undefined
        ? {}
        : { supersededWindowDays: request.supersededWindowDays }),
    });
  },
  async receive(request: PickupRequest) {
    const { store } = await connect(request.config);
    return store.receiveHandoff(request.id, store.scope.actorId);
  },
  async inbox(request: InboxRequest): Promise<HandoffInbox> {
    const { store, identity } = await connect(request.config);
    const project = await requireProject(store, request.config, 'pickup');

    const waiting = await store.listInboxHandoffs({
      projectId: project.id,
      limit: request.limit,
    });

    const mine = (handoff: Handoff): boolean => handoff.toActor === identity.actorId;

    return {
      viewerId: identity.actorId,
      addressed: waiting.filter(mine),
      open: waiting.filter((handoff) => handoff.toActor === null),
      actors: await actorsFor(
        store,
        waiting.flatMap((handoff) =>
          handoff.toActor === null ? [handoff.fromActor] : [handoff.fromActor, handoff.toActor],
        ),
      ),
    };
  },
};

export const httpTeamApi: TeamApi = {
  async roster(request: RosterRequest): Promise<Roster> {
    const { store, identity } = await connect(request.config);
    const actors = await store.listWorkspaceActors({ limit: request.limit });
    return { viewerId: identity.actorId, actors };
  },
};

export const httpSessionsApi: SessionsApi = {
  async sessions(request: SessionsRequest): Promise<SessionsReport> {
    const { store, identity } = await connect(request.config);
    const project = await requireProject(store, request.config, 'sessions');

    return {
      projectId: project.id,
      viewerId: identity.actorId,
      sessions: await store.listProjectSessions({
        projectId: project.id,
        limit: request.limit,
      }),
    };
  },
};

const CHAIN_LOOKUP_LIMIT = 500;
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function chainReferenceUnknown(reference: string, where: string): CliError {
  return new CliError(
    'usage',
    `mneia log --chain found no item matching ${reference} ${where}`,
    'run mneia log to see the ids it prints in [brackets], then pass one of those',
  );
}

async function resolveChainSeed(
  store: ScopedStore,
  projectId: Uuid,
  reference: string,
): Promise<ContextItem> {
  if (FULL_UUID.test(reference)) {
    const item = await store.getContextItem(reference);
    if (item === null || item.projectId !== projectId) {
      throw chainReferenceUnknown(reference, 'in this project');
    }
    return item;
  }

  const items = await store.listContextItems({ projectId, limit: CHAIN_LOOKUP_LIMIT });
  const matches = matchItemIds(
    items.map((item) => item.id),
    reference,
  );

  if (matches.length === 0) {
    throw chainReferenceUnknown(
      reference,
      `in the newest ${CHAIN_LOOKUP_LIMIT} items of this project`,
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      'usage',
      `mneia log --chain matched ${matches.length} items for ${reference}: ${matches.join(', ')}`,
      'pass more characters of the id, or the full uuid',
    );
  }

  const seed = items.find((item) => item.id === matches[0]);
  if (seed === undefined) {
    throw chainReferenceUnknown(reference, 'in this project');
  }
  return seed;
}

async function walkChain(store: ScopedStore, seed: ContextItem): Promise<readonly ContextItem[]> {
  const revisions = new Map<Uuid, ContextItem>([[seed.id, seed]]);

  let backwards: ContextItem = seed;
  while (backwards.supersedesId !== null && revisions.size < MAX_CHAIN_REVISIONS) {
    const previous = await store.getContextItem(backwards.supersedesId);
    if (previous === null || revisions.has(previous.id)) {
      break;
    }
    revisions.set(previous.id, previous);
    backwards = previous;
  }

  let forwards: ContextItem = seed;
  while (forwards.supersededById !== null && revisions.size < MAX_CHAIN_REVISIONS) {
    const next = await store.getContextItem(forwards.supersededById);
    if (next === null || revisions.has(next.id)) {
      break;
    }
    revisions.set(next.id, next);
    forwards = next;
  }

  return [...revisions.values()];
}

export const httpLogApi: LogApi = {
  async chain(request: LogChainRequest): Promise<LogChainPage> {
    const { store } = await connect(request.config);
    const project = await requireProject(store, request.config, 'log');
    const seed = await resolveChainSeed(store, project.id, request.reference);
    const revisions = await walkChain(store, seed);

    return {
      projectId: project.id,
      itemId: seed.id,
      revisions,
      actors: await actorsFor(
        store,
        revisions.map((item) => item.assertedBy),
      ),
      truncated: revisions.length >= MAX_CHAIN_REVISIONS,
    };
  },

  async log(request: LogRequest): Promise<LogPage> {
    const { store } = await connect(request.config);
    const project = await requireProject(store, request.config, 'log');

    const all = await store.listContextItems({
      projectId: project.id,
      kinds: ['decision'],
      limit: request.limit,
    });
    const since = request.since;
    const items =
      since === null ? all : all.filter((item) => item.assertedAt.getTime() >= since.getTime());

    return {
      projectId: project.id,
      items,
      actors: await actorsFor(
        store,
        items.map((item) => item.assertedBy),
      ),
    };
  },
};

export const httpStatusApi: StatusApi = {
  async status(request: StatusRequest): Promise<StatusReport> {
    const { store } = await connect(request.config);
    const project = await requireProject(store, request.config, 'status');

    return {
      projectId: project.id,
      items: await store.listContextItems({ projectId: project.id, limit: STATUS_ITEM_LIMIT }),
    };
  },
};

export const httpVerifyApi: VerifyApi = {
  async stale(request: StaleListRequest): Promise<StaleList> {
    const { store } = await connect(request.config);
    const project = await requireProject(store, request.config, 'verify');

    const due = await store.listStaleContextItems({
      projectId: project.id,
      asOf: request.asOf,
      limit: request.limit,
    });

    return {
      projectId: project.id,
      entries: due.map((entry) => ({
        item: entry.item,
        staleSince: entry.staleSince,
        staleForMs: entry.staleForMs,
      })),
    };
  },

  async verify(request: VerifyRequest): Promise<VerifyOutcome> {
    const { store } = await connect(request.config);
    const project = await requireProject(store, request.config, 'verify');

    const result = await store.verifyContextItem({
      projectId: project.id,
      itemId: request.itemId,
      verification: request.verification,
      reason: request.reason,
    });

    return {
      checkpointId: result.checkpoint.id,
      item: result.item,
      verification: result.verification,
      previousLastVerifiedAt: result.previousLastVerifiedAt,
    };
  },
};

export const REVIEW_PENDING_ROUTE = REVIEW_PENDING_PATH;
export const REVIEW_ROUTE = REVIEW_PATH;

const PendingReviewEnvelope = z.object({ items: z.array(PendingReviewItemWireSchema) });

const ReviewResultEnvelope = z.object({ result: ReviewPendingItemsResultWireSchema });

function reviewRouteMissing(endpoint: string, route: string): CliError {
  return new CliError(
    'failed',
    `the Mneia API at ${endpoint} serves no ${route}, so mneia review has nothing to call — the deployment is older than the release that added the review routes`,
    'upgrade the workspace to a build that serves the review routes, or drain the queue from the project review page in the web app',
  );
}

async function reviewRequest<T>(
  transport: HttpTransport,
  endpoint: string,
  route: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  try {
    return await transport.request(path, schema, body);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'unsupported')) {
      throw reviewRouteMissing(endpoint, route);
    }
    throw error;
  }
}

export const httpReviewApi: ReviewApi = {
  async pending(request: PendingQueueRequest): Promise<PendingQueue> {
    const { store, transport } = await connect(request.config);
    const project = await requireProject(store, request.config, 'review');

    const { items } = await reviewRequest(
      transport,
      request.config.endpoint,
      REVIEW_PENDING_ROUTE,
      `${REVIEW_PENDING_ROUTE}?projectId=${encodeURIComponent(project.id)}&limit=${request.limit}`,
      PendingReviewEnvelope,
    );

    return { projectId: project.id, items: items.map(decodePendingReviewItem) };
  },

  async submit(request: SubmitReviewRequest): Promise<ReviewReceipt> {
    const { transport } = await connect(request.config);

    const { result } = await reviewRequest(
      transport,
      request.config.endpoint,
      REVIEW_ROUTE,
      REVIEW_ROUTE,
      ReviewResultEnvelope,
      {
        projectId: request.projectId,
        reviews: request.reviews,
        summary: request.summary,
      },
    );

    return { checkpointId: result.checkpoint.id, outcomes: result.outcomes };
  },
};

interface CommitEntry {
  readonly candidate: CheckpointCandidate;
  readonly overrides: ReviewedCandidate | undefined;
}

const newItemFrom = (entry: CommitEntry, projectId: Uuid): NewContextItem => ({
  projectId,
  kind: entry.candidate.kind,
  title: entry.overrides?.title ?? entry.candidate.title,
  body: entry.overrides?.body ?? entry.candidate.body,
  confidence: entry.candidate.confidence,
  loadBearing: entry.overrides?.loadBearing ?? entry.candidate.loadBearing,
  accessScope: entry.candidate.accessScope,
  supersedesId: entry.candidate.supersedes?.id ?? null,
});

const actionFor = (entry: CommitEntry) =>
  entry.candidate.supersedes === null ? ('created' as const) : ('superseded' as const);

export const MAX_UPLOAD_BYTES = 900_000;

/**
 * A turn longer than MAX_TURN_TEXT_LENGTH fails schema validation for the whole request,
 * and because the offending turn is in every later upload of that session too, the failure
 * is permanent: the session can never be checkpointed again. Trimming the tail of one turn
 * loses less than refusing the session, and the note makes the loss visible in the prompt.
 */

const truncationNote = (dropped: number): string =>
  `\n… truncated by mneia, ${dropped} more characters`;

const wireText = (text: string): string => {
  if (text.length <= MAX_TURN_TEXT_LENGTH) {
    return text;
  }
  // truncationNote(text.length) is the widest the note can get, so budgeting for it keeps
  // the result at or under the cap however many digits the real count needs.
  const kept = MAX_TURN_TEXT_LENGTH - truncationNote(text.length).length;
  return `${text.slice(0, kept)}${truncationNote(text.length - kept)}`;
};

const wireTurn = (turn: TrajectoryTurn) => ({
  ref: turn.ref,
  role: turn.role,
  kind: turn.kind,
  text: wireText(turn.text),
  toolName: turn.toolName,
  at: turn.at === null ? null : turn.at.toISOString(),
});

export function uploadableFrom(
  turns: readonly TrajectoryTurn[],
  start: number,
  budgetBytes: number = MAX_UPLOAD_BYTES,
): readonly TrajectoryTurn[] {
  const taken: TrajectoryTurn[] = [];
  let used = 0;

  for (let index = start; index < turns.length; index += 1) {
    // The byte budget is ours; the turn count is the API's, and exceeding it fails the
    // whole request rather than trimming it. A session of many short turns stays well
    // inside MAX_UPLOAD_BYTES while going past MAX_TRAJECTORY_TURNS, so both bound this.
    if (taken.length >= MAX_TRAJECTORY_TURNS) {
      break;
    }
    const turn = turns[index];
    if (turn === undefined) {
      break;
    }
    const cost = Buffer.byteLength(JSON.stringify(wireTurn(turn)), 'utf8') + 1;
    if (taken.length > 0 && used + cost > budgetBytes) {
      break;
    }
    taken.push(turn);
    used += cost;
  }

  return taken;
}

export const httpCheckpointApi: CheckpointApi = {
  async discover(request: DiscoverRequest): Promise<SessionDiscovery> {
    const discovered = await discoverTrajectories(
      { cwd: request.cwd, limit: SESSION_DISCOVERY_LIMIT },
      createReaders(request.source === undefined ? undefined : [request.source]),
    );

    return {
      sessions: discovered
        .filter((entry) => entry.unavailable === null)
        .map((entry) => ({
          source: entry.source,
          sessionRef: entry.sessionRef,
          lastActivityAt: entry.lastActivityAt,
        })),
      blocked: blockedReasons(discovered),
    };
  },

  async propose(request: ProposeRequest): Promise<CheckpointProposal> {
    const { transport } = await connect(request.config);

    const trajectory =
      request.fromFile === undefined
        ? await selectTrajectory(request.cwd ?? process.cwd(), request.sessionRef, request.source)
        : await readTrajectoryFile(request.fromFile);

    const reduced = reduceTrajectory(trajectory, { maxChars: Number.MAX_SAFE_INTEGER });
    const all = reduced.trajectory.turns;

    const send = async (turns: readonly TrajectoryTurn[], fromStart = false) => {
      const { proposal } = await transport.request(
        '/api/v1/checkpoints/propose',
        ProposalEnvelope,
        {
          project: request.config.project,
          source: reduced.trajectory.source,
          sessionRef: reduced.trajectory.sessionRef,
          trigger: request.trigger,
          turns: turns.map(wireTurn),
          fromStart,
        },
      );
      return proposal;
    };

    // Upload nothing first, purely to learn the server's watermark. This costs no
    // extraction: the server returns early when there is nothing new past it.
    let proposal = await send([]);
    let heldBack = 0;

    const at = proposal.watermark;
    const marked = at === null ? -1 : all.findIndex((turn) => turn.ref === at);
    const done = all.length === 0 || marked === all.length - 1;

    if (!done) {
      // marked < 0 means we are sending from the very first turn we hold, either because
      // the server has no watermark yet or because this transcript has rotated past the
      // one it has. Tell the server, so it can distinguish that from an upload that has
      // simply lost the turns in between - which it must refuse rather than re-extract
      // and bill for twice.
      const fromStart = marked < 0;
      const start = fromStart ? 0 : marked;
      const uploaded = uploadableFrom(all, start);
      proposal = await send(uploaded, fromStart);
      heldBack = all.length - start - uploaded.length;
    }

    return {
      workspaceId: proposal.workspaceId,
      projectId: proposal.projectId,
      actorId: proposal.actorId,
      sessionId: null,
      source: reduced.trajectory.source,
      sourceSessionRef: reduced.trajectory.sessionRef,
      watermark: proposal.watermark,
      // Carried so the caller can tell "extraction ran and kept nothing" from "there was
      // nothing new to extract". Only the first has a watermark worth banking; committing
      // on the second would write a fresh empty checkpoint on every invocation.
      consumedTurns: proposal.consumedTurns,
      pendingTurns: proposal.pendingTurns + heldBack,
      incompleteReason: proposal.incompleteReason,
      droppedBeforeUpload: trajectory.turns.length - all.length,
      candidates: proposal.candidates.map((candidate) => ({
        index: candidate.index,
        kind: candidate.kind,
        title: candidate.title,
        body: candidate.body,
        confidence: candidate.confidence,
        loadBearing: candidate.loadBearing,
        accessScope: candidate.accessScope,
        supersedes:
          candidate.contradiction === null || candidate.contradiction === undefined
            ? null
            : {
                id: candidate.contradiction.matchedItemId,
                title: candidate.contradiction.matchedTitle,
                humanConfirmed: candidate.contradiction.matchedHumanConfirmed,
                loadBearing: candidate.contradiction.matchedLoadBearing,
              },
      })),
    };
  },

  async commit(request: CommitRequest): Promise<CheckpointReceipt> {
    const { store, identity } = await connect(request.config);

    const entries: readonly CommitEntry[] = [
      ...request.automatic.map((candidate) => ({ candidate, overrides: undefined })),
      ...request.reviewed
        .filter((reviewed) => reviewed.decision !== 'rejected')
        .map((reviewed) => ({ candidate: reviewed.candidate, overrides: reviewed })),
    ];

    // An empty commit is legitimate only as a watermark: extraction ran, kept nothing, and
    // the one thing worth recording is how far it got. Without a watermark there is
    // genuinely nothing to write, and that stays an error.
    if (entries.length === 0 && (request.watermark ?? null) === null) {
      throw new CliError(
        'failed',
        'every candidate was rejected and no watermark was reached, so there is nothing to write',
        'nothing was recorded; run mneia checkpoint again when there is something to keep',
      );
    }

    const result = await store.writeCheckpoint({
      checkpoint: {
        projectId: request.projectId,
        sessionId: request.sessionId,
        actorId: identity.actorId,
        trigger: request.trigger,
        summary: request.summary,
        source: request.source ?? null,
        sourceSessionRef: request.sourceSessionRef ?? null,
        sourceWatermark: request.watermark ?? null,
      },
      items: entries.map((entry) => ({
        action: actionFor(entry),
        item: newItemFrom(entry, request.projectId),
        conflictsWith: entry.candidate.supersedes?.id ?? null,
      })),
    });

    if (result.written.length !== entries.length) {
      throw new CliError(
        'failed',
        `the checkpoint recorded ${result.written.length} items for ${entries.length} candidates, so the receipt cannot be trusted`,
        'check mneia log to see what was written before checkpointing again',
      );
    }

    return {
      checkpointId: result.checkpoint.id,
      items: result.written.map((written, position) => {
        const entry = entries[position];
        return {
          index: entry === undefined ? position : entry.candidate.index,
          itemId: written.id,
          action: entry === undefined ? ('created' as const) : actionFor(entry),
        };
      }),
    };
  },
};
