import { describe, expect, it } from 'vitest';

import { LINKED_TOOLS } from './linked-tools.js';
import { SHIPPED_TOOL_NAMES, ToolRegistry } from './registry.js';
import { toAdvertisedTool } from './server.js';

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

  it('advertises a schema the MCP SDK accepts, because one bad schema refuses the whole server', () => {
    const registry = new ToolRegistry(LINKED_TOOLS);

    for (const listing of registry.list()) {
      expect(
        () => toAdvertisedTool(listing),
        `${listing.name} cannot be advertised, so the server would refuse to start`,
      ).not.toThrow();
    }
  });

  it('advertises a closed object for every tool, not just mneia_assert', () => {
    for (const tool of LINKED_TOOLS) {
      const schema = tool.inputSchema as { readonly additionalProperties?: unknown };
      expect(
        schema.additionalProperties,
        `${tool.name} advertises an open object, so a validating client cannot catch a misspelled argument`,
      ).toBe(false);
    }
  });

  it('closes the nested objects too, so a misspelled candidate field is caught before it is sent', () => {
    const checkpoint = LINKED_TOOLS.find((tool) => tool.name === 'mneia_checkpoint');
    if (checkpoint === undefined) {
      throw new Error('expected mneia_checkpoint to be linked');
    }

    const schema = checkpoint.inputSchema as {
      readonly properties?: {
        readonly items?: { readonly items?: { readonly additionalProperties?: unknown } };
      };
    };

    expect(schema.properties?.items?.items?.additionalProperties).toBe(false);
  });
});
