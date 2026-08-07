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
  Team,
  TeamMember,
  Uuid,
  Workspace,
} from '../../domain/types.js';
import {
  ACCESS_SCOPES,
  ACTOR_KINDS,
  BILLING_STATUSES,
  CHECKPOINT_ACTIONS,
  CHECKPOINT_TRIGGERS,
  CONFLICT_RESOLUTIONS,
  ITEM_KINDS,
  ITEM_STATUSES,
  TEAM_FUNCTIONS,
  TEAM_ROLES,
  WORKSPACE_PLANS,
} from '../schema.js';

export type RowMappingErrorCode = 'missing_column' | 'unexpected_type' | 'unexpected_value';

export class RowMappingError extends Error {
  readonly code: RowMappingErrorCode;
  readonly column: string;

  constructor(code: RowMappingErrorCode, column: string, message: string) {
    super(message);
    this.name = 'RowMappingError';
    this.code = code;
    this.column = column;
  }
}

export type SqlRow = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MILLISECOND = 1;
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365.25 * DAY;

const INTERVAL_UNITS: Readonly<Record<string, number>> = {
  ms: MILLISECOND,
  msec: MILLISECOND,
  msecs: MILLISECOND,
  millisecond: MILLISECOND,
  milliseconds: MILLISECOND,
  sec: SECOND,
  secs: SECOND,
  second: SECOND,
  seconds: SECOND,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  day: DAY,
  days: DAY,
  week: WEEK,
  weeks: WEEK,
  mon: MONTH,
  mons: MONTH,
  month: MONTH,
  months: MONTH,
  yr: YEAR,
  yrs: YEAR,
  year: YEAR,
  years: YEAR,
};

const INTERVAL_PART_FIELDS: readonly (readonly [string, number])[] = [
  ['years', YEAR],
  ['months', MONTH],
  ['weeks', WEEK],
  ['days', DAY],
  ['hours', HOUR],
  ['minutes', MINUTE],
  ['seconds', SECOND],
  ['milliseconds', MILLISECOND],
];

const isRecord = (value: unknown): value is SqlRow =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const describeValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'an invalid Date' : `Date ${value.toISOString()}`;
  }
  if (Array.isArray(value)) return `an array of length ${value.length}`;
  if (typeof value === 'string') return `string ${JSON.stringify(value)}`;
  if (typeof value === 'object') return `object with keys [${Object.keys(value).join(', ')}]`;
  return `${typeof value} ${String(value)}`;
};

const readColumn = (row: SqlRow, column: string): unknown => {
  if (!(column in row)) {
    throw new RowMappingError(
      'missing_column',
      column,
      `expected column "${column}" in the result row; received columns [${Object.keys(row).join(', ')}]`,
    );
  }
  return row[column];
};

const isAbsent = (value: unknown): boolean => value === null || value === undefined;

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const isUuid = (value: unknown): value is Uuid =>
  typeof value === 'string' && UUID_PATTERN.test(value);

export const toUuid = (row: SqlRow, column: string): Uuid => {
  const value = readColumn(row, column);
  if (!isUuid(value)) {
    throw new RowMappingError(
      'unexpected_value',
      column,
      `expected column "${column}" to be a UUID; received ${describeValue(value)}`,
    );
  }
  return value;
};

export const toNullableUuid = (row: SqlRow, column: string): Uuid | null => {
  const value = readColumn(row, column);
  return isAbsent(value) ? null : toUuid(row, column);
};

export const toText = (row: SqlRow, column: string): string => {
  const value = readColumn(row, column);
  if (typeof value !== 'string') {
    throw new RowMappingError(
      'unexpected_type',
      column,
      `expected column "${column}" to be text; received ${describeValue(value)}`,
    );
  }
  return value;
};

export const toNullableText = (row: SqlRow, column: string): string | null => {
  const value = readColumn(row, column);
  return isAbsent(value) ? null : toText(row, column);
};

export const toBoolean = (row: SqlRow, column: string): boolean => {
  const value = readColumn(row, column);
  if (typeof value === 'boolean') return value;
  if (value === 't' || value === 'true') return true;
  if (value === 'f' || value === 'false') return false;
  throw new RowMappingError(
    'unexpected_type',
    column,
    `expected column "${column}" to be a boolean; received ${describeValue(value)}`,
  );
};

