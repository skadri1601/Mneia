import { describe, expect, it } from 'vitest';
import {
  embeddingLiteral,
  intervalLiteral,
  isUuid,
  RowMappingError,
  toActor,
  toBoolean,
  toCheckpoint,
  toCheckpointItem,
  toConflict,
  toContextItem,
  toDate,
  toEmbedding,
  toHandoff,
  toIntervalMs,
  toNullableNumber,
  toProject,
  toSession,
  toTeam,
  toTeamMember,
  toWorkspace,
} from './rows.js';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
const OTHER_ITEM = '66666666-6666-4666-8666-666666666666';
const CHECKPOINT = '77777777-7777-4777-8777-777777777777';
const TEAM = '88888888-8888-4888-8888-888888888888';
const HANDOFF = '99999999-9999-4999-8999-999999999999';
const CONFLICT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ASSERTED_AT = new Date('2026-07-31T09:00:00.000Z');
const CREATED_AT = new Date('2026-07-30T08:00:00.000Z');

const contextItemRow = (): Record<string, unknown> => ({
  id: ITEM,
  workspace_id: WORKSPACE,
  project_id: PROJECT,
  kind: 'constraint',
  title: 'RLS is mandatory',
  body: 'Ruled in MNE-172.',
  status: 'active',
  asserted_by: ACTOR,
  asserted_at: ASSERTED_AT,
  source_session_id: SESSION,
  source_ref: 'https://example.invalid/pr/1',
  confidence: 0.9,
  human_confirmed: true,
  load_bearing: true,
  last_verified_at: ASSERTED_AT,
  decay_after: 86_400_000,
  valid_from: ASSERTED_AT,
  valid_to: null,
  supersedes_id: OTHER_ITEM,
  superseded_by_id: null,
  supersede_reason: null,
  access_scope: 'workspace',
  embedding: '[0.25,-0.5,1]',
  embedding_model: 'openai:text-embedding-3-small',
  provenance_actor_id: ACTOR,
  provenance_actor_kind: 'agent',
  provenance_actor_display_name: 'Codex',
  provenance_source_session_id: SESSION,
  provenance_session_tool: 'mcp',
  provenance_client_name: 'codex',
  provenance_client_version: '1.2.3',
  provenance_client_session_ref: '019c-session',
  provenance_client_session_name: 'MNE-86 dogfood',
  provenance_client_session_url: 'https://example.invalid/sessions/019c-session',
});

