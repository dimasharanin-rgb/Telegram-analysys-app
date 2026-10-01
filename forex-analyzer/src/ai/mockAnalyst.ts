import type { AiAssessment, AiVerdict, Rating, ScoreComponent, ScoreComponentKey } from "@/types/ai";
import type { StructureBias } from "@/types/technical";
import type { AnalystResult, TradeAnalyst } from "./analyst";
import { parseClaudeResponse } from "./parse";
import type { ClaudePayload, PayloadTimeframe } from "./payload";

const WEIGHTS: Record<ScoreComponentKey, number> = {
  higherTimeframeAlignment: 0.2,
  marketStructure: 0.2,
  trendAlignment: 0.15,
  entryQuality: 0.15,
  momentum: 0.1,
  riskReward: 0.1,
  volatility: 0.1,
};

function rate(score: number | null): Rating {
  if (score === null) return "UNKNOWN";
  return score >= 65 ? "GOOD" : score >= 45 ? "MODERATE" : "POOR";
}

function component(score: number | null, note: string): ScoreComponent {
  return { score: score === null ? null : Math.round(score), rating: rate(score), note };
}

function structureScore(bias: StructureBias, long: boolean): number {
  if (bias === "BULLISH") return long ? 82 : 22;
  if (bias === "BEARISH") return long ? 22 : 82;
  if (bias === "RANGE") return 50;
  return 40;
}

/**
 * Offline stand-in for Claude, used when no API key is configured. It applies
 * fixed, transparent rules to the same payload Claude would receive and
 * produces the same schema, so the whole app can be explored without keys.
 * Every summary it writes says it is a mock.
 */
export class MockAnalyst implements TradeAnalyst {
  readonly provider = "mock" as const;
  readonly model = "mock-rules-v1";

  async analyze(payload: ClaudePayload): Promise<AnalystResult> {
    const started = Date.now();
    const assessment = this.assess(payload);
    // Round-trip through the same validator Claude's output goes through.
    const parsed = parseClaudeResponse(JSON.stringify(assessment));
    return {
      assessment: parsed.assessment,
      info: { provider: "mock", model: this.model, servedBy: this.model, durationMs: Date.now() - started, notes: parsed.notes },
    };
  }

