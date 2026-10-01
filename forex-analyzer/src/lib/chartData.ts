import type { Candle } from "@/types/market";
import { ema } from "@/technical/indicators";

export interface LinePoint {
  time: number;
  value: number;
}

/** EMA overlay points for the chart, computed with the same function the analysis uses. */
export function emaLine(candles: Candle[], period: number): LinePoint[] {
  const values = ema(
    candles.map((c) => c.close),
    period,
  );
  const out: LinePoint[] = [];
  values.forEach((v, i) => {
    if (v !== null) out.push({ time: candles[i]!.time, value: v });
  });
  return out;
}