describe('isUuid', () => {
  it('accepts a canonical uuid and rejects anything else', () => {
    expect(isUuid(WORKSPACE)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe('toContextItem', () => {
  it('maps every snake_case column onto its camelCase field', () => {
    expect(toContextItem(contextItemRow())).toEqual({
      id: ITEM,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      kind: 'constraint',
      title: 'RLS is mandatory',
      body: 'Ruled in MNE-172.',
      status: 'active',
      assertedBy: ACTOR,
      assertedAt: ASSERTED_AT,
      sourceSessionId: SESSION,
      sourceRef: 'https://example.invalid/pr/1',
      confidence: 0.9,
      humanConfirmed: true,
      loadBearing: true,
      lastVerifiedAt: ASSERTED_AT,
      decayAfter: 86_400_000,
      validFrom: ASSERTED_AT,
      validTo: null,
      supersedesId: OTHER_ITEM,
      supersededById: null,
      supersedeReason: null,
      accessScope: 'workspace',
      embedding: [0.25, -0.5, 1],
      embeddingModel: 'openai:text-embedding-3-small',
      provenance: {
        actorId: ACTOR,
        actorKind: 'agent',
        actorDisplayName: 'Codex',
        sourceSessionId: SESSION,
        sessionTool: 'mcp',
        clientName: 'codex',
        clientVersion: '1.2.3',
        clientSessionRef: '019c-session',
        clientSessionName: 'MNE-86 dogfood',
        clientSessionUrl: 'https://example.invalid/sessions/019c-session',
        status: 'complete',
        missingFields: [],
      },
    });
  });

  it('maps every nullable column to null', () => {
    const item = toContextItem({
      ...contextItemRow(),
      body: null,
      source_session_id: null,
      source_ref: null,
      last_verified_at: null,
      decay_after: null,
      valid_to: null,
      supersedes_id: null,
      superseded_by_id: null,
      supersede_reason: null,
      embedding: null,
      embedding_model: null,
    });

    expect(item.body).toBeNull();
    expect(item.sourceSessionId).toBeNull();
    expect(item.sourceRef).toBeNull();
    expect(item.lastVerifiedAt).toBeNull();
    expect(item.decayAfter).toBeNull();
    expect(item.validTo).toBeNull();
    expect(item.supersedesId).toBeNull();
    expect(item.supersededById).toBeNull();
    expect(item.embedding).toBeNull();
    expect(item.embeddingModel).toBeNull();
  });

  it('marks legacy rows without a source session as partial and names every missing field', () => {
    const item = toContextItem({
      ...contextItemRow(),
      source_session_id: null,
      provenance_source_session_id: null,
      provenance_session_tool: null,
      provenance_client_name: null,
      provenance_client_version: null,
      provenance_client_session_ref: null,
      provenance_client_session_name: null,
      provenance_client_session_url: null,
    });

    expect(item.provenance).toEqual({
      actorId: ACTOR,
      actorKind: 'agent',
      actorDisplayName: 'Codex',
      sourceSessionId: null,
      sessionTool: null,
      clientName: null,
      clientVersion: null,
      clientSessionRef: null,
      clientSessionName: null,
      clientSessionUrl: null,
      status: 'partial',
      missingFields: [
        'sourceSessionId',
        'sessionTool',
        'clientName',
        'clientVersion',
        'clientSessionRef',
        'clientSessionName',
        'clientSessionUrl',
      ],
    });
  });

  it('names the missing column when a select forgets one', () => {
    const row = contextItemRow();
    delete row.load_bearing;

    const error = (() => {
      try {
        toContextItem(row);
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(RowMappingError);
    expect((error as RowMappingError).code).toBe('missing_column');
    expect((error as RowMappingError).column).toBe('load_bearing');
    expect((error as Error).message).toContain('expected column "load_bearing"');
  });

  it('names the allowed values when an enum column carries something unknown', () => {
    expect(() => toContextItem({ ...contextItemRow(), status: 'archived' })).toThrow(
      /expected column "status" to be one of \[active, superseded, disputed, retired\]; received string "archived"/,
    );
  });

  it('refuses a non-uuid primary key rather than passing it through', () => {
    expect(() => toContextItem({ ...contextItemRow(), id: 'item-1' })).toThrow(
      /expected column "id" to be a UUID; received string "item-1"/,
    );
  });
});

describe('toActor, toProject and toSession', () => {
  it('maps an actor row', () => {
    expect(
      toActor({
        id: ACTOR,
        workspace_id: WORKSPACE,
        kind: 'agent',
        display_name: 'claude-code',
        external_ref: 'claude-code@opus-5',
        created_at: CREATED_AT,
      }),
    ).toEqual({
      id: ACTOR,
      workspaceId: WORKSPACE,
      kind: 'agent',
      displayName: 'claude-code',
      externalRef: 'claude-code@opus-5',
      createdAt: CREATED_AT,
    });
  });

  it('maps a project row and keeps a repo-less project valid', () => {
    expect(
      toProject({
        id: PROJECT,
        workspace_id: WORKSPACE,
        team_id: null,
        slug: 'q3-enterprise-motion',
        repo_url: null,
        created_at: CREATED_AT,
      }),
    ).toEqual({
      id: PROJECT,
      workspaceId: WORKSPACE,
      teamId: null,
      slug: 'q3-enterprise-motion',
      repoUrl: null,
      createdAt: CREATED_AT,
    });
  });

  it('maps a session row with a team-owned project and an open end time', () => {
    expect(
      toSession({
        id: SESSION,
        workspace_id: WORKSPACE,
        project_id: PROJECT,
        actor_id: ACTOR,
        tool: 'claude-code',
        client_name: 'claude-code',
        client_version: '1.0.90',
        client_session_ref: 'session-ref',
        client_session_name: 'MNE-86 dogfood',
        client_session_url: 'https://claude.ai/code/session-ref',
        started_at: CREATED_AT,
        ended_at: null,
      }),
    ).toEqual({
      id: SESSION,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      actorId: ACTOR,
      tool: 'claude-code',
      clientName: 'claude-code',
      clientVersion: '1.0.90',
      clientSessionRef: 'session-ref',
      clientSessionName: 'MNE-86 dogfood',
      clientSessionUrl: 'https://claude.ai/code/session-ref',
      startedAt: CREATED_AT,
      endedAt: null,
    });
    expect(isUuid(TEAM)).toBe(true);
  });
});

describe('toWorkspace', () => {
  const workspaceRow = (): Record<string, unknown> => ({
    id: WORKSPACE,
    slug: 'workspace-11111111-1111-4111-8111-111111111111',
    display_name: 'Ada Lovelace',
    plan: 'solo',
    billing_status: 'trialing',
    billing_customer_ref: 'cus_123',
    seats_purchased: 3,
    checkpoint_allowance: 1_000,
    trial_ends_at: ASSERTED_AT,
    created_at: CREATED_AT,
  });

  it('maps a workspace row', () => {
    expect(toWorkspace(workspaceRow())).toEqual({
      id: WORKSPACE,
      slug: 'workspace-11111111-1111-4111-8111-111111111111',
      displayName: 'Ada Lovelace',
      plan: 'solo',
      billingStatus: 'trialing',
      billingCustomerRef: 'cus_123',
      seatsPurchased: 3,
      checkpointAllowance: 1_000,
      trialEndsAt: ASSERTED_AT,
      createdAt: CREATED_AT,
    });
  });

  it('maps every nullable billing column to null', () => {
    expect(
      toWorkspace({
        ...workspaceRow(),
        billing_customer_ref: null,
        seats_purchased: null,
        checkpoint_allowance: null,
        trial_ends_at: null,
      }),
    ).toMatchObject({
      billingCustomerRef: null,
      seatsPurchased: null,
      checkpointAllowance: null,
      trialEndsAt: null,
    });
  });

  it('rejects an unknown workspace plan', () => {
    expect(() => toWorkspace({ ...workspaceRow(), plan: 'starter' })).toThrow(
      /expected column "plan" to be one of \[solo, pro, team, enterprise\]/,
    );
  });

  it('rejects an unknown billing status', () => {
    expect(() => toWorkspace({ ...workspaceRow(), billing_status: 'paused' })).toThrow(
      /expected column "billing_status" to be one of \[active, trialing, past_due, canceled\]/,
    );
  });
});

describe('toTeam', () => {
  const teamRow = (): Record<string, unknown> => ({
    id: TEAM,
    workspace_id: WORKSPACE,
    slug: 'default',
    display_name: 'Default',
    function: 'engineering',
    created_at: CREATED_AT,
  });

  it('maps a team row', () => {
    expect(toTeam(teamRow())).toEqual({
      id: TEAM,
      workspaceId: WORKSPACE,
      slug: 'default',
      displayName: 'Default',
      function: 'engineering',
      createdAt: CREATED_AT,
    });
  });

  it('rejects an unknown team function', () => {
    expect(() => toTeam({ ...teamRow(), function: 'research' })).toThrow(
      /expected column "function" to be one of \[engineering, product, design, sales, marketing, support, success, operations, finance, other\]/,
    );
  });
});

describe('toTeamMember', () => {
  const teamMemberRow = (): Record<string, unknown> => ({
    workspace_id: WORKSPACE,
    team_id: TEAM,
    actor_id: ACTOR,
    role: 'lead',
    added_at: CREATED_AT,
  });

  it('maps a team membership row', () => {
    expect(toTeamMember(teamMemberRow())).toEqual({
      workspaceId: WORKSPACE,
      teamId: TEAM,
      actorId: ACTOR,
      role: 'lead',
      addedAt: CREATED_AT,
    });
  });

  it('rejects an unknown team role', () => {
    expect(() => toTeamMember({ ...teamMemberRow(), role: 'owner' })).toThrow(
      /expected column "role" to be one of \[lead, member\]/,
    );
  });
});

describe('toCheckpoint, toCheckpointItem, toHandoff and toConflict', () => {
  it('maps a checkpoint row', () => {
    expect(
      toCheckpoint({
        id: CHECKPOINT,
        workspace_id: WORKSPACE,
        project_id: PROJECT,
        session_id: SESSION,
        actor_id: ACTOR,
        trigger: 'task_boundary',
        created_at: CREATED_AT,
        summary: 'closed out MNE-44',
      }),
    ).toEqual({
      id: CHECKPOINT,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      sessionId: SESSION,
      actorId: ACTOR,
      trigger: 'task_boundary',
      createdAt: CREATED_AT,
      summary: 'closed out MNE-44',
    });
  });

  it('maps a checkpoint_item link row', () => {
    expect(
      toCheckpointItem({
        workspace_id: WORKSPACE,
        checkpoint_id: CHECKPOINT,
        item_id: ITEM,
        action: 'superseded',
      }),
    ).toEqual({
      workspaceId: WORKSPACE,
      checkpointId: CHECKPOINT,
      itemId: ITEM,
      action: 'superseded',
    });
  });

  it('maps an open handoff, which has no receiver yet', () => {
    expect(
      toHandoff({
        id: HANDOFF,
        workspace_id: WORKSPACE,
        project_id: PROJECT,
        from_actor: ACTOR,
        to_actor: null,
        created_at: CREATED_AT,
        received_at: null,
        next_action: 'land migration 0006',
        rendered: '# Handoff',
      }),
    ).toEqual({
      id: HANDOFF,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      fromActor: ACTOR,
      toActor: null,
      createdAt: CREATED_AT,
      receivedAt: null,
      nextAction: 'land migration 0006',
      rendered: '# Handoff',
    });
  });

  it('maps an unresolved conflict with a null resolution', () => {
    expect(
      toConflict({
        id: CONFLICT,
        workspace_id: WORKSPACE,
        project_id: PROJECT,
        item_a: ITEM,
        item_b: OTHER_ITEM,
        detected_at: CREATED_AT,
        resolved_at: null,
        resolved_by: null,
        resolution: null,
        rationale: null,
      }),
    ).toEqual({
      id: CONFLICT,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      itemA: ITEM,
      itemB: OTHER_ITEM,
      detectedAt: CREATED_AT,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
      rationale: null,
    });
  });

  it('maps a resolved conflict', () => {
    const conflict = toConflict({
      id: CONFLICT,
      workspace_id: WORKSPACE,
      project_id: PROJECT,
      item_a: ITEM,
      item_b: OTHER_ITEM,
      detected_at: CREATED_AT,
      resolved_at: ASSERTED_AT,
      resolved_by: ACTOR,
      resolution: 'a_wins',
      rationale: 'the human constraint wins',
    });

    expect(conflict.resolvedAt).toEqual(ASSERTED_AT);
    expect(conflict.resolvedBy).toBe(ACTOR);
    expect(conflict.resolution).toBe('a_wins');
    expect(conflict.rationale).toBe('the human constraint wins');
  });
});

describe('interval conversion', () => {
  it('returns null for a null or undefined interval', () => {
    expect(toIntervalMs({ decay_after: null }, 'decay_after')).toBeNull();
    expect(toIntervalMs({ decay_after: undefined }, 'decay_after')).toBeNull();
  });

  it('accepts milliseconds already reduced to a number by the driver', () => {
    expect(toIntervalMs({ decay_after: 90_000 }, 'decay_after')).toBe(90_000);
    expect(toIntervalMs({ decay_after: 0 }, 'decay_after')).toBe(0);
  });

  it('accepts the numeric string a driver returns for EXTRACT(EPOCH ...) * 1000', () => {
    expect(toIntervalMs({ decay_after: '90000.000000' }, 'decay_after')).toBe(90_000);
  });

  it('parses Postgres interval text in the default output style', () => {
    expect(toIntervalMs({ decay_after: '1 day 02:00:00' }, 'decay_after')).toBe(93_600_000);
    expect(toIntervalMs({ decay_after: '01:00:00' }, 'decay_after')).toBe(3_600_000);
    expect(toIntervalMs({ decay_after: '00:00:01.5' }, 'decay_after')).toBe(1_500);
    expect(toIntervalMs({ decay_after: '2 mons' }, 'decay_after')).toBe(5_184_000_000);
  });

  it('parses the interval object shape a typed driver returns', () => {
    expect(
      toIntervalMs({ decay_after: { days: 1, hours: 2, minutes: 0, seconds: 0 } }, 'decay_after'),
    ).toBe(93_600_000);
    expect(toIntervalMs({ decay_after: { seconds: 1, milliseconds: 500 } }, 'decay_after')).toBe(
      1_500,
    );
  });

  it('renders milliseconds back into a Postgres interval literal', () => {
    expect(intervalLiteral(90_000)).toBe('90000 milliseconds');
    expect(intervalLiteral(0)).toBe('0 milliseconds');
  });

  it('round-trips a millisecond value through the literal it writes', () => {
    for (const milliseconds of [0, 1, 1_500, 86_400_000]) {
      expect(toIntervalMs({ value: intervalLiteral(milliseconds) }, 'value')).toBe(milliseconds);
    }
  });

  it('refuses an interval it cannot read rather than guessing zero', () => {
    expect(() => toIntervalMs({ decay_after: '' }, 'decay_after')).toThrow(
      /expected interval column "decay_after" to be milliseconds or Postgres interval text/,
    );
    expect(() => toIntervalMs({ decay_after: 'soon' }, 'decay_after')).toThrow(RowMappingError);
    expect(() => toIntervalMs({ decay_after: Number.NaN }, 'decay_after')).toThrow(
      /finite number of milliseconds/,
    );
    expect(() => toIntervalMs({ decay_after: true }, 'decay_after')).toThrow(
      /expected interval column "decay_after" to be a number, interval text, or an interval object/,
    );
    expect(() => toIntervalMs({ decay_after: { fortnights: 2 } }, 'decay_after')).toThrow(
      /expected interval column "decay_after" to carry at least one of/,
    );
  });
});

describe('embedding conversion', () => {
  it('parses the bracketed text form pgvector returns', () => {
    expect(toEmbedding({ embedding: '[0.25,-0.5,1]' }, 'embedding')).toEqual([0.25, -0.5, 1]);
    expect(toEmbedding({ embedding: '[]' }, 'embedding')).toEqual([]);
  });

  it('accepts an array when a driver has a vector type parser registered', () => {
    expect(toEmbedding({ embedding: [1, 2, 3] }, 'embedding')).toEqual([1, 2, 3]);
  });

  it('returns null for an item with no embedding yet', () => {
    expect(toEmbedding({ embedding: null }, 'embedding')).toBeNull();
  });

  it('round-trips a vector through the literal it writes', () => {
    const vector = [0.25, -0.5, 1, 0];
    expect(embeddingLiteral(vector)).toBe('[0.25,-0.5,1,0]');
    expect(toEmbedding({ embedding: embeddingLiteral(vector) }, 'embedding')).toEqual(vector);
  });

  it('names the offending component rather than writing NaN into the vector', () => {
    expect(() => embeddingLiteral([1, Number.NaN, 3])).toThrow(/component 1 is number NaN/);
    expect(() => toEmbedding({ embedding: '[1,oops,3]' }, 'embedding')).toThrow(
      /component 1 is string "oops"/,
    );
    expect(() => toEmbedding({ embedding: '0.25,-0.5' }, 'embedding')).toThrow(
      /formatted as \[n,n,\.\.\.\]/,
    );
  });
});

describe('scalar conversion', () => {
  it('maps nullable numbers without coercing database strings', () => {
    expect(toNullableNumber({ v: null }, 'v')).toBeNull();
    expect(toNullableNumber({ v: undefined }, 'v')).toBeNull();
    expect(toNullableNumber({ v: 3 }, 'v')).toBe(3);
    expect(() => toNullableNumber({ v: '3' }, 'v')).toThrow(
      /expected column "v" to be a finite number/,
    );
    expect(() => toNullableNumber({ v: Number.NaN }, 'v')).toThrow(
      /expected column "v" to be a finite number/,
    );
  });

  it('accepts the boolean spellings a driver may hand back', () => {
    expect(toBoolean({ v: true }, 'v')).toBe(true);
    expect(toBoolean({ v: 't' }, 'v')).toBe(true);
    expect(toBoolean({ v: 'false' }, 'v')).toBe(false);
    expect(() => toBoolean({ v: 1 }, 'v')).toThrow(/expected column "v" to be a boolean/);
  });

  it('accepts a Date or a parseable timestamp string', () => {
    expect(toDate({ v: ASSERTED_AT }, 'v')).toEqual(ASSERTED_AT);
    expect(toDate({ v: '2026-07-31T09:00:00.000Z' }, 'v')).toEqual(ASSERTED_AT);
    expect(() => toDate({ v: 'yesterday' }, 'v')).toThrow(/parseable timestamp/);
    expect(() => toDate({ v: new Date(Number.NaN) }, 'v')).toThrow(/an invalid Date/);
  });
});
