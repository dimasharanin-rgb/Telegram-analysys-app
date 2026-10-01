import { randomUUID } from "node:crypto";
import type { AnalysisResult } from "@/types/analysis";
import type { JournalEntry, JournalFilters, JournalSummary, OutcomeUpdate } from "@/types/journal";
import type { ClosedTradeRecord, OpenTradeRecord } from "@/risk/accountState";
import { round } from "@/lib/math";
import type { Db } from "./client";

interface JournalRow {
  id: string;
  created_at: string;
  pair: string;
  direction: JournalSummary["direction"];
  timeframe: JournalSummary["timeframe"];
  entry: number;
  stop_loss: number;
  take_profit: number;
  position_size: number | null;
  risk_percent: number | null;
  risk_amount: number | null;
  reward_amount: number | null;
  risk_reward: number | null;
  account_currency: string;
  state: JournalSummary["state"];
  final_verdict: JournalSummary["finalVerdict"];
  ai_verdict: JournalSummary["aiVerdict"];
  ai_score: number | null;
  ai_provider: string | null;
  status: JournalSummary["status"];
  result: JournalSummary["result"];
  actual_pnl: number | null;
  r_multiple: number | null;
  closed_at: string | null;
}

interface JournalDetailRow extends JournalRow {
  thesis: string;
  outcome_notes: string;
  opened_at: string | null;
  updated_at: string;
  risk_report_json: string;
  market_snapshot_json: string | null;
  ai_assessment_json: string | null;
  analysis_json: string;
}

const SUMMARY_COLUMNS = `id, created_at, pair, direction, timeframe, entry, stop_loss, take_profit, position_size,
  risk_percent, risk_amount, reward_amount, risk_reward, account_currency, state, final_verdict, ai_verdict,
  ai_score, ai_provider, status, result, actual_pnl, r_multiple, closed_at`;

/** Candles kept per stored analysis: enough to redraw the chart, small enough to keep the file lean. */
const STORED_CANDLES = 150;

function toSummary(r: JournalRow): JournalSummary {
  return {
    id: r.id,
    createdAt: r.created_at,
    pair: r.pair,
    direction: r.direction,
    timeframe: r.timeframe,
    entry: r.entry,
    stopLoss: r.stop_loss,
    takeProfit: r.take_profit,
    positionSize: r.position_size,
    riskPercent: r.risk_percent,
    riskAmount: r.risk_amount,
    rewardAmount: r.reward_amount,
    riskReward: r.risk_reward,
    accountCurrency: r.account_currency,
    state: r.state,
    finalVerdict: r.final_verdict,
    aiVerdict: r.ai_verdict,
    aiScore: r.ai_score,
    aiProvider: r.ai_provider,
    status: r.status,
    result: r.result,
    actualPnl: r.actual_pnl,
    rMultiple: r.r_multiple,
    closedAt: r.closed_at,
  };
}

export class JournalRepository {
  constructor(private readonly db: Db) {}

  /** Stores a completed analysis (blocked and unavailable ones included) and returns its id. */
  insert(analysis: AnalysisResult): string {
    const id = randomUUID();
    const calc = analysis.risk.calculation;
    const { risk, market, ai, ...rest } = analysis;
    const storedMarket = market
      ? {
          ...market,
          candles: { [analysis.trade.timeframe]: (market.candles[analysis.trade.timeframe] ?? []).slice(-STORED_CANDLES) },
        }
      : null;

    this.db
      .prepare(
        `INSERT INTO journal (
          id, created_at, pair, direction, timeframe, entry, stop_loss, take_profit, position_size,
          risk_percent, risk_amount, reward_amount, risk_reward, account_currency, state, final_verdict,
          ai_verdict, ai_score, ai_provider, ai_model, ai_summary, thesis,
          risk_report_json, market_snapshot_json, ai_assessment_json, analysis_json, updated_at
        ) VALUES (
          @id, @createdAt, @pair, @direction, @timeframe, @entry, @stopLoss, @takeProfit, @positionSize,
          @riskPercent, @riskAmount, @rewardAmount, @riskReward, @currency, @state, @finalVerdict,
          @aiVerdict, @aiScore, @aiProvider, @aiModel, @aiSummary, @thesis,
          @riskJson, @marketJson, @aiJson, @analysisJson, @createdAt
        )`,
      )
      .run({
        id,
        createdAt: analysis.createdAt,
        pair: analysis.trade.pair,
        direction: analysis.trade.direction,
        timeframe: analysis.trade.timeframe,
        entry: analysis.trade.entry,
        stopLoss: analysis.trade.stopLoss,
        takeProfit: analysis.trade.takeProfit,
        positionSize: calc?.positionSize ?? analysis.trade.positionSize ?? null,
        riskPercent: calc ? round(calc.riskPercent, 4) : null,
        riskAmount: calc?.riskAmount ?? null,
        rewardAmount: calc?.rewardAmount ?? null,
        riskReward: calc && Number.isFinite(calc.riskReward) ? calc.riskReward : null,
        currency: analysis.settings.currency,
        state: analysis.state,
        finalVerdict: analysis.decision.finalVerdict,
        aiVerdict: ai?.assessment.verdict ?? null,
        aiScore: ai?.assessment.setupQuality ?? null,
        aiProvider: ai?.info.provider ?? null,
        aiModel: ai?.info.servedBy ?? null,
        aiSummary: ai?.assessment.summary ?? null,
        thesis: analysis.trade.thesis ?? "",
        riskJson: JSON.stringify(risk),
        marketJson: storedMarket ? JSON.stringify(storedMarket) : null,
        aiJson: ai ? JSON.stringify(ai) : null,
        analysisJson: JSON.stringify(rest),
      });
    return id;
  }

