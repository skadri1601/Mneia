import 'server-only';

/**
 * What a model costs us, in micros (millionths of a dollar) per token.
 *
 * Micros because `checkpoint_usage.cost_micros` and `wallet_balance_micros` are integers:
 * a checkpoint costs single-digit thousandths of a dollar, so cents cannot express it and
 * floats would drift once a wallet accumulates thousands of debits.
 *
 * Rates are published list prices as of 2026-08-22. They are not read from the provider,
 * so a price change upstream shows up as a drift between what we bill and what we are
 * billed — the Cloudflare AI Gateway dashboard is the cross-check.
 *
 * Only models on the EXTRACTION_MODELS allowlist appear here. An unpriced model is a bug,
 * not a free one, so `costMicrosFor` refuses rather than silently metering zero.
 */
interface ModelRates {
  /** Uncached prompt tokens. */
  readonly inputMicrosPerToken: number;
  /** Prompt tokens served from the provider's cache, at a tenth of the input rate. */
  readonly cachedInputMicrosPerToken: number;
  /** Completion tokens. On a reasoning model this includes reasoning tokens. */
  readonly outputMicrosPerToken: number;
}

/**
 * Standard and flex rates per model.
 *
 * Flex is exactly half of standard on both input and output; it is listed rather than
 * derived so a future tier that is not a clean halving cannot be introduced by accident.
 */
const RATES: Readonly<Record<string, Readonly<Record<'auto' | 'flex', ModelRates>>>> = {
  'gpt-5.6-luna': {
    // $0.20 / $0.02 / $1.20 per million.
    auto: { inputMicrosPerToken: 0.2, cachedInputMicrosPerToken: 0.02, outputMicrosPerToken: 1.2 },
    // $0.10 / $0.01 / $0.60 per million.
    flex: { inputMicrosPerToken: 0.1, cachedInputMicrosPerToken: 0.01, outputMicrosPerToken: 0.6 },
  },
  'claude-haiku-4-5': {
    // $1.00 / $5.00 per million. The fallback vendor has no flex equivalent, so both
    // entries are the same rate: falling back is five times the price of the primary,
    // which is the cost of not losing a checkpoint to an outage.
    auto: { inputMicrosPerToken: 1, cachedInputMicrosPerToken: 0.1, outputMicrosPerToken: 5 },
    flex: { inputMicrosPerToken: 1, cachedInputMicrosPerToken: 0.1, outputMicrosPerToken: 5 },
  },
};

/**
 * Where the provider switches to long-context pricing.
 *
 * Above this, input bills at 2x and output at 1.5x for the *entire* request rather than
 * the excess. propose.ts caps chunks below it, so this multiplier should never apply — it
 * exists so that if a chunk ever does cross the line, the ledger says what it really cost
 * rather than under-reporting it.
 */
const LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;
const LONG_CONTEXT_INPUT_MULTIPLIER = 2;
const LONG_CONTEXT_OUTPUT_MULTIPLIER = 1.5;

export interface UsageForCost {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Of `inputTokens`, how many the provider served from cache. Defaults to none. */
  readonly cachedInputTokens?: number | undefined;
  readonly serviceTier?: 'auto' | 'flex' | undefined;
}

export class UnpricedModelError extends Error {
  constructor(model: string) {
    super(
      `expected ${model} to have a rate in the pricing table; found none — a model that can be called but not priced would meter as free and silently invert the margin. Add its published rates alongside the EXTRACTION_MODELS allowlist entry.`,
    );
    this.name = 'UnpricedModelError';
  }
}

/**
 * What a completed call cost, rounded up to the nearest micro.
 *
 * Rounds up so a long tail of sub-micro calls cannot accumulate as free usage.
 */
export const costMicrosFor = (usage: UsageForCost): number => {
  const perModel = RATES[usage.model];
  if (perModel === undefined) {
    throw new UnpricedModelError(usage.model);
  }
  const rates = perModel[usage.serviceTier ?? 'flex'];

  const cached = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  const long = usage.inputTokens > LONG_CONTEXT_THRESHOLD_TOKENS;

  const inputMultiplier = long ? LONG_CONTEXT_INPUT_MULTIPLIER : 1;
  const outputMultiplier = long ? LONG_CONTEXT_OUTPUT_MULTIPLIER : 1;

  const micros =
    uncached * rates.inputMicrosPerToken * inputMultiplier +
    cached * rates.cachedInputMicrosPerToken * inputMultiplier +
    usage.outputTokens * rates.outputMicrosPerToken * outputMultiplier;

  return Math.ceil(micros);
};

/**
 * How many output tokens to assume before a call, for the pre-flight quota check.
 *
 * Deliberately generous. Under-estimating here would let a request through that the wallet
 * cannot actually cover, and the debit is reconciled against real usage afterwards, so the
 * only cost of guessing high is refusing slightly early at the very bottom of a balance.
 */
export const ASSUMED_OUTPUT_TOKENS = 2_000;

/** What a call is expected to cost, from the prompt size alone, before it is made. */
export const estimateCostMicros = (
  model: string,
  inputTokens: number,
  serviceTier?: 'auto' | 'flex' | undefined,
): number =>
  costMicrosFor({
    model,
    inputTokens,
    outputTokens: ASSUMED_OUTPUT_TOKENS,
    serviceTier,
  });
