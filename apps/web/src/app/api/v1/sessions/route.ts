import { z } from 'zod';
import { handleCreateSession } from '../../../../server/api/handlers.js';
import { serve } from '../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NewSessionSchema = z.object({
  projectId: z.string().min(1),
  tool: z.string().max(200).nullable(),
});

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: NewSessionSchema,
    run: (store, input) => handleCreateSession(store, input),
  });
