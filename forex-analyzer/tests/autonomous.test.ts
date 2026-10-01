import { describe, expect, it, vi } from "vitest";
import type { CandidateEvaluation, StoredCandidate } from "@/shared/types/autonomous";
import type { Candle, MarketDataSnapshot } from "@/shared/types/market";
import { TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";
import { AiError } from "@/ai/errors";
import type { AnalysisDeps } from "@/analysis/analysisService";
import { ClaudeCandidateEvaluator, type CandidateEvaluator } from "@/autonomous/evaluator";
import { parseCandidateEvaluation } from "@/autonomous/parse";
import { buildCandidatePayload } from "@/autonomous/payload";
import { AUTONOMOUS_PROMPT_VERSION } from "@/autonomous/prompt";
import { analyzeCandidate } from "@/autonomous/service";
import { MockMarketDataProvider } from "@/data/mock/mockProvider";
import { DecisionLog } from "@/journal/decisionLog";
import { openDatabase } from "@/journal/db";
import { computeLimits } from "@/risk";
import { detectSetups, setupConfig } from "@/setups";
import { buildAnalysisSnapshot } from "@/technical";
import { account, settings } from "./helpers";

const END = Date.UTC(2026, 8, 30, 12);

function wave(tf: Timeframe, drift: number, amp: number, phase: number, n = 260): Candle[] {
  const ms = TIMEFRAME_SECONDS[tf] * 1000;
  const price = (k: number) => 1.1 + drift * k + amp * Math.sin(((k - n + 1 + phase) / 20) * 2 * Math.PI);
  return Array.from({ length: n }, (_, k) => {
    const close = price(k);
    const open = price(k - 1);
    return { timestamp: END - (n - k) * ms, open, high: Math.max(open, close) + amp * 0.05, low: Math.min(open, close) - amp * 0.05, close };
  });
}

/** A bullish market and the LONG M15 continuation the detector finds in it. */
function storedCandidate(): StoredCandidate {
  const candles = { H4: wave("H4", 0.00064, 0.004, 15), H1: wave("H1", 0.00016, 0.002, 15), M15: wave("M15", 0.00004, 0.001, 15) };
  const mid = candles.M15.at(-1)!.close;
  const data: MarketDataSnapshot = {
    symbol: "EUR/USD",
    mode: "LIVE",
    source: "twelvedata",
    sourceName: "Twelve Data",
    quote: { symbol: "EUR/USD", bid: mid - 0.00003, ask: mid + 0.00003, mid, spread: 0.00006, timestamp: END, receivedAt: END, source: "twelvedata-ws" },
    candles,
    dataTimestamp: END,
    retrievedAt: END,
    stale: false,
    staleReasons: [],
  };
  const snap = buildAnalysisSnapshot(data, END);
  const candidate = detectSetups(snap, setupConfig()).find((c) => c.timeframe === "M15" && c.setupType === "CONTINUATION")!;
  return { candidate, snapshot: { ...snap.metadata, asOf: snap.asOf, price: snap.price } };
}

const s = settings({ tradingSessions: [] });
function analysisDeps(): AnalysisDeps {
  return {
    market: new MockMarketDataProvider({ now: () => new Date(END) }),
    analyst: { provider: "mock", model: "unused", analyze: () => Promise.reject(new Error("unused")) },
    getSettings: () => s,
    getAccountState: () => account(),
    saveAnalysis: () => "unused",
    now: () => new Date(END),
    maxQuoteAgeSeconds: 120,
  };
}

function evaluation(patch: Partial<CandidateEvaluation> = {}): CandidateEvaluation {
  return {
    decision: "TRADE",
    direction: "LONG",
    setupQuality: 74,
    trade: { entry: 1.2, stopLoss: 1.198, takeProfit: 1.205 },
    riskAssessment: { riskDistance: 0.002, rewardDistance: 0.005, rr: 2.5 },
    technicalAssessment: { trendAlignment: "GOOD", marketStructure: "GOOD", momentum: "MODERATE", entryQuality: "GOOD", stopPlacement: "GOOD", targetPlacement: "GOOD" },
    positiveFactors: ["H4 and H1 bullish"],
    warnings: [],
    contradictingFactors: [],
    invalidation: ["M15 closes below the swing low"],
    summary: "Bullish structure with room to the next resistance.",
    ...patch,
  };
}

function stub(result: CandidateEvaluation | (() => never), model = "stub-model") {
  const evaluate = vi.fn(async () => {
    if (typeof result === "function") return result();
    return { evaluation: result, servedBy: "stub", notes: [] };
  });
  const evaluator: CandidateEvaluator = { provider: "anthropic", model, evaluate };
  return { evaluator, evaluate };
}

function run(stored: StoredCandidate, evaluator: CandidateEvaluator, opts: { now?: number; log?: DecisionLog } = {}) {
  const log = opts.log ?? new DecisionLog(openDatabase(":memory:"));
  return { log, result: analyzeCandidate(stored, { evaluator, analysis: analysisDeps(), log, now: () => opts.now ?? END + 1000, freshnessSeconds: 120 }) };
}

/** A proposal relative to the candidate's current price. */
function proposal(stored: StoredCandidate, entryOff: number, stopOff: number, targetOff: number) {
  const p = stored.snapshot.price.mid;
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return { entry: r(p + entryOff), stopLoss: r(p + stopOff), takeProfit: r(p + targetOff) };
}

describe("AI output schema", () => {
  it("accepts a valid TRADE and a valid NO_TRADE", () => {
    expect(parseCandidateEvaluation(JSON.stringify(evaluation())).evaluation.decision).toBe("TRADE");
    const no = evaluation({ decision: "NO_TRADE", trade: null, riskAssessment: null, setupQuality: 42 });
    expect(parseCandidateEvaluation(JSON.stringify(no)).evaluation.trade).toBeNull();
  });

  it("rejects malformed, incomplete or out-of-range answers", () => {
    const bad = (v: unknown) => expect(() => parseCandidateEvaluation(typeof v === "string" ? v : JSON.stringify(v))).toThrow(AiError);
    bad("I would buy here.");
    bad("{ not json");
    bad({ ...evaluation(), setupQuality: 120 });
    bad({ ...evaluation(), setupQuality: 73.5 });
    bad({ ...evaluation(), decision: "BUY" });
    bad({ ...evaluation(), direction: "UP" });
    bad({ ...evaluation(), trade: { entry: -1, stopLoss: 1.19, takeProfit: 1.21 } });
    bad({ ...evaluation(), trade: { entry: "1.2", stopLoss: 1.19, takeProfit: 1.21 } });
    bad({ ...evaluation(), trade: null }); // TRADE without prices
    bad({ ...evaluation({ decision: "NO_TRADE" }) }); // NO_TRADE with prices
    const { summary: _s, ...missing } = evaluation();
    bad(missing);
    bad({ ...evaluation(), winProbability: 0.73 });
  });

  it("flags probability language", () => {
    const { notes } = parseCandidateEvaluation(JSON.stringify(evaluation({ summary: "A 73% chance of winning." })));
    expect(notes[0]).toMatch(/not a probability/);
  });
});

describe("risk validation of AI proposals (shared deterministic engine)", () => {
  it("passes an acceptable proposal and computes size, risk and R:R itself", async () => {
    const stored = storedCandidate();
    const { evaluator } = stub(evaluation({ trade: proposal(stored, 0, -0.002, 0.005), riskAssessment: { riskDistance: 0.002, rewardDistance: 0.005, rr: 9.9 } }));
    const r = await run(stored, evaluator).result;
    expect(r.aiDecision).toBe("TRADE");
    expect(r.riskValidation!.passed).toBe(true);
    expect(r.riskValidation!.calculatedRR).toBeCloseTo(2.5, 2);
    expect(r.riskValidation!.calculatedRiskPercent).toBeLessThanOrEqual(0.5);
    expect(r.riskValidation!.positionSizeLots).toBe(0.25);
    expect(r.riskValidation!.discrepancies[0]).toMatch(/AI stated R:R 9.9/);
    expect(r.finalDecision).toBe("TRADE");
  });

  it("rejects excessive risk even when the AI claims it is fine", async () => {
    const stored = storedCandidate();
    // 600-pip stop: even 0.01 lots risks $60 against a $50 maximum.
    const { evaluator } = stub(evaluation({ trade: proposal(stored, 0, -0.06, 0.15), riskAssessment: { riskDistance: 0.06, rewardDistance: 0.15, rr: 2.5 } }));
    const r = await run(stored, evaluator).result;
    expect(r.aiDecision).toBe("TRADE");
    expect(r.riskValidation!.passed).toBe(false);
    expect(r.riskValidation!.failures.join(" ")).toMatch(/Risk within limit|Position size/);
    expect(r.finalDecision).toBe("NO_TRADE");
  });

  it("rejects a stop on the wrong side", async () => {
    const stored = storedCandidate();
    const r = await run(stored, stub(evaluation({ trade: proposal(stored, 0, 0.002, 0.005) })).evaluator).result;
    expect(r.riskValidation!.failures.join(" ")).toMatch(/Stop loss on correct side/);
    expect(r.finalDecision).toBe("NO_TRADE");
  });

  it("rejects insufficient R:R against the configured minimum", async () => {
    const stored = storedCandidate();
    const r = await run(stored, stub(evaluation({ trade: proposal(stored, 0, -0.002, 0.002) })).evaluator).result;
    expect(r.riskValidation!.failures.join(" ")).toMatch(/R:R requirement/);
    expect(r.finalDecision).toBe("NO_TRADE");
  });

  it("rejects prices not based on the market and a flipped direction", async () => {
    const stored = storedCandidate();
    const far = await run(stored, stub(evaluation({ trade: proposal(stored, 0.05, 0.048, 0.055) })).evaluator).result;
    expect(far.riskValidation!.failures.join(" ")).toMatch(/not based on the supplied data/);
    const flipped = await run(stored, stub(evaluation({ direction: "SHORT", trade: proposal(stored, 0, 0.002, -0.005) })).evaluator).result;
    expect(flipped.riskValidation!.failures[0]).toMatch(/differs from the candidate/);
    expect([far.finalDecision, flipped.finalDecision]).toEqual(["NO_TRADE", "NO_TRADE"]);
  });
});

describe("final decision", () => {
  it("AI NO_TRADE → NO_TRADE without any risk run", async () => {
    const r = await run(storedCandidate(), stub(evaluation({ decision: "NO_TRADE", trade: null, riskAssessment: null })).evaluator).result;
    expect(r).toMatchObject({ aiDecision: "NO_TRADE", finalDecision: "NO_TRADE", riskValidation: null, proposedTrade: null });
  });

  it("malformed AI output fails safely to NO_TRADE", async () => {
    const { evaluator } = stub(() => {
      parseCandidateEvaluation("definitely buy");
      throw new Error("unreachable");
    });
    const r = await run(storedCandidate(), evaluator).result;
    expect(r).toMatchObject({ aiDecision: null, finalDecision: "NO_TRADE", error: { stage: "AI", code: "MALFORMED" } });
  });

  it("an AI timeout fails safely to NO_TRADE", async () => {
    const { evaluator } = stub(() => {
      throw new AiError("TIMEOUT", "Claude did not respond in time.");
    });
    expect((await run(storedCandidate(), evaluator).result).error?.code).toBe("TIMEOUT");
  });
});

describe("data protection", () => {
  it("never asks the AI about stale data", async () => {
    const { evaluator, evaluate } = stub(evaluation());
    const r = await run(storedCandidate(), evaluator, { now: END + 3_600_000 }).result;
    expect(evaluate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ finalDecision: "NO_TRADE", error: { stage: "DATA", code: "STALE" } });
  });

  it("the AI input holds no candles and nothing newer than the candidate time", () => {
    const stored = storedCandidate();
    const state = account();
    const payload = buildCandidatePayload(stored, { settings: s, state, limits: computeLimits(s, state) });
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/"candles"|"open"|"close"/);
    expect(payload.market.asOf).toBe(new Date(END).toISOString());
    expect(payload.technical.map((t) => t.timeframe)).toEqual(["M15", "H4", "H1"]);
    expect(payload.account).toMatchObject({ balance: 10_000, maxRiskPerTradePct: 0.5, minRiskReward: 2, maxOpenPositions: 1 });
  });

  it("refuses to build an AI input that contains later data", async () => {
    const stored = storedCandidate();
    const tampered: StoredCandidate = {
      ...stored,
      candidate: { ...stored.candidate, marketContext: stored.candidate.marketContext.map((t, i) => (i === 0 ? { ...t, lastCandleTime: END + 900_000 } : t)) },
    };
    const { evaluator, evaluate } = stub(evaluation());
    const r = await run(tampered, evaluator).result;
    expect(evaluate).not.toHaveBeenCalled();
    expect(r.error).toMatchObject({ stage: "DATA", code: "TEMPORAL" });
  });
});

