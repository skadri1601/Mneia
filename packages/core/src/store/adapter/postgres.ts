import type {
  Actor,
  Checkpoint,
  CheckpointItem,
  Conflict,
  ContextItem,
  Embedding,
  Handoff,
  IntervalMs,
  Project,
  Session,
  Uuid,
} from '../../domain/types.js';
import { assertSupersedeAllowed } from '../../policy/index.js';
import { DEFAULT_DECAY_AFTER_BY_KIND } from '../../rehydrate/score.js';
import type { SqlExecutor, SqlValue } from '../driver.js';
import { assertConnectionEnforcesRls } from '../rls-guard.js';
import {
  ACCESS_SCOPES,
  ACTOR_KINDS,
  EMBEDDING_DIMENSIONS,
  ITEM_KINDS,
  ITEM_STATUSES,
  WORKSPACE_SETTING,
} from '../schema.js';
import { visibilityPredicate } from '../scope.js';
import type { SqlRow } from './rows.js';
import {
  embeddingLiteral,
  isUuid,
  toActor,
  toBoolean,
  toCheckpoint,
  toCheckpointItem,
  toConflict,
  toContextItem,
  toDate,
  toEnum,
  toHandoff,
  toNullableDate,
  toNullableNumber,
  toNullableText,
  toNullableUuid,
  toNumber,
  toProject,
  toSession,
  toText,
  toUuid,
} from './rows.js';
import type {
  CheckpointWrite,
  CheckpointWriteResult,
  ConfirmContextItemInput,
  ConflictResolutionInput,
  ContextItemFilter,
  ContextItemReview,
  ContextItemReviewOutcome,
  ContextItemReviewOutcomeKind,
  ContextItemSearch,
  HandoffItem,
  InboxHandoffFilter,
  NewConflict,
  NewContextItem,
  NewHandoff,
  NewProject,
  PendingReviewFilter,
  PendingReviewItem,
  ProjectSessionFilter,
  ProjectSessionSummary,
  RehydrationCandidateGroups,
  RehydrationCandidateRequest,
  RetireContextItemInput,
  RetireContextItemResult,
  ReviewCapableStore,
  ReviewPendingItemsInput,
  ReviewPendingItemsResult,
  SessionClientProvenance,
  StaleContextItem,
  StaleContextItemFilter,
  StoreAdapter,
  VerifyContextItemInput,
  VerifyContextItemResult,
  WorkspaceActorFilter,
  WorkspaceScope,
} from './types.js';

export type StoreErrorCode =
  | 'store_detached'
  | 'invalid_argument'
  | 'not_found'
  | 'already_received'
  | 'already_resolved'
  | 'wrong_receiver'
  | 'no_row'
  | 'rollback_failed';

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreError';
    this.code = code;
  }
}

export interface PostgresSession extends SqlExecutor {
  release(): Promise<void>;
  discard(): Promise<void>;
}

export interface PostgresConnectionSource {
  acquire(): Promise<PostgresSession>;
  close(): Promise<void>;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;
const DEFAULT_CONFIDENCE = 0.5;
const DEFAULT_ACCESS_SCOPE = 'project';

const ACTOR_COLUMNS = 'id, workspace_id, kind, display_name, external_ref, created_at';
const PROJECT_COLUMNS = 'id, workspace_id, team_id, slug, repo_url, created_at';
const SESSION_COLUMNS =
  'id, workspace_id, project_id, actor_id, tool, client_name, client_version, client_session_ref, client_session_name, client_session_url, started_at, ended_at';
const CHECKPOINT_COLUMNS =
  'id, workspace_id, project_id, session_id, actor_id, "trigger", created_at, summary';
const CHECKPOINT_ITEM_COLUMNS = 'workspace_id, checkpoint_id, item_id, action';
const PROJECT_SESSION_COLUMNS = `session.id, session.workspace_id, session.project_id,
       session.actor_id, session.tool, session.client_name, session.client_version,
       session.client_session_ref, session.client_session_name, session.client_session_url,
       session.started_at, session.ended_at,
       session_actor.id AS session_actor_id,
       session_actor.workspace_id AS session_actor_workspace_id,
       session_actor.kind AS session_actor_kind,
       session_actor.display_name AS session_actor_display_name,
       session_actor.external_ref AS session_actor_external_ref,
       session_actor.created_at AS session_actor_created_at`;
const HANDOFF_COLUMNS =
  'id, workspace_id, project_id, from_actor, to_actor, created_at, received_at, next_action, rendered';
const CONFLICT_COLUMNS =
  'id, workspace_id, project_id, item_a, item_b, detected_at, resolved_at, resolved_by, resolution, rationale';
const CONTEXT_ITEM_COLUMNS = `context_item.id, context_item.workspace_id, context_item.project_id,
       context_item.kind, context_item.title, context_item.body, context_item.status,
       context_item.asserted_by, context_item.asserted_at, context_item.source_session_id,
       context_item.source_ref, context_item.confidence, context_item.human_confirmed,
       context_item.load_bearing, context_item.last_verified_at,
       (EXTRACT(EPOCH FROM context_item.decay_after) * 1000)::double precision AS decay_after,
       context_item.valid_from, context_item.valid_to, context_item.supersedes_id,
       context_item.superseded_by_id, context_item.supersede_reason, context_item.access_scope`;

const CONTEXT_ITEM_PROVENANCE_COLUMNS = `provenance_actor.id AS provenance_actor_id,
       provenance_actor.kind AS provenance_actor_kind,
       provenance_actor.display_name AS provenance_actor_display_name,
       provenance_session.id AS provenance_source_session_id,
       provenance_session.tool AS provenance_session_tool,
       provenance_session.client_name AS provenance_client_name,
       provenance_session.client_version AS provenance_client_version,
       provenance_session.client_session_ref AS provenance_client_session_ref,
       provenance_session.client_session_name AS provenance_client_session_name,
       provenance_session.client_session_url AS provenance_client_session_url`;

const CONTEXT_ITEM_PROVENANCE_JOINS = `JOIN actor AS provenance_actor
           ON provenance_actor.workspace_id = context_item.workspace_id
          AND provenance_actor.id = context_item.asserted_by
         LEFT JOIN session AS provenance_session
           ON provenance_session.workspace_id = context_item.workspace_id
          AND provenance_session.id = context_item.source_session_id
          AND provenance_session.project_id = context_item.project_id
          AND provenance_session.actor_id = context_item.asserted_by`;

const CONTEXT_ITEM_COLUMNS_WITH_EMBEDDING = `${CONTEXT_ITEM_COLUMNS},
       context_item_embedding.model AS embedding_model,
       context_item_embedding.embedding::text AS embedding`;

const EMBEDDING_JOIN = `LEFT JOIN LATERAL (
             SELECT model, embedding
               FROM context_item_embedding
              WHERE context_item_embedding.workspace_id = context_item.workspace_id
                AND context_item_embedding.item_id = context_item.id
              ORDER BY created_at DESC
              LIMIT 1
           ) AS context_item_embedding ON TRUE`;

const contextItemReadColumns = (withEmbedding: boolean | undefined): string =>
  `${withEmbedding === true ? CONTEXT_ITEM_COLUMNS_WITH_EMBEDDING : CONTEXT_ITEM_COLUMNS},
       ${CONTEXT_ITEM_PROVENANCE_COLUMNS}`;

const contextItemFrom = (withEmbedding: boolean | undefined): string =>
  withEmbedding === true
    ? `context_item\n         ${EMBEDDING_JOIN}\n         ${CONTEXT_ITEM_PROVENANCE_JOINS}`
    : `context_item\n         ${CONTEXT_ITEM_PROVENANCE_JOINS}`;

const PENDING_REVIEW_COLUMNS = `item.id, item.project_id, item.kind, item.title, item.body,
       item.confidence, item.load_bearing, item.access_scope,
       item.asserted_by, item.asserted_at, item.source_ref,
       asserter.kind AS asserted_by_kind,
       asserter.display_name AS asserted_by_name,
       origin.checkpoint_id AS origin_checkpoint_id`;
const REVIEWED_ITEM_COLUMNS =
  'id, title, body, load_bearing, access_scope, status, human_confirmed';

const REVIEW_TRIGGER = 'manual';

const VERIFICATION_ANCHOR = 'COALESCE(context_item.last_verified_at, context_item.asserted_at)';
const effectiveDecayAfter = (params: SqlParams): string => {
  const branches = ITEM_KINDS.flatMap((kind) => {
    const fallback = DEFAULT_DECAY_AFTER_BY_KIND[kind];
    if (fallback === null) {
      return [];
    }
    const name = params.add(kind);
    const seconds = params.add(Math.floor(fallback / 1000));
    return [`WHEN ${name} THEN make_interval(secs => ${seconds})`];
  }).join(' ');

  return `COALESCE(context_item.decay_after, CASE context_item.kind ${branches} ELSE NULL END)`;
};

const verificationDueAt = (decay: string): string => `(${VERIFICATION_ANCHOR} + ${decay})`;

const CONTEXT_ITEM_VERIFICATIONS = ['confirmed', 'denied'] as const;

const toPendingReviewItem = (row: SqlRow): PendingReviewItem => ({
  id: toUuid(row, 'id'),
  projectId: toUuid(row, 'project_id'),
  kind: toEnum(row, 'kind', ITEM_KINDS),
  title: toText(row, 'title'),
  body: toNullableText(row, 'body'),
  confidence: toNumber(row, 'confidence'),
  loadBearing: toBoolean(row, 'load_bearing'),
  accessScope: toEnum(row, 'access_scope', ACCESS_SCOPES),
  assertedBy: toUuid(row, 'asserted_by'),
  assertedByKind: toEnum(row, 'asserted_by_kind', ACTOR_KINDS),
  assertedByName: toText(row, 'asserted_by_name'),
  assertedAt: toDate(row, 'asserted_at'),
  sourceRef: toNullableText(row, 'source_ref'),
  originCheckpointId: toNullableUuid(row, 'origin_checkpoint_id'),
});

class SqlParams {
  private readonly values: SqlValue[] = [];

