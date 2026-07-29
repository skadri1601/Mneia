import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

describe('@mneia/core', () => {
  it('exports a version string', () => {
    expect(VERSION).toBeTypeOf('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
