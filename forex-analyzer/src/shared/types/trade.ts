export const DIRECTIONS = ["LONG", "SHORT"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Friendly names; the data layer maps them to provider intervals (Twelve Data: 1min … 1day). */
export const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H2", "H4", "D1"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H2: 2 * 60 * 60,
  H4: 4 * 60 * 60,
  D1: 24 * 60 * 60,
};

/** The timeframes every market snapshot contains, highest first. */
export const PRIMARY_TIMEFRAMES = ["H4", "H1", "M15", "M5"] as const satisfies readonly Timeframe[];
export type PrimaryTimeframe = (typeof PRIMARY_TIMEFRAMES)[number];

/** Timeframes whose market structure is reported. */
export const STRUCTURE_TIMEFRAMES = ["H4", "H1", "M15"] as const satisfies readonly Timeframe[];

/** A trade the user proposes. Nothing here is ever sent to a broker. */
export interface TradeInput {
  /** Twelve Data style symbol, e.g. "EUR/USD". */
  pair: string;
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  /** Lots. Optional: when absent the risk engine suggests a size. */
  positionSize?: number | null;
  timeframe: Timeframe;
  thesis?: string;
}
