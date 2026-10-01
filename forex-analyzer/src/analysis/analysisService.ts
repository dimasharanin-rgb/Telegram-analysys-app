import type { AnalysisResult, AnalysisSnapshot, UnavailableReason } from "@/shared/types/analysis";
import type { MarketDataSnapshot } from "@/shared/types/market";
import type { AccountState, RiskReport } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";
import type { TradeInput } from "@/shared/types/trade";
import { getInstrument, normalizeSymbol } from "@/shared/instruments";
import { conversionSymbols, runRiskEngine } from "@/risk";
import { analysisTimeframes, buildAnalysisSnapshot } from "@/technical";
import { collectMarketData } from "@/data/collect";
import { buildTradeContext } from "@/technical/tradeContext";
import type { TradeAnalyst } from "@/ai/analyst";
import { AiError } from "@/ai/errors";
import { buildClaudePayload } from "@/ai/payload";
import { candleProblem, quoteMatchesCandles, quoteProblem } from "@/data/freshness";
import { MarketDataError, type MarketDataProvider } from "@/data/types";
import { decide } from "@/analysis/decision";
import { runMarketChecks } from "@/analysis/marketChecks";

/** Candles requested per timeframe: enough for EMA 200 plus a margin. */
export const CANDLE_LIMIT = 260;
/** Minimum candles for a timeframe to be usable at all. */
const MIN_CANDLES_TRADE_TF = 60;
const MIN_CANDLES_CONTEXT_TF = 30;

export interface AnalysisDeps {
  market: MarketDataProvider;
  analyst: TradeAnalyst;
  getSettings(): AccountSettings;
  getAccountState(settings: AccountSettings, now: Date): AccountState;
  saveAnalysis(result: AnalysisResult): string;
  now(): Date;
  maxQuoteAgeSeconds: number;
}

/** Conversion rates move slowly relative to their effect on risk; reusing them for a minute saves API credits. */
const CONVERSION_TTL_MS = 60_000;
const conversionCache = new Map<string, { rate: number; at: number }>();

/** Fetches the prices needed to convert P/L into the account currency. Failures leave the lookup empty. */
async function conversionQuotes(market: MarketDataProvider, pair: string, currency: string): Promise<Map<string, number>> {
  const quotes = new Map<string, number>();
  const instrument = getInstrument(pair);
  if (!instrument) return quotes;
  for (const symbol of conversionSymbols(instrument, currency)) {
    const key = `${market.mode}:${symbol}`;
    const hit = conversionCache.get(key);
    if (hit && Date.now() - hit.at < CONVERSION_TTL_MS) {
      quotes.set(symbol, hit.rate);
      break;
    }
    try {
      const q = await market.getQuote(symbol);
      quotes.set(symbol, q.mid);
      conversionCache.set(key, { rate: q.mid, at: Date.now() });
      break;
    } catch {
      // try the next candidate; the risk engine reports a BLOCK if none is available
    }
  }
  return quotes;
}

export async function evaluateRisk(trade: TradeInput, deps: AnalysisDeps): Promise<RiskReport> {
  const now = deps.now();
  const settings = deps.getSettings();
  const account = deps.getAccountState(settings, now);
  const quotes = await conversionQuotes(deps.market, trade.pair, settings.currency);
  return runRiskEngine({ trade, settings, account, quotes: (s) => quotes.get(s), now });
}

class UnavailableError extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(reason.message);
  }
}

function marketUnavailable(code: string, message: string): UnavailableError {
  return new UnavailableError({ stage: "MARKET_DATA", code, message: `Market data could not be verified. ${message}` });
}

/**
 * Market data for an analysis, in three separate steps:
 *   1. collect normalised data from the provider (data layer),
 *   2. reject data that is stale, too short or inconsistent,
 *   3. build the analysed snapshot of market state at `now` (technical layer).
 */
