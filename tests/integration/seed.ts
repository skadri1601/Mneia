import type { Client } from 'pg';
import { EMBEDDING_DIMENSIONS, WORKSPACE_SETTING } from '../../packages/core/src/index.js';

export const SEED = {
  workspaceA: '5eed0000-0000-4000-8000-000000000001',
  workspaceB: '5eed0000-0000-4000-8000-000000000002',
  humanA: '5eed0000-0000-4000-8000-000000000011',
  humanB: '5eed0000-0000-4000-8000-000000000012',
  agentA: '5eed0000-0000-4000-8000-000000000013',
  teamA: '5eed0000-0000-4000-8000-000000000021',
  teamB: '5eed0000-0000-4000-8000-000000000022',
  projectA: '5eed0000-0000-4000-8000-000000000031',
  projectB: '5eed0000-0000-4000-8000-000000000032',
  sessionA: '5eed0000-0000-4000-8000-000000000041',
  constraintLoadBearing: '5eed0000-0000-4000-8000-000000000101',
  constraintIncidental: '5eed0000-0000-4000-8000-000000000102',
  decisionOriginal: '5eed0000-0000-4000-8000-000000000103',
  decisionSuperseding: '5eed0000-0000-4000-8000-000000000104',
  decisionHead: '5eed0000-0000-4000-8000-000000000105',
  decisionDisputed: '5eed0000-0000-4000-8000-000000000106',
  openQuestion: '5eed0000-0000-4000-8000-000000000107',
  agentAsserted: '5eed0000-0000-4000-8000-000000000108',
  privateItem: '5eed0000-0000-4000-8000-000000000109',
  otherWorkspaceItem: '5eed0000-0000-4000-8000-000000000110',
} as const;

export const seedVector = (fill: number): string =>
  `[${Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill).join(',')}]`;

const scopeTo = async (client: Client, workspaceId: string): Promise<void> => {
  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
};

interface SeedItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly status?: string;
  readonly assertedBy: string;
  readonly assertedAt: string;
  readonly confidence: number;
  readonly humanConfirmed: boolean;
  readonly loadBearing: boolean;
  readonly accessScope?: string;
  readonly validTo?: string | null;
  readonly supersedesId?: string | null;
  readonly supersededById?: string | null;
  readonly supersedeReason?: string | null;
  readonly sourceSessionId?: string | null;
}

const ITEMS: readonly SeedItem[] = [
  {
    id: SEED.constraintLoadBearing,
    kind: 'constraint',
    title: 'Never auto-supersede a human-confirmed item',
    body: 'Standing rule 1. The arbiter refuses; it does not merely warn.',
    assertedBy: SEED.humanA,
    assertedAt: '2026-07-01T09:00:00.000Z',
    confidence: 1,
    humanConfirmed: true,
    loadBearing: true,
  },
  {
    id: SEED.constraintIncidental,
    kind: 'constraint',
    title: 'Prefer named exports',
    body: null,
    assertedBy: SEED.agentA,
    assertedAt: '2026-07-02T09:00:00.000Z',
    confidence: 0.4,
    humanConfirmed: false,
    loadBearing: false,
  },
  {
    id: SEED.decisionOriginal,
    kind: 'decision',
    title: 'Store embeddings on context_item',
    body: 'Superseded once the vector column moved to its own table.',
    status: 'superseded',
    assertedBy: SEED.humanA,
    assertedAt: '2026-07-03T09:00:00.000Z',
    confidence: 0.8,
    humanConfirmed: true,
    loadBearing: false,
    validTo: '2026-07-04T09:00:00.000Z',
    supersededById: SEED.decisionSuperseding,
  },
  {
    id: SEED.decisionSuperseding,
    kind: 'decision',
    title: 'Move embeddings to context_item_embedding',
    body: 'Keeps unread vectors off every context_item read.',
    status: 'superseded',
    assertedBy: SEED.humanA,
    assertedAt: '2026-07-04T09:00:00.000Z',
    confidence: 0.85,
    humanConfirmed: true,
    loadBearing: false,
    validTo: '2026-07-05T09:00:00.000Z',
    supersedesId: SEED.decisionOriginal,
    supersededById: SEED.decisionHead,
    supersedeReason: 'the embedding column was never read on the hot path',
  },
  {
    id: SEED.decisionHead,
    kind: 'decision',
    title: 'Record the model alongside every stored vector',
    body: 'Mixed vector spaces degrade retrieval in a way that looks like bad ranking.',
    assertedBy: SEED.humanA,
    assertedAt: '2026-07-05T09:00:00.000Z',
    confidence: 0.9,
    humanConfirmed: true,
    loadBearing: true,
    supersedesId: SEED.decisionSuperseding,
    supersedeReason: 'provenance was missing from the previous decision',
  },
  {
    id: SEED.decisionDisputed,
    kind: 'decision',
    title: 'Adopt a graph database for multi-hop reasoning',
    body: 'Contested — §11 rules it premature.',
    status: 'disputed',
    assertedBy: SEED.agentA,
    assertedAt: '2026-07-06T09:00:00.000Z',
    confidence: 0.55,
    humanConfirmed: false,
    loadBearing: false,
  },
  {
    id: SEED.openQuestion,
    kind: 'open_question',
    title: 'Who pays for inference at the team tier',
    body: null,
    assertedBy: SEED.humanA,
    assertedAt: '2026-07-07T09:00:00.000Z',
    confidence: 0.5,
    humanConfirmed: true,
    loadBearing: false,
  },
  {
    id: SEED.agentAsserted,
    kind: 'fact',
    title: 'The migration runner holds a session advisory lock',
    body: 'Extracted from a session, not yet confirmed.',
    assertedBy: SEED.agentA,
    assertedAt: '2026-07-08T09:00:00.000Z',
    confidence: 0.6,
    humanConfirmed: false,
    loadBearing: false,
    sourceSessionId: SEED.sessionA,
  },
  {
    id: SEED.privateItem,
    kind: 'decision',
    title: 'A private note that workspace queries must not see',
    body: null,
    assertedBy: SEED.humanA,
    assertedAt: '2026-07-09T09:00:00.000Z',
    confidence: 0.5,
    humanConfirmed: true,
    loadBearing: false,
    accessScope: 'private',
  },
];

