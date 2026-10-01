import { z } from "zod";
import type { Candle, MarketPrice } from "@/types/market";
import type { Timeframe } from "@/types/trade";
import { getInstrument } from "@/lib/instruments";
import { MarketDataError, type MarketDataProvider } from "./types";

const INTERVALS: Record<Timeframe, string> = {
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "1h",
  H4: "4h",
  D1: "1day",
};

const errorBody = z.object({ status: z.literal("error"), code: z.number().optional(), message: z.string().optional() });

const timeSeriesBody = z.object({
  status: z.literal("ok").optional(),
  values: z
    .array(
      z.object({
        datetime: z.string(),
        open: z.string(),
        high: z.string(),
        low: z.string(),
        close: z.string(),
      }),
    )
    .min(1),
});

const quoteBody = z.object({
  close: z.string(),
  timestamp: z.number().optional(),
  last_quote_at: z.number().optional(),
  datetime: z.string().optional(),
});

export interface TwelveDataOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Market data from Twelve Data (https://twelvedata.com). It provides quotes and
 * OHLC candles but no bid/ask spread, so `spread` is reported as null and the
 * analysis says so instead of guessing one.
 */
export class TwelveDataProvider implements MarketDataProvider {
  readonly id = "twelvedata";
  readonly name = "Twelve Data";
  readonly isMock = false;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TwelveDataOptions) {
    if (!options.apiKey) throw new MarketDataError("NOT_CONFIGURED", "MARKET_DATA_API_KEY is not set.");
    this.baseUrl = options.baseUrl ?? "https://api.twelvedata.com";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  supportsTimeframe(timeframe: Timeframe): boolean {
    return timeframe in INTERVALS;
  }

  private symbol(pair: string): string {
    const instrument = getInstrument(pair);
    if (!instrument) throw new MarketDataError("UNSUPPORTED_PAIR", `Unknown instrument "${pair}".`);
    return `${instrument.base}/${instrument.quote}`;
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `apikey ${this.options.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new MarketDataError("TIMEOUT", "Twelve Data did not respond in time.");
      }
      throw new MarketDataError("UNAVAILABLE", "Could not reach Twelve Data.");
    }
    if (response.status === 429) throw new MarketDataError("RATE_LIMITED", "Twelve Data rate limit reached.");
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MarketDataError("BAD_RESPONSE", `Twelve Data returned an unreadable response (HTTP ${response.status}).`);
    }
    const err = errorBody.safeParse(body);
    if (err.success || !response.ok) {
      const code = err.success ? err.data.code : response.status;
      const message = err.success ? err.data.message : undefined;
      if (code === 429) throw new MarketDataError("RATE_LIMITED", "Twelve Data rate limit reached.");
      throw new MarketDataError("UNAVAILABLE", `Twelve Data error${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}.`);
    }
    return body;
  }

  async getCandles(pair: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const body = await this.request("/time_series", {
      symbol: this.symbol(pair),
      interval: INTERVALS[timeframe],
      outputsize: String(limit),
      timezone: "UTC",
      order: "asc",
    });
    const parsed = timeSeriesBody.safeParse(body);
    if (!parsed.success) throw new MarketDataError("BAD_RESPONSE", "Twelve Data candles were not in the expected format.");
    return parsed.data.values.map((v) => ({
      time: Math.floor(Date.parse(`${v.datetime.replace(" ", "T")}${v.datetime.length > 10 ? "" : "T00:00:00"}Z`) / 1000),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }));
  }

  async getCurrentPrice(pair: string): Promise<MarketPrice> {
    const body = await this.request("/quote", { symbol: this.symbol(pair), interval: "1min", timezone: "UTC" });
    const parsed = quoteBody.safeParse(body);
    if (!parsed.success) throw new MarketDataError("BAD_RESPONSE", "Twelve Data quote was not in the expected format.");
    const price = Number(parsed.data.close);
    const seconds = parsed.data.last_quote_at ?? parsed.data.timestamp;
    if (!Number.isFinite(price) || seconds === undefined) {
      throw new MarketDataError("BAD_RESPONSE", "Twelve Data quote is missing a price or timestamp.");
    }
    return {
      pair: pair.toUpperCase(),
      price,
      bid: null,
      ask: null,
      spread: null,
      timestamp: seconds * 1000,
      source: this.id,
    };
  }
}
