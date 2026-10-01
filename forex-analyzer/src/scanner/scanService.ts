import type { ScanResult, SetupCandidate, SetupDetectionConfig, SymbolScanStatus } from "@/shared/types/setup";
import { PRIMARY_TIMEFRAMES, TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";
import { getInstrument } from "@/shared/instruments";
import { collectMarketData } from "@/data/collect";
import { candleProblem } from "@/data/freshness";
import { MarketDataError, type MarketDataProvider } from "@/data/types";
import { buildAnalysisSnapshot } from "@/technical/snapshot";
import { DEFAULT_SETUP_CONFIG, detectSetups } from "@/setups";

export interface ScanRequest {
  symbols: string[];
  /** Entry timeframes to look for setups on; higher timeframes are fetched as context. */
  timeframes: Timeframe[];
  config?: SetupDetectionConfig;
}

/** Deliberately no AI here: the scanner's dependencies cannot reach Claude. */
export interface ScanDeps {
  market: MarketDataProvider;
  now: () => number;
  maxAgeSeconds: number;
}

/** Candles needed for EMA 200 plus margin. */
const SCAN_CANDLES = 260;
const MIN_CANDLES = 60;

/** Entry timeframes plus every higher primary timeframe as context, highest first. */
export function timeframesFor(entry: Timeframe[]): Timeframe[] {
  const lowest = Math.min(...entry.map((t) => TIMEFRAME_SECONDS[t]));
  const set = new Set<Timeframe>([...entry, ...PRIMARY_TIMEFRAMES.filter((t) => TIMEFRAME_SECONDS[t] >= lowest)]);
  return [...set].sort((a, b) => TIMEFRAME_SECONDS[b] - TIMEFRAME_SECONDS[a]);
}

/**
 * One on-demand scan: for each symbol, collect market data once (through the
 * provider and its cache), build the snapshot, and run the setup detector.
 * No loop, no schedule, no notifications, no AI, no orders. A symbol whose data
 * is missing or stale is reported as UNAVAILABLE and not analysed.
 */
export async function scanMarket(request: ScanRequest, deps: ScanDeps): Promise<ScanResult> {
  const config = { ...(request.config ?? DEFAULT_SETUP_CONFIG), allowedTimeframes: request.timeframes };
  const timeframes = timeframesFor(request.timeframes).filter((tf) => deps.market.supportsTimeframe(tf));
  const symbols: SymbolScanStatus[] = [];
  const candidates: SetupCandidate[] = [];

  for (const raw of request.symbols) {
    const symbol = getInstrument(raw)?.symbol ?? raw;
    try {
      if (!getInstrument(symbol)) throw new MarketDataError("INVALID_SYMBOL", `"${raw}" is not a recognised Forex symbol.`);
      const data = await collectMarketData(deps.market, symbol, { timeframes, candles: SCAN_CANDLES, maxAgeSeconds: deps.maxAgeSeconds, now: deps.now });
      if (data.stale) throw new MarketDataError("UNAVAILABLE", data.staleReasons[0] ?? "Market data is stale.");
      for (const tf of request.timeframes) {
        const problem = candleProblem(data.candles[tf] ?? [], tf, deps.now(), MIN_CANDLES);
        if (problem) throw new MarketDataError("NO_DATA", problem);
      }
      const found = detectSetups(buildAnalysisSnapshot(data, deps.now()), config);
      candidates.push(...found);
      symbols.push({ symbol, status: "OK", candidates: found.length });
    } catch (error) {
      if (!(error instanceof MarketDataError)) throw error;
      symbols.push({ symbol, status: "UNAVAILABLE", reason: error.message, candidates: 0 });
    }
  }
  return { scannedAt: deps.now(), timeframes: request.timeframes, symbols, candidates };
}
