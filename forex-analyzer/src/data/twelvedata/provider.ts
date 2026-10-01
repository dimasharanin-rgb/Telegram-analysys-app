import type { Candle, Instrument, Quote } from "@/shared/types/market";
import type { Timeframe } from "@/shared/types/trade";
import { getInstrument, normalizeSymbol } from "@/shared/instruments";
import { MarketDataError, type MarketDataProvider } from "../types";
import type { UsageTracker } from "../usage";
import { INTERVALS, matchesQuery, parseError, parseForexPairs, parseRestQuote, parseTimeSeries } from "./normalize";

export interface TwelveDataOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  usage?: UsageTracker;
  now?: () => number;
}

const SYMBOL_LIST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * REST access to Twelve Data. The API key travels in the Authorization header,
 * never in a URL, and never leaves the server.
 */
export class TwelveDataProvider implements MarketDataProvider {
  readonly id = "twelvedata";
  readonly name = "Twelve Data";
  readonly mode = "LIVE" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private symbolList: { at: number; list: Promise<Instrument[]> } | null = null;

  constructor(private readonly options: TwelveDataOptions) {
    if (!options.apiKey) throw new MarketDataError("NOT_CONFIGURED", "TWELVE_DATA_API_KEY is not set.");
    this.baseUrl = options.baseUrl ?? "https://api.twelvedata.com";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  supportsTimeframe(timeframe: Timeframe): boolean {
    return timeframe in INTERVALS;
  }

  private symbol(raw: string): string {
    const spec = getInstrument(raw);
    if (!spec) throw new MarketDataError("INVALID_SYMBOL", `"${raw}" is not a recognised Forex symbol.`);
    return spec.symbol;
  }

  private async request(endpoint: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(endpoint, this.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    this.options.usage?.twelveDataRequest(endpoint);
    try {
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
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new MarketDataError(response.status === 429 ? "RATE_LIMITED" : "BAD_RESPONSE", `Twelve Data returned an unreadable response (HTTP ${response.status}).`);
      }
      const error = parseError(body, response.status);
      if (error) throw error;
      return body;
    } catch (error) {
      this.options.usage?.twelveDataError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async getCandles(symbol: string, interval: Timeframe, outputSize: number): Promise<Candle[]> {
    const body = await this.request("/time_series", {
      symbol: this.symbol(symbol),
      interval: INTERVALS[interval],
      outputsize: String(Math.min(5000, Math.max(1, Math.round(outputSize)))),
      timezone: "UTC",
      order: "asc",
    });
    return parseTimeSeries(body);
  }

  async getQuote(symbol: string): Promise<Quote> {
    const s = this.symbol(symbol);
    const body = await this.request("/quote", { symbol: s, interval: "1min", timezone: "UTC" });
    return parseRestQuote(body, s, this.now());
  }

  /** Searches Twelve Data's Forex pair list, fetched at most once a day and filtered locally. */
  async searchSymbols(query: string): Promise<Instrument[]> {
    if (!this.symbolList || this.now() - this.symbolList.at > SYMBOL_LIST_TTL_MS) {
      const list = this.request("/forex_pairs", {}).then(parseForexPairs);
      this.symbolList = { at: this.now(), list };
      list.catch(() => (this.symbolList = null));
    }
    const all = await this.symbolList.list;
    const exact = normalizeSymbol(query);
    return all
      .filter((i) => matchesQuery(i, query))
      .sort((a, b) => Number(b.symbol === exact) - Number(a.symbol === exact) || a.symbol.localeCompare(b.symbol))
      .slice(0, 25);
  }
}