export async function seedCorpus(client: Client): Promise<void> {
  const workspaces = [
    [SEED.workspaceA, 'seed-acme', SEED.humanA, SEED.teamA, SEED.projectA],
    [SEED.workspaceB, 'seed-globex', SEED.humanB, SEED.teamB, SEED.projectB],
  ] as const;

  for (const [workspaceId, slug, humanId, teamId, projectId] of workspaces) {
    await scopeTo(client, workspaceId);
    await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
      workspaceId,
      slug,
    ]);
    await client.query(
      'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
      [humanId, workspaceId, 'human', `${slug} lead`],
    );
    await client.query(
      'INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, $3, $3)',
      [teamId, workspaceId, `${slug}-eng`],
    );
    await client.query(
      'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
      [workspaceId, teamId, humanId, 'lead'],
    );
    await client.query(
      'INSERT INTO project (id, workspace_id, team_id, slug) VALUES ($1, $2, $3, $4)',
      [projectId, workspaceId, teamId, `${slug}-platform`],
    );
  }

  await scopeTo(client, SEED.workspaceA);
  await client.query(
    'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
    [SEED.agentA, SEED.workspaceA, 'agent', 'seed coding agent'],
  );
  await client.query(
    'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
    [SEED.workspaceA, SEED.teamA, SEED.agentA, 'member'],
  );
  await client.query(
    `INSERT INTO session (id, workspace_id, project_id, actor_id, tool, started_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      SEED.sessionA,
      SEED.workspaceA,
      SEED.projectA,
      SEED.agentA,
      'claude-code',
      '2026-07-08T08:00:00.000Z',
    ],
  );

  for (const item of ITEMS) {
    await client.query(
      `INSERT INTO context_item
         (id, workspace_id, project_id, kind, title, body, status, asserted_by, asserted_at,
          source_session_id, confidence, human_confirmed, load_bearing, access_scope,
          valid_from, valid_to)
       VALUES ($1, $2, $3, $4::item_kind, $5, $6, $7::item_status, $8, $9,
               $10, $11, $12, $13, $14::access_scope, $9, $15)`,
      [
        item.id,
        SEED.workspaceA,
        SEED.projectA,
        item.kind,
        item.title,
        item.body,
        item.status ?? 'active',
        item.assertedBy,
        item.assertedAt,
        item.sourceSessionId ?? null,
        item.confidence,
        item.humanConfirmed,
        item.loadBearing,
        item.accessScope ?? 'project',
        item.validTo ?? null,
      ],
    );
  }

  for (const item of ITEMS) {
    if (item.supersedesId === undefined && item.supersededById === undefined) continue;
    await client.query(
      `UPDATE context_item
          SET supersedes_id = $2, superseded_by_id = $3, supersede_reason = $4
        WHERE id = $1`,
      [
        item.id,
        item.supersedesId ?? null,
        item.supersededById ?? null,
        item.supersedeReason ?? null,
      ],
    );
  }

  await client.query(
    `INSERT INTO context_item_embedding (workspace_id, item_id, model, dim, embedding)
     VALUES ($1, $2, $3, $4, $5::vector)`,
    [
      SEED.workspaceA,
      SEED.decisionHead,
      'text-embedding-3-small',
      EMBEDDING_DIMENSIONS,
      seedVector(0.25),
    ],
  );

  await scopeTo(client, SEED.workspaceB);
  await client.query(
    `INSERT INTO context_item
       (id, workspace_id, project_id, kind, title, asserted_by, confidence, human_confirmed)
     VALUES ($1, $2, $3, 'decision'::item_kind, $4, $5, 0.7, true)`,
    [
      SEED.otherWorkspaceItem,
      SEED.workspaceB,
      SEED.projectB,
      'A decision belonging to another workspace',
      SEED.humanB,
    ],
  );
}
