export interface ExtractionProviderRequest {
  readonly system: string;
  readonly user: string;
  readonly maxOutputTokens: number;
}

export interface ExtractionProviderResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ExtractionProvider {
  readonly model: string;
  extract(request: ExtractionProviderRequest): Promise<ExtractionProviderResponse>;
}