export const toNumber = (row: SqlRow, column: string): number => {
  const value = readColumn(row, column);
  const parsed = finiteNumber(value);
  if (parsed === null) {
    throw new RowMappingError(
      'unexpected_type',
      column,
      `expected column "${column}" to be a finite number; received ${describeValue(value)}`,
    );
  }
  return parsed;
};

export const toNullableNumber = (row: SqlRow, column: string): number | null => {
  const value = readColumn(row, column);
  if (isAbsent(value)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RowMappingError(
      'unexpected_type',
      column,
      `expected column "${column}" to be a finite number; received ${describeValue(value)}`,
    );
  }
  return value;
};

export const toDate = (row: SqlRow, column: string): Date => {
  const value = readColumn(row, column);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RowMappingError(
        'unexpected_value',
        column,
        `expected column "${column}" to be a valid timestamp; received an invalid Date`,
      );
    }
    return value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new RowMappingError(
        'unexpected_value',
        column,
        `expected column "${column}" to be a parseable timestamp; received ${describeValue(value)}`,
      );
    }
    return parsed;
  }
  throw new RowMappingError(
    'unexpected_type',
    column,
    `expected column "${column}" to be a timestamp; received ${describeValue(value)}`,
  );
};

export const toNullableDate = (row: SqlRow, column: string): Date | null => {
  const value = readColumn(row, column);
  return isAbsent(value) ? null : toDate(row, column);
};

export const toEnum = <T extends string>(row: SqlRow, column: string, allowed: readonly T[]): T => {
  const value = readColumn(row, column);
  if (typeof value === 'string') {
    const match = allowed.find((candidate) => candidate === value);
    if (match !== undefined) return match;
  }
  throw new RowMappingError(
    'unexpected_value',
    column,
    `expected column "${column}" to be one of [${allowed.join(', ')}]; received ${describeValue(value)}`,
  );
};

export const toNullableEnum = <T extends string>(
  row: SqlRow,
  column: string,
  allowed: readonly T[],
): T | null => {
  const value = readColumn(row, column);
  return isAbsent(value) ? null : toEnum(row, column, allowed);
};

const parseIntervalText = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  let total = 0;
  let matched = false;

  for (const part of trimmed.matchAll(/(-?\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
    const amount = finiteNumber(part[1]);
    const unit = part[2]?.toLowerCase();
    if (amount === null || unit === undefined) return null;
    const scale = INTERVAL_UNITS[unit];
    if (scale === undefined) return null;
    total += amount * scale;
    matched = true;
  }

  const clock = /(-)?(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)/.exec(trimmed);
  if (clock !== null) {
    const hours = finiteNumber(clock[2]);
    const minutes = finiteNumber(clock[3]);
    const seconds = finiteNumber(clock[4]);
    if (hours === null || minutes === null || seconds === null) return null;
    const magnitude = hours * HOUR + minutes * MINUTE + seconds * SECOND;
    total += clock[1] === '-' ? -magnitude : magnitude;
    matched = true;
  }

  return matched ? total : null;
};

const partsToMilliseconds = (parts: SqlRow, column: string): number => {
  let total = 0;
  let matched = false;

  for (const [field, scale] of INTERVAL_PART_FIELDS) {
    if (!(field in parts)) continue;
    const raw = parts[field];
    if (isAbsent(raw)) continue;
    const amount = finiteNumber(raw);
    if (amount === null) {
      throw new RowMappingError(
        'unexpected_type',
        column,
        `expected the "${field}" field of interval column "${column}" to be a finite number; received ${describeValue(raw)}`,
      );
    }
    total += amount * scale;
    matched = true;
  }

  if (!matched) {
    throw new RowMappingError(
      'unexpected_value',
      column,
      `expected interval column "${column}" to carry at least one of [${INTERVAL_PART_FIELDS.map(
        ([field]) => field,
      ).join(', ')}]; received object with keys [${Object.keys(parts).join(', ')}]`,
    );
  }

  return total;
};

export const toIntervalMs = (row: SqlRow, column: string): IntervalMs | null => {
  const value = readColumn(row, column);
  if (isAbsent(value)) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RowMappingError(
        'unexpected_value',
        column,
        `expected interval column "${column}" to be a finite number of milliseconds; received ${describeValue(value)}`,
      );
    }
    return value;
  }

  if (typeof value === 'string') {
    const numeric = finiteNumber(value);
    if (numeric !== null) return numeric;
    const parsed = parseIntervalText(value);
    if (parsed !== null) return parsed;
    throw new RowMappingError(
      'unexpected_value',
      column,
      `expected interval column "${column}" to be milliseconds or Postgres interval text; received ${describeValue(value)}`,
    );
  }

  if (isRecord(value)) return partsToMilliseconds(value, column);

  throw new RowMappingError(
    'unexpected_type',
    column,
    `expected interval column "${column}" to be a number, interval text, or an interval object; received ${describeValue(value)}`,
  );
};

