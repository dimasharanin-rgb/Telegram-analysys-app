import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/shared/types/analysis";
import type { JournalSummary } from "@/shared/types/journal";
import { MockAnalyst } from "@/ai/mockAnalyst";
import { openDatabase } from "@/journal/db";
import { JournalRepository } from "@/journal/journalRepository";
import { SettingsRepository } from "@/server/settingsRepository";
import { DEFAULT_SETTINGS } from "@/shared/defaults";
import { deriveAccountState } from "@/risk";
import { analyzeTrade } from "@/analysis/analysisService";
import { MockMarketDataProvider } from "@/data/mock/mockProvider";
import { journalStats, MIN_SAMPLE_FOR_SCORE_STATS, scoreVsOutcome, spearman } from "@/journal/stats";
import { account, settings } from "./helpers";

const NOW = new Date("2026-09-30T11:00:00Z");

async function analysis(patch: { positionSize?: number } = {}): Promise<AnalysisResult> {
  const market = new MockMarketDataProvider({ now: () => NOW });
  const price = (await market.getQuote("EUR/USD")).mid;
  return analyzeTrade(
    { pair: "EUR/USD", direction: "LONG", entry: price, stopLoss: +(price - 0.002).toFixed(5), takeProfit: +(price + 0.0045).toFixed(5), timeframe: "M15", thesis: "test", ...patch },
    {
      market,
      analyst: new MockAnalyst(),
      getSettings: () => settings(),
      getAccountState: () => account(),
      saveAnalysis: () => "unsaved",
      now: () => NOW,
      maxQuoteAgeSeconds: 300,
    },
  );
}

