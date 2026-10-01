import { describe, expect, it, vi } from "vitest";
import type { AiAssessment } from "@/shared/types/ai";
import type { AnalysisResult } from "@/shared/types/analysis";
import type { TradeInput } from "@/shared/types/trade";
import type { TradeAnalyst } from "@/ai/analyst";
import { AiError } from "@/ai/errors";
import { MockAnalyst } from "@/ai/mockAnalyst";
import { parseClaudeResponse } from "@/ai/parse";
import type { ClaudePayload } from "@/ai/payload";
import { analyzeTrade, type AnalysisDeps } from "@/analysis/analysisService";
import { decide } from "@/analysis/decision";
import { MockMarketDataProvider } from "@/data/mock/mockProvider";
import { MarketDataError, type MarketDataProvider } from "@/data/types";
import { account, risk, settings } from "./helpers";
import { validAssessment } from "./fixtures";

const NOW = new Date("2026-09-30T11:00:00Z");

function stubAnalyst(assessment: AiAssessment | (() => Promise<never>) = validAssessment()) {
  const calls: ClaudePayload[] = [];
  const analyst: TradeAnalyst = {
    provider: "anthropic",
    model: "stub",
    analyze: vi.fn(async (payload: ClaudePayload) => {
      calls.push(payload);
      if (typeof assessment === "function") return assessment();
      return { assessment, info: { provider: "anthropic" as const, model: "stub", servedBy: "stub", durationMs: 1, notes: [] } };
    }),
  };
  return { analyst, calls };
}

function deps(analyst: TradeAnalyst, opts: { market?: MarketDataProvider; now?: Date; settings?: Parameters<typeof settings>[0] } = {}) {
  const now = opts.now ?? NOW;
  const saved: AnalysisResult[] = [];
  const d: AnalysisDeps = {
    market: opts.market ?? new MockMarketDataProvider({ now: () => now }),
    analyst,
    getSettings: () => settings(opts.settings),
    getAccountState: () => account(),
    saveAnalysis: (r) => {
      saved.push(r);
      return `id-${saved.length}`;
    },
    now: () => now,
    maxQuoteAgeSeconds: 300,
  };
  return { d, saved };
}

/** A valid 20-pip / 45-pip EURUSD trade at the mock market's current price. */
async function marketTrade(patch: Partial<TradeInput> = {}, now = NOW): Promise<TradeInput> {
  const price = (await new MockMarketDataProvider({ now: () => now }).getQuote("EUR/USD")).mid;
  return { pair: "EUR/USD", direction: "LONG", entry: price, stopLoss: +(price - 0.002).toFixed(5), takeProfit: +(price + 0.0045).toFixed(5), timeframe: "M15", ...patch };
}