  private assess(p: ClaudePayload): AiAssessment {
    const long = p.direction === "LONG";
    const side = long ? "bullish" : "bearish";
    const tfs = p.timeframes;
    const own: PayloadTimeframe | undefined = tfs.find((t) => t.timeframe === p.timeframe);
    const higher = tfs.filter((t) => t.timeframe !== p.timeframe && tfs.indexOf(t) < tfs.indexOf(own ?? tfs[tfs.length - 1]!));
    const positives: string[] = [];
    const warnings: string[] = [];
    const conflicts: string[] = [];

    // Trend alignment: share of timeframes whose EMAs are stacked in the trade direction.
    const known = tfs.filter((t) => t.emaTrend !== "UNKNOWN");
    const aligned = known.filter((t) => t.emaTrend === (long ? "UP" : "DOWN"));
    const against = known.filter((t) => t.emaTrend === (long ? "DOWN" : "UP"));
    const trend = known.length ? 20 + (70 * aligned.length) / known.length : null;
    if (aligned.length) positives.push(`EMAs stacked ${side} on ${aligned.map((t) => t.timeframe).join(", ")}.`);
    if (against.length) conflicts.push(`EMAs point the other way on ${against.map((t) => t.timeframe).join(", ")}.`);

    // Structure on the trade timeframe.
    const ownBias = own?.structure ?? "UNCLEAR";
    const structure = structureScore(ownBias, long);
    if (structure >= 65) positives.push(`${p.timeframe} structure is ${ownBias.toLowerCase()}.`);
    else if (structure < 45 && ownBias !== "UNCLEAR") conflicts.push(`${p.timeframe} structure is ${ownBias.toLowerCase()}, against the trade.`);
    else warnings.push(`${p.timeframe} structure is ${ownBias.toLowerCase()}.`);

    // Higher-timeframe alignment.
    const htfScores = higher.map((t) => structureScore(t.structure, long));
    const htf = htfScores.length ? htfScores.reduce((a, b) => a + b, 0) / htfScores.length : null;
    for (const t of higher) {
      const s = structureScore(t.structure, long);
      if (s >= 65) positives.push(`${t.timeframe} structure is ${t.structure.toLowerCase()}.`);
      else if (s < 45 && t.structure !== "UNCLEAR") conflicts.push(`${t.timeframe} structure is ${t.structure.toLowerCase()}.`);
    }

    // Momentum from RSI on the trade timeframe, mirrored for shorts.
    let momentum: number | null = null;
    let momentumNote = "RSI unavailable.";
    if (own?.rsi14 != null) {
      const rsi = long ? own.rsi14 : 100 - own.rsi14;
      momentum = rsi > 75 ? 45 : rsi >= 55 ? 75 : rsi >= 45 ? 55 : rsi >= 35 ? 35 : 25;
      momentumNote = `RSI ${own.rsi14.toFixed(1)} on ${p.timeframe}.`;
      if (rsi > 75) warnings.push(`RSI ${own.rsi14.toFixed(1)} is extended in the trade direction; entry may be late.`);
      else if (rsi < 45) conflicts.push(`RSI ${own.rsi14.toFixed(1)} does not confirm ${side} momentum.`);
    }

    // Entry quality: room before the first opposing level, and distance from market.
    const atr = p.derived.atrTradeTimeframe;
    const obstacle = p.derived.levelsBetweenEntryAndTarget[0];
    let entry = 70;
    let entryNote = "No opposing level between entry and target.";
    if (obstacle && atr) {
      const room = Math.abs(obstacle.price - p.entry) / atr;
      entry = room < 0.5 ? 30 : room < 1.5 ? 50 : 65;
      entryNote = `${long ? "Resistance" : "Support"} at ${obstacle.price} (${obstacle.timeframe}) is ${room.toFixed(1)} ATR from entry.`;
      warnings.push(`${obstacle.timeframe} ${long ? "resistance" : "support"} at ${obstacle.price} lies between entry and target.`);
    }
    if (p.derived.entryDistanceAtr !== null && p.derived.entryDistanceAtr > 3) {
      entry -= 15;
      warnings.push(`Entry is ${p.derived.entryDistanceAtr} ATR from the current price.`);
    }

    // Risk/reward as supplied by the risk engine.
    const rr = p.risk.riskReward;
    const rrScore = rr >= 3 ? 90 : rr >= 2 ? 75 : rr >= 1.5 ? 55 : 35;

    // Volatility regime on the trade timeframe.
    const vol = own?.volatility ?? "UNKNOWN";
    const volScore = vol === "NORMAL" ? 70 : vol === "LOW" ? 50 : vol === "HIGH" ? 45 : null;
    if (vol === "HIGH") warnings.push(`${p.timeframe} volatility is elevated relative to its recent range.`);
    if (vol === "LOW") warnings.push(`${p.timeframe} volatility is subdued; the target may take longer to reach.`);

    const breakdown: Record<ScoreComponentKey, ScoreComponent> = {
      trendAlignment: component(trend, `${aligned.length} of ${known.length} timeframes have EMAs aligned ${side}.`),
      marketStructure: component(structure, `${p.timeframe}: ${own?.structureReason ?? "no structure data"}`),
      momentum: component(momentum, momentumNote),
      entryQuality: component(entry, entryNote),
      riskReward: component(rrScore, `R:R 1:${rr.toFixed(2)} from the risk engine.`),
      volatility: component(volScore, `${p.timeframe} volatility regime: ${vol}.`),
      higherTimeframeAlignment: component(htf, higher.length ? higher.map((t) => `${t.timeframe} ${t.structure}`).join(", ") : "No higher timeframe analysed."),
    };

    let total = 0;
    let weight = 0;
    for (const [key, c] of Object.entries(breakdown) as [ScoreComponentKey, ScoreComponent][]) {
      if (c.score === null) continue;
      total += c.score * WEIGHTS[key];
      weight += WEIGHTS[key];
    }
    const setupQuality = weight > 0 ? Math.round(total / weight) : 0;
    const structuralConflict = breakdown.marketStructure.rating === "POOR" || breakdown.higherTimeframeAlignment.rating === "POOR";
    const verdict: AiVerdict = setupQuality >= 65 && !structuralConflict ? "ACCEPTABLE" : setupQuality >= 45 ? "CAUTION" : "REJECT";

    const stopBeyond = p.derived.stopBeyondRecentSwing;
    const stopTight = p.derived.stopDistanceAtr !== null && p.derived.stopDistanceAtr < 0.5;
    const stopRating: Rating = stopTight ? "POOR" : stopBeyond === null ? "UNKNOWN" : stopBeyond ? "GOOD" : "MODERATE";
    const swing = p.derived.referenceSwing;
    const stopNote = stopTight
      ? `Stop is only ${p.derived.stopDistanceAtr} ATR from entry.`
      : swing === null
        ? "No recent swing to compare the stop with."
        : stopBeyond
          ? `Stop is beyond the recent swing ${long ? "low" : "high"} at ${swing}.`
          : `Stop is inside the recent swing ${long ? "low" : "high"} at ${swing}.`;
    if (stopBeyond) positives.push(stopNote);
    else if (stopRating !== "UNKNOWN") warnings.push(stopNote);

    const targetRating: Rating = obstacle ? (p.derived.levelsBetweenEntryAndTarget.length > 1 ? "POOR" : "MODERATE") : "GOOD";
    const bias = trend === null ? "UNKNOWN" : aligned.length > against.length ? (long ? "BULLISH" : "BEARISH") : against.length > aligned.length ? (long ? "BEARISH" : "BULLISH") : "NEUTRAL";

    const technicalScores = [trend, structure, momentum, entry].filter((v): v is number => v !== null);
    const invalidation = swing !== null
      ? [`${p.timeframe} closes ${long ? "below" : "above"} the recent swing ${long ? "low" : "high"} at ${swing}.`]
      : [`Price trades through the stop at ${p.stopLoss}.`];

    return {
      verdict,
      setupQuality,
      directionalBias: bias,
      technicalAssessment: {
        score: technicalScores.length ? Math.round(technicalScores.reduce((a, b) => a + b, 0) / technicalScores.length) : null,
        trendAlignment: breakdown.trendAlignment.rating,
        momentum: breakdown.momentum.rating,
        structure: breakdown.marketStructure.rating,
        entryQuality: breakdown.entryQuality.rating,
      },
      riskAssessment: {
        score: Math.round((rrScore + (stopRating === "GOOD" ? 80 : stopRating === "MODERATE" ? 55 : stopRating === "POOR" ? 30 : 50)) / 2),
        riskReward: Number(rr.toFixed(2)),
        riskLevel: stopRating === "POOR" ? "ELEVATED" : "ACCEPTABLE",
      },
      scoreBreakdown: breakdown,
      stopPlacement: { rating: stopRating, note: stopNote },
      targetPlacement: {
        rating: targetRating,
        note: obstacle
          ? `${p.derived.levelsBetweenEntryAndTarget.length} opposing level(s) between entry and target.`
          : "No mapped level between entry and target.",
      },
      warnings: warnings.slice(0, 10),
      positiveFactors: positives.slice(0, 10),
      conflictingSignals: conflicts.slice(0, 10),
      invalidation,
      summary: `MOCK ANALYSIS: produced by fixed rules, not by Claude (no ANTHROPIC_API_KEY configured). ${aligned.length} of ${known.length} timeframes have EMAs aligned ${side}; ${p.timeframe} structure is ${ownBias.toLowerCase()}. The score is a rule-based setup heuristic, not a probability.`,
    };
  }
}
