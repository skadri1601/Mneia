import { z } from 'zod';
import { handleCreateSession } from '../../../../server/api/handlers.js';
import { serve } from '../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NewSessionSchema = z.object({
  projectId: z.string().min(1),
  tool: z.string().max(200).nullable(),
  clientName: z.string().min(1).max(200).nullable().optional(),
  clientVersion: z.string().min(1).max(200).nullable().optional(),
  clientSessionRef: z.string().min(1).max(500).nullable().optional(),
  clientSessionName: z.string().min(1).max(500).nullable().optional(),
  clientSessionUrl: z.string().min(1).max(2000).nullable().optional(),
  // The parent is named by its client ref, not by a session id: a client reporting a
  // sub-agent transcript knows the parent's transcript id and has no way to know ours.
  // Accepting an id here would also let a caller point a session at a row it never opened.
  parentClientSessionRef: z.string().min(1).max(500).nullable().optional(),
});

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: NewSessionSchema,
    run: (store, input) => handleCreateSession(store, input),
  });