describe("analysis pipeline", () => {
  it("never calls the AI for a trade that breaks a hard rule", async () => {
    const { analyst } = stubAnalyst();
    const { d, saved } = deps(analyst);
    const result = await analyzeTrade(await marketTrade({ positionSize: 1 }), d);
    expect(result.state).toBe("BLOCKED");
    expect(result.decision.finalVerdict).toBe("BLOCKED");
    expect(result.decision.reasons.join(" ")).toMatch(/Risk within limit/);
    expect(analyst.analyze).not.toHaveBeenCalled();
    expect(result.ai).toBeNull();
    expect(saved).toHaveLength(1);
    expect(result.id).toBe("id-1");
  });

  it("the AI cannot override the risk engine, however good it says the setup is", () => {
    const report = risk({ positionSize: 1 }); // 1% > 0.5%
    const decision = decide({ risk: report, unavailable: null, assessment: validAssessment({ verdict: "ACCEPTABLE", setupQuality: 99 }), marketChecks: [], settings: settings() });
    expect(decision.finalVerdict).toBe("BLOCKED");
    expect(decision.aiVerdict).toBeNull();
  });

  it("returns an AI verdict for a valid trade with fresh data", async () => {
    const { analyst, calls } = stubAnalyst();
    const { d } = deps(analyst);
    const result = await analyzeTrade(await marketTrade({ thesis: "Breakout and retest" }), d);
    expect(result.state).toBe("ANALYZED");
    expect(result.decision.aiVerdict).toBe("ACCEPTABLE");
    expect(result.market?.timeframes.map((t) => t.timeframe)).toEqual(["H4", "H1", "M15", "M5"]);
    expect(analyst.analyze).toHaveBeenCalledOnce();

    const payload = calls[0]!;
    expect(payload.pair).toBe("EUR/USD");
    expect(payload.risk.riskPercent).toBeLessThanOrEqual(0.5);
    expect(Object.keys(payload.structure)).toEqual(["h4", "h1", "m15", "m5"]);
    expect(payload.userThesis).toBe("Breakout and retest");
    expect(payload.market.syntheticData).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key/i);
  });

  it("does not produce a verdict when the quote is stale", async () => {
    const { analyst } = stubAnalyst();
    const inner = new MockMarketDataProvider({ now: () => NOW });
    const stale: MarketDataProvider = {
      id: "stale",
      name: "Stale feed",
      mode: "LIVE",
      supportsTimeframe: (tf) => inner.supportsTimeframe(tf),
      getCandles: (p, tf, n) => inner.getCandles(p, tf, n),
      getQuote: async (p) => ({ ...(await inner.getQuote(p)), timestamp: NOW.getTime() - 3_600_000 }),
      searchSymbols: async () => [],
    };
    const { d } = deps(analyst, { market: stale });
    const result = await analyzeTrade(await marketTrade(), d);
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.decision.headline).toBe("ANALYSIS UNAVAILABLE");
    expect(result.unavailable?.message).toMatch(/^Market data could not be verified/);
    expect(result.ai).toBeNull();
    expect(analyst.analyze).not.toHaveBeenCalled();
  });

  it("does not produce a verdict when candles are missing", async () => {
    const { analyst } = stubAnalyst();
    const inner = new MockMarketDataProvider({ now: () => NOW });
    const short: MarketDataProvider = { id: "x", name: "x", mode: "MOCK", supportsTimeframe: () => true, searchSymbols: async () => [], getQuote: (p) => inner.getQuote(p), getCandles: async (p, tf) => (await inner.getCandles(p, tf, 260)).slice(-10) };
    const result = await analyzeTrade(await marketTrade(), deps(analyst, { market: short }).d);
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.unavailable?.code).toBe("BAD_CANDLES");
    expect(analyst.analyze).not.toHaveBeenCalled();
  });

  it("reports a provider failure as unavailable market data", async () => {
    const { analyst } = stubAnalyst();
    const failing: MarketDataProvider = {
      id: "down",
      name: "Down",
      mode: "LIVE",
      supportsTimeframe: () => true,
      searchSymbols: async () => [],
      getQuote: async () => {
        throw new MarketDataError("TIMEOUT", "Provider did not respond in time.");
      },
      getCandles: async () => [],
    };
    const result = await analyzeTrade(await marketTrade(), deps(analyst, { market: failing }).d);
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.unavailable).toMatchObject({ stage: "MARKET_DATA", code: "TIMEOUT" });
  });

  it("reports a Claude failure as unavailable but keeps the risk and market results", async () => {
    const { analyst } = stubAnalyst(async () => {
      throw new AiError("TIMEOUT", "Claude did not respond in time.");
    });
    const result = await analyzeTrade(await marketTrade(), deps(analyst).d);
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.unavailable).toMatchObject({ stage: "AI", code: "TIMEOUT" });
    expect(result.decision.finalVerdict).toBe("UNAVAILABLE");
    expect(result.risk.calculation).not.toBeNull();
    expect(result.market).not.toBeNull();
    expect(result.ai).toBeNull();
  });

  it("treats malformed AI output as unavailable, never as a verdict", async () => {
    const analyst: TradeAnalyst = {
      provider: "anthropic",
      model: "stub",
      analyze: async () => ({ assessment: parseClaudeResponse("Looks bullish, I'd buy.").assessment, info: { provider: "anthropic", model: "s", servedBy: "s", durationMs: 1, notes: [] } }),
    };
    const result = await analyzeTrade(await marketTrade(), deps(analyst).d);
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.unavailable?.code).toBe("MALFORMED");
  });

  it("caps an ACCEPTABLE verdict at CAUTION when a rule warns (outside sessions)", async () => {
    const night = new Date("2026-09-30T03:00:00Z");
    const { analyst } = stubAnalyst(validAssessment({ verdict: "ACCEPTABLE", setupQuality: 80 }));
    const result = await analyzeTrade(await marketTrade({}, night), deps(analyst, { now: night, settings: { tradingSessions: ["LONDON"] } }).d);
    expect(result.decision.aiVerdict).toBe("ACCEPTABLE");
    expect(result.decision.finalVerdict).toBe("CAUTION");
    expect(result.decision.capped).toBe(true);
    expect(result.decision.reasons.join(" ")).toMatch(/Trading session/);
  });

  it("caps at CAUTION below the minimum setup score, and never raises a REJECT", () => {
    const base = { risk: risk(), unavailable: null, marketChecks: [], settings: settings({ minSetupScore: 60 }) };
    const low = decide({ ...base, assessment: validAssessment({ verdict: "ACCEPTABLE", setupQuality: 55 }) });
    expect(low.finalVerdict).toBe("CAUTION");
    expect(low.reasons[0]).toMatch(/below your minimum of 60/);
    expect(decide({ ...base, assessment: validAssessment({ verdict: "REJECT", setupQuality: 90 }) }).finalVerdict).toBe("REJECT");
    expect(decide({ ...base, assessment: validAssessment({ verdict: "ACCEPTABLE", setupQuality: 75 }) }).finalVerdict).toBe("ACCEPTABLE");
  });

  it("runs end to end in mock mode without any API key", async () => {
    const result = await analyzeTrade(await marketTrade(), deps(new MockAnalyst()).d);
    expect(result.state).toBe("ANALYZED");
    expect(["ACCEPTABLE", "CAUTION", "REJECT"]).toContain(result.ai!.assessment.verdict);
    expect(result.ai!.assessment.summary).toMatch(/^MOCK ANALYSIS/);
    expect(result.ai!.info.provider).toBe("mock");
  });
});
