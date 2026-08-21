import type { ToolContext, ToolDefinition, ToolResult } from './tools/types.js';

export type ErasedToolDefinition = ToolDefinition<unknown>;

export const SHIPPED_TOOL_NAMES = [
  'mneia_rehydrate',
  'mneia_assert',
  'mneia_retire',
  'mneia_checkpoint',
  'mneia_search',
  'mneia_handoff_create',
  'mneia_handoff_receive',
  'mneia_handoff_inbox',
  'mneia_team',
  'mneia_sessions',
] as const;

export type ShippedToolName = (typeof SHIPPED_TOOL_NAMES)[number];

export const DEFERRED_TOOL_MILESTONES: ReadonlyMap<string, string> = new Map([
  ['mneia_conflicts', 'M4'],
]);

const SHIPPED_TOOL_NAME_SET: ReadonlySet<string> = new Set(SHIPPED_TOOL_NAMES);

export interface ToolListing {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export class ToolRegistrationError extends Error {
  readonly toolName: string;

  constructor(toolName: string, message: string) {
    super(message);
    this.name = 'ToolRegistrationError';
    this.toolName = toolName;
  }
}

export function toolFailure(code: string, summary: string, remedy: string): ToolResult {
  return {
    content: [{ type: 'text', text: `${summary} ${remedy}` }],
    isError: true,
    structuredContent: { error: { code, summary, remedy } },
  };
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return String(cause);
}

function propertyOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}

export function isToolDefinition(value: unknown, toolName: string): value is ErasedToolDefinition {
  const inputSchema = propertyOf(value, 'inputSchema');
  return (
    propertyOf(value, 'name') === toolName &&
    typeof propertyOf(value, 'title') === 'string' &&
    typeof propertyOf(value, 'description') === 'string' &&
    typeof inputSchema === 'object' &&
    inputSchema !== null &&
    typeof propertyOf(value, 'parse') === 'function' &&
    typeof propertyOf(value, 'run') === 'function'
  );
}

export function findToolDefinition(module: unknown, toolName: string): ErasedToolDefinition | null {
  if (typeof module !== 'object' || module === null) {
    return null;
  }
  for (const key of Object.keys(module)) {
    const exported = Reflect.get(module, key);
    if (isToolDefinition(exported, toolName)) {
      return exported;
    }
  }
  return null;
}

function rejectRegistration(name: string): never {
  const deferredMilestone = DEFERRED_TOOL_MILESTONES.get(name);
  if (deferredMilestone !== undefined) {
    throw new ToolRegistrationError(
      name,
      `${name} ships in ${deferredMilestone} and must not be registered now — the M1 tool surface is exactly ${SHIPPED_TOOL_NAMES.join(', ')}. Remove it from the tool list, or move the milestone in .claude/rules/mcp-server.md first.`,
    );
  }

  throw new ToolRegistrationError(
    name,
    `"${name}" is not a Mneia tool. Registrable tools are ${SHIPPED_TOOL_NAMES.join(', ')}; rename the definition or remove it from the tool list.`,
  );
}

export class ToolRegistry {
  private readonly byName: Map<string, ErasedToolDefinition>;

  constructor(tools: readonly ErasedToolDefinition[]) {
    this.byName = new Map();

    for (const tool of tools) {
      if (!SHIPPED_TOOL_NAME_SET.has(tool.name)) {
        rejectRegistration(tool.name);
      }
      if (this.byName.has(tool.name)) {
        throw new ToolRegistrationError(
          tool.name,
          `${tool.name} was registered twice. Each tool name maps to exactly one definition; remove the duplicate from the tool list.`,
        );
      }
      this.byName.set(tool.name, tool);
    }
  }

  get size(): number {
    return this.byName.size;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): readonly string[] {
    return SHIPPED_TOOL_NAMES.filter((name) => this.byName.has(name));
  }

  list(): readonly ToolListing[] {
    const listings: ToolListing[] = [];
    for (const name of SHIPPED_TOOL_NAMES) {
      const tool = this.byName.get(name);
      if (tool !== undefined) {
        listings.push({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return listings;
  }

  refuse(name: string): ToolResult | null {
    return this.byName.has(name) ? null : this.unknownTool(name);
  }

  async dispatch(name: string, rawArguments: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.byName.get(name);
    if (tool === undefined) {
      return this.unknownTool(name);
    }

    let input: unknown;
    try {
      input = tool.parse(rawArguments);
    } catch (cause) {
      return toolFailure(
        'invalid_arguments',
        describeCause(cause),
        `Nothing was read or written — arguments are validated first. Correct them and call ${name} again.`,
      );
    }

    try {
      return await tool.run(input, context);
    } catch (cause) {
      return toolFailure(
        'tool_failed',
        `${name} failed while running: ${describeCause(cause)}.`,
        `This is a fault in the Mneia server, not in your arguments. Retry once; if it persists, continue the task without ${name} and report the failure rather than assuming the answer.`,
      );
    }
  }

  private unknownTool(name: string): ToolResult {
    const available = this.names();
    const deferredMilestone = DEFERRED_TOOL_MILESTONES.get(name);

    if (deferredMilestone !== undefined) {
      return toolFailure(
        'tool_not_available',
        `${name} does not exist yet — it ships in ${deferredMilestone}.`,
        `Use one of ${available.join(', ')} instead, and do not retry ${name}.`,
      );
    }

    if (SHIPPED_TOOL_NAME_SET.has(name)) {
      return toolFailure(
        'tool_not_available',
        `${name} is a Mneia tool but this server did not load it.`,
        `The tools this server offers are ${available.join(', ')}. Call tools/list to re-read the surface, use one of those instead, and do not retry ${name}.`,
      );
    }

    return toolFailure(
      'unknown_tool',
      `"${name}" is not a tool this server offers.`,
      `The tools this server offers are ${available.join(', ')}. Call one of those, and do not retry "${name}".`,
    );
  }
}
