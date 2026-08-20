import { describe, expect, it } from 'vitest';

import { LINKED_TOOLS } from './linked-tools.js';
import { SHIPPED_TOOL_NAMES, ToolRegistry } from './registry.js';

describe('the statically linked tool list', () => {
  it('registers without throwing, so the server can start', () => {
    expect(() => new ToolRegistry(LINKED_TOOLS)).not.toThrow();
  });

  it('registers every tool the M1 surface promises', () => {
    const registry = new ToolRegistry(LINKED_TOOLS);
    for (const name of SHIPPED_TOOL_NAMES) {
      expect(registry.has(name), `${name} is in SHIPPED_TOOL_NAMES but nothing links it`).toBe(
        true,
      );
    }
  });

  it('links mneia_retire, whose absence from the allow-list stopped the server starting', () => {
    expect(LINKED_TOOLS.map((tool) => tool.name)).toContain('mneia_retire');
    expect(SHIPPED_TOOL_NAMES).toContain('mneia_retire');
  });
});
