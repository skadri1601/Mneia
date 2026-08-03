import { describe, expect, it } from 'vitest';
import type { ContextItem } from '../domain/types.js';
import type { SqlValue } from './driver.js';
import { ACCESS_SCOPES, type AccessScope } from './schema.js';
import { canRead, type VisibilityViewer, visibilityPredicate } from './scope.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-00000000000f';
const ACTOR_AUTHOR = '11111111-1111-4111-8111-111111111111';
const ACTOR_READER = '22222222-2222-4222-8222-222222222222';
const TEAM_OWNING = '33333333-3333-4333-8333-333333333333';
const TEAM_OTHER = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const EPOCH = new Date('2026-01-01T00:00:00.000Z');

const itemAt = (accessScope: AccessScope): ContextItem => ({
  id: '66666666-6666-4666-8666-666666666666',
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  kind: 'decision',
  title: `a ${accessScope} item`,
  body: null,
  status: 'active',
  assertedBy: ACTOR_AUTHOR,
  assertedAt: EPOCH,
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.5,
  humanConfirmed: false,
  loadBearing: false,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: EPOCH,
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope,
  embedding: null,
});

interface Relationship {
  readonly name: string;
  readonly viewer: VisibilityViewer;
  readonly expected: Record<AccessScope, boolean>;
}

const RELATIONSHIPS: readonly Relationship[] = [
  {
    name: 'the asserting actor',
    viewer: { actorId: ACTOR_AUTHOR, teamIds: [TEAM_OTHER], projectTeamId: TEAM_OWNING },
    expected: { private: true, project: true, team: true, workspace: true, restricted: true },
  },
  {
    name: 'another actor reading the same project with no team',
    viewer: { actorId: ACTOR_READER, teamIds: [], projectTeamId: TEAM_OWNING },
    expected: { private: false, project: false, team: false, workspace: true, restricted: false },
  },
  {
    name: 'another actor on the owning team',
    viewer: { actorId: ACTOR_READER, teamIds: [TEAM_OWNING], projectTeamId: TEAM_OWNING },
    expected: { private: false, project: true, team: true, workspace: true, restricted: false },
  },
  {
    name: 'another actor on a different team',
    viewer: { actorId: ACTOR_READER, teamIds: [TEAM_OTHER], projectTeamId: TEAM_OWNING },
    expected: { private: false, project: false, team: false, workspace: true, restricted: false },
  },
  {
    name: 'another actor whose teams include the owning team among others',
    viewer: {
      actorId: ACTOR_READER,
      teamIds: [TEAM_OTHER, TEAM_OWNING],
      projectTeamId: TEAM_OWNING,
    },
    expected: { private: false, project: true, team: true, workspace: true, restricted: false },
  },
  {
    name: 'another actor in the workspace reading a project owned by no team',
    viewer: { actorId: ACTOR_READER, teamIds: [TEAM_OWNING], projectTeamId: null },
    expected: { private: false, project: true, team: false, workspace: true, restricted: false },
  },
];

const fragmentFor = (viewer: VisibilityViewer, paramOffset: number) =>
  visibilityPredicate({
    scope: { workspaceId: WORKSPACE_ID, actorId: viewer.actorId },
    actorTeamIds: viewer.teamIds,
    projectId: PROJECT_ID,
    paramOffset,
  });

interface ItemRow {
  readonly asserted_by: string;
  readonly access_scope: AccessScope;
  readonly project_id: string;
}

interface ProjectRow {
  readonly id: string;
  readonly team_id: string | null;
}

interface World {
  readonly item: ItemRow;
  readonly projects: readonly ProjectRow[];
}

type Resolve = (placeholder: string) => SqlValue;

function splitTopLevel(expression: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    } else if (depth === 0 && expression.startsWith(separator, index)) {
      parts.push(expression.slice(start, index));
      index += separator.length - 1;
      start = index + 1;
    }
  }
  parts.push(expression.slice(start));

  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function wrapsEntirely(expression: string): boolean {
  let depth = 0;

  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === '(') {
      depth += 1;
    } else if (expression[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index === expression.length - 1;
      }
    }
  }

  return false;
}

function stripOuterParens(expression: string): string {
  let current = expression.trim();

  while (current.startsWith('(') && current.endsWith(')') && wrapsEntirely(current)) {
    current = current.slice(1, -1).trim();
  }

  return current;
}

const PARAM_COMPARISON = /^(\w+) = (\$\d+)$/;
const LITERAL_COMPARISON = /^(\w+) = '([a-z_]+)'$/;
const TEAM_SUBQUERY = /^(\w+) IN \(SELECT id FROM project WHERE team_id IN \(([^)]*)\)\)$/;
const PROJECT_SUBQUERY =
  /^(\w+) IN \(SELECT id FROM project WHERE team_id IS NULL OR team_id IN \(([^)]*)\)\)$/;