export const intervalLiteral = (milliseconds: IntervalMs): string => {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) {
    throw new RowMappingError(
      'unexpected_value',
      'interval',
      `expected an interval expressed as a finite number of milliseconds; received ${describeValue(milliseconds)}`,
    );
  }
  return `${milliseconds} milliseconds`;
};

const embeddingComponent = (value: unknown, column: string, index: number): number => {
  const parsed = finiteNumber(value);
  if (parsed === null) {
    throw new RowMappingError(
      'unexpected_value',
      column,
      `expected every component of vector column "${column}" to be a finite number; component ${index} is ${describeValue(value)}`,
    );
  }
  return parsed;
};

export const toOptionalEmbedding = (row: SqlRow, column: string): Embedding | null =>
  column in row ? toEmbedding(row, column) : null;

export const toEmbedding = (row: SqlRow, column: string): Embedding | null => {
  const value = readColumn(row, column);
  if (isAbsent(value)) return null;

  if (Array.isArray(value)) {
    return value.map((component, index) => embeddingComponent(component, column, index));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
      throw new RowMappingError(
        'unexpected_value',
        column,
        `expected vector column "${column}" to be formatted as [n,n,...]; received ${describeValue(value)}`,
      );
    }
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return [];
    return inner
      .split(',')
      .map((component, index) => embeddingComponent(component.trim(), column, index));
  }

  throw new RowMappingError(
    'unexpected_type',
    column,
    `expected vector column "${column}" to be an array or [n,n,...] text; received ${describeValue(value)}`,
  );
};

export const embeddingLiteral = (embedding: Embedding): string => {
  const components = embedding.map((component, index) => {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new RowMappingError(
        'unexpected_value',
        'embedding',
        `expected every embedding component to be a finite number; component ${index} is ${describeValue(component)}`,
      );
    }
    return String(component);
  });
  return `[${components.join(',')}]`;
};

export const toWorkspace = (row: SqlRow): Workspace => ({
  id: toUuid(row, 'id'),
  slug: toText(row, 'slug'),
  displayName: toText(row, 'display_name'),
  plan: toEnum(row, 'plan', WORKSPACE_PLANS),
  billingStatus: toEnum(row, 'billing_status', BILLING_STATUSES),
  billingCustomerRef: toNullableText(row, 'billing_customer_ref'),
  seatsPurchased: toNullableNumber(row, 'seats_purchased'),
  checkpointAllowance: toNullableNumber(row, 'checkpoint_allowance'),
  trialEndsAt: toNullableDate(row, 'trial_ends_at'),
  createdAt: toDate(row, 'created_at'),
});

export const toActor = (row: SqlRow): Actor => ({
  id: toUuid(row, 'id'),
  workspaceId: toUuid(row, 'workspace_id'),
  kind: toEnum(row, 'kind', ACTOR_KINDS),
  displayName: toText(row, 'display_name'),
  externalRef: toNullableText(row, 'external_ref'),
  createdAt: toDate(row, 'created_at'),
});

export const toTeam = (row: SqlRow): Team => ({
  id: toUuid(row, 'id'),
  workspaceId: toUuid(row, 'workspace_id'),
  slug: toText(row, 'slug'),
  displayName: toText(row, 'display_name'),
  function: toEnum(row, 'function', TEAM_FUNCTIONS),
  createdAt: toDate(row, 'created_at'),
});

export const toTeamMember = (row: SqlRow): TeamMember => ({
  workspaceId: toUuid(row, 'workspace_id'),
  teamId: toUuid(row, 'team_id'),
  actorId: toUuid(row, 'actor_id'),
  role: toEnum(row, 'role', TEAM_ROLES),
  addedAt: toDate(row, 'added_at'),
});

