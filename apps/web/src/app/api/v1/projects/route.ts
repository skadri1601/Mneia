import { NewProjectWireSchema } from '@mneia/core';
import {
  ApiRequestError,
  handleCreateProject,
  handleGetProjectBySlug,
} from '../../../../server/api/handlers.js';
import { serve } from '../../../../server/api/serve.js';
import { memberships } from '../../../../server/membership-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request): Promise<Response> => {
  const slug = new URL(request.url).searchParams.get('slug');
  return serve({
    request,
    input: slug,
    run: (store, value) => {
      if (value === null || value.length === 0) {
        throw new ApiRequestError(
          'invalid_request',
          'expected a ?slug= query parameter naming the project; found none',
        );
      }
      return handleGetProjectBySlug(store, value);
    },
  });
};

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: NewProjectWireSchema,
    run: (store, input) => handleCreateProject(store, input, { memberships: memberships() }),
  });
