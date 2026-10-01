import type { Direction, Timeframe, TradeInput } from "@/types/trade";
import { fieldErrors, tradeInputSchema } from "./schemas";

/** The analyzer form as typed: prices stay strings so partial input like "1.17" is not mangled. */
export interface TradeFormValues {
  pair: string;
  direction: Direction;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  positionSize: string;
  timeframe: Timeframe;
  thesis: string;
}

export const EMPTY_TRADE_FORM: TradeFormValues = {
  pair: "EURUSD",
  direction: "LONG",
  entry: "",
  stopLoss: "",
  takeProfit: "",
  positionSize: "",
  timeframe: "M15",
  thesis: "",
};

function parseNumber(raw: string): number | undefined {
  const s = raw.trim().replace(",", ".");
  return s === "" ? undefined : Number(s);
}

/** Converts form values to a TradeInput, or per-field messages explaining what is missing or wrong. */
export function parseTradeForm(v: TradeFormValues): { trade: TradeInput | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const entry = parseNumber(v.entry);
  const stopLoss = parseNumber(v.stopLoss);
  const takeProfit = parseNumber(v.takeProfit);
  if (entry === undefined) errors.entry = "Required";
  if (stopLoss === undefined) errors.stopLoss = "Required";
  if (takeProfit === undefined) errors.takeProfit = "Required";
  const positionSize = parseNumber(v.positionSize);

  const result = tradeInputSchema.safeParse({
    pair: v.pair,
    direction: v.direction,
    entry,
    stopLoss,
    takeProfit,
    positionSize: positionSize ?? null,
    timeframe: v.timeframe,
    thesis: v.thesis,
  });
  if (!result.success) {
    const schemaErrors = fieldErrors(result.error);
    return { trade: null, errors: { ...schemaErrors, ...errors } };
  }
  return Object.keys(errors).length ? { trade: null, errors } : { trade: result.data, errors: {} };
}
