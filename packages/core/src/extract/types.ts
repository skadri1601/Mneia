export interface ExtractionProviderRequest {
  readonly system: string;
  readonly user: string;
  readonly maxOutputTokens: number;
  /**
   * Stable grouping key for the provider's prompt cache, when the caller has one.
   *
   * GPT-5.6 and later need an explicit key for cache hits to be reliable; without it
   * matching is best-effort and a busy account fragments its own prefix. Cached input
   * bills at a tenth of the uncached rate, and our prefix (system prompt plus the
   * existing-items block) is deliberately byte-stable across a session, so this is the
   * difference between paying full rate for it on every extraction and paying once.
   *
   * Optional so every existing implementer and test double keeps compiling.
   */
  readonly cacheKey?: string | undefined;
}

export interface ExtractionProviderResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /**
   * The tier that actually served this response, where the provider has one and knows it.
   *
   * A flex request that finds no capacity is re-sent on the standard tier, which bills at
   * twice the rate. Only the provider sees that transition, so a caller stamping the
   * *configured* tier onto the attempt prices the request at half what it cost. Optional
   * because a vendor with no tiers has nothing to report; the caller falls back to what it
   * configured, and reported beats configured.
   */
  readonly serviceTier?: string | undefined;
}

export interface ExtractionProvider {
  readonly model: string;
  extract(request: ExtractionProviderRequest): Promise<ExtractionProviderResponse>;
}
