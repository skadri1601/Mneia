import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

describe('@mneia/mcp-server', () => {
  it('re-exports from @mneia/core across the workspace boundary', () => {
    expect(VERSION).toBeTypeOf('string');
  });
});