export const toProject = (row: SqlRow): Project => ({
  id: toUuid(row, 'id'),
  workspaceId: toUuid(row, 'workspace_id'),
  teamId: toNullableUuid(row, 'team_id'),
  slug: toText(row, 'slug'),
  repoUrl: toNullableText(row, 'repo_url'),
  createdAt: toDate(row, 'created_at'),
});

export const toSession = (row: SqlRow): Session => ({
  id: toUuid(row, 'id'),
  workspaceId: toUuid(row, 'workspace_id'),
  projectId: toUuid(row, 'project_id'),
  actorId: toUuid(row, 'actor_id'),
  tool: toNullableText(row, 'tool'),
  startedAt: toDate(row, 'started_at'),
  endedAt: toNullableDate(row, 'ended_at'),
});

export const toContextItem = (row: SqlRow): ContextItem => ({
  id: toUuid(row, 'id'),
  workspaceId: toUuid(row, 'workspace_id'),
  projectId: toUuid(row, 'project_id'),
  kind: toEnum(row, 'kind', ITEM_KINDS),
  title: toText(row, 'title'),
  body: toNullableText(row, 'body'),
  status: toEnum(row, 'status', ITEM_STATUSES),
  assertedBy: toUuid(row, 'asserted_by'),
  assertedAt: toDate(row, 'asserted_at'),
  sourceSessionId: toNullableUuid(row, 'source_session_id'),
  sourceRef: toNullableText(row, 'source_ref'),
  confidence: toNumber(row, 'confidence'),
  humanConfirmed: toBoolean(row, 'human_confirmed'),
  loadBearing: toBoolean(row, 'load_bearing'),
  lastVerifiedAt: toNullableDate(row, 'last_verified_at'),
  decayAfter: toIntervalMs(row, 'decay_after'),
  validFrom: toDate(row, 'valid_from'),
  validTo: toNullableDate(row, 'valid_to'),
  supersedesId: toNullableUuid(row, 'supersedes_id'),
  supersededById: toNullableUuid(row, 'superseded_by_id'),
  accessScope: toEnum(row, 'access_scope', ACCESS_SCOPES),
  embedding: toOptionalEmbedding(row, 'embedding'),
  embeddingModel: toNullableText(row, 'embedding_model'),
});

export const toCheckpoint = (row: SqlRow): Checkpoint => ({
  id: toUuid(row, 'id'),
  workspaceId: toUuid(row, 'workspace_id'),
  projectId: toUuid(row, 'project_id'),
  sessionId: toNullableUuid(row, 'session_id'),
  actorId: toUuid(row, 'actor_id'),
  trigger: toEnum(row, 'trigger', CHECKPOINT_TRIGGERS),
  createdAt: toDate(row, 'created_at'),
  summary: toNullableText(row, 'summary'),
});

export const toCheckpointItem = (row: SqlRow): CheckpointItem => ({
  workspaceId: toUuid(row, 'workspace_id'),
  checkpointId: toUuid(row, 'checkpoint_id'),
  itemId: toUuid(row, 'item_id'),
  action: toEnum(row, 'action', CHECKPOINT_ACTIONS),
});

export const toHandoff = (row: SqlRow): Handoff => ({
  id: toUuid(row, 'id'),
  workspaceId: toUuid(row, 'workspace_id'),
  projectId: toUuid(row, 'project_id'),
  fromActor: toUuid(row, 'from_actor'),
  toActor: toNullableUuid(row, 'to_actor'),
  createdAt: toDate(row, 'created_at'),
  receivedAt: toNullableDate(row, 'received_at'),
  nextAction: toText(row, 'next_action'),
  rendered: toText(row, 'rendered'),
});

export const toConflict = (row: SqlRow): Conflict => ({
  id: toUuid(row, 'id'),
  workspaceId: toUuid(row, 'workspace_id'),
  projectId: toUuid(row, 'project_id'),
  itemA: toUuid(row, 'item_a'),
  itemB: toUuid(row, 'item_b'),
  detectedAt: toDate(row, 'detected_at'),
  resolvedAt: toNullableDate(row, 'resolved_at'),
  resolvedBy: toNullableUuid(row, 'resolved_by'),
  resolution: toNullableEnum(row, 'resolution', CONFLICT_RESOLUTIONS),
});