describe("settings repository", () => {
  it("returns defaults until something is saved, then the saved values", () => {
    const repo = new SettingsRepository(openDatabase(":memory:"));
    expect(repo.get()).toEqual(DEFAULT_SETTINGS);
    repo.save({ ...DEFAULT_SETTINGS, accountSize: 25_000, maxRiskPerTradePct: 1 });
    expect(repo.get().accountSize).toBe(25_000);
    expect(repo.get().maxRiskPerTradePct).toBe(1);
  });

  it("falls back to defaults if the stored row no longer validates", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)").run('{"accountSize": -5}', "x");
    expect(new SettingsRepository(db).get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("journal repository", () => {
  it("stores every analysis with its risk, market snapshot and AI reasoning", async () => {
    const repo = new JournalRepository(openDatabase(":memory:"));
    const result = await analysis();
    const id = repo.insert(result);
    const entry = repo.get(id)!;

    expect(entry.pair).toBe("EUR/USD");
    expect(entry.riskAmount).toBe(result.risk.calculation!.riskAmount);
    expect(entry.riskReward).toBe(result.risk.calculation!.riskReward);
    expect(entry.aiScore).toBe(result.ai!.assessment.setupQuality);
    expect(entry.finalVerdict).toBe(result.decision.finalVerdict);
    expect(entry.status).toBe("PENDING");
    expect(entry.thesis).toBe("test");
    expect(entry.analysis.ai!.assessment.summary).toBe(result.ai!.assessment.summary);
    expect(entry.analysis.market!.price).toEqual(result.market!.price);
    expect(entry.analysis.market!.candles.M15!.length).toBeLessThanOrEqual(150);
    expect(entry.analysis.risk.checks).toEqual(result.risk.checks);
  });

  it("stores blocked analyses too, without AI fields", async () => {
    const repo = new JournalRepository(openDatabase(":memory:"));
    const id = repo.insert(await analysis({ positionSize: 1 }));
    const entry = repo.get(id)!;
    expect(entry.finalVerdict).toBe("BLOCKED");
    expect(entry.aiScore).toBeNull();
    expect(entry.analysis.ai).toBeNull();
  });

  it("records outcomes, derives the R multiple, and feeds the account state", async () => {
    const db = openDatabase(":memory:");
    const repo = new JournalRepository(db);
    const a = repo.insert(await analysis());
    const b = repo.insert(await analysis());
    const c = repo.insert(await analysis());
    const risk = repo.get(a)!.riskAmount!;

    const won = repo.updateOutcome(a, { status: "CLOSED", result: "WIN", actualPnl: risk * 2, rMultiple: null, notes: "hit TP" }, NOW)!;
    expect(won.rMultiple).toBe(2);
    expect(won.closedAt).toBe(NOW.toISOString());
    expect(won.outcomeNotes).toBe("hit TP");

    repo.updateOutcome(b, { status: "OPEN", result: null, actualPnl: null, rMultiple: null, notes: "" }, NOW);
    const cancelled = repo.updateOutcome(c, { status: "CLOSED", result: "CANCELLED", actualPnl: null, rMultiple: null, notes: "" }, NOW)!;
    expect(cancelled.actualPnl).toBeNull();
    expect(cancelled.rMultiple).toBeNull();

    const records = repo.accountRecords();
    expect(records.closed).toEqual([{ closedAt: NOW.toISOString(), pnl: risk * 2 }]);
    expect(records.open).toEqual([{ riskAmount: risk }]);

    const state = deriveAccountState(settings({ accountStateSource: "JOURNAL" }), records, NOW);
    expect(state.balance).toBeCloseTo(10_000 + risk * 2, 2);
    expect(state.todayRealizedPnl).toBeCloseTo(risk * 2, 2);
    expect(state.openPositions).toBe(1);
    expect(state.openRisk).toBe(risk);
  });

  it("filters by pair, verdict, score range, result and date", async () => {
    const repo = new JournalRepository(openDatabase(":memory:"));
    const ok = await analysis();
    const id = repo.insert(ok);
    repo.insert(await analysis({ positionSize: 1 }));
    repo.updateOutcome(id, { status: "CLOSED", result: "LOSS", actualPnl: -40, rMultiple: null, notes: "" }, NOW);
    const score = ok.ai!.assessment.setupQuality;

    expect(repo.list()).toHaveLength(2);
    expect(repo.list({ pair: "GBP/USD" })).toHaveLength(0);
    expect(repo.list({ verdict: "BLOCKED" })).toHaveLength(1);
    expect(repo.list({ minScore: score, maxScore: score })).toHaveLength(1);
    expect(repo.list({ minScore: score + 1 })).toHaveLength(0);
    expect(repo.list({ result: "LOSS" })).toHaveLength(1);
    expect(repo.list({ result: "PENDING" })).toHaveLength(1);
    expect(repo.list({ from: "2026-09-30", to: "2026-09-30" })).toHaveLength(2);
    expect(repo.list({ from: "2026-10-01" })).toHaveLength(0);
  });

  it("deletes entries", async () => {
    const repo = new JournalRepository(openDatabase(":memory:"));
    const id = repo.insert(await analysis());
    expect(repo.delete(id)).toBe(true);
    expect(repo.get(id)).toBeNull();
    expect(repo.delete(id)).toBe(false);
  });
});

describe("account state from the journal", () => {
  it("counts only today's closes (in the configured time zone) towards today's P/L", () => {
    const s = settings({ dayResetTimeZone: "America/New_York", accountStateSource: "JOURNAL" });
    // 02:00 UTC on the 30th is still the 29th in New York.
    const state = deriveAccountState(s, { closed: [{ closedAt: "2026-09-30T02:00:00Z", pnl: -100 }, { closedAt: "2026-09-30T10:00:00Z", pnl: 40 }], open: [] }, NOW);
    expect(state.balance).toBe(9_940);
    expect(state.todayRealizedPnl).toBe(40);
    expect(state.dayStartBalance).toBe(9_900);
    expect(state.highWaterMark).toBe(10_000);
  });

  it("uses the manual figures in MANUAL mode", () => {
    const s = settings({ accountStateSource: "MANUAL", manualState: { balance: 9_800, equity: 9_750, todayRealizedPnl: -200, todayUnrealizedPnl: -50, openPositions: 2, openRisk: 75, highWaterMark: 10_300 } });
    expect(deriveAccountState(s, { closed: [], open: [] }, NOW)).toMatchObject({ source: "MANUAL", balance: 9_800, equity: 9_750, dayStartBalance: 10_000, openPositions: 2, openRisk: 75, highWaterMark: 10_300 });
  });
});

describe("statistics", () => {
  const entry = (i: number, patch: Partial<JournalSummary>): JournalSummary => ({
    id: String(i),
    createdAt: NOW.toISOString(),
    pair: "EUR/USD",
    direction: "LONG",
    timeframe: "M15",
    entry: 1,
    stopLoss: 0.9,
    takeProfit: 1.2,
    positionSize: 0.1,
    riskPercent: 0.5,
    riskAmount: 50,
    rewardAmount: 100,
    riskReward: 2,
    accountCurrency: "USD",
    state: "ANALYZED",
    finalVerdict: "ACCEPTABLE",
    aiVerdict: "ACCEPTABLE",
    aiScore: 70,
    aiProvider: "mock",
    status: "PENDING",
    result: null,
    actualPnl: null,
    rMultiple: null,
    closedAt: null,
    ...patch,
  });

  it("summarises the journal", () => {
    const stats = journalStats([
      entry(1, { status: "CLOSED", result: "WIN", rMultiple: 2, aiScore: 80 }),
      entry(2, { status: "CLOSED", result: "LOSS", rMultiple: -1, aiScore: 60, finalVerdict: "CAUTION" }),
      entry(3, { finalVerdict: "BLOCKED", aiScore: null, state: "BLOCKED" }),
    ]);
    expect(stats).toMatchObject({ analyses: 3, accepted: 1, caution: 1, blocked: 1, wins: 1, losses: 1, averageAiScore: 70, averageR: 0.5 });
  });

  it("does not summarise score vs outcome until the sample is large enough", () => {
    const few = Array.from({ length: 5 }, (_, i) => entry(i, { status: "CLOSED", result: "WIN", rMultiple: 1 }));
    const r = scoreVsOutcome(few);
    expect(r.sufficient).toBe(false);
    expect(r.sampleSize).toBe(5);
    expect(r.buckets).toEqual([]);
    expect(r.rankCorrelation).toBeNull();
  });

  it("buckets scores and computes a rank correlation once enough trades exist", () => {
    const many = Array.from({ length: MIN_SAMPLE_FOR_SCORE_STATS }, (_, i) =>
      entry(i, { status: "CLOSED", aiScore: 40 + i * 2, result: i % 2 ? "WIN" : "LOSS", rMultiple: i % 2 ? 2 : -1 }),
    );
    const r = scoreVsOutcome(many);
    expect(r.sufficient).toBe(true);
    expect(r.buckets.reduce((s, b) => s + b.trades, 0)).toBe(MIN_SAMPLE_FOR_SCORE_STATS);
    expect(r.rankCorrelation).not.toBeNull();
  });

  it("Spearman correlation is 1 for monotone data and handles ties", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
    expect(spearman([1, 1, 2, 2], [1, 1, 2, 2])).toBeCloseTo(1, 10);
  });
});
