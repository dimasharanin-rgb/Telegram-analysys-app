import { createHash, randomUUID } from "node:crypto";
import type { AutonomousAnalysisResult, CandidateEvaluation, RiskValidation, StoredCandidate } from "@/shared/types/autonomous";
import type { TradeInput } from "@/shared/types/trade";
import { round } from "@/shared/math";
import { AiError } from "@/ai/errors";
import { evaluateRisk, type AnalysisDeps } from "@/analysis/analysisService";
import type { DecisionLog } from "@/journal/decisionLog";
import { computeLimits } from "@/risk";
import type { CandidateEvaluator } from "./evaluator";
import { buildCandidatePayload } from "./payload";
import { AUTONOMOUS_PROMPT_VERSION } from "./prompt";

export interface AutonomousDeps {
  evaluator: CandidateEvaluator;
  /** The same dependencies the manual analyzer uses: settings, account state, quotes. One risk engine for both. */
  analysis: AnalysisDeps;
  log: DecisionLog;
  now: () => number;
  /** Data and candidates older than this are not analysed. */
  freshnessSeconds: number;
}

/** A proposed entry further than this from the snapshot price (in ATRs of the candidate's timeframe) is rejected as not based on the market. */
export const MAX_ENTRY_DISTANCE_ATR = 3;
const MIN_CANDLES = 60;

/**
 * Candidate → structured input → Claude → strict parse → (if TRADE) the
 * deterministic risk engine → final decision → decision log.
 *
 * The final decision is TRADE only if the AI proposed a trade AND the risk
 * validation passed. Every failure (stale data, AI error, malformed output,
 * risk rejection) ends in NO_TRADE, and every outcome is logged.
 */
