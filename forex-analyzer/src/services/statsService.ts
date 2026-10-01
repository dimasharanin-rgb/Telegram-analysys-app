import type { JournalStats, ScoreBucket, ScoreOutcomePoint, ScoreVsOutcome } from "@/types/dashboard";
import type { JournalSummary } from "@/types/journal";
import { round } from "@/lib/math";

/** Closed, scored trades needed before score-vs-outcome figures are summarised at all. */
export const MIN_SAMPLE_FOR_SCORE_STATS = 30;

const BUCKETS: Omit<ScoreBucket, "trades" | "wins" | "averageR">[] = [
  { label: "0-49", min: 0, max: 49 },
  { label: "50-64", min: 50, max: 64 },
  { label: "65-79", min: 65, max: 79 },
  { label: "80-100", min: 80, max: 100 },
];

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function journalStats(entries: JournalSummary[]): JournalStats {
  const count = (pred: (e: JournalSummary) => boolean) => entries.filter(pred).length;
  const scores = entries.map((e) => e.aiScore).filter((s): s is number => s !== null);
  const rs = entries
    .filter((e) => e.status === "CLOSED" && e.result !== "CANCELLED" && e.rMultiple !== null)
    .map((e) => e.rMultiple!);
  const avgScore = mean(scores);
  const avgR = mean(rs);
  return {
    analyses: entries.length,
    accepted: count((e) => e.finalVerdict === "ACCEPTABLE"),
    caution: count((e) => e.finalVerdict === "CAUTION"),
    rejected: count((e) => e.finalVerdict === "REJECT"),
    blocked: count((e) => e.finalVerdict === "BLOCKED"),
    unavailable: count((e) => e.finalVerdict === "UNAVAILABLE"),
    wins: count((e) => e.result === "WIN"),
    losses: count((e) => e.result === "LOSS"),
    breakeven: count((e) => e.result === "BREAKEVEN"),
    cancelled: count((e) => e.result === "CANCELLED"),
    open: count((e) => e.status === "OPEN"),
    averageAiScore: avgScore === null ? null : round(avgScore, 1),
    averageR: avgR === null ? null : round(avgR, 2),
  };
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const rank = (i + j) / 2 + 1; // average rank for ties
    for (let k = i; k <= j; k++) out[order[k]!.i] = rank;
    i = j + 1;
  }
  return out;
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx)!;
  const my = mean(ry)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

export function scoreVsOutcome(entries: JournalSummary[]): ScoreVsOutcome {
  const points: ScoreOutcomePoint[] = entries
    .filter((e) => e.aiScore !== null && e.status === "CLOSED" && e.result !== null && e.result !== "CANCELLED")
    .map((e) => ({ id: e.id, score: e.aiScore!, rMultiple: e.rMultiple, result: e.result as ScoreOutcomePoint["result"] }));
  const sufficient = points.length >= MIN_SAMPLE_FOR_SCORE_STATS;

  const buckets: ScoreBucket[] = BUCKETS.map((b) => {
    const inside = points.filter((p) => p.score >= b.min && p.score <= b.max);
    const rs = inside.map((p) => p.rMultiple).filter((r): r is number => r !== null);
    const avg = mean(rs);
    return { ...b, trades: inside.length, wins: inside.filter((p) => p.result === "WIN").length, averageR: avg === null ? null : round(avg, 2) };
  });

  const withR = points.filter((p) => p.rMultiple !== null);
  const correlation = sufficient ? spearman(withR.map((p) => p.score), withR.map((p) => p.rMultiple!)) : null;

  return {
    sampleSize: points.length,
    minimumSample: MIN_SAMPLE_FOR_SCORE_STATS,
    sufficient,
    points,
    buckets: sufficient ? buckets : [],
    rankCorrelation: correlation === null ? null : round(correlation, 2),
  };
}