  add(value: SqlValue): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  addAll(values: readonly SqlValue[]): void {
    this.values.push(...values);
  }

  get length(): number {
    return this.values.length;
  }

  list(): readonly SqlValue[] {
    return this.values;
  }
}

const assertUuid = (value: Uuid, label: string): Uuid => {
  if (!isUuid(value)) {
    throw new StoreError(
      'invalid_argument',
      `expected ${label} to be a UUID; received ${JSON.stringify(value)}`,
    );
  }
  return value;
};

const assertOptionalUuid = (value: Uuid | null | undefined, label: string): Uuid | null => {
  if (value === null || value === undefined) return null;
  return assertUuid(value, label);
};

const assertOptionalIntervalMs = (
  value: IntervalMs | null | undefined,
  label: string,
): number | null => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new StoreError(
      'invalid_argument',
      `expected ${label} to be a non-negative number of milliseconds; received ${JSON.stringify(value)}`,
    );
  }
  return value;
};

const assertNonEmpty = (value: string, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StoreError(
      'invalid_argument',
      `expected ${label} to be a non-empty string; received ${JSON.stringify(value)}`,
    );
  }
  return value;
};

const assertEmbedding = (embedding: Embedding, label: string): Embedding => {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new StoreError(
      'invalid_argument',
      `expected ${label} to hold ${EMBEDDING_DIMENSIONS} components; received ${embedding.length}`,
    );
  }
  return embedding;
};

const assertEmbeddingProvenance = (
  embedding: Embedding | null,
  embeddingModel: string | null,
): string | null => {
  if (embedding !== null && embeddingModel === null) {
    throw new StoreError(
      'invalid_argument',
      'expected item.embeddingModel to name the model that produced item.embedding; received none — ' +
        'pass a provider-qualified identifier such as "openai:text-embedding-3-small", because a vector ' +
        'whose model is unknown cannot be compared against any other',
    );
  }
  if (embedding === null && embeddingModel !== null) {
    throw new StoreError(
      'invalid_argument',
      `expected item.embedding to hold a vector when item.embeddingModel is ${JSON.stringify(embeddingModel)}; received none — omit the model, or pass the vector it produced`,
    );
  }
  if (embeddingModel === null) return null;
  return assertNonEmpty(embeddingModel, 'item.embeddingModel');
};

const assertInstant = (value: Date | undefined, label: string): Date => {
  if (value === undefined) return new Date();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new StoreError(
      'invalid_argument',
      `expected ${label} to be a valid Date; received ${JSON.stringify(value)}`,
    );
  }
  return value;
};

const resolveLimit = (limit: number | undefined, label: string): number => {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new StoreError(
      'invalid_argument',
      `expected ${label} to be an integer between 1 and ${MAX_LIMIT}; received ${limit}`,
    );
  }
  return limit;
};

const escapeLike = (text: string): string =>
  text.replace(/[\\%_]/g, (character) => `\\${character}`);

const expectOne = (rows: readonly SqlRow[], what: string): SqlRow => {
  const row = rows[0];
  if (row === undefined) {
    throw new StoreError('no_row', `expected exactly one row from ${what}; received none`);
  }
  return row;
};

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

class PostgresScopedStore implements ReviewCapableStore {
  private attached = true;
  private savepoints = 0;
  private teamIds: Promise<readonly Uuid[]> | null = null;
  private scopedActor: Actor | null = null;

  constructor(
    private readonly session: PostgresSession,
    readonly scope: WorkspaceScope,
  ) {}

  detach(): void {
    this.attached = false;
  }

  private executor(): SqlExecutor {
    if (!this.attached) {
      throw new StoreError(
        'store_detached',
        `the scoped store for workspace ${this.scope.workspaceId} is usable only inside the withScope callback that created it; its transaction has already ended`,
      );
    }
    return this.session;
  }

  private async rows(sql: string, params: readonly SqlValue[] = []): Promise<readonly SqlRow[]> {
    const result = await this.executor().execute<SqlRow>(sql, params);
    return result.rows;
  }