export async function analyzeCandidate(stored: StoredCandidate, deps: AutonomousDeps): Promise<AutonomousAnalysisResult> {
  const { candidate, snapshot } = stored;
  const now = deps.now();
  const base = {
    id: randomUUID(),
    candidateId: candidate.id,
    analyzedAt: now,
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    setupType: candidate.setupType,
    candidateDirection: candidate.direction,
    snapshotAsOf: candidate.asOf,
    snapshotSource: snapshot.source,
    promptVersion: AUTONOMOUS_PROMPT_VERSION,
    model: deps.evaluator.model,
    cached: false,
  };
  const finish = (result: AutonomousAnalysisResult, hash: string) => {
    deps.log.insert(result, candidate, hash);
    return result;
  };
  const noTrade = (reason: string, extra: Partial<AutonomousAnalysisResult>): AutonomousAnalysisResult => ({
    ...base,
    servedBy: null,
    aiDecision: null,
    setupQuality: null,
    proposedTrade: null,
    riskValidation: null,
    analysis: null,
    error: null,
    ...extra,
    finalDecision: "NO_TRADE",
    finalReason: reason,
  });

  // 1. Never let the AI decide from stale or incomplete data.
  const dataProblem = checkData(stored, now, deps.freshnessSeconds);
  if (dataProblem) {
    return finish(noTrade(`Market data problem: ${dataProblem.message}`, { error: { stage: "DATA", ...dataProblem } }), `data:${candidate.id}:${now}`);
  }

  // 2. Structured input, frozen at the candidate time.
  const settings = deps.analysis.getSettings();
  const state = deps.analysis.getAccountState(settings, new Date(now));
  let payload;
  try {
    payload = buildCandidatePayload(stored, { settings, state, limits: computeLimits(settings, state) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return finish(noTrade(message, { error: { stage: "DATA", code: "TEMPORAL", message } }), `data:${candidate.id}:${now}`);
  }

  // 3. Identical input already evaluated by the same prompt and model: reuse it instead of paying for another call.
  const hash = createHash("sha256").update(JSON.stringify({ payload, prompt: AUTONOMOUS_PROMPT_VERSION, model: deps.evaluator.model })).digest("hex");
  const previous = deps.log.findByHash(hash);
  if (previous) return { ...previous, cached: true };

  // 4. AI evaluation. Any failure is a safe NO_TRADE.
  let evaluation: CandidateEvaluation;
  let servedBy: string;
  let notes: string[];
  try {
    ({ evaluation, servedBy, notes } = await deps.evaluator.evaluate(payload));
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("API_ERROR", "The AI evaluation failed unexpectedly.");
    return finish(noTrade(`AI evaluation failed: ${err.message}`, { error: { stage: "AI", code: err.code, message: err.message } }), hash);
  }

  const aiPart = { servedBy, aiDecision: evaluation.decision, setupQuality: evaluation.setupQuality, analysis: { ...evaluation, warnings: [...evaluation.warnings, ...notes] }, error: null };
  if (evaluation.decision === "NO_TRADE" || !evaluation.trade) {
    return finish({ ...base, ...aiPart, proposedTrade: null, riskValidation: null, finalDecision: "NO_TRADE", finalReason: "The AI found no worthwhile trade in this setup." }, hash);
  }

  // 5. The proposal goes through the deterministic risk engine, exactly like a manual trade. Its verdict is final.
  const proposedTrade = { direction: evaluation.direction, ...evaluation.trade };
  const riskValidation = await validateProposal(stored, proposedTrade, evaluation, deps.analysis);
  return finish(
    {
      ...base,
      ...aiPart,
      proposedTrade,
      riskValidation,
      finalDecision: riskValidation.passed ? "TRADE" : "NO_TRADE",
      finalReason: riskValidation.passed
        ? "The AI proposed a trade and it passed every deterministic risk check. This is an analysis result, not an order."
        : `The AI proposed a trade but risk validation rejected it: ${riskValidation.failures[0]}`,
    },
    hash,
  );
}

function checkData(stored: StoredCandidate, now: number, freshnessSeconds: number): { code: string; message: string } | null {
  const { candidate, snapshot } = stored;
  const limit = freshnessSeconds * 1000;
  if (!snapshot.source) return { code: "NO_SOURCE", message: "The snapshot does not say where its data came from." };
  if (now - candidate.asOf > limit) return { code: "STALE", message: `The candidate is ${Math.round((now - candidate.asOf) / 1000)} s old (limit ${freshnessSeconds} s). Scan again.` };
  if (now - snapshot.dataTimestamp > limit) return { code: "STALE", message: `The newest market price in the snapshot is ${Math.round((now - snapshot.dataTimestamp) / 1000)} s old (limit ${freshnessSeconds} s).` };
  const own = candidate.marketContext.find((t) => t.timeframe === candidate.timeframe);
  if (!own || own.candleCount < MIN_CANDLES) return { code: "INSUFFICIENT_CANDLES", message: `Not enough ${candidate.timeframe} candles in the snapshot.` };
  if (own.indicators.atr14 === null) return { code: "INSUFFICIENT_CANDLES", message: "ATR could not be computed." };
  return null;
}

/**
 * Recomputes everything from the proposed prices with the shared risk engine.
 * Claude's own R:R and risk numbers are only compared, never used.
 */
export async function validateProposal(
  stored: StoredCandidate,
  proposal: { direction: "LONG" | "SHORT"; entry: number; stopLoss: number; takeProfit: number },
  evaluation: Pick<CandidateEvaluation, "riskAssessment">,
  analysis: AnalysisDeps,
): Promise<RiskValidation> {
  const { candidate, snapshot } = stored;
  const failures: string[] = [];
  if (proposal.direction !== candidate.direction) failures.push(`Direction ${proposal.direction} differs from the candidate's ${candidate.direction}.`);
  const atr = candidate.marketContext.find((t) => t.timeframe === candidate.timeframe)?.indicators.atr14 ?? null;
  if (atr !== null) {
    const distance = Math.abs(proposal.entry - snapshot.price.mid) / atr;
    if (distance > MAX_ENTRY_DISTANCE_ATR) failures.push(`Entry ${proposal.entry} is ${distance.toFixed(1)} ATR from the market price ${snapshot.price.mid}; it is not based on the supplied data.`);
  }

  const trade: TradeInput = { pair: candidate.symbol, direction: proposal.direction, entry: proposal.entry, stopLoss: proposal.stopLoss, takeProfit: proposal.takeProfit, positionSize: null, timeframe: candidate.timeframe };
  const report = await evaluateRisk(trade, analysis);
  for (const c of report.checks) if (c.status === "BLOCK") failures.push(`${c.label}: ${c.detail}`);
  const calc = report.calculation;

  const discrepancies: string[] = [];
  const claimed = evaluation.riskAssessment?.rr;
  if (claimed !== undefined && calc && Number.isFinite(calc.riskReward) && Math.abs(claimed - calc.riskReward) > 0.05) {
    discrepancies.push(`AI stated R:R ${claimed}; calculated ${round(calc.riskReward, 2)}. The calculated value is used.`);
  }

  return {
    passed: failures.length === 0,
    calculatedRiskPercent: calc ? round(calc.riskPercent, 3) : null,
    calculatedRiskAmount: calc?.riskAmount ?? null,
    calculatedRR: calc && Number.isFinite(calc.riskReward) ? round(calc.riskReward, 2) : null,
    positionSizeLots: calc?.positionSize ?? null,
    accountCurrency: calc?.accountCurrency ?? analysis.getSettings().currency,
    failures,
    warnings: report.checks.filter((c) => c.status === "WARNING").map((c) => `${c.label}: ${c.detail}`),
    discrepancies,
  };
}
