import type { ContextItem, Embedding, Uuid } from '../domain/types.js';
import type { ItemKind } from '../store/schema.js';

export interface ScoringWeights {
  readonly semanticRelevance: number;
  readonly recencyDecay: number;
  readonly confidence: number;
  readonly humanConfirmed: number;
  readonly loadBearing: number;
  readonly freshness: number;
  readonly disputed: number;
}

export interface ScoreComponents {
  readonly semanticRelevance: number;
  readonly recencyDecay: number;
  readonly confidence: number;
  readonly humanConfirmed: number;
  readonly loadBearing: number;
  readonly freshness: number;
  readonly disputed: number;
}

export interface ScoredItem {
  readonly item: ContextItem;
  readonly score: number;
  readonly components: ScoreComponents;
}

export interface ScoringInput {
  readonly items: readonly ContextItem[];
  readonly taskEmbedding: Embedding | null;
  readonly now: Date;
  readonly weights?: ScoringWeights;
}

export type KindQuotas = Readonly<Record<ItemKind, number>>;

export interface PackRequest {
  readonly scored: readonly ScoredItem[];
  readonly tokenBudget: number;
  readonly quotas?: KindQuotas;
}

export interface PackedSlice {
  readonly items: readonly ScoredItem[];
  readonly tokensUsed: number;
  readonly tokenBudget: number;
  readonly droppedItemIds: readonly Uuid[];
  readonly mandatoryItemIds: readonly Uuid[];
}

export interface SliceRequest {
  readonly projectId: Uuid;
  readonly task: string;
  readonly tokenBudget: number;
  readonly asOf?: Date;
}

export interface Slice {
  readonly id: Uuid;
  readonly projectId: Uuid;
  readonly task: string;
  readonly items: readonly ScoredItem[];
  readonly tokensUsed: number;
  readonly tokenBudget: number;
  readonly renderedMarkdown: string;
  readonly generatedAt: Date;
}
