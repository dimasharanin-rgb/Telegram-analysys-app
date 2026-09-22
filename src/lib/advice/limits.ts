/**
 * How many AI advice requests an analysis includes.
 *
 * V2 let the advice page call the model as often as someone felt like
 * clicking, which is not something a free product can offer: every click is
 * a paid request, and nothing stopped one analysis making a hundred of them.
 *
 * The allowance is per analysis rather than per account, because that is the
 * unit the user bought and the unit the context belongs to. All of it is
 * configuration - the numbers live here and nowhere else, and each can be
 * overridden from the environment.
 */

export type AdviceTier = "free" | "basic" | "premium";

function limit(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** Requests included with an analysis, by tier. */
export function adviceLimits(): Record<AdviceTier, number> {
  return {
    free: limit(process.env.ADVICE_REQUESTS_FREE, 3),
    basic: limit(process.env.ADVICE_REQUESTS_BASIC, 10),
    premium: limit(process.env.ADVICE_REQUESTS_PREMIUM, 50),
  };
}

/**
 * Which tier a product's analyses get.
 *
 * Kept as a map from product id rather than a field on the product so that
 * adding a product does not silently grant an allowance nobody chose: an
 * unlisted product falls to `free`.
 */
const PRODUCT_TIER: Record<string, AdviceTier> = {
  free: "free",
  "deep-text": "basic",
  "pro-credits": "premium",
  multimodal: "premium",
};

export function adviceTierFor(productId: string): AdviceTier {
  return PRODUCT_TIER[productId] ?? "free";
}

export function adviceAllowanceFor(productId: string): number {
  return adviceLimits()[adviceTierFor(productId)];
}

export interface AdviceAllowance {
  /** Included with this analysis. */
  total: number;
  used: number;
  remaining: number;
  tier: AdviceTier;
}

export function describeAllowance(productId: string, used: number): AdviceAllowance {
  const total = adviceAllowanceFor(productId);
  return {
    total,
    used,
    remaining: Math.max(0, total - used),
    tier: adviceTierFor(productId),
  };
}