const UNOWNED_SUBQUERY = /^(\w+) IN \(SELECT id FROM project WHERE team_id IS NULL\)$/;

function columnValue(row: ItemRow, column: string): string {
  if (column === 'asserted_by') {
    return row.asserted_by;
  }
  if (column === 'access_scope') {
    return row.access_scope;
  }
  if (column === 'project_id') {
    return row.project_id;
  }
  throw new Error(`the predicate referenced an unknown context_item column: ${column}`);
}

function captures(pattern: RegExp, atom: string): [string, string] | null {
  const match = pattern.exec(atom);
  if (match === null) {
    return null;
  }
  const [, left, right] = match;
  if (left === undefined || right === undefined) {
    return null;
  }
  return [left, right];
}

function evaluateAtom(atom: string, resolve: Resolve, world: World): boolean {
  const byParam = captures(PARAM_COMPARISON, atom);
  if (byParam !== null) {
    return columnValue(world.item, byParam[0]) === resolve(byParam[1]);
  }

  const byLiteral = captures(LITERAL_COMPARISON, atom);
  if (byLiteral !== null) {
    return columnValue(world.item, byLiteral[0]) === byLiteral[1];
  }

  const byProject = captures(PROJECT_SUBQUERY, atom);
  if (byProject !== null) {
    const teamIds = byProject[1].split(', ').map(resolve);
    const reachable = world.projects
      .filter((project) => project.team_id === null || teamIds.includes(project.team_id))
      .map((project) => project.id);
    return reachable.includes(columnValue(world.item, byProject[0]));
  }

  const byUnowned = UNOWNED_SUBQUERY.exec(atom);
  if (byUnowned !== null && byUnowned[1] !== undefined) {
    const reachable = world.projects
      .filter((project) => project.team_id === null)
      .map((project) => project.id);
    return reachable.includes(columnValue(world.item, byUnowned[1]));
  }

  const bySubquery = captures(TEAM_SUBQUERY, atom);
  if (bySubquery !== null) {
    const teamIds = bySubquery[1].split(', ').map(resolve);
    const reachable = world.projects
      .filter((project) => project.team_id !== null && teamIds.includes(project.team_id))
      .map((project) => project.id);
    return reachable.includes(columnValue(world.item, bySubquery[0]));
  }

  throw new Error(
    `the predicate emitted an expression this evaluator does not understand: ${atom}`,
  );
}

function evaluate(expression: string, resolve: Resolve, world: World): boolean {
  const normalized = stripOuterParens(expression);

  const disjuncts = splitTopLevel(normalized, ' OR ');
  if (disjuncts.length > 1) {
    return disjuncts.some((part) => evaluate(part, resolve, world));
  }

  const conjuncts = splitTopLevel(normalized, ' AND ');
  if (conjuncts.length > 1) {
    return conjuncts.every((part) => evaluate(part, resolve, world));
  }

  return evaluateAtom(normalized, resolve, world);
}

const resolverFor =
  (params: readonly SqlValue[], paramOffset: number): Resolve =>
  (placeholder) => {
    const index = Number(placeholder.slice(1)) - paramOffset - 1;
    const value = params[index];
    if (value === undefined) {
      throw new Error(
        `the predicate referenced ${placeholder}, which falls outside the ${params.length} parameters it returned at offset ${paramOffset}`,
      );
    }
    return value;
  };

const placeholdersIn = (sql: string): number[] => {
  const found = sql.match(/\$\d+/g) ?? [];
  return [...new Set(found.map((token) => Number(token.slice(1))))].sort((a, b) => a - b);
};

describe('canRead', () => {
  for (const relationship of RELATIONSHIPS) {
    for (const accessScope of ACCESS_SCOPES) {
      const verdict = relationship.expected[accessScope];

      it(`${verdict ? 'shows' : 'hides'} a ${accessScope} item ${verdict ? 'to' : 'from'} ${relationship.name}`, () => {
        expect(canRead(itemAt(accessScope), relationship.viewer)).toBe(verdict);
      });
    }
  }

  it('shows a private item to nobody but the actor who asserted it', () => {
    const item = itemAt('private');
    const stranger: VisibilityViewer = {
      actorId: ACTOR_READER,
      teamIds: [TEAM_OWNING, TEAM_OTHER],
      projectTeamId: TEAM_OWNING,
    };

    expect(canRead(item, stranger)).toBe(false);
  });

  it('fails closed on restricted items until a grant table exists', () => {
    const item = itemAt('restricted');

    for (const relationship of RELATIONSHIPS) {
      const expected = relationship.viewer.actorId === item.assertedBy;
      expect(canRead(item, relationship.viewer)).toBe(expected);
    }
  });
});

