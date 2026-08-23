import type { ScopedStore, TelemetryEmitter, Uuid } from '@mneia/core';
import type { ReviewQueue } from '../review-queue.js';
import type { ResolvedWriteSession } from '../session-provenance.js';
import type { SliceLog } from '../slices.js';
import type { SourceSession } from '../source-session.js';
import type { UsageProbe } from './usage.js';

export interface ToolContext {
  readonly store: ScopedStore;
  readonly telemetry: TelemetryEmitter;
  readonly now: () => Date;
  readonly slices: SliceLog;
  readonly reviewQueue: ReviewQueue;
  readonly sessionIdFor: (projectId: Uuid) => Uuid | null;
  readonly resolveWriteSession: (
    projectId: Uuid,
    sourceSession: SourceSession | undefined,
    legacySessionId: Uuid | null,
  ) => Promise<ResolvedWriteSession>;
  readonly defaultProject?: string | null;
  /**
   * Reads the usage meter for this workspace, or is absent when the surface has no billing
   * layer behind it. Tools call it after the write it should reflect — see readUsage.
   */
  readonly usage?: UsageProbe | undefined;
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