  list(filters: JournalFilters = {}): JournalSummary[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filters.pair) {
      where.push("pair = @pair");
      params.pair = filters.pair;
    }
    if (filters.verdict) {
      where.push("final_verdict = @verdict");
      params.verdict = filters.verdict;
    }
    if (filters.minScore !== undefined) {
      where.push("ai_score >= @minScore");
      params.minScore = filters.minScore;
    }
    if (filters.maxScore !== undefined) {
      where.push("ai_score <= @maxScore");
      params.maxScore = filters.maxScore;
    }
    if (filters.result === "OPEN" || filters.result === "PENDING") {
      where.push("status = @status");
      params.status = filters.result;
    } else if (filters.result) {
      where.push("result = @result");
      params.result = filters.result;
    }
    if (filters.from) {
      where.push("created_at >= @from");
      params.from = `${filters.from}T00:00:00.000Z`;
    }
    if (filters.to) {
      where.push("created_at <= @to");
      params.to = `${filters.to}T23:59:59.999Z`;
    }
    const sql = `SELECT ${SUMMARY_COLUMNS} FROM journal ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
    return (this.db.prepare(sql).all(params) as JournalRow[]).map(toSummary);
  }

  get(id: string): JournalEntry | null {
    const row = this.db.prepare("SELECT * FROM journal WHERE id = ?").get(id) as JournalDetailRow | undefined;
    if (!row) return null;
    const rest = JSON.parse(row.analysis_json) as Omit<AnalysisResult, "risk" | "market" | "ai">;
    const analysis: AnalysisResult = {
      ...rest,
      id: row.id,
      risk: JSON.parse(row.risk_report_json),
      market: row.market_snapshot_json ? JSON.parse(row.market_snapshot_json) : null,
      ai: row.ai_assessment_json ? JSON.parse(row.ai_assessment_json) : null,
    };
    return {
      ...toSummary(row),
      thesis: row.thesis,
      outcomeNotes: row.outcome_notes,
      openedAt: row.opened_at,
      updatedAt: row.updated_at,
      analysis,
    };
  }

  /**
   * Records what actually happened. The R multiple is derived from P/L and the
   * analysed risk unless the user supplies one.
   */
  updateOutcome(id: string, outcome: OutcomeUpdate, now = new Date()): JournalEntry | null {
    const current = this.db.prepare("SELECT risk_amount, opened_at, closed_at, status FROM journal WHERE id = ?").get(id) as
      | { risk_amount: number | null; opened_at: string | null; closed_at: string | null; status: string }
      | undefined;
    if (!current) return null;

    const nowIso = now.toISOString();
    const closed = outcome.status === "CLOSED";
    const pnl = closed ? (outcome.result === "CANCELLED" ? null : outcome.actualPnl) : null;
    let rMultiple = closed && outcome.result !== "CANCELLED" ? outcome.rMultiple : null;
    if (rMultiple === null && pnl !== null && current.risk_amount && current.risk_amount > 0) {
      rMultiple = round(pnl / current.risk_amount, 2);
    }
    const openedAt =
      outcome.status === "PENDING" || outcome.result === "CANCELLED" ? null : (current.opened_at ?? nowIso);
    const closedAt = closed ? (outcome.closedAt ?? (current.status === "CLOSED" ? current.closed_at : null) ?? nowIso) : null;

    this.db
      .prepare(
        `UPDATE journal SET status = @status, result = @result, actual_pnl = @pnl, r_multiple = @r,
           outcome_notes = @notes, opened_at = @openedAt, closed_at = @closedAt, updated_at = @now
         WHERE id = @id`,
      )
      .run({
        id,
        status: outcome.status,
        result: closed ? outcome.result : null,
        pnl,
        r: rMultiple,
        notes: outcome.notes,
        openedAt,
        closedAt,
        now: nowIso,
      });
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM journal WHERE id = ?").run(id).changes > 0;
  }

  /** Closed P/L and open risk, for deriving the account state in JOURNAL mode. */
  accountRecords(): { closed: ClosedTradeRecord[]; open: OpenTradeRecord[] } {
    const closed = this.db
      .prepare(
        `SELECT closed_at AS closedAt, actual_pnl AS pnl FROM journal
         WHERE status = 'CLOSED' AND result != 'CANCELLED' AND actual_pnl IS NOT NULL AND closed_at IS NOT NULL`,
      )
      .all() as ClosedTradeRecord[];
    const open = this.db
      .prepare(`SELECT COALESCE(risk_amount, 0) AS riskAmount FROM journal WHERE status = 'OPEN'`)
      .all() as OpenTradeRecord[];
    return { closed, open };
  }
}
