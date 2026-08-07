import { z } from 'zod';
import { ACTOR_KINDS } from '../store/schema.js';
import type { HttpTransport } from './http.js';

const MeWireSchema = z.object({
  actor: z.object({
    id: z.string().min(1),
    display_name: z.string(),
    kind: z.enum(ACTOR_KINDS),
  }),
  workspace: z.object({
    id: z.string().min(1),
    slug: z.string(),
    display_name: z.string(),
  }),
  team: z.object({
    id: z.string().min(1),
    display_name: z.string(),
  }),
});

export interface HostedIdentity {
  readonly actorId: string;
  readonly actorName: string;
  readonly actorKind: (typeof ACTOR_KINDS)[number];
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly teamId: string;
  readonly teamName: string;
}

export async function fetchIdentity(transport: HttpTransport): Promise<HostedIdentity> {
  const me = await transport.request('/api/me', MeWireSchema);

  return {
    actorId: me.actor.id,
    actorName: me.actor.display_name,
    actorKind: me.actor.kind,
    workspaceId: me.workspace.id,
    workspaceSlug: me.workspace.slug,
    workspaceName: me.workspace.display_name,
    teamId: me.team.id,
    teamName: me.team.display_name,
  };
}
