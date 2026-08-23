import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { openAiCacheKey } = await import('./providers.js');

const WORKSPACE = '874090eb-c7bc-49ef-b653-93e24148a92c';
const PROJECT = '4484a9ea-851a-4e26-800c-1a13ee4bd5f0';

describe('openAiCacheKey', () => {
  // propose.ts sends `${workspaceId}:${project.id}`, which is 73 characters. OpenAI rejects
  // anything over 64 with a 400, and that 400 fails the whole extraction rather than
  // degrading to an uncached call — every checkpoint in production failed on it.
  it('brings a workspace and project pair under the 64-character provider limit', () => {
    const raw = `${WORKSPACE}:${PROJECT}`;

    expect(raw.length).toBe(73);
    expect(openAiCacheKey(raw).length).toBeLessThanOrEqual(64);
  });

  it('loses nothing from a pair of uuids, so two projects never share a key', () => {
    const first = openAiCacheKey(`${WORKSPACE}:${PROJECT}`);
    const sibling = openAiCacheKey(`${WORKSPACE}:4484a9ea-851a-4e26-800c-1a13ee4bd5f1`);

    expect(first.length).toBe(64);
    expect(first).not.toBe(sibling);
  });

  it('is stable, because a key that varies per call caches nothing', () => {
    expect(openAiCacheKey(`${WORKSPACE}:${PROJECT}`)).toBe(
      openAiCacheKey(`${WORKSPACE}:${PROJECT}`),
    );
  });

  it('truncates a longer key rather than sending one the provider will refuse', () => {
    expect(openAiCacheKey('x'.repeat(200)).length).toBe(64);
  });
});
