import type { AutonomousAnalysisResult } from "@/shared/types/autonomous";
import type { SetupCandidate } from "@/shared/types/setup";
import type { Db } from "./db";

interface Row {
  result_json: string;
}

/**
 * Persistent log of every candidate analysis: TRADE and NO_TRADE, AI failures
 * and data rejections included, so later evaluation is not biased towards the
 * setups that were accepted.
 */
export class DecisionLog {
  constructor(private readonly db: Db) {}

  insert(result: AutonomousAnalysisResult, candidate: SetupCandidate, inputHash: string): void {
    const t = result.proposedTrade;
    const r = result.riskValidation;
    this.db
      .prepare(
        `INSERT INTO decisions (id, analyzed_at, candidate_id, input_hash, symbol, timeframe, setup_type, candidate_direction,
          snapshot_as_of, snapshot_source, prompt_version, model, served_by, ai_decision, setup_quality,
          proposed_entry, proposed_stop_loss, proposed_take_profit, risk_passed, risk_percent, risk_amount, risk_reward,
          final_decision, error_code, candidate_json, result_json)
         VALUES (@id, @analyzedAt, @candidateId, @hash, @symbol, @timeframe, @setupType, @direction,
          @asOf, @source, @promptVersion, @model, @servedBy, @aiDecision, @quality,
          @entry, @stop, @target, @riskPassed, @riskPct, @riskAmt, @rr,
          @final, @errorCode, @candidateJson, @resultJson)`,
      )
      .run({
        id: result.id,
        analyzedAt: new Date(result.analyzedAt).toISOString(),
        candidateId: result.candidateId,
        hash: inputHash,
        symbol: result.symbol,
        timeframe: result.timeframe,
        setupType: result.setupType,
        direction: result.candidateDirection,
        asOf: new Date(result.snapshotAsOf).toISOString(),
        source: result.snapshotSource,
        promptVersion: result.promptVersion,
        model: result.model,
        servedBy: result.servedBy,
        aiDecision: result.aiDecision,
        quality: result.setupQuality,
        entry: t?.entry ?? null,
        stop: t?.stopLoss ?? null,
        target: t?.takeProfit ?? null,
        riskPassed: r ? (r.passed ? 1 : 0) : null,
        riskPct: r?.calculatedRiskPercent ?? null,
        riskAmt: r?.calculatedRiskAmount ?? null,
        rr: r?.calculatedRR ?? null,
        final: result.finalDecision,
        errorCode: result.error?.code ?? null,
        candidateJson: JSON.stringify(candidate),
        resultJson: JSON.stringify(result),
      });
  }

  /** A previous successful AI evaluation of exactly the same input, if any. */
  findByHash(inputHash: string): AutonomousAnalysisResult | null {
    const row = this.db
      .prepare("SELECT result_json FROM decisions WHERE input_hash = ? AND error_code IS NULL ORDER BY analyzed_at DESC LIMIT 1")
      .get(inputHash) as Row | undefined;
    return row ? (JSON.parse(row.result_json) as AutonomousAnalysisResult) : null;
  }

  recent(limit = 50): AutonomousAnalysisResult[] {
    return (this.db.prepare("SELECT result_json FROM decisions ORDER BY analyzed_at DESC LIMIT ?").all(limit) as Row[]).map((r) => JSON.parse(r.result_json));
  }

  counts(): { total: number; trade: number; noTrade: number } {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total, SUM(final_decision = 'TRADE') AS trade, SUM(final_decision = 'NO_TRADE') AS noTrade FROM decisions")
      .get() as { total: number; trade: number | null; noTrade: number | null };
    return { total: row.total, trade: row.trade ?? 0, noTrade: row.noTrade ?? 0 };
  }
}
