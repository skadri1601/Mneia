import type { ContextItem, Uuid } from '../domain/types.js';
import type { WorkspaceScope } from './adapter/types.js';
import type { SqlValue } from './driver.js';
import type { AccessScope } from './schema.js';

export interface VisibilityInput {
  readonly scope: WorkspaceScope;
  readonly actorTeamIds: readonly Uuid[];
  readonly projectId: Uuid;
  readonly paramOffset: number;
  readonly itemAlias?: string;
}

export interface VisibilityFragment {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

export interface VisibilityViewer {
  readonly actorId: Uuid;
  readonly teamIds: readonly Uuid[];
  readonly projectTeamId: Uuid | null;
}

const WORKSPACE: AccessScope = 'workspace';
const PROJECT: AccessScope = 'project';
const TEAM: AccessScope = 'team';

const identifiers = (values: readonly Uuid[]): Uuid[] =>
  [...new Set(values)].filter((value) => value.length > 0);

export function visibilityPredicate(input: VisibilityInput): VisibilityFragment {
  const { scope, projectId, paramOffset } = input;

  if (!Number.isInteger(paramOffset) || paramOffset < 0) {
    throw new Error(
      `visibilityPredicate expected paramOffset to be the count of parameters already bound, a non-negative integer; received ${String(paramOffset)}`,
    );
  }
  if (scope.actorId.length === 0) {
    throw new Error(
      'visibilityPredicate expected scope.actorId to name the reading actor; received an empty string — resolve the actor before building a query',
    );
  }
  if (projectId.length === 0) {
    throw new Error(
      'visibilityPredicate expected projectId to name the project being read; received an empty string — resolve the project before building a query',
    );
  }

  const teamIds = identifiers(input.actorTeamIds);
  const params: SqlValue[] = [scope.actorId, ...teamIds];
  const placeholder = (index: number): string => `$${paramOffset + index + 1}`;

  const actorParam = placeholder(0);
  const teamParams = teamIds.map((_, index) => placeholder(index + 1));
  const itemColumn = (column: string): string =>
    input.itemAlias === undefined ? column : `${input.itemAlias}.${column}`;

  const readableProjects =
    teamParams.length > 0
      ? `SELECT id FROM project WHERE team_id IS NULL OR team_id IN (${teamParams.join(', ')})`
      : 'SELECT id FROM project WHERE team_id IS NULL';

  const disjuncts = [
    `${itemColumn('asserted_by')} = ${actorParam}`,
    `${itemColumn('access_scope')} = '${WORKSPACE}'`,
    `(${itemColumn('access_scope')} = '${PROJECT}' AND ${itemColumn('project_id')} IN (${readableProjects}))`,
  ];

  if (teamParams.length > 0) {
    disjuncts.push(
      `(${itemColumn('access_scope')} = '${TEAM}' AND ${itemColumn('project_id')} IN (SELECT id FROM project WHERE team_id IN (${teamParams.join(', ')})))`,
    );
  }

  return { sql: `(${disjuncts.join(' OR ')})`, params };
}

export function canRead(item: ContextItem, viewer: VisibilityViewer): boolean {
  if (item.assertedBy === viewer.actorId) {
    return true;
  }
  if (item.accessScope === WORKSPACE) {
    return true;
  }
  if (item.accessScope === PROJECT) {
    return viewer.projectTeamId === null || viewer.teamIds.includes(viewer.projectTeamId);
  }
  if (item.accessScope === TEAM) {
    return viewer.projectTeamId !== null && viewer.teamIds.includes(viewer.projectTeamId);
  }
  return false;
}
