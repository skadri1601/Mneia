import type {
  Actor,
  Checkpoint,
  CheckpointItem,
  Conflict,
  ContextItem,
  Embedding,
  Handoff,
  Project,
  Session,
  Uuid,
} from '../../domain/types.js';
import type { SqlExecutor, SqlValue } from '../driver.js';
import { EMBEDDING_DIMENSIONS, WORKSPACE_SETTING } from '../schema.js';
import { visibilityPredicate } from '../scope.js';
import type { SqlRow } from './rows.js';
import {
  embeddingLiteral,
  isUuid,
  toActor,
  toCheckpoint,
  toCheckpointItem,
  toConflict,
  toContextItem,
  toHandoff,
  toProject,
  toSession,
  toUuid,
} from './rows.js';
import type {
  CheckpointWrite,
  CheckpointWriteResult,
  ConflictResolutionInput,
  ContextItemFilter,
  ContextItemSearch,
  NewConflict,
  NewContextItem,
  NewHandoff,
  ScopedStore,
  StoreAdapter,
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
const SESSION_COLUMNS = 'id, workspace_id, project_id, actor_id, tool, started_at, ended_at';
const CHECKPOINT_COLUMNS =
  'id, workspace_id, project_id, session_id, actor_id, "trigger", created_at, summary';
const CHECKPOINT_ITEM_COLUMNS = 'workspace_id, checkpoint_id, item_id, action';
const HANDOFF_COLUMNS =
  'id, workspace_id, project_id, from_actor, to_actor, created_at, received_at, next_action, rendered';
const CONFLICT_COLUMNS =
  'id, workspace_id, project_id, item_a, item_b, detected_at, resolved_at, resolved_by, resolution';
const CONTEXT_ITEM_COLUMNS = `id, workspace_id, project_id, kind, title, body, status,
       asserted_by, asserted_at, source_session_id, source_ref,
       confidence, human_confirmed, load_bearing, last_verified_at,
       (EXTRACT(EPOCH FROM decay_after) * 1000)::double precision AS decay_after,
       valid_from, valid_to, supersedes_id, superseded_by_id,
       access_scope, embedding::text AS embedding`;

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

class PostgresScopedStore implements ScopedStore {
  private attached = true;
  private savepoints = 0;
  private teamIds: readonly Uuid[] | null = null;

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

  private async actorTeamIds(): Promise<readonly Uuid[]> {
    if (this.teamIds === null) {
      const rows = await this.rows(
        'SELECT team_id FROM team_member WHERE workspace_id = $1 AND actor_id = $2',
        [this.scope.workspaceId, this.scope.actorId],
      );
      this.teamIds = rows.map((row) => toUuid(row, 'team_id'));
    }
    return this.teamIds;
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

  async createSession(projectId: Uuid, tool: string | null): Promise<Session> {
    assertUuid(projectId, 'projectId');
    const rows = await this.rows(
      `INSERT INTO session (id, workspace_id, project_id, actor_id, tool, started_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
       RETURNING ${SESSION_COLUMNS}`,
      [this.scope.workspaceId, projectId, this.scope.actorId, tool],
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
    });
    params.addAll(visibility.params);

    const rows = await this.rows(
      `SELECT ${CONTEXT_ITEM_COLUMNS}
         FROM context_item
        WHERE workspace_id = ${workspace} AND id = ${item} AND (${visibility.sql})`,
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

  private async selectContextItems(search: ContextItemSearch): Promise<readonly ContextItem[]> {
    assertUuid(search.projectId, 'filter.projectId');

    const params = new SqlParams();
    const conditions = [
      `workspace_id = ${params.add(this.scope.workspaceId)}`,
      `project_id = ${params.add(search.projectId)}`,
    ];

    const visibility = visibilityPredicate({
      scope: this.scope,
      actorTeamIds: await this.actorTeamIds(),
      projectId: search.projectId,
      paramOffset: params.length,
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
      conditions.push(`kind IN (${search.kinds.map((kind) => params.add(kind)).join(', ')})`);
    }

    if (search.statuses !== undefined) {
      if (search.statuses.length === 0) {
        throw new StoreError(
          'invalid_argument',
          'expected filter.statuses to name at least one item status; received an empty array — omit the field to accept every status',
        );
      }
      conditions.push(
        `status IN (${search.statuses.map((status) => params.add(status)).join(', ')})`,
      );
    }

    if (search.loadBearing !== undefined) {
      conditions.push(`load_bearing = ${params.add(search.loadBearing)}`);
    }

    if (search.asOf !== undefined) {
      const asOf = params.add(search.asOf);
      conditions.push(`valid_from <= ${asOf}`);
      conditions.push(`(valid_to IS NULL OR valid_to > ${asOf})`);
    }

    if (search.text !== undefined && search.text.trim() !== '') {
      const pattern = params.add(`%${escapeLike(search.text.trim())}%`);
      conditions.push(`(title ILIKE ${pattern} ESCAPE '\\' OR body ILIKE ${pattern} ESCAPE '\\')`);
    }

    let ordering = 'asserted_at DESC, id DESC';
    if (search.embedding !== undefined) {
      assertEmbedding(search.embedding, 'search.embedding');
      conditions.push('embedding IS NOT NULL');
      ordering = `embedding <=> ${params.add(embeddingLiteral(search.embedding))}::vector`;
    }

    const limit = params.add(resolveLimit(search.limit, 'filter.limit'));

    const rows = await this.rows(
      `SELECT ${CONTEXT_ITEM_COLUMNS}
         FROM context_item
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

    return this.atomic(`inserting a context item superseding ${item.supersedesId}`, async () => {
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
    assertUuid(item.assertedBy, 'item.assertedBy');
    assertNonEmpty(item.title, 'item.title');
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
    const embeddingValue =
      embedding === null ? null : embeddingLiteral(assertEmbedding(embedding, 'item.embedding'));

    const params = new SqlParams();
    const values = [
      `COALESCE(${params.add(id)}::uuid, gen_random_uuid())`,
      params.add(this.scope.workspaceId),
      params.add(item.projectId),
      params.add(item.kind),
      params.add(item.title),
      params.add(item.body ?? null),
      params.add(item.assertedBy),
      params.add(sourceSessionId),
      params.add(item.sourceRef ?? null),
      params.add(confidence),
      params.add(item.humanConfirmed ?? false),
      params.add(item.loadBearing ?? false),
      params.add(item.accessScope ?? DEFAULT_ACCESS_SCOPE),
      `${params.add(embeddingValue)}::vector`,
      params.add(supersedesId),
    ];

    const rows = await this.rows(
      `INSERT INTO context_item (
         id, workspace_id, project_id, kind, title, body,
         asserted_by, source_session_id, source_ref,
         confidence, human_confirmed, load_bearing,
         access_scope, embedding, supersedes_id)
       VALUES (${values.join(', ')})
       RETURNING ${CONTEXT_ITEM_COLUMNS}`,
      params.list(),
    );

    return expectOne(rows, `inserting a context item into project ${item.projectId}`);
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
      const previous = await this.rows(
        'SELECT id FROM context_item WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [this.scope.workspaceId, previousId],
      );
      if (previous[0] === undefined) {
        throw new StoreError(
          'not_found',
          `expected context item ${previousId} in workspace ${this.scope.workspaceId} to supersede; found none`,
        );
      }

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
          `INSERT INTO checkpoint (id, workspace_id, project_id, session_id, actor_id, "trigger", summary)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7)
           RETURNING ${CHECKPOINT_COLUMNS}`,
          [
            id,
            this.scope.workspaceId,
            checkpoint.projectId,
            sessionId,
            checkpoint.actorId,
            checkpoint.trigger,
            checkpoint.summary ?? null,
          ],
        ),
        `inserting the checkpoint row for project ${checkpoint.projectId}`,
      );

      const created = toCheckpoint(checkpointRow);
      const written: ContextItem[] = [];
      const links: CheckpointItem[] = [];

      for (const entry of items) {
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
      }

      return { checkpoint: created, items: links, written };
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
    return toHandoff(expectOne(rows, `creating a handoff on project ${handoff.projectId}`));
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
            SET resolved_at = now(), resolved_by = $1, resolution = $2
          WHERE workspace_id = $3 AND id = $4
          RETURNING ${CONFLICT_COLUMNS}`,
        [input.resolvedBy, input.resolution, this.scope.workspaceId, input.conflictId],
      );
      return toConflict(expectOne(updated, `resolving conflict ${input.conflictId}`));
    });
  }
}

export class PostgresStoreAdapter implements StoreAdapter {
  constructor(private readonly source: PostgresConnectionSource) {}

  async withScope<T>(scope: WorkspaceScope, run: (store: ScopedStore) => Promise<T>): Promise<T> {
    assertUuid(scope.workspaceId, 'scope.workspaceId');
    assertUuid(scope.actorId, 'scope.actorId');

    const session = await this.source.acquire();
    const store = new PostgresScopedStore(session, scope);
    let discardSession = false;

    try {
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