describe("decision log", () => {
  it("records TRADE and NO_TRADE outcomes, with prompt version, model and snapshot time", async () => {
    const log = new DecisionLog(openDatabase(":memory:"));
    const stored = storedCandidate();
    await run(stored, stub(evaluation({ trade: proposal(stored, 0, -0.002, 0.005) })).evaluator, { log }).result;
    // A different model is a different cache key, so this one is really asked.
    await run(stored, stub(evaluation({ decision: "NO_TRADE", trade: null, riskAssessment: null }), "other-model").evaluator, { log }).result;
    await run(stored, stub(evaluation()).evaluator, { log, now: END + 3_600_000 }).result; // stale → NO_TRADE
    expect(log.counts()).toEqual({ total: 3, trade: 1, noTrade: 2 });
    const [latest] = log.recent(1);
    expect(latest).toMatchObject({ promptVersion: AUTONOMOUS_PROMPT_VERSION, candidateId: stored.candidate.id, snapshotAsOf: END });
    expect(log.recent().map((d) => d.model)).toContain("stub-model");
  });

  it("reuses an identical earlier analysis instead of calling the AI again", async () => {
    const log = new DecisionLog(openDatabase(":memory:"));
    const stored = storedCandidate();
    const { evaluator, evaluate } = stub(evaluation({ trade: proposal(stored, 0, -0.002, 0.005) }));
    const first = await run(stored, evaluator, { log }).result;
    const second = await run(stored, evaluator, { log }).result;
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
    expect(second.finalDecision).toBe(first.finalDecision);
  });
});

describe("Claude candidate evaluator", () => {
  it("sends the structured payload with the versioned prompt and a strict output schema", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: JSON.stringify(evaluation({ decision: "NO_TRADE", trade: null, riskAssessment: null })) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const stored = storedCandidate();
    const state = account();
    const ev = new ClaudeCandidateEvaluator("claude-opus-5-5", { apiKey: "k", timeoutMs: 5000, effort: "high", fetch: fetchImpl });
    const out = await ev.evaluate(buildCandidatePayload(stored, { settings: s, state, limits: computeLimits(s, state) }));
    expect(out.evaluation.decision).toBe("NO_TRADE");
    const body = bodies[0]!;
    expect(String(body.system)).toMatch(/not an execution system/);
    expect(String(body.system)).toMatch(/NOT a probability/);
    expect(JSON.stringify(body.messages)).toContain('\\"setupType\\": \\"CONTINUATION\\"');
    const fmt = (body.output_config as { format: { type: string; schema: { properties: Record<string, { enum?: string[] }> } } }).format;
    expect(fmt.type).toBe("json_schema");
    expect(fmt.schema.properties.decision!.enum).toEqual(["TRADE", "NO_TRADE"]);
  });
});