describe('visibilityPredicate parameters', () => {
  it.each([0, 1, 7, 42])('numbers placeholders from paramOffset %i upward', (paramOffset) => {
    const fragment = fragmentFor(
      { actorId: ACTOR_READER, teamIds: [TEAM_OWNING, TEAM_OTHER], projectTeamId: TEAM_OWNING },
      paramOffset,
    );

    expect(fragment.params).toEqual([ACTOR_READER, TEAM_OWNING, TEAM_OTHER]);
    expect(placeholdersIn(fragment.sql)).toEqual([
      paramOffset + 1,
      paramOffset + 2,
      paramOffset + 3,
    ]);
    expect(fragment.sql).toContain(`asserted_by = $${paramOffset + 1}`);
    expect(fragment.sql).toContain(
      `team_id IS NULL OR team_id IN ($${paramOffset + 2}, $${paramOffset + 3})`,
    );
    expect(fragment.sql).toContain(`team_id IN ($${paramOffset + 2}, $${paramOffset + 3})`);
  });

  it('binds every parameter it returns and returns every parameter it binds', () => {
    for (const paramOffset of [0, 3, 11]) {
      for (const relationship of RELATIONSHIPS) {
        const fragment = fragmentFor(relationship.viewer, paramOffset);
        const expected = fragment.params.map((_, index) => paramOffset + index + 1);

        expect(placeholdersIn(fragment.sql)).toEqual(expected);
      }
    }
  });

  it('emits no team membership test when the actor belongs to no team', () => {
    const fragment = fragmentFor(
      { actorId: ACTOR_READER, teamIds: [], projectTeamId: TEAM_OWNING },
      0,
    );

    expect(fragment.params).toEqual([ACTOR_READER]);
    expect(fragment.sql).toContain('team_id IS NULL');
    expect(fragment.sql).not.toContain('team_id IN');
    expect(fragment.sql).not.toContain('IN ()');
  });

  it('collapses duplicate and empty team ids rather than binding them twice', () => {
    const fragment = fragmentFor(
      {
        actorId: ACTOR_READER,
        teamIds: [TEAM_OWNING, TEAM_OWNING, ''],
        projectTeamId: TEAM_OWNING,
      },
      0,
    );

    expect(fragment.params).toEqual([ACTOR_READER, TEAM_OWNING]);
    expect(placeholdersIn(fragment.sql)).toEqual([1, 2]);
  });

  it('never interpolates an identifier into the sql text', () => {
    const fragment = fragmentFor(
      { actorId: ACTOR_READER, teamIds: [TEAM_OWNING, TEAM_OTHER], projectTeamId: TEAM_OWNING },
      0,
    );

    for (const value of [ACTOR_READER, PROJECT_ID, TEAM_OWNING, TEAM_OTHER]) {
      expect(fragment.sql).not.toContain(value);
    }
  });

  it('is a self-contained boolean fragment, safe to AND into a where clause', () => {
    const fragment = fragmentFor(
      { actorId: ACTOR_READER, teamIds: [TEAM_OWNING], projectTeamId: TEAM_OWNING },
      0,
    );

    expect(fragment.sql.startsWith('(')).toBe(true);
    expect(fragment.sql.endsWith(')')).toBe(true);
    expect(stripOuterParens(fragment.sql)).not.toBe(fragment.sql);
  });

  it.each([-1, 1.5, Number.NaN])('refuses a paramOffset of %s', (paramOffset) => {
    expect(() =>
      fragmentFor({ actorId: ACTOR_READER, teamIds: [], projectTeamId: null }, paramOffset),
    ).toThrow(/paramOffset/);
  });

  it('refuses to build a query for an unresolved actor or project', () => {
    expect(() =>
      visibilityPredicate({
        scope: { workspaceId: WORKSPACE_ID, actorId: '' },
        actorTeamIds: [],
        projectId: PROJECT_ID,
        paramOffset: 0,
      }),
    ).toThrow(/actorId/);

    expect(() =>
      visibilityPredicate({
        scope: { workspaceId: WORKSPACE_ID, actorId: ACTOR_READER },
        actorTeamIds: [],
        projectId: '',
        paramOffset: 0,
      }),
    ).toThrow(/projectId/);
  });
});

describe('visibilityPredicate and canRead agree', () => {
  for (const relationship of RELATIONSHIPS) {
    for (const accessScope of ACCESS_SCOPES) {
      it(`on a ${accessScope} item read by ${relationship.name}`, () => {
        const item = itemAt(accessScope);
        const world: World = {
          item: {
            asserted_by: item.assertedBy,
            access_scope: item.accessScope,
            project_id: item.projectId,
          },
          projects: [
            { id: PROJECT_ID, team_id: relationship.viewer.projectTeamId },
            { id: '77777777-7777-4777-8777-777777777777', team_id: TEAM_OTHER },
          ],
        };

        for (const paramOffset of [0, 4]) {
          const fragment = fragmentFor(relationship.viewer, paramOffset);
          const verdict = evaluate(fragment.sql, resolverFor(fragment.params, paramOffset), world);

          expect(verdict).toBe(canRead(item, relationship.viewer));
          expect(verdict).toBe(relationship.expected[accessScope]);
        }
      });
    }
  }
});
