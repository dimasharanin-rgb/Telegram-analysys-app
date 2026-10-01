import { z } from "zod";
import type { Candle, Instrument, Quote } from "@/shared/types/market";
import type { Timeframe } from "@/shared/types/trade";
import { getInstrument, normalizeSymbol } from "@/shared/instruments";
import { MarketDataError } from "../types";

/**
 * Pure translation between Twelve Data's wire format and the app's normalised
 * types. Nothing outside src/data/twelvedata sees a raw Twelve Data response.
 */

export const INTERVALS: Record<Timeframe, string> = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "1h",
  H2: "2h",
  H4: "4h",
  D1: "1day",
};

const num = z.union([z.string(), z.number()]).transform((v) => Number(v));

const errorBody = z.object({ status: z.literal("error"), code: z.number().optional(), message: z.string().optional() }).loose();

const timeSeriesBody = z
  .object({
    meta: z.object({ symbol: z.string().optional(), interval: z.string().optional(), exchange_timezone: z.string().optional() }).loose().optional(),
    values: z.array(z.object({ datetime: z.string(), open: num, high: num, low: num, close: num, volume: num.optional() }).loose()),
    status: z.string().optional(),
  })
  .loose();

const quoteBody = z
  .object({
    symbol: z.string().optional(),
    close: num,
    timestamp: z.number().optional(),
    last_quote_at: z.number().optional(),
    is_market_open: z.boolean().optional(),
  })
  .loose();

const wsPrice = z
  .object({
    event: z.literal("price"),
    symbol: z.string(),
    timestamp: z.number(),
    price: num,
    bid: num.optional(),
    ask: num.optional(),
  })
  .loose();

const forexPairsBody = z.object({
  data: z.array(z.object({ symbol: z.string(), currency_base: z.string().optional(), currency_quote: z.string().optional(), currency_group: z.string().optional() }).loose()),
});

/**
 * Twelve Data error payloads look like {"code": 429, "message": "...", "status": "error"},
 * sometimes alongside a non-200 HTTP status. Returns null when the body is not an error.
 */
export function parseError(body: unknown, httpStatus: number): MarketDataError | null {
  const parsed = errorBody.safeParse(body);
  if (!parsed.success && httpStatus < 400) return null;
  const code = parsed.success ? (parsed.data.code ?? httpStatus) : httpStatus;
  const message = (parsed.success ? parsed.data.message : undefined) ?? `HTTP ${httpStatus}`;
  const clean = message.replace(/\*\*/g, "");
  if (code === 401) return new MarketDataError("AUTH", `Twelve Data rejected the API key: ${clean}`);
  if (code === 429) return new MarketDataError("RATE_LIMITED", `Twelve Data rate limit / credits exhausted: ${clean}`);
  if (code === 403) return new MarketDataError("PLAN_RESTRICTED", `Not available on the current Twelve Data plan: ${clean}`);
  if (code === 404 || /symbol/i.test(clean)) return new MarketDataError("INVALID_SYMBOL", `Twelve Data: ${clean}`);
  return new MarketDataError("UNAVAILABLE", `Twelve Data error ${code}: ${clean}`);
}

/** "2026-09-30 10:45:00" or "2026-09-30" in the requested timezone (we always request UTC) → unix ms. */
export function parseUtcDatetime(datetime: string): number {
  const iso = datetime.length <= 10 ? `${datetime}T00:00:00Z` : `${datetime.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new MarketDataError("BAD_RESPONSE", `Unreadable candle time "${datetime}".`);
  return ms;
}

export function parseTimeSeries(body: unknown): Candle[] {
  const parsed = timeSeriesBody.safeParse(body);
  if (!parsed.success) throw new MarketDataError("BAD_RESPONSE", "Twelve Data candles were not in the expected format.");
  if (parsed.data.values.length === 0) throw new MarketDataError("NO_DATA", "Twelve Data returned no candles.");
  const candles = parsed.data.values.map((v) => ({
    timestamp: parseUtcDatetime(v.datetime),
    open: v.open,
    high: v.high,
    low: v.low,
    close: v.close,
    ...(v.volume !== undefined && Number.isFinite(v.volume) && v.volume > 0 ? { volume: v.volume } : {}),
  }));
  if (!candles.every((c) => [c.open, c.high, c.low, c.close].every((x) => Number.isFinite(x) && x > 0))) {
    throw new MarketDataError("BAD_RESPONSE", "Twelve Data candles contain invalid prices.");
  }
  // Twelve Data returns newest first unless order=asc is honoured; never rely on it.
  return candles.sort((a, b) => a.timestamp - b.timestamp);
}

/** /quote has no bid/ask; the last close is used as the mid and the spread is unknown. */
export function parseRestQuote(body: unknown, symbol: string, receivedAt: number): Quote {
  const parsed = quoteBody.safeParse(body);
  if (!parsed.success || !Number.isFinite(parsed.data.close) || parsed.data.close <= 0) {
    throw new MarketDataError("BAD_RESPONSE", "Twelve Data quote was not in the expected format.");
  }
  const seconds = parsed.data.last_quote_at ?? parsed.data.timestamp;
  if (seconds === undefined) throw new MarketDataError("BAD_RESPONSE", "Twelve Data quote has no timestamp.");
  return {
    symbol: normalizeSymbol(parsed.data.symbol ?? symbol),
    bid: null,
    ask: null,
    mid: parsed.data.close,
    spread: null,
    timestamp: seconds * 1000,
    receivedAt,
    source: "twelvedata-rest",
  };
}

/** A WebSocket "price" event. Forex events carry bid/ask; when they don't, the spread is unknown. Null for other events. */
export function parseStreamPrice(message: unknown, receivedAt: number): Quote | null {
  const parsed = wsPrice.safeParse(message);
  if (!parsed.success || !Number.isFinite(parsed.data.price) || parsed.data.price <= 0) return null;
  const { bid, ask } = parsed.data;
  const hasBook = bid !== undefined && ask !== undefined && Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid;
  return {
    symbol: normalizeSymbol(parsed.data.symbol),
    bid: hasBook ? bid : null,
    ask: hasBook ? ask : null,
    mid: hasBook ? (bid + ask) / 2 : parsed.data.price,
    spread: hasBook ? ask - bid : null,
    timestamp: parsed.data.timestamp * 1000,
    receivedAt,
    source: "twelvedata-ws",
  };
}

/** /forex_pairs → instruments the app can size (both legs recognised). */
export function parseForexPairs(body: unknown): Instrument[] {
  const parsed = forexPairsBody.safeParse(body);
  if (!parsed.success) throw new MarketDataError("BAD_RESPONSE", "Twelve Data symbol list was not in the expected format.");
  const out: Instrument[] = [];
  for (const p of parsed.data.data) {
    const spec = getInstrument(p.symbol);
    if (!spec) continue;
    out.push({
      symbol: spec.symbol,
      name: p.currency_base && p.currency_quote ? `${p.currency_base} / ${p.currency_quote}` : spec.symbol,
      base: spec.base,
      quote: spec.quote,
      type: spec.assetClass,
    });
  }
  return out;
}

export function matchesQuery(instrument: Instrument, query: string): boolean {
  const q = query.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!q) return true;
  return instrument.symbol.replace("/", "").includes(q) || instrument.name.toUpperCase().includes(query.trim().toUpperCase());
}
