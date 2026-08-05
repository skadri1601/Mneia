import { describe, expect, it } from 'vitest';
import { PostgresStoreAdapter, StoreError, VERSION } from './index.js';

describe('@mneia/core', () => {
  it('exports a version string', () => {
    expect(VERSION).toBeTypeOf('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exports the Postgres store adapter as a value so a surface can construct one', () => {
    expect(PostgresStoreAdapter).toBeTypeOf('function');
  });

  it('exports StoreError so a surface can narrow store failures', () => {
    expect(StoreError).toBeTypeOf('function');
    expect(new StoreError('not_found', 'probe')).toBeInstanceOf(Error);
  });
});
