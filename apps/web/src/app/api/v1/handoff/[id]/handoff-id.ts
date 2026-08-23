import type { Uuid } from '@mneia/core';
import { ApiRequestError } from '../../../../../server/api/handlers.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The path segment is untrusted input. Parsing it here rather than letting the store adapter's
// assertUuid catch it keeps the check at the trust boundary, so a store path that forgets to
// assert does not become the hole.
export function parseHandoffId(id: string): Uuid {
  if (!UUID_PATTERN.test(id)) {
    throw new ApiRequestError(
      'invalid_request',
      `expected the handoff id in the path to be a UUID; received ${JSON.stringify(id)} — pass the id mneia pickup prints in [brackets], or the full uuid from mneia handoff`,
    );
  }
  return id;
}
