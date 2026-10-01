import { z } from "zod";
import { DIRECTIONS, TIMEFRAMES, type TradeInput } from "@/types/trade";
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_STATE_SOURCES,
  DAILY_LOSS_BASES,
  DRAWDOWN_MODES,
  TRADING_SESSIONS,
  type AccountSettings,
} from "@/types/settings";
import { JOURNAL_STATUSES, TRADE_RESULTS } from "@/types/journal";
import { getInstrument, normalizeSymbol } from "./instruments";
import { isValidTimeZone } from "./time";

const finite = z.number().refine(Number.isFinite, "Must be a finite number");
const price = finite.positive("Must be greater than zero").max(1_000_000, "Price is implausibly large");

export const tradeInputSchema = z.object({
  pair: z
    .string()
    .trim()
    .min(3, "Pair is required")
    .max(12)
    .transform(normalizeSymbol),
  direction: z.enum(DIRECTIONS, { error: "Direction must be LONG or SHORT" }),
  entry: price,
  stopLoss: price,
  takeProfit: price,
  positionSize: finite.positive("Position size must be positive").max(1000, "Position size is implausibly large").nullable().optional(),
  timeframe: z.enum(TIMEFRAMES, { error: "Unsupported timeframe" }),
  thesis: z.string().max(2000, "Keep the thesis under 2000 characters").optional(),
}) satisfies z.ZodType<TradeInput, unknown>;

const pct = (max: number) => finite.gt(0, "Must be greater than 0").max(max, `Must be at most ${max}`);

export const settingsSchema = z
  .object({
    accountSize: finite.min(100, "At least 100").max(100_000_000),
    currency: z.enum(ACCOUNT_CURRENCIES),
    maxDailyLossPct: pct(100),
    dailyLossBasis: z.enum(DAILY_LOSS_BASES),
    maxDrawdownPct: pct(100),
    drawdownMode: z.enum(DRAWDOWN_MODES),
    maxRiskPerTradePct: pct(100),
    maxOpenPositions: z.number().int("Whole number").min(1).max(100),
    minRiskReward: finite.min(0).max(20),
    allowedPairs: z
      .array(z.string().transform(normalizeSymbol))
      .min(1, "Allow at least one instrument")
      .refine((list) => list.every((s) => getInstrument(s)), "Unknown instrument in list")
      .transform((list) => [...new Set(list)]),
    tradingSessions: z.array(z.enum(TRADING_SESSIONS)).transform((list) => [...new Set(list)]),
    minSetupScore: z.number().int("Whole number").min(0).max(100),
    dayResetTimeZone: z.string().trim().min(1).refine(isValidTimeZone, "Unknown IANA time zone"),
    accountStateSource: z.enum(ACCOUNT_STATE_SOURCES),
    manualState: z.object({
      balance: finite.positive(),
      todayRealizedPnl: finite,
      openPositions: z.number().int().min(0).max(100),
      openRisk: finite.min(0),
      highWaterMark: finite.positive(),
    }),
  })
  .strict() satisfies z.ZodType<AccountSettings, unknown>;

/** Field path → first message, for showing next to form inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export const outcomeSchema = z
  .object({
    status: z.enum(JOURNAL_STATUSES),
    result: z.enum(TRADE_RESULTS).nullable(),
    actualPnl: finite.nullable(),
    rMultiple: finite.nullable(),
    notes: z.string().max(2000, "Keep notes under 2000 characters").default(""),
    /** When the trade closed; defaults to now. Determines which day's P/L it counts towards. */
    closedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "CLOSED" && !v.result) {
      ctx.addIssue({ code: "custom", path: ["result"], message: "Choose a result for a closed trade" });
    }
    if (v.status !== "CLOSED" && v.result) {
      ctx.addIssue({ code: "custom", path: ["result"], message: "A result only applies to a closed trade" });
    }
    if (v.status === "CLOSED" && v.result && v.result !== "CANCELLED" && v.actualPnl === null) {
      ctx.addIssue({ code: "custom", path: ["actualPnl"], message: "Enter the actual P/L" });
    }
    if (v.result === "CANCELLED" && v.actualPnl !== null && v.actualPnl !== 0) {
      ctx.addIssue({ code: "custom", path: ["actualPnl"], message: "A cancelled trade has no P/L" });
    }
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : Number(v)))
  .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= 100), "Score must be 0-100");

export const journalFiltersSchema = z.object({
  pair: z.string().trim().transform(normalizeSymbol).optional().transform((v) => v || undefined),
  verdict: z.enum(["BLOCKED", "UNAVAILABLE", "ACCEPTABLE", "CAUTION", "REJECT"]).optional(),
  minScore: optionalNumber,
  maxScore: optionalNumber,
  result: z.enum([...TRADE_RESULTS, "OPEN", "PENDING"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