async function loadMarket(trade: TradeInput, deps: AnalysisDeps, now: Date): Promise<AnalysisSnapshot> {
  const { market } = deps;
  const timeframes = analysisTimeframes(trade.timeframe).filter((tf) => market.supportsTimeframe(tf));
  if (!timeframes.includes(trade.timeframe)) {
    throw marketUnavailable("UNSUPPORTED_TIMEFRAME", `${market.name} does not provide ${trade.timeframe} candles.`);
  }

  let data: MarketDataSnapshot;
  try {
    data = await collectMarketData(market, trade.pair, { timeframes, candles: CANDLE_LIMIT, maxAgeSeconds: deps.maxQuoteAgeSeconds, now: () => now.getTime() });
  } catch (error) {
    if (error instanceof MarketDataError) throw marketUnavailable(error.code, error.message);
    throw marketUnavailable("UNAVAILABLE", "The market data provider failed.");
  }

  const stale = quoteProblem(data.quote, now.getTime(), deps.maxQuoteAgeSeconds);
  if (stale) throw marketUnavailable("STALE_QUOTE", stale);
  for (const tf of timeframes) {
    const problem = candleProblem(data.candles[tf] ?? [], tf, now.getTime(), tf === trade.timeframe ? MIN_CANDLES_TRADE_TF : MIN_CANDLES_CONTEXT_TF);
    if (problem) throw marketUnavailable("BAD_CANDLES", problem);
  }

  const snapshot = buildAnalysisSnapshot(data, now.getTime());
  const own = snapshot.timeframes.find((a) => a.timeframe === trade.timeframe)!;
  const mismatch = quoteMatchesCandles(snapshot.price, snapshot.candles[trade.timeframe]!, own.indicators.atr14);
  if (mismatch) throw marketUnavailable("INCONSISTENT", mismatch);
  return snapshot;
}

/**
 * The full pipeline:
 *   risk engine → (stop if BLOCKED) → market data → technical analysis
 *   → deterministic market checks → AI assessment → decision → journal.
 *
 * The AI is called only for trades that pass every hard rule and only with
 * verified, fresh market data. Every outcome, blocked or not, is saved.
 */
export async function analyzeTrade(input: TradeInput, deps: AnalysisDeps): Promise<AnalysisResult> {
  const now = deps.now();
  const settings = deps.getSettings();
  const trade: TradeInput = { ...input, pair: normalizeSymbol(input.pair), thesis: input.thesis?.trim() ?? "" };
  const risk = await evaluateRisk(trade, deps);

  const base = {
    id: null,
    createdAt: now.toISOString(),
    trade,
    risk,
    settings,
  };

  if (risk.status === "BLOCKED" || !risk.calculation) {
    const result: AnalysisResult = {
      ...base,
      state: "BLOCKED",
      market: null,
      marketChecks: [],
      context: null,
      ai: null,
      unavailable: null,
      decision: decide({ risk, unavailable: null, assessment: null, marketChecks: [], settings }),
    };
    return { ...result, id: deps.saveAnalysis(result) };
  }

  const instrument = getInstrument(trade.pair)!;
  let market: AnalysisSnapshot | null = null;
  let unavailable: UnavailableReason | null = null;
  let ai: AnalysisResult["ai"] = null;
  let context: AnalysisResult["context"] = null;
  let marketChecks: AnalysisResult["marketChecks"] = [];

  try {
    market = await loadMarket(trade, deps, now);
    context = buildTradeContext(trade, market.price, market.timeframes);
    marketChecks = runMarketChecks(market.price, context, instrument);
    const payload = buildClaudePayload({ trade, instrument, risk, calculation: risk.calculation, market, context, marketChecks });
    try {
      ai = await deps.analyst.analyze(payload);
    } catch (error) {
      const e = error instanceof AiError ? error : new AiError("API_ERROR", "The AI analysis failed unexpectedly.");
      unavailable = { stage: "AI", code: e.code, message: `AI analysis failed. ${e.message}` };
    }
  } catch (error) {
    if (!(error instanceof UnavailableError)) throw error;
    unavailable = error.reason;
  }

  const result: AnalysisResult = {
    ...base,
    state: unavailable ? "UNAVAILABLE" : "ANALYZED",
    market,
    marketChecks,
    context,
    ai: unavailable ? null : ai,
    unavailable,
    decision: decide({ risk, unavailable, assessment: unavailable ? null : (ai?.assessment ?? null), marketChecks, settings }),
  };
  return { ...result, id: deps.saveAnalysis(result) };
}
