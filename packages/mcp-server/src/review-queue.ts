import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AccessScope, ItemKind, SupersedeBlockedOutcome, Uuid } from '@mneia/core';

export const REVIEW_QUEUE_SOURCES = ['mneia_checkpoint'] as const;

export type ReviewQueueSource = (typeof REVIEW_QUEUE_SOURCES)[number];

export interface ReviewQueueEntry {
  readonly id: Uuid;
  readonly queuedAt: string;
  readonly source: ReviewQueueSource;
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly assertedBy: Uuid;
  readonly sessionId: Uuid | null;
  readonly checkpointTrigger: string;
  readonly outcome: SupersedeBlockedOutcome;
  readonly reason: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body: string | null;
  readonly sourceRef: string | null;
  readonly confidence: number;
  readonly loadBearing: boolean;
  readonly accessScope: AccessScope;
  readonly supersedesId: Uuid | null;
}

export interface ReviewQueue {
  readonly path: string | null;
  append(entries: readonly ReviewQueueEntry[]): Promise<void>;
}

export interface JsonlReviewQueueOptions {
  readonly filePath: string;
  readonly writeLines?: ((filePath: string, contents: string) => Promise<void>) | undefined;
}

async function appendLines(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, contents, 'utf8');
}

export function createJsonlReviewQueue(options: JsonlReviewQueueOptions): ReviewQueue {
  const write = options.writeLines ?? appendLines;
  let pending: Promise<void> = Promise.resolve();

  return {
    path: options.filePath,

    append(entries: readonly ReviewQueueEntry[]): Promise<void> {
      if (entries.length === 0) {
        return Promise.resolve();
      }
      const contents = `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
      const next = pending.then(
        () => write(options.filePath, contents),
        () => write(options.filePath, contents),
      );
      pending = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

export function createNoopReviewQueue(): ReviewQueue {
  return {
    path: null,
    append(): Promise<void> {
      return Promise.resolve();
    },
  };
}
