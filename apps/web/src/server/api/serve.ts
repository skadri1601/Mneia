import 'server-only';

import type { ScopedStore } from '@mneia/core';
import { StoreError, SupersedeNotAllowedError } from '@mneia/core';
import type { z } from 'zod';
import { ApiAuthError, apiError, apiOk, resolveBearerIdentity } from '../api-auth.js';
import { deviceStore } from '../device-runtime.js';
import { withWorkspaceScope } from '../store-runtime.js';
import { ApiRequestError } from './handlers.js';

export interface ServeOptions<TInput> {
  readonly request: Request;
  readonly schema?: z.ZodType<TInput> | undefined;
  readonly input?: TInput | undefined;
  readonly run: (store: ScopedStore, input: TInput) => Promise<unknown>;
}

const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

const readJsonBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  if (text.length === 0) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiRequestError('invalid_request', 'the request body is not valid JSON');
  }
};

export const serve = async <TInput>(options: ServeOptions<TInput>): Promise<Response> => {
  try {
    const identity = await resolveBearerIdentity(
      options.request.headers.get('authorization'),
      (tokenHash) => deviceStore.identify(tokenHash),
    );

    let input = options.input as TInput;
    if (options.schema !== undefined) {
      const parsed = options.schema.safeParse(await readJsonBody(options.request));
      if (!parsed.success) {
        return apiError('invalid_request', describeIssues(parsed.error));
      }
      input = parsed.data;
    }

    const body = await withWorkspaceScope(
      { workspaceId: identity.workspaceId, actorId: identity.actorId },
      (store) => options.run(store, input),
    );

    return apiOk(body);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return apiError('invalid_token', error.message);
    }
    if (error instanceof ApiRequestError) {
      return apiError(error.code, error.message);
    }
    if (error instanceof SupersedeNotAllowedError) {
      return apiError('supersede_refused', error.message);
    }
    if (error instanceof StoreError) {
      if (error.code === 'not_found') {
        return apiError('not_found', error.message);
      }
      if (error.code === 'invalid_argument') {
        return apiError('invalid_request', error.message);
      }
    }
    throw error;
  }
};
