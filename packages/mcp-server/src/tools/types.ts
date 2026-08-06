import type { ScopedStore, TelemetryEmitter, Uuid } from '@mneia/core';
import type { ReviewQueue } from '../review-queue.js';
import type { SliceLog } from '../slices.js';

export interface ToolContext {
  readonly store: ScopedStore;
  readonly telemetry: TelemetryEmitter;
  readonly now: () => Date;
  readonly slices: SliceLog;
  readonly reviewQueue: ReviewQueue;
  readonly sessionIdFor: (projectId: Uuid) => Uuid | null;
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
