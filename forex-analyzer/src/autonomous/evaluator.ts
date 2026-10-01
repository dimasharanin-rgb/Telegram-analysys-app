import Anthropic from "@anthropic-ai/sdk";
import type { CandidateEvaluation } from "@/shared/types/autonomous";
import { round } from "@/shared/math";
import { AiError } from "@/ai/errors";
import { toAiError, type Effort } from "@/ai/claudeAnalyst";
import type { CandidatePayload } from "./payload";
import { parseCandidateEvaluation } from "./parse";
import { getAutonomousSystemPrompt } from "./prompt";
import { CANDIDATE_EVALUATION_JSON_SCHEMA } from "./schema";

export interface EvaluatorOutput {
  evaluation: CandidateEvaluation;
  servedBy: string;
  notes: string[];
}

/** Turns a candidate payload into a validated evaluation. It has no access to account limits beyond the payload, and no way to change them. */
export interface CandidateEvaluator {
  readonly provider: "anthropic" | "mock";
  readonly model: string;
  evaluate(payload: CandidatePayload): Promise<EvaluatorOutput>;
}

export class ClaudeCandidateEvaluator implements CandidateEvaluator {
  readonly provider = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    opts: { apiKey: string; timeoutMs: number; effort: Effort; fetch?: typeof fetch },
    private readonly effort: Effort = opts.effort,
  ) {
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 1, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  }

  async evaluate(payload: CandidatePayload): Promise<EvaluatorOutput> {
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: getAutonomousSystemPrompt(),
        messages: [{ role: "user", content: `Evaluate this setup candidate. Input data:\n\n${JSON.stringify(payload, null, 2)}` }],
        output_config: { effort: this.effort, format: { type: "json_schema", schema: CANDIDATE_EVALUATION_JSON_SCHEMA } },
      });
    } catch (error) {
      throw toAiError(error);
    }
    if (response.stop_reason === "refusal") throw new AiError("REFUSAL", "The model declined to assess this request.");
    if (response.stop_reason === "max_tokens") throw new AiError("TRUNCATED", "The model's answer was cut off.");
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const { evaluation, notes } = parseCandidateEvaluation(text);
    return { evaluation, servedBy: response.model, notes: response.model !== this.model ? [...notes, `Answered by fallback model ${response.model}.`] : notes };
  }
}

/**
 * Offline stand-in used when no ANTHROPIC_API_KEY is set: fixed rules, clearly
 * labelled. Proposes only when every checked condition held: stop a quarter
 * ATR beyond the recent swing, target at 1.1 x the larger of 2 and the account's minimum R:R.
 */
export class MockCandidateEvaluator implements CandidateEvaluator {
  readonly provider = "mock" as const;
  readonly model = "mock-candidate-rules-v1";

  async evaluate(p: CandidatePayload): Promise<EvaluatorOutput> {
    const long = p.candidate.direction === "LONG";
    const own = p.technical.find((t) => t.timeframe === p.market.timeframe);
    const allMet = p.candidate.conditions.every((c) => c.met);
    const price = long ? (p.market.ask ?? p.market.price) : (p.market.bid ?? p.market.price);
    const atr = own?.atr14 ?? null;
    const swing = long ? own?.recentSwingLows.at(-1) : own?.recentSwingHighs.at(-1);
    const prec = p.instrument.pricePrecision ?? 5;
    const base = {
      direction: p.candidate.direction,
      technicalAssessment: {
        trendAlignment: own?.trend.direction === (long ? "BULLISH" : "BEARISH") ? ("GOOD" as const) : ("MODERATE" as const),
        marketStructure: own?.structure === (long ? "BULLISH" : "BEARISH") ? ("GOOD" as const) : ("MODERATE" as const),
        momentum: "MODERATE" as const,
        entryQuality: "MODERATE" as const,
        stopPlacement: "MODERATE" as const,
        targetPlacement: "MODERATE" as const,
      },
      positiveFactors: p.candidate.reasons.slice(0, 5),
      warnings: ["MOCK EVALUATION: fixed rules, not Claude."],
      contradictingFactors: p.candidate.conditions.filter((c) => !c.met).map((c) => `${c.name}: ${c.detail}`).slice(0, 5),
      invalidation: p.candidate.invalidation.slice(0, 5),
    };
    if (!allMet || price === null || atr === null || swing == null || (long ? swing >= price : swing <= price)) {
      return {
        evaluation: { ...base, decision: "NO_TRADE", setupQuality: 40, trade: null, riskAssessment: null, summary: "MOCK EVALUATION (no ANTHROPIC_API_KEY): not every condition held or no usable swing level, so no proposal." },
        servedBy: this.model,
        notes: [],
      };
    }
    const stop = long ? swing - atr * 0.25 : swing + atr * 0.25;
    const risk = Math.abs(price - stop);
    const reward = risk * Math.max(2, p.account.minRiskReward) * 1.1;
    const target = long ? price + reward : price - reward;
    return {
      evaluation: {
        ...base,
        decision: "TRADE",
        setupQuality: 65,
        trade: { entry: round(price, prec), stopLoss: round(stop, prec), takeProfit: round(target, prec) },
        riskAssessment: { riskDistance: round(risk, prec + 1), rewardDistance: round(reward, prec + 1), rr: round(reward / risk, 2) },
        summary: "MOCK EVALUATION (no ANTHROPIC_API_KEY): every condition held; stop beyond the recent swing, target sized from the minimum R:R. Setup quality is a heuristic, not a probability.",
      },
      servedBy: this.model,
      notes: [],
    };
  }
}
