export const DIRECTIONS = ["LONG", "SHORT"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const TIMEFRAMES = ["M5", "M15", "M30", "H1", "H4", "D1"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: 24 * 60 * 60,
};

/** A trade the user proposes. Nothing here is ever sent to a broker. */
export interface TradeInput {
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