  private async atomic<T>(what: string, run: () => Promise<T>): Promise<T> {
    this.savepoints += 1;
    const savepoint = `mneia_sp_${this.savepoints}`;
    await this.rows(`SAVEPOINT ${savepoint}`);

    try {
      const result = await run();
      await this.rows(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try {
        await this.rows(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await this.rows(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (rollbackError) {
        throw new StoreError(
          'rollback_failed',
          `${what} failed with "${describeCause(error)}" and rolling back to ${savepoint} failed too; the transaction cannot continue`,
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  private async readActorTeamIds(): Promise<readonly Uuid[]> {
    const rows = await this.rows(
      'SELECT team_id FROM team_member WHERE workspace_id = $1 AND actor_id = $2',
      [this.scope.workspaceId, this.scope.actorId],
    );
    return rows.map((row) => toUuid(row, 'team_id'));
  }

  private actorTeamIds(): Promise<readonly Uuid[]> {
    this.teamIds ??= this.readActorTeamIds();
    return this.teamIds;
  }

  private async assertingActor(): Promise<Actor> {
    if (this.scopedActor === null) {
      const rows = await this.rows(
        `SELECT ${ACTOR_COLUMNS} FROM actor WHERE workspace_id = $1 AND id = $2`,
        [this.scope.workspaceId, this.scope.actorId],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new StoreError(
          'not_found',
          `expected scope.actorId ${this.scope.actorId} to name an actor in workspace ${this.scope.workspaceId}, because the store reads actor.kind there to arbitrate a supersede; found no such actor — open the scope with an actor row that exists in this workspace`,
        );
      }
      this.scopedActor = toActor(row);
    }
    return this.scopedActor;
  }

  private async guardSupersede(previousId: Uuid): Promise<void> {
    const actor = await this.assertingActor();

    const rows = await this.rows(
      `SELECT ${CONTEXT_ITEM_COLUMNS}
         FROM context_item
        WHERE workspace_id = $1 AND id = $2
        FOR UPDATE`,
      [this.scope.workspaceId, previousId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new StoreError(
        'not_found',
        `expected context item ${previousId} in workspace ${this.scope.workspaceId} to supersede; found none — re-read the chain and name an item that exists in this workspace`,
      );
    }

    assertSupersedeAllowed({
      existing: toContextItem(row),
      assertingActorKind: actor.kind,
      assertingActorId: actor.id,
      humanConfirmedByAsserter: actor.kind === 'human',
    });
  }

  async getActor(id: Uuid): Promise<Actor | null> {
    assertUuid(id, 'id');
    const rows = await this.rows(
      `SELECT ${ACTOR_COLUMNS} FROM actor WHERE workspace_id = $1 AND id = $2`,
      [this.scope.workspaceId, id],
    );
    const row = rows[0];
    return row === undefined ? null : toActor(row);
  }

  async getProject(id: Uuid): Promise<Project | null> {
    assertUuid(id, 'id');
    const rows = await this.rows(
      `SELECT ${PROJECT_COLUMNS}
         FROM project
        WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL`,
      [this.scope.workspaceId, id],
    );
    const row = rows[0];
    return row === undefined ? null : toProject(row);
  }

  async createProject(input: NewProject): Promise<Project> {
    assertNonEmpty(input.slug, 'input.slug');
    assertNonEmpty(input.displayName, 'input.displayName');
    const id = assertOptionalUuid(input.id, 'input.id');
    const teamId = assertOptionalUuid(input.teamId, 'input.teamId');

    const params = new SqlParams();
    const values = [
      `COALESCE(${params.add(id)}::uuid, gen_random_uuid())`,
      params.add(this.scope.workspaceId),
      params.add(teamId),
      params.add(input.slug),
      params.add(input.displayName),
      params.add(input.repoUrl ?? null),
    ];

    const rows = await this.rows(
      `INSERT INTO project (id, workspace_id, team_id, slug, display_name, repo_url)
       VALUES (${values.join(', ')})
       RETURNING ${PROJECT_COLUMNS}`,
      params.list(),
    );

    return toProject(expectOne(rows, `creating project ${input.slug}`));
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    assertNonEmpty(slug, 'slug');
    const rows = await this.rows(
      `SELECT ${PROJECT_COLUMNS}
         FROM project
        WHERE workspace_id = $1 AND slug = $2 AND archived_at IS NULL`,
      [this.scope.workspaceId, slug],
    );
    const row = rows[0];
    return row === undefined ? null : toProject(row);
  }

  async createSession(
    projectId: Uuid,
    tool: string | null,
    provenance: SessionClientProvenance = {},
  ): Promise<Session> {
    assertUuid(projectId, 'projectId');
    const clientName =
      provenance.clientName == null
        ? null
        : assertNonEmpty(provenance.clientName, 'provenance.clientName');
    const clientVersion =
      provenance.clientVersion == null
        ? null
        : assertNonEmpty(provenance.clientVersion, 'provenance.clientVersion');
    const clientSessionRef =
      provenance.clientSessionRef == null
        ? null
        : assertNonEmpty(provenance.clientSessionRef, 'provenance.clientSessionRef');
    const clientSessionName =
      provenance.clientSessionName == null
        ? null
        : assertNonEmpty(provenance.clientSessionName, 'provenance.clientSessionName');
    const clientSessionUrl =
      provenance.clientSessionUrl == null
        ? null
        : assertNonEmpty(provenance.clientSessionUrl, 'provenance.clientSessionUrl');
    const rows = await this.rows(
      `INSERT INTO session (
         id, workspace_id, project_id, actor_id, tool,
         client_name, client_version, client_session_ref, client_session_name, client_session_url,
         started_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       RETURNING ${SESSION_COLUMNS}`,
      [
        this.scope.workspaceId,
        projectId,
        this.scope.actorId,
        tool,
        clientName,
        clientVersion,
        clientSessionRef,
        clientSessionName,
        clientSessionUrl,
      ],
    );
    return toSession(expectOne(rows, `opening a session on project ${projectId}`));
  }

  async endSession(id: Uuid): Promise<Session> {
    assertUuid(id, 'id');
    const rows = await this.rows(
      `UPDATE session SET ended_at = COALESCE(ended_at, now())
        WHERE workspace_id = $1 AND id = $2
        RETURNING ${SESSION_COLUMNS}`,
      [this.scope.workspaceId, id],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new StoreError(
        'not_found',
        `expected session ${id} in workspace ${this.scope.workspaceId}; found none`,
      );
    }
    return toSession(row);
  }

  async getContextItem(id: Uuid): Promise<ContextItem | null> {
    assertUuid(id, 'id');
    const located = await this.rows(
      'SELECT project_id FROM context_item WHERE workspace_id = $1 AND id = $2',
      [this.scope.workspaceId, id],
    );
    const first = located[0];
    if (first === undefined) return null;

    const params = new SqlParams();
    const workspace = params.add(this.scope.workspaceId);
    const item = params.add(id);
    const visibility = visibilityPredicate({
      scope: this.scope,
      actorTeamIds: await this.actorTeamIds(),
      projectId: toUuid(first, 'project_id'),
      paramOffset: params.length,
      itemAlias: 'context_item',
    });
    params.addAll(visibility.params);

    const rows = await this.rows(
      `SELECT ${contextItemReadColumns(false)}
         FROM ${contextItemFrom(false)}
        WHERE context_item.workspace_id = ${workspace}
          AND context_item.id = ${item}
          AND (${visibility.sql})`,
      params.list(),
    );
    const row = rows[0];
    return row === undefined ? null : toContextItem(row);
  }

  async listContextItems(filter: ContextItemFilter): Promise<readonly ContextItem[]> {
    return this.selectContextItems(filter);
  }

  async searchContextItems(search: ContextItemSearch): Promise<readonly ContextItem[]> {
    return this.selectContextItems(search);
  }

  async listStaleContextItems(
    filter: StaleContextItemFilter,
  ): Promise<readonly StaleContextItem[]> {
    assertUuid(filter.projectId, 'filter.projectId');
    const asOfAt = assertInstant(filter.asOf, 'filter.asOf');

    const params = new SqlParams();
    const workspace = params.add(this.scope.workspaceId);
    const project = params.add(filter.projectId);

    const visibility = visibilityPredicate({
      scope: this.scope,
      actorTeamIds: await this.actorTeamIds(),
      projectId: filter.projectId,
      paramOffset: params.length,
      itemAlias: 'context_item',
    });
    params.addAll(visibility.params);

    const decay = effectiveDecayAfter(params);
    const dueAt = verificationDueAt(decay);
    const asOf = params.add(asOfAt);
    const limit = params.add(resolveLimit(filter.limit, 'filter.limit'));

    const rows = await this.rows(
      `SELECT ${contextItemReadColumns(false)},
              ${dueAt} AS stale_since
         FROM ${contextItemFrom(false)}
        WHERE context_item.workspace_id = ${workspace}
          AND context_item.project_id = ${project}
          AND (${visibility.sql})
          AND context_item.status = 'active'
          AND context_item.valid_to IS NULL
          AND ${decay} IS NOT NULL
          AND ${dueAt} <= ${asOf}
        ORDER BY stale_since ASC, context_item.id ASC
        LIMIT ${limit}`,
      params.list(),
    );

    return rows.map((row) => {
      const staleSince = toDate(row, 'stale_since');
      return {
        item: toContextItem(row),
        staleSince,
        staleForMs: asOfAt.getTime() - staleSince.getTime(),
      };
    });
  }

  async selectRehydrationCandidates(
    request: RehydrationCandidateRequest,
  ): Promise<RehydrationCandidateGroups> {
    assertUuid(request.projectId, 'request.projectId');

    const params = new SqlParams();
    const workspace = params.add(this.scope.workspaceId);
    const project = params.add(request.projectId);
    const actor = params.add(this.scope.actorId);
    const asOf = params.add(request.asOf);
    const candidateLimit = params.add(resolveLimit(request.candidateLimit, 'candidateLimit'));
    const mandatoryLimit = params.add(resolveLimit(request.mandatoryLimit, 'mandatoryLimit'));
    const supersededLimit = params.add(resolveLimit(request.supersededLimit, 'supersededLimit'));

    const visibility = `(context_item.asserted_by = ${actor}
             OR context_item.access_scope = 'workspace'
             OR (context_item.access_scope = 'project' AND viewer.can_read_project)
             OR (context_item.access_scope = 'team' AND viewer.can_read_team))`;

    let candidateFrom = `context_item
         ${CONTEXT_ITEM_PROVENANCE_JOINS}`;
    let candidateColumns = `${CONTEXT_ITEM_COLUMNS},
       ${CONTEXT_ITEM_PROVENANCE_COLUMNS},
       NULL::text AS embedding_model, NULL::text AS embedding,
       NULL::double precision AS semantic_relevance`;
    let candidateOrder = 'context_item.asserted_at DESC, context_item.id DESC';

    if (request.embedding !== undefined) {
      assertEmbedding(request.embedding, 'request.embedding');
      const model = request.embeddingModel ?? null;
      if (model === null || model.trim() === '') {
        throw new StoreError(
          'invalid_argument',
          'expected request.embeddingModel to name the model that produced request.embedding; received none',
        );
      }
      candidateFrom = `context_item
         JOIN context_item_embedding
           ON context_item_embedding.workspace_id = context_item.workspace_id
          AND context_item_embedding.item_id = context_item.id
          AND context_item_embedding.model = ${params.add(model)}
         ${CONTEXT_ITEM_PROVENANCE_JOINS}`;
      const vector = `${params.add(embeddingLiteral(request.embedding))}::vector`;
      candidateColumns = `${CONTEXT_ITEM_COLUMNS},
       ${CONTEXT_ITEM_PROVENANCE_COLUMNS},
       context_item_embedding.model AS embedding_model, NULL::text AS embedding,
       GREATEST(0, LEAST(1, 1 - (context_item_embedding.embedding <=> ${vector})))::double precision
         AS semantic_relevance`;
      candidateOrder = `context_item_embedding.embedding <=> ${vector}`;
    }

    const rows = await this.rows(
      `WITH viewer AS (
         SELECT project.id,
                project.team_id IS NULL OR EXISTS (
                  SELECT 1
                    FROM team_member
                   WHERE team_member.workspace_id = ${workspace}
                     AND team_member.actor_id = ${actor}
                     AND team_member.team_id = project.team_id
                ) AS can_read_project,
                project.team_id IS NOT NULL AND EXISTS (
                  SELECT 1
                    FROM team_member
                   WHERE team_member.workspace_id = ${workspace}
                     AND team_member.actor_id = ${actor}
                     AND team_member.team_id = project.team_id
                ) AS can_read_team
           FROM project
          WHERE project.workspace_id = ${workspace} AND project.id = ${project}
       ), candidate_rows AS (
         SELECT 'candidate'::text AS candidate_group, ${candidateColumns}
           FROM ${candidateFrom}
          CROSS JOIN viewer
          WHERE context_item.workspace_id = ${workspace}
            AND context_item.project_id = ${project}
            AND context_item.status = 'active'
            AND context_item.valid_from <= ${asOf}
            AND (context_item.valid_to IS NULL OR context_item.valid_to > ${asOf})
            AND ${visibility}
          ORDER BY ${candidateOrder}
          LIMIT ${candidateLimit}
       ), mandatory_rows AS (
         SELECT 'mandatory'::text AS candidate_group, ${CONTEXT_ITEM_COLUMNS},
                ${CONTEXT_ITEM_PROVENANCE_COLUMNS},
                NULL::text AS embedding_model, NULL::text AS embedding,
                NULL::double precision AS semantic_relevance
           FROM context_item
          ${CONTEXT_ITEM_PROVENANCE_JOINS}
          CROSS JOIN viewer
          WHERE context_item.workspace_id = ${workspace}
            AND context_item.project_id = ${project}
            AND context_item.kind = 'constraint'
            AND context_item.status = 'active'
            AND context_item.load_bearing = true
            AND context_item.valid_from <= ${asOf}
            AND (context_item.valid_to IS NULL OR context_item.valid_to > ${asOf})
            AND ${visibility}
          ORDER BY context_item.asserted_at DESC, context_item.id DESC
          LIMIT ${mandatoryLimit}
       ), superseded_rows AS (
         SELECT 'superseded'::text AS candidate_group, ${CONTEXT_ITEM_COLUMNS},
                ${CONTEXT_ITEM_PROVENANCE_COLUMNS},
                NULL::text AS embedding_model, NULL::text AS embedding,
                NULL::double precision AS semantic_relevance
           FROM context_item
          ${CONTEXT_ITEM_PROVENANCE_JOINS}
          CROSS JOIN viewer
          WHERE context_item.workspace_id = ${workspace}
            AND context_item.project_id = ${project}
            AND context_item.kind IN ('decision', 'constraint')
            AND context_item.status = 'superseded'
            AND ${visibility}
          ORDER BY context_item.asserted_at DESC, context_item.id DESC
          LIMIT ${supersededLimit}
       )
       SELECT * FROM candidate_rows
       UNION ALL
       SELECT * FROM mandatory_rows
       UNION ALL
       SELECT * FROM superseded_rows`,
      params.list(),
    );

    const candidates: ContextItem[] = [];
    const mandatory: ContextItem[] = [];
    const superseded: ContextItem[] = [];
    const relevance = new Map<Uuid, number>();

    for (const row of rows) {
      const group = toText(row, 'candidate_group');
      const contextItem = toContextItem(row);
      const scored = toNullableNumber(row, 'semantic_relevance');
      if (scored !== null) relevance.set(contextItem.id, scored);
      if (group === 'candidate') candidates.push(contextItem);
      else if (group === 'mandatory') mandatory.push(contextItem);
      else if (group === 'superseded') superseded.push(contextItem);
      else {
        throw new StoreError(
          'invalid_argument',
          `expected candidate_group to be candidate, mandatory or superseded; received ${JSON.stringify(group)}`,
        );
      }
    }

    return { candidates, mandatory, superseded, relevance };
  }

  private async selectContextItems(search: ContextItemSearch): Promise<readonly ContextItem[]> {
    assertUuid(search.projectId, 'filter.projectId');

    const params = new SqlParams();
    const conditions = [
      `context_item.workspace_id = ${params.add(this.scope.workspaceId)}`,
      `context_item.project_id = ${params.add(search.projectId)}`,
    ];

    const visibility = visibilityPredicate({
      scope: this.scope,
      actorTeamIds: await this.actorTeamIds(),
      projectId: search.projectId,
      paramOffset: params.length,
      itemAlias: 'context_item',
    });
    params.addAll(visibility.params);
    conditions.push(`(${visibility.sql})`);

    if (search.kinds !== undefined) {
      if (search.kinds.length === 0) {
        throw new StoreError(
          'invalid_argument',
          'expected filter.kinds to name at least one item kind; received an empty array — omit the field to accept every kind',
        );
      }
      conditions.push(
        `context_item.kind IN (${search.kinds.map((kind) => params.add(kind)).join(', ')})`,
      );
    }

    if (search.statuses !== undefined) {
      if (search.statuses.length === 0) {
        throw new StoreError(
          'invalid_argument',
          'expected filter.statuses to name at least one item status; received an empty array — omit the field to accept every status',
        );
      }
      conditions.push(
        `context_item.status IN (${search.statuses.map((status) => params.add(status)).join(', ')})`,
      );
    }

    if (search.loadBearing !== undefined) {
      conditions.push(`context_item.load_bearing = ${params.add(search.loadBearing)}`);
    }

    if (search.asOf !== undefined) {
      const asOf = params.add(search.asOf);
      conditions.push(`context_item.valid_from <= ${asOf}`);
      conditions.push(`(context_item.valid_to IS NULL OR context_item.valid_to > ${asOf})`);
    }

    if (search.text !== undefined && search.text.trim() !== '') {
      const pattern = params.add(`%${escapeLike(search.text.trim())}%`);
      conditions.push(
        `(context_item.title ILIKE ${pattern} ESCAPE '\\' OR context_item.body ILIKE ${pattern} ESCAPE '\\')`,
      );
    }

    let ordering = 'context_item.asserted_at DESC, context_item.id DESC';
    let from = contextItemFrom(search.withEmbedding);

    if (search.embedding !== undefined) {
      assertEmbedding(search.embedding, 'search.embedding');
      const model = search.embeddingModel ?? null;
      if (model === null || model.trim() === '') {
        throw new StoreError(
          'invalid_argument',
          'expected search.embeddingModel to name the model that produced search.embedding; received none — ' +
            'a cosine distance between vectors from two different models is meaningless, so pass a ' +
            'provider-qualified identifier such as "openai:text-embedding-3-small"',
        );
      }
      const modelParam = params.add(model);
      from = `context_item
         JOIN context_item_embedding
           ON context_item_embedding.workspace_id = context_item.workspace_id
          AND context_item_embedding.item_id = context_item.id
          AND context_item_embedding.model = ${modelParam}
         ${CONTEXT_ITEM_PROVENANCE_JOINS}`;
      ordering = `context_item_embedding.embedding <=> ${params.add(embeddingLiteral(search.embedding))}::vector`;
    }

    const limit = params.add(resolveLimit(search.limit, 'filter.limit'));

    const rows = await this.rows(
      `SELECT ${contextItemReadColumns(search.withEmbedding)}
         FROM ${from}
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY ${ordering}
        LIMIT ${limit}`,
      params.list(),
    );
    return rows.map(toContextItem);
  }

  async insertContextItem(item: NewContextItem): Promise<ContextItem> {
    if (item.supersedesId === undefined || item.supersedesId === null) {
      return toContextItem(await this.insertContextItemRow(item, null));
    }

    const supersedesId = assertUuid(item.supersedesId, 'item.supersedesId');

    return this.atomic(`inserting a context item superseding ${supersedesId}`, async () => {
      await this.guardSupersede(supersedesId);
      const inserted = toContextItem(await this.insertContextItemRow(item, null));
      if (inserted.supersedesId !== null) {
        await this.linkSupersession(inserted.supersedesId, inserted.id);
      }
      return inserted;
    });
  }

  private async insertContextItemRow(
    item: NewContextItem,
    supersedes: Uuid | null,
  ): Promise<SqlRow> {
    assertUuid(item.projectId, 'item.projectId');
    assertNonEmpty(item.title, 'item.title');
    const asserter = await this.assertingActor();
    const id = assertOptionalUuid(item.id, 'item.id');
    const sourceSessionId = assertOptionalUuid(item.sourceSessionId, 'item.sourceSessionId');
    const supersedesId =
      supersedes ?? assertOptionalUuid(item.supersedesId, 'item.supersedesId') ?? null;

    const confidence = item.confidence ?? DEFAULT_CONFIDENCE;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new StoreError(
        'invalid_argument',
        `expected item.confidence to be between 0 and 1; received ${confidence}`,
      );
    }

    const embedding = item.embedding ?? null;
    const embeddingModel = assertEmbeddingProvenance(embedding, item.embeddingModel ?? null);
    const embeddingValue =
      embedding === null ? null : embeddingLiteral(assertEmbedding(embedding, 'item.embedding'));

    const decayAfterMs = assertOptionalIntervalMs(item.decayAfter, 'item.decayAfter');

    const params = new SqlParams();
    const values = [
      `COALESCE(${params.add(id)}::uuid, gen_random_uuid())`,
      params.add(this.scope.workspaceId),
      params.add(item.projectId),
      params.add(item.kind),
      params.add(item.title),
      params.add(item.body ?? null),
      params.add(asserter.id),
      params.add(sourceSessionId),
      params.add(item.sourceRef ?? null),
      params.add(confidence),
      params.add(asserter.kind === 'human'),
      params.add(item.loadBearing ?? false),
      params.add(item.accessScope ?? DEFAULT_ACCESS_SCOPE),
      params.add(supersedesId),
      params.add(item.supersedeReason ?? null),
      `CASE WHEN ${params.add(decayAfterMs)}::double precision IS NULL THEN NULL
            ELSE make_interval(secs => ${params.add(decayAfterMs)}::double precision / 1000.0) END`,
    ];

    const modelParam = params.add(embeddingModel);
    const vectorParam = params.add(embeddingValue);
    const dimParam = params.add(EMBEDDING_DIMENSIONS);

    const rows = await this.rows(
      `WITH inserted AS (
         INSERT INTO context_item (
           id, workspace_id, project_id, kind, title, body,
           asserted_by, source_session_id, source_ref,
           confidence, human_confirmed, load_bearing,
           access_scope, supersedes_id, supersede_reason, decay_after)
         VALUES (${values.join(', ')})
         RETURNING context_item.*
       ), stored AS (
         INSERT INTO context_item_embedding (workspace_id, item_id, model, dim, embedding)
         SELECT inserted.workspace_id, inserted.id, ${modelParam}, ${dimParam}, ${vectorParam}::vector
           FROM inserted
          WHERE ${modelParam}::text IS NOT NULL
         RETURNING item_id
       )
       SELECT ${CONTEXT_ITEM_COLUMNS}, ${modelParam}::text AS embedding_model,
              ${vectorParam}::text AS embedding
         FROM inserted AS context_item`,
      params.list(),
    );

    return expectOne(rows, `inserting a context item into project ${item.projectId}`);
  }

  async confirmContextItem(input: ConfirmContextItemInput): Promise<ContextItem> {
    assertUuid(input.id, 'input.id');
    assertUuid(input.confirmedBy, 'input.confirmedBy');
    if (input.title !== undefined) {
      assertNonEmpty(input.title, 'input.title');
    }

    return this.atomic(`confirming context item ${input.id}`, async () => {
      const actor = await this.getActor(input.confirmedBy);
      if (actor === null) {
        throw new StoreError(
          'not_found',
          `expected input.confirmedBy ${input.confirmedBy} to name an actor in workspace ${this.scope.workspaceId}; found none`,
        );
      }
      if (actor.kind !== 'human') {
        throw new StoreError(
          'invalid_argument',
          `expected input.confirmedBy ${input.confirmedBy} to be an actor of kind "human"; received "${actor.kind}". Only a human confirms an item — an agent doing so would let it overrule a human (vision.md §10.1).`,
        );
      }

      const params = new SqlParams();
      const assignments = ['human_confirmed = true', 'last_verified_at = now()'];
      if (input.loadBearing !== undefined) {
        assignments.push(`load_bearing = ${params.add(input.loadBearing)}`);
      }
      if (input.accessScope !== undefined) {
        assignments.push(`access_scope = ${params.add(input.accessScope)}`);
      }
      if (input.title !== undefined) {
        assignments.push(`title = ${params.add(input.title)}`);
      }
      if (input.body !== undefined) {
        assignments.push(`body = ${params.add(input.body)}`);
      }

      const rows = await this.rows(
        `UPDATE context_item
            SET ${assignments.join(', ')}
          WHERE workspace_id = ${params.add(this.scope.workspaceId)}
            AND id = ${params.add(input.id)}
          RETURNING ${CONTEXT_ITEM_COLUMNS}`,
        params.list(),
      );

      const row = rows[0];
      if (row === undefined) {
        throw new StoreError(
          'not_found',
          `expected context item ${input.id} in workspace ${this.scope.workspaceId} to confirm; found none`,
        );
      }
      return toContextItem(row);
    });
  }

  async verifyContextItem(input: VerifyContextItemInput): Promise<VerifyContextItemResult> {
    assertUuid(input.projectId, 'input.projectId');
    assertUuid(input.itemId, 'input.itemId');

    if (!CONTEXT_ITEM_VERIFICATIONS.includes(input.verification)) {
      throw new StoreError(
        'invalid_argument',
        `expected input.verification to be one of ${CONTEXT_ITEM_VERIFICATIONS.join(', ')}; received ${JSON.stringify(input.verification)}`,
      );
    }

    const reason = input.reason ?? null;
    if (input.verification === 'denied' && (reason === null || reason.trim() === '')) {
      throw new StoreError(
        'invalid_argument',
        'expected input.reason to say why the item no longer holds; received none — a denial retires the item, and the reason is the labelled example §17 collects',
      );
    }

    return this.atomic(`verifying context item ${input.itemId}`, async () => {
      const actor = await this.assertingActor();
      if (actor.kind !== 'human') {
        throw new StoreError(
          'invalid_argument',
          `expected the verifying actor ${actor.id} to be of kind "human"; received "${actor.kind}". Only a human answers a re-verification prompt — an agent doing so would let it overrule a human (vision.md §10.1). Open the scope with a human actor.`,
        );
      }

      const existingRows = await this.rows(
        `SELECT ${CONTEXT_ITEM_COLUMNS}
           FROM context_item
          WHERE workspace_id = $1 AND id = $2 AND project_id = $3
          FOR UPDATE`,
        [this.scope.workspaceId, input.itemId, input.projectId],
      );
      const existing = existingRows[0];
      if (existing === undefined) {
        throw new StoreError(
          'not_found',
          `expected context item ${input.itemId} in project ${input.projectId} of workspace ${this.scope.workspaceId} to verify; found none — re-read the stale list and name an item that exists in this project`,
        );
      }

      const status = toEnum(existing, 'status', ITEM_STATUSES);
      if (status !== 'active') {
        throw new StoreError(
          'invalid_argument',
          `expected context item ${input.itemId} to be active to verify; its status is "${status}" — only an active item is ever prompted for re-verification, so reload the stale list`,
        );
      }

      const previousLastVerifiedAt = toNullableDate(existing, 'last_verified_at');
      const confirmed = input.verification === 'confirmed';

      const checkpointRow = expectOne(
        await this.rows(
          `INSERT INTO checkpoint (id, workspace_id, project_id, session_id, actor_id, "trigger", summary)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5)
           RETURNING ${CHECKPOINT_COLUMNS}`,
          [
            this.scope.workspaceId,
            input.projectId,
            this.scope.actorId,
            REVIEW_TRIGGER,
            confirmed
              ? `Re-verified: ${reason ?? 'still holds'}`
              : `Verification denied: ${reason ?? ''}`,
          ],
        ),
        `opening the verification checkpoint for project ${input.projectId}`,
      );
      const checkpoint = toCheckpoint(checkpointRow);

      const assignments = confirmed
        ? 'human_confirmed = true, last_verified_at = now()'
        : "status = 'retired', valid_to = COALESCE(valid_to, now()), last_verified_at = now()";

      const verifiedRows = await this.rows(
        `UPDATE context_item
            SET ${assignments}
          WHERE workspace_id = $1 AND id = $2
          RETURNING ${CONTEXT_ITEM_COLUMNS}`,
        [this.scope.workspaceId, input.itemId],
      );
      const verified = expectOne(verifiedRows, `verifying context item ${input.itemId}`);

      await this.rows(
        `INSERT INTO checkpoint_item (workspace_id, checkpoint_id, item_id, action)
         VALUES ($1, $2, $3, $4)`,
        [this.scope.workspaceId, checkpoint.id, input.itemId, confirmed ? 'updated' : 'rejected'],
      );

      return {
        checkpoint,
        item: toContextItem(verified),
        verification: input.verification,
        previousLastVerifiedAt,
      };
    });
  }

  async retireContextItem(input: RetireContextItemInput): Promise<RetireContextItemResult> {
    assertUuid(input.projectId, 'input.projectId');
    assertUuid(input.itemId, 'input.itemId');
    assertNonEmpty(input.reason, 'input.reason');

    return this.atomic(`retiring context item ${input.itemId}`, async () => {
      const actor = await this.assertingActor();
      if (actor.kind !== 'human') {
        throw new StoreError(
          'invalid_argument',
          `expected the retiring actor ${actor.id} to be of kind "human"; received "${actor.kind}". Only a human retires a stored item — an agent doing so would let it overrule a human (vision.md §10.1). Open the scope with a human actor.`,
        );
      }

      const existingRows = await this.rows(
        `SELECT ${CONTEXT_ITEM_COLUMNS}
           FROM context_item
          WHERE workspace_id = $1 AND id = $2 AND project_id = $3
          FOR UPDATE`,
        [this.scope.workspaceId, input.itemId, input.projectId],
      );
      const existing = existingRows[0];
      if (existing === undefined) {
        throw new StoreError(
          'not_found',
          `expected context item ${input.itemId} on project ${input.projectId} in workspace ${this.scope.workspaceId} to retire; found none — check the id with mneia log`,
        );
      }

      const status = toEnum(existing, 'status', ITEM_STATUSES);
      if (status !== 'active' && status !== 'disputed') {
        throw new StoreError(
          'invalid_argument',
          `expected context item ${input.itemId} to be active or disputed to retire it; its status is "${status}" — a retired or superseded item is already out of every slice`,
        );
      }

      const checkpointRow = expectOne(
        await this.rows(
          `INSERT INTO checkpoint (id, workspace_id, project_id, session_id, actor_id, "trigger", summary)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5)
           RETURNING ${CHECKPOINT_COLUMNS}`,
          [
            this.scope.workspaceId,
            input.projectId,
            this.scope.actorId,
            REVIEW_TRIGGER,
            `Retired: ${input.reason}`,
          ],
        ),
        `opening the retirement checkpoint for project ${input.projectId}`,
      );
      const checkpoint = toCheckpoint(checkpointRow);

      const retiredRows = await this.rows(
        `UPDATE context_item
            SET status = 'retired',
                valid_to = COALESCE(valid_to, now()),
                last_verified_at = now()
          WHERE workspace_id = $1 AND id = $2
          RETURNING ${CONTEXT_ITEM_COLUMNS}`,
        [this.scope.workspaceId, input.itemId],
      );
      const retired = expectOne(retiredRows, `retiring context item ${input.itemId}`);

      await this.rows(
        `INSERT INTO checkpoint_item (workspace_id, checkpoint_id, item_id, action)
         VALUES ($1, $2, $3, 'rejected')`,
        [this.scope.workspaceId, checkpoint.id, input.itemId],
      );

      return { checkpoint, item: toContextItem(retired) };
    });
  }

  async listPendingReviewItems(filter: PendingReviewFilter): Promise<readonly PendingReviewItem[]> {
    assertUuid(filter.projectId, 'filter.projectId');

    const params = new SqlParams();
    const workspace = params.add(this.scope.workspaceId);
    const project = params.add(filter.projectId);

    const visibility = visibilityPredicate({
      scope: this.scope,
      actorTeamIds: await this.actorTeamIds(),
      projectId: filter.projectId,
      paramOffset: params.length,
      itemAlias: 'item',
    });
    params.addAll(visibility.params);

    const limit = params.add(resolveLimit(filter.limit, 'filter.limit'));

    const rows = await this.rows(
      `SELECT ${PENDING_REVIEW_COLUMNS}
         FROM context_item AS item
         INNER JOIN actor AS asserter
            ON asserter.workspace_id = item.workspace_id
           AND asserter.id = item.asserted_by
         LEFT JOIN LATERAL (
           SELECT link.checkpoint_id
             FROM checkpoint_item AS link
             INNER JOIN checkpoint AS origin_checkpoint
                ON origin_checkpoint.workspace_id = link.workspace_id
               AND origin_checkpoint.id = link.checkpoint_id
            WHERE link.workspace_id = item.workspace_id
              AND link.item_id = item.id
            ORDER BY origin_checkpoint.created_at ASC, link.checkpoint_id ASC
            LIMIT 1
         ) AS origin ON true
        WHERE item.workspace_id = ${workspace}
          AND item.project_id = ${project}
          AND item.human_confirmed = false
          AND item.status = 'active'
          AND (${visibility.sql})
        ORDER BY item.load_bearing DESC, item.asserted_at ASC, item.id ASC
        LIMIT ${limit}`,
      params.list(),
    );

    return rows.map(toPendingReviewItem);
  }

  async reviewPendingItems(input: ReviewPendingItemsInput): Promise<ReviewPendingItemsResult> {
    assertUuid(input.projectId, 'input.projectId');
    if (input.reviews.length === 0) {
      throw new StoreError(
        'invalid_argument',
        'expected input.reviews to name at least one pending context item to review; received an empty array — submit the items the reviewer decided on',
      );
    }

    const seen = new Set<Uuid>();
    for (const review of input.reviews) {
      assertUuid(review.itemId, 'review.itemId');
      if (review.decision !== 'accept' && review.decision !== 'reject') {
        throw new StoreError(
          'invalid_argument',
          `expected review.decision for item ${review.itemId} to be "accept" or "reject"; received ${JSON.stringify(review.decision)}`,
        );
      }
      if (seen.has(review.itemId)) {
        throw new StoreError(
          'invalid_argument',
          `expected every review to name a distinct context item; item ${review.itemId} appears twice — a single review carries one decision per item`,
        );
      }
      seen.add(review.itemId);
      if (review.title !== undefined) {
        assertNonEmpty(review.title, 'review.title');
      }
    }

    return this.atomic(
      `reviewing ${input.reviews.length} pending context items on project ${input.projectId}`,
      async () => {
        const reviewer = await this.assertingActor();
        if (reviewer.kind !== 'human') {
          throw new StoreError(
            'invalid_argument',
            `expected the reviewing actor ${reviewer.id} to be of kind "human"; received "${reviewer.kind}". Only a human confirms, edits, or rejects an extraction — an agent doing so would let it overrule a human (vision.md §10.1). Open the scope with a human actor.`,
          );
        }

        const checkpointRow = expectOne(
          await this.rows(
            `INSERT INTO checkpoint (id, workspace_id, project_id, session_id, actor_id, "trigger", summary)
             VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5)
             RETURNING ${CHECKPOINT_COLUMNS}`,
            [
              this.scope.workspaceId,
              input.projectId,
              this.scope.actorId,
              REVIEW_TRIGGER,
              input.summary ?? null,
            ],
          ),
          `opening the review checkpoint for project ${input.projectId}`,
        );
        const checkpoint = toCheckpoint(checkpointRow);

        const outcomes: ContextItemReviewOutcome[] = [];
        for (const review of input.reviews) {
          outcomes.push(await this.applyReview(checkpoint.id, input.projectId, review));
        }

        return { checkpoint, outcomes };
      },
    );
  }

  private async applyReview(
    checkpointId: Uuid,
    projectId: Uuid,
    review: ContextItemReview,
  ): Promise<ContextItemReviewOutcome> {
    const existingRows = await this.rows(
      `SELECT ${REVIEWED_ITEM_COLUMNS}
         FROM context_item
        WHERE workspace_id = $1 AND id = $2 AND project_id = $3
        FOR UPDATE`,
      [this.scope.workspaceId, review.itemId, projectId],
    );
    const existing = existingRows[0];
    if (existing === undefined) {
      throw new StoreError(
        'not_found',
        `expected context item ${review.itemId} on project ${projectId} in workspace ${this.scope.workspaceId} to review; found none — reload the review queue and submit only the items it lists`,
      );
    }

    if (toBoolean(existing, 'human_confirmed')) {
      throw new StoreError(
        'invalid_argument',
        `expected context item ${review.itemId} to be awaiting human confirmation; a human already confirmed it. A review never overwrites a human-confirmed item (vision.md §10.1) — reload the review queue.`,
      );
    }

    const status = toEnum(existing, 'status', ITEM_STATUSES);
    if (status !== 'active') {
      throw new StoreError(
        'invalid_argument',
        `expected context item ${review.itemId} to be active to review; its status is "${status}" — only active items sit in the review queue, so reload it`,
      );
    }

    const outcome =
      review.decision === 'reject'
        ? await this.rejectReviewedItem(review.itemId)
        : await this.acceptReviewedItem(existing, review);

    await this.rows(
      `INSERT INTO checkpoint_item (workspace_id, checkpoint_id, item_id, action)
       VALUES ($1, $2, $3, $4)`,
      [
        this.scope.workspaceId,
        checkpointId,
        review.itemId,
        outcome.outcome === 'rejected' ? 'rejected' : 'updated',
      ],
    );

    return outcome;
  }

  private async rejectReviewedItem(itemId: Uuid): Promise<ContextItemReviewOutcome> {
    const rows = await this.rows(
      `UPDATE context_item
          SET status = 'retired',
              valid_to = COALESCE(valid_to, now()),
              last_verified_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING id`,
      [this.scope.workspaceId, itemId],
    );
    expectOne(rows, `rejecting context item ${itemId}`);
    return { itemId, outcome: 'rejected', fieldsChanged: [] };
  }

  private async acceptReviewedItem(
    existing: SqlRow,
    review: ContextItemReview,
  ): Promise<ContextItemReviewOutcome> {
    const params = new SqlParams();
    const assignments = ['human_confirmed = true', 'last_verified_at = now()'];
    const fieldsChanged: string[] = [];

    if (review.title !== undefined && review.title !== toText(existing, 'title')) {
      assignments.push(`title = ${params.add(review.title)}`);
      fieldsChanged.push('title');
    }
    if (review.body !== undefined && (review.body ?? null) !== toNullableText(existing, 'body')) {
      assignments.push(`body = ${params.add(review.body ?? null)}`);
      fieldsChanged.push('body');
    }
    if (
      review.loadBearing !== undefined &&
      review.loadBearing !== toBoolean(existing, 'load_bearing')
    ) {
      assignments.push(`load_bearing = ${params.add(review.loadBearing)}`);
      fieldsChanged.push('load_bearing');
    }
    if (
      review.accessScope !== undefined &&
      review.accessScope !== toEnum(existing, 'access_scope', ACCESS_SCOPES)
    ) {
      assignments.push(`access_scope = ${params.add(review.accessScope)}`);
      fieldsChanged.push('access_scope');
    }

    const rows = await this.rows(
      `UPDATE context_item
          SET ${assignments.join(', ')}
        WHERE workspace_id = ${params.add(this.scope.workspaceId)}
          AND id = ${params.add(review.itemId)}
        RETURNING id`,
      params.list(),
    );
    expectOne(rows, `confirming context item ${review.itemId}`);

    const outcome: ContextItemReviewOutcomeKind = fieldsChanged.length > 0 ? 'edited' : 'confirmed';
    return { itemId: review.itemId, outcome, fieldsChanged };
  }

  private async linkSupersession(previousId: Uuid, replacementId: Uuid): Promise<void> {
    const rows = await this.rows(
      `UPDATE context_item
          SET status = $1,
              valid_to = COALESCE(valid_to, now()),
              superseded_by_id = $2
        WHERE workspace_id = $3 AND id = $4
        RETURNING id`,
      ['superseded', replacementId, this.scope.workspaceId, previousId],
    );
    if (rows[0] === undefined) {
      throw new StoreError(
        'not_found',
        `expected context item ${previousId} in workspace ${this.scope.workspaceId} to mark superseded by ${replacementId}; found none`,
      );
    }
  }

  async supersedeContextItem(previousId: Uuid, replacement: NewContextItem): Promise<ContextItem> {
    assertUuid(previousId, 'previousId');

    return this.atomic(`superseding context item ${previousId}`, async () => {
      await this.guardSupersede(previousId);

      const inserted = toContextItem(await this.insertContextItemRow(replacement, previousId));
      await this.linkSupersession(previousId, inserted.id);
      return inserted;
    });
  }

  async writeCheckpoint(write: CheckpointWrite): Promise<CheckpointWriteResult> {
    const { checkpoint, items } = write;
    assertUuid(checkpoint.projectId, 'checkpoint.projectId');
    assertUuid(checkpoint.actorId, 'checkpoint.actorId');
    const id = assertOptionalUuid(checkpoint.id, 'checkpoint.id');
    const sessionId = assertOptionalUuid(checkpoint.sessionId, 'checkpoint.sessionId');

    return this.atomic(`writing a checkpoint on project ${checkpoint.projectId}`, async () => {
      const checkpointRow = expectOne(
        await this.rows(
          `INSERT INTO checkpoint (id, workspace_id, project_id, session_id, actor_id, "trigger", summary, source, source_session_ref, source_watermark)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING ${CHECKPOINT_COLUMNS}`,
          [
            id,
            this.scope.workspaceId,
            checkpoint.projectId,
            sessionId,
            checkpoint.actorId,
            checkpoint.trigger,
            checkpoint.summary ?? null,
            checkpoint.source ?? null,
            checkpoint.sourceSessionRef ?? null,
            checkpoint.sourceWatermark ?? null,
          ],
        ),
        `inserting the checkpoint row for project ${checkpoint.projectId}`,
      );

      const created = toCheckpoint(checkpointRow);
      const written: ContextItem[] = [];
      const links: CheckpointItem[] = [];
      const conflicts: Conflict[] = [];

      for (const entry of items) {
        const supersedesId = assertOptionalUuid(entry.item.supersedesId, 'item.supersedesId');
        if (supersedesId !== null) {
          await this.guardSupersede(supersedesId);
        }
        const conflictsWith = assertOptionalUuid(entry.conflictsWith, 'item.conflictsWith');

        const item = toContextItem(await this.insertContextItemRow(entry.item, null));
        written.push(item);

        if (item.supersedesId !== null) {
          await this.linkSupersession(item.supersedesId, item.id);
        }

        const linkRow = expectOne(
          await this.rows(
            `INSERT INTO checkpoint_item (workspace_id, checkpoint_id, item_id, action)
             VALUES ($1, $2, $3, $4)
             RETURNING ${CHECKPOINT_ITEM_COLUMNS}`,
            [this.scope.workspaceId, created.id, item.id, entry.action],
          ),
          `attributing context item ${item.id} to checkpoint ${created.id}`,
        );
        links.push(toCheckpointItem(linkRow));

        if (conflictsWith !== null && conflictsWith !== item.id) {
          const conflictRows = await this.rows(
            `INSERT INTO conflict (id, workspace_id, project_id, item_a, item_b)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)
             ON CONFLICT DO NOTHING
             RETURNING ${CONFLICT_COLUMNS}`,
            [this.scope.workspaceId, item.projectId, conflictsWith, item.id],
          );
          const conflictRow = conflictRows[0];
          if (conflictRow !== undefined) {
            conflicts.push(toConflict(conflictRow));
          }
        }
      }

      return { checkpoint: created, items: links, written, conflicts };
    });
  }

  async getCheckpoint(id: Uuid): Promise<Checkpoint | null> {
    assertUuid(id, 'id');
    const rows = await this.rows(
      `SELECT ${CHECKPOINT_COLUMNS} FROM checkpoint WHERE workspace_id = $1 AND id = $2`,
      [this.scope.workspaceId, id],
    );
    const row = rows[0];
    return row === undefined ? null : toCheckpoint(row);
  }

  async listCheckpoints(projectId: Uuid, limit?: number): Promise<readonly Checkpoint[]> {
    assertUuid(projectId, 'projectId');
    const rows = await this.rows(
      `SELECT ${CHECKPOINT_COLUMNS}
         FROM checkpoint
        WHERE workspace_id = $1 AND project_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [this.scope.workspaceId, projectId, resolveLimit(limit, 'limit')],
    );
    return rows.map(toCheckpoint);
  }

  async createHandoff(handoff: NewHandoff): Promise<Handoff> {
    assertUuid(handoff.projectId, 'handoff.projectId');
    assertUuid(handoff.fromActor, 'handoff.fromActor');
    assertNonEmpty(handoff.nextAction, 'handoff.nextAction');
    assertNonEmpty(handoff.rendered, 'handoff.rendered');
    const id = assertOptionalUuid(handoff.id, 'handoff.id');
    const toActor = assertOptionalUuid(handoff.toActor, 'handoff.toActor');

    return this.atomic(`creating a handoff on project ${handoff.projectId}`, async () => {
      const rows = await this.rows(
        `INSERT INTO handoff (id, workspace_id, project_id, from_actor, to_actor, next_action, rendered)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7)
       RETURNING ${HANDOFF_COLUMNS}`,
        [
          id,
          this.scope.workspaceId,
          handoff.projectId,
          handoff.fromActor,
          toActor,
          handoff.nextAction,
          handoff.rendered,
        ],
      );
      const created = toHandoff(
        expectOne(rows, `creating a handoff on project ${handoff.projectId}`),
      );

      for (const entry of handoff.items ?? []) {
        assertUuid(entry.itemId, 'handoff.items[].itemId');
        assertNonEmpty(entry.section, 'handoff.items[].section');
        await this.rows(
          `INSERT INTO handoff_item (workspace_id, handoff_id, item_id, section)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (handoff_id, item_id) DO NOTHING`,
          [this.scope.workspaceId, created.id, entry.itemId, entry.section],
        );
      }

      return created;
    });
  }

  async listHandoffItems(handoffId: Uuid): Promise<readonly HandoffItem[]> {
    assertUuid(handoffId, 'handoffId');
    const rows = await this.rows(
      `SELECT handoff_item.section AS handoff_section, ${CONTEXT_ITEM_COLUMNS}
         FROM handoff_item
         JOIN context_item
           ON context_item.workspace_id = handoff_item.workspace_id
          AND context_item.id = handoff_item.item_id
        WHERE handoff_item.workspace_id = $1 AND handoff_item.handoff_id = $2
        ORDER BY handoff_item.section, context_item.asserted_at DESC`,
      [this.scope.workspaceId, handoffId],
    );
    return rows.map((row) => ({
      section: String(row.handoff_section),
      item: toContextItem(row),
    }));
  }

  async receiveHandoff(id: Uuid, receivedBy: Uuid): Promise<Handoff> {
    assertUuid(id, 'id');
    assertUuid(receivedBy, 'receivedBy');

    return this.atomic(`receiving handoff ${id}`, async () => {
      const rows = await this.rows(
        `SELECT ${HANDOFF_COLUMNS} FROM handoff WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [this.scope.workspaceId, id],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new StoreError(
          'not_found',
          `expected handoff ${id} in workspace ${this.scope.workspaceId}; found none`,
        );
      }

      const existing = toHandoff(row);
      if (existing.receivedAt !== null) {
        throw new StoreError(
          'already_received',
          `expected handoff ${id} to be unreceived; it was already received at ${existing.receivedAt.toISOString()}`,
        );
      }
      if (existing.toActor !== null && existing.toActor !== receivedBy) {
        throw new StoreError(
          'wrong_receiver',
          `expected handoff ${id} to be received by actor ${existing.toActor}; received by ${receivedBy}`,
        );
      }

      const updated = await this.rows(
        `UPDATE handoff
            SET received_at = now(), to_actor = COALESCE(to_actor, $1)
          WHERE workspace_id = $2 AND id = $3
          RETURNING ${HANDOFF_COLUMNS}`,
        [receivedBy, this.scope.workspaceId, id],
      );
      return toHandoff(expectOne(updated, `marking handoff ${id} received`));
    });
  }

  async getHandoff(id: Uuid): Promise<Handoff | null> {
    assertUuid(id, 'id');
    const rows = await this.rows(
      `SELECT ${HANDOFF_COLUMNS} FROM handoff WHERE workspace_id = $1 AND id = $2`,
      [this.scope.workspaceId, id],
    );
    const row = rows[0];
    return row === undefined ? null : toHandoff(row);
  }

  async listOpenHandoffs(projectId: Uuid, limit?: number): Promise<readonly Handoff[]> {
    assertUuid(projectId, 'projectId');
    const rows = await this.rows(
      `SELECT ${HANDOFF_COLUMNS}
         FROM handoff
        WHERE workspace_id = $1 AND project_id = $2 AND received_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [this.scope.workspaceId, projectId, resolveLimit(limit, 'limit')],
    );
    return rows.map(toHandoff);
  }

  async listInboxHandoffs(filter: InboxHandoffFilter): Promise<readonly Handoff[]> {
    assertUuid(filter.projectId, 'filter.projectId');

    const rows = await this.rows(
      `SELECT ${HANDOFF_COLUMNS}
         FROM handoff
        WHERE workspace_id = $1
          AND project_id = $2
          AND received_at IS NULL
          AND (to_actor = $3 OR to_actor IS NULL)
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [
        this.scope.workspaceId,
        filter.projectId,
        this.scope.actorId,
        resolveLimit(filter.limit, 'filter.limit'),
      ],
    );
    return rows.map(toHandoff);
  }

  async listWorkspaceActors(filter: WorkspaceActorFilter = {}): Promise<readonly Actor[]> {
    const rows = await this.rows(
      `SELECT ${ACTOR_COLUMNS}
         FROM actor
        WHERE workspace_id = $1
        ORDER BY display_name ASC, id ASC
        LIMIT $2`,
      [this.scope.workspaceId, resolveLimit(filter.limit, 'filter.limit')],
    );
    return rows.map(toActor);
  }

  async listProjectSessions(
    filter: ProjectSessionFilter,
  ): Promise<readonly ProjectSessionSummary[]> {
    assertUuid(filter.projectId, 'filter.projectId');

    const params = new SqlParams();
    const workspace = params.add(this.scope.workspaceId);
    const project = params.add(filter.projectId);

    const visibility = visibilityPredicate({
      scope: this.scope,
      actorTeamIds: await this.actorTeamIds(),
      projectId: filter.projectId,
      paramOffset: params.length,
      itemAlias: 'context_item',
    });
    params.addAll(visibility.params);

    const limit = params.add(resolveLimit(filter.limit, 'filter.limit'));

    const rows = await this.rows(
      `SELECT ${PROJECT_SESSION_COLUMNS},
              counts.checkpoint_count,
              counts.item_count
         FROM session
         JOIN actor AS session_actor
           ON session_actor.workspace_id = session.workspace_id
          AND session_actor.id = session.actor_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS checkpoint_count,
                  COALESCE(SUM(visible.item_count), 0)::int AS item_count
             FROM checkpoint
             LEFT JOIN LATERAL (
               SELECT COUNT(*)::int AS item_count
                 FROM checkpoint_item
                 JOIN context_item
                   ON context_item.workspace_id = checkpoint_item.workspace_id
                  AND context_item.id = checkpoint_item.item_id
                WHERE checkpoint_item.workspace_id = checkpoint.workspace_id
                  AND checkpoint_item.checkpoint_id = checkpoint.id
                  AND ${visibility.sql}
             ) AS visible ON TRUE
            WHERE checkpoint.workspace_id = session.workspace_id
              AND checkpoint.session_id = session.id
         ) AS counts ON TRUE
        WHERE session.workspace_id = ${workspace}
          AND session.project_id = ${project}
        ORDER BY session.started_at DESC, session.id DESC
        LIMIT ${limit}`,
      params.list(),
    );

    return rows.map((row) => ({
      session: toSession(row),
      actor: {
        id: toUuid(row, 'session_actor_id'),
        workspaceId: toUuid(row, 'session_actor_workspace_id'),
        kind: toEnum(row, 'session_actor_kind', ACTOR_KINDS),
        displayName: toText(row, 'session_actor_display_name'),
        externalRef: toNullableText(row, 'session_actor_external_ref'),
        createdAt: toDate(row, 'session_actor_created_at'),
      },
      checkpointCount: toNumber(row, 'checkpoint_count'),
      itemCount: toNumber(row, 'item_count'),
    }));
  }

  async recordConflict(conflict: NewConflict): Promise<Conflict> {
    assertUuid(conflict.projectId, 'conflict.projectId');
    assertUuid(conflict.itemA, 'conflict.itemA');
    assertUuid(conflict.itemB, 'conflict.itemB');
    if (conflict.itemA === conflict.itemB) {
      throw new StoreError(
        'invalid_argument',
        `expected conflict.itemA and conflict.itemB to name different context items; both are ${conflict.itemA}`,
      );
    }
    const id = assertOptionalUuid(conflict.id, 'conflict.id');

    const rows = await this.rows(
      `INSERT INTO conflict (id, workspace_id, project_id, item_a, item_b)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5)
       RETURNING ${CONFLICT_COLUMNS}`,
      [id, this.scope.workspaceId, conflict.projectId, conflict.itemA, conflict.itemB],
    );
    return toConflict(expectOne(rows, `recording a conflict on project ${conflict.projectId}`));
  }

  async listOpenConflicts(projectId: Uuid): Promise<readonly Conflict[]> {
    assertUuid(projectId, 'projectId');
    const rows = await this.rows(
      `SELECT ${CONFLICT_COLUMNS}
         FROM conflict
        WHERE workspace_id = $1 AND project_id = $2 AND resolved_at IS NULL
        ORDER BY detected_at DESC, id DESC`,
      [this.scope.workspaceId, projectId],
    );
    return rows.map(toConflict);
  }

  async resolveConflict(input: ConflictResolutionInput): Promise<Conflict> {
    assertUuid(input.conflictId, 'input.conflictId');
    assertUuid(input.resolvedBy, 'input.resolvedBy');
    if (typeof input.rationale !== 'string' || input.rationale.trim() === '') {
      throw new StoreError(
        'invalid_argument',
        `expected input.rationale to record why conflict ${input.conflictId} was resolved as ${input.resolution}; received none — ` +
          'which side a human chose is derivable, but why they chose it is not, and §17 collects both',
      );
    }

    return this.atomic(`resolving conflict ${input.conflictId}`, async () => {
      const rows = await this.rows(
        `SELECT ${CONFLICT_COLUMNS} FROM conflict WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [this.scope.workspaceId, input.conflictId],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new StoreError(
          'not_found',
          `expected conflict ${input.conflictId} in workspace ${this.scope.workspaceId}; found none`,
        );
      }

      const existing = toConflict(row);
      if (existing.resolvedAt !== null) {
        throw new StoreError(
          'already_resolved',
          `expected conflict ${input.conflictId} to be open; it was resolved at ${existing.resolvedAt.toISOString()} as ${existing.resolution ?? 'unknown'}`,
        );
      }

      const updated = await this.rows(
        `UPDATE conflict
            SET resolved_at = now(), resolved_by = $1, resolution = $2, rationale = $3
          WHERE workspace_id = $4 AND id = $5
          RETURNING ${CONFLICT_COLUMNS}`,
        [
          input.resolvedBy,
          input.resolution,
          input.rationale.trim(),
          this.scope.workspaceId,
          input.conflictId,
        ],
      );
      return toConflict(expectOne(updated, `resolving conflict ${input.conflictId}`));
    });
  }
}

export class PostgresStoreAdapter implements StoreAdapter {
  constructor(private readonly source: PostgresConnectionSource) {}

  async withScope<T>(
    scope: WorkspaceScope,
    run: (store: ReviewCapableStore) => Promise<T>,
  ): Promise<T> {
    assertUuid(scope.workspaceId, 'scope.workspaceId');
    assertUuid(scope.actorId, 'scope.actorId');

    const session = await this.source.acquire();
    const store = new PostgresScopedStore(session, scope);
    let discardSession = false;

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      try {
        await session.execute('SELECT set_config($1, $2, true)', [
          WORKSPACE_SETTING,
          scope.workspaceId,
        ]);
        const result = await run(store);
        await session.execute('COMMIT');
        return result;
      } catch (error) {
        try {
          await session.execute('ROLLBACK');
        } catch (rollbackError) {
          discardSession = true;
          throw new StoreError(
            'rollback_failed',
            `the transaction for workspace ${scope.workspaceId} failed with "${describeCause(error)}" and the rollback failed too; the connection is unusable`,
            { cause: rollbackError },
          );
        }
        throw error;
      }
    } finally {
      store.detach();
      if (discardSession) {
        await session.discard();
      } else {
        await session.release();
      }
    }
  }

  async close(): Promise<void> {
    await this.source.close();
  }
}
