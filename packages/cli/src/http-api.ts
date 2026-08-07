import type {
  Actor,
  HostedIdentity,
  NewContextItem,
  RemoteStore,
  ScopedStore,
  Uuid,
} from '@mneia/core';
import { createHttpTransport, createRemoteStore, fetchIdentity, resolveProject } from '@mneia/core';
import { CliError } from './command.js';
import { resolveToken } from './config.js';
import type { BriefApi, BriefRequest, ProjectConfig } from './commands/brief.js';
import type {
  CheckpointApi,
  CheckpointCandidate,
  CheckpointProposal,
  CheckpointReceipt,
  CommitRequest,
  ProposeRequest,
  ReviewedCandidate,
} from './commands/checkpoint.js';
import type { LogApi, LogPage, LogRequest } from './commands/log.js';
import type { StatusApi, StatusReport, StatusRequest } from './commands/status.js';

const STATUS_ITEM_LIMIT = 500;

interface Connection {
  readonly store: RemoteStore;
  readonly identity: HostedIdentity;
}

async function connect(config: ProjectConfig): Promise<Connection> {
  const token = await resolveToken(process.env);
  const transport = createHttpTransport({ endpoint: config.endpoint, token });
  const identity = await fetchIdentity(transport);
  const store = createRemoteStore({
    transport,
    scope: { workspaceId: identity.workspaceId, actorId: identity.actorId },
  });
  return { store, identity };
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

export const httpLogApi: LogApi = {
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

export const httpCheckpointApi: CheckpointApi = {
  async propose(request: ProposeRequest): Promise<CheckpointProposal> {
    const { store, identity } = await connect(request.config);
    const project = await requireProject(store, request.config, 'checkpoint');

    return {
      workspaceId: identity.workspaceId,
      projectId: project.id,
      actorId: identity.actorId,
      sessionId: null,
      candidates: [],
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

    if (entries.length === 0) {
      throw new CliError(
        'failed',
        'every candidate was rejected, so there is nothing to write',
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
      },
      items: entries.map((entry) => ({
        action: actionFor(entry),
        item: newItemFrom(entry, request.projectId),
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
