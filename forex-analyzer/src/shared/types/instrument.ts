export type AssetClass = "FX" | "METAL";

/**
 * Contract specification for an instrument. Money is always derived from
 * price distance x contract size, so `pipSize` only affects how distances are
 * displayed, never how much is at risk.
 */
export interface InstrumentSpec {
  /** "EUR/USD" */
  symbol: string;
  displayName: string;
  assetClass: AssetClass;
  base: string;
  quote: string;
  /** Price increment conventionally called one pip (0.0001, 0.01 for JPY quotes, 0.1 for gold). */
  pipSize: number;
  /** Decimal places quoted by Forex feeds (one more than the pip). */
  pricePrecision: number;
  /** Units of the base asset in one standard lot. */
  contractSize: number;
  minLot: number;
  lotStep: number;
}
