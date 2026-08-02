import type { ScopedStore, TelemetryEmitter } from '@mneia/core';

export interface ToolContext {
  readonly store: ScopedStore;
  readonly telemetry: TelemetryEmitter;
  readonly now: () => Date;
}

export interface ToolResult {
  readonly content: readonly ToolContentBlock[];
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
}

export interface ToolContentBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolDefinition<TInput> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  parse(raw: unknown): TInput;
  run(input: TInput, context: ToolContext): Promise<ToolResult>;
}

export type AnyToolDefinition = ToolDefinition<unknown>;
