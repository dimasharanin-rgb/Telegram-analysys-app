import express, { Router } from "express";
import { z } from "zod";
import { DEFAULT_SETTINGS } from "@/shared/defaults";
import { journalFiltersSchema, outcomeSchema, settingsSchema, tradeInputSchema } from "@/shared/schemas";
import { computeLimits } from "@/risk";
import { analyzeTrade, evaluateRisk } from "@/analysis/analysisService";
import { MarketDataError, type MarketDataErrorCode } from "@/data/types";
import { TIMEFRAMES } from "@/shared/types/trade";
import { SETUP_TYPES } from "@/shared/types/setup";
import { buildAnalysisSnapshot } from "@/technical/snapshot";
import { scanMarket } from "@/scanner/scanService";
import { analyzeCandidate } from "@/autonomous/service";
import { setupConfig } from "@/setups";
import { normalizeSymbol, getInstrument } from "@/shared/instruments";
import { journalStats, scoreVsOutcome } from "@/journal/stats";
import type { DashboardData } from "@/shared/types/dashboard";
import type { Services } from "@/server/container";
import { HttpError, errorHandler, parseInput } from "@/server/api/http";

const idParam = z.uuid();

/**
 * JSON API. Everything that needs a secret (Claude, the market data key) runs
 * behind these routes; the browser only ever sees results.
 */
const scanRequestSchema = z.object({
  symbols: z
    .array(z.string().transform(normalizeSymbol))
    .min(1)
    .max(20, "Scan at most 20 symbols at a time")
    .refine((l) => l.every((s) => getInstrument(s)), "Unknown symbol")
    .optional(),
  timeframes: z.array(z.enum(TIMEFRAMES)).min(1).max(4).default(["M15", "H1"]),
  config: z
    .object({
      allowedSetupTypes: z.array(z.enum(SETUP_TYPES)).min(1),
      minimumAtrPercent: z.number().min(0).nullable(),
      requireTrendAlignment: z.boolean(),
      requireHigherTimeframeAgreement: z.boolean(),
      maxDistanceFromLevelAtr: z.number().positive().max(10),
      compressionMaxRangeAtr: z.number().positive().max(50),
      minimumCompleteness: z.number().min(0).max(1),
    })
    .partial()
    .strict()
    .optional(),
});

const MARKET_HTTP_STATUS: Record<MarketDataErrorCode, number> = {
  INVALID_SYMBOL: 400,
  UNSUPPORTED_TIMEFRAME: 400,
  NOT_CONFIGURED: 503,
  RATE_LIMITED: 429,
  AUTH: 502,
  PLAN_RESTRICTED: 502,
  TIMEOUT: 504,
  BAD_RESPONSE: 502,
  NO_DATA: 502,
  UNAVAILABLE: 502,
};

/** Runs a market-data call, turning provider errors into explicit HTTP errors (never into substitute data). */
async function market<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof MarketDataError) throw new HttpError(MARKET_HTTP_STATUS[error.code], error.message, undefined, error.code);
    throw error;
  }
}

export function createApiRouter(services: Services): Router {
  const router = Router();
  router.use(express.json({ limit: "64kb" }));

  router.get("/status", (_req, res) => {
    res.json({
      dataMode: services.market.mode,
      liveConfigured: services.market.liveConfigured,
      marketSource: services.market.name,
      stream: services.market.streamStatus(),
      ai: { provider: services.analyst.provider, model: services.analyst.model, isMock: services.analyst.provider === "mock" },
      execution: "disabled",
    });
  });

  router.get("/settings", (_req, res) => {
    res.json(services.settings.get());
  });

  router.put("/settings", (req, res) => {
    const settings = services.settings.save(parseInput(settingsSchema, req.body));
    services.applySettings(settings);
    res.json(settings);
  });

  router.post("/settings/reset", (_req, res) => {
    const settings = services.settings.save(structuredClone(DEFAULT_SETTINGS));
    services.applySettings(settings);
    res.json(settings);
  });

  router.get("/account", (_req, res) => {
    const settings = services.settings.get();
    const account = services.accountState(settings, services.now());
    res.json({ currency: settings.currency, account, limits: computeLimits(settings, account) });
  });

  router.post("/risk", async (req, res) => {
    const trade = parseInput(tradeInputSchema, req.body);
    res.json(await evaluateRisk(trade, services.analysisDeps()));
  });

  router.post("/analyze", async (req, res) => {
    const trade = parseInput(tradeInputSchema, req.body);
    res.json(await analyzeTrade(trade, services.analysisDeps()));
  });

  const symbolQuery = z.object({ symbol: z.string().trim().min(3).max(20) });

  router.get("/market/search", async (req, res) => {
    const { q } = parseInput(z.object({ q: z.string().trim().max(20).default("") }), req.query);
    res.json(await market(() => services.market.searchSymbols(q)));
  });

  router.get("/market/quote", async (req, res) => {
    const { symbol } = parseInput(symbolQuery, req.query);
    res.json(await market(() => services.market.getQuote(symbol)));
  });

  router.get("/market/candles", async (req, res) => {
    const q = parseInput(
      symbolQuery.extend({ timeframe: z.enum(TIMEFRAMES), limit: z.coerce.number().int().min(10).max(1000).default(300) }),
      req.query,
    );
    const result = await market(() => services.market.getCandlesWithInfo(q.symbol, q.timeframe, q.limit));
    res.json({ symbol: q.symbol, timeframe: q.timeframe, ...result, retrievedAt: Date.now() });
  });

  router.get("/market/snapshot", async (req, res) => {
    const { symbol } = parseInput(symbolQuery, req.query);
    const maxAgeSeconds = services.settings.get().freshnessThresholdSeconds;
    res.json(await market(() => services.market.snapshot(symbol, { maxAgeSeconds })));
  });

  /**
   * Server-sent events with live prices for one symbol. The browser never talks
   * to Twelve Data; this server holds the one upstream WebSocket and fans out.
   */
  router.get("/stream", (req, res) => {
    const { symbol } = parseInput(symbolQuery, req.query);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const stop = services.market.watch(symbol, (q) => send("quote", q), (s) => send("status", s));
    send("status", services.market.streamStatus());
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(keepAlive);
      stop();
    });
  });

  /** Deterministic market context (no candles, no AI) for the analyzer's informational panel. */
  router.get("/market/context", async (req, res) => {
    const { symbol } = parseInput(symbolQuery, req.query);
    const maxAgeSeconds = services.settings.get().freshnessThresholdSeconds;
    const data = await market(() => services.market.snapshot(symbol, { maxAgeSeconds }));
    const snap = buildAnalysisSnapshot(data, services.now().getTime());
    res.json({ symbol: snap.symbol, asOf: snap.asOf, metadata: snap.metadata, stale: data.stale, staleReasons: data.staleReasons, timeframes: snap.timeframes });
  });

  /**
   * One on-demand deterministic scan for setup candidates. Never calls Claude,
   * never runs on a schedule, never places anything.
   */
  router.post("/scan", async (req, res) => {
    const body = parseInput(scanRequestSchema, req.body ?? {});
    const settings = services.settings.get();
    const symbols = body.symbols ?? settings.allowedPairs;
    const result = await scanMarket(
      { symbols, timeframes: body.timeframes, config: setupConfig({ ...body.config, allowedTimeframes: body.timeframes }) },
      { market: services.market, now: () => services.now().getTime(), maxAgeSeconds: settings.freshnessThresholdSeconds },
    );
    services.candidates.add(result.candidates, result.snapshots);
    res.json(result);
  });

  /**
   * Evaluates one scanned candidate: Claude (or the mock) proposes TRADE or
   * NO_TRADE, and any proposal is re-checked by the deterministic risk engine.
   * Only the candidate id is accepted; the market facts come from the server's
   * own scan. The result is an analysis, never an order.
   */
  router.post("/autonomous/analyze", async (req, res) => {
    const { candidateId } = parseInput(z.object({ candidateId: z.string().min(1).max(200) }), req.body ?? {});
    const stored = services.candidates.get(candidateId);
    if (!stored) throw new HttpError(404, "Candidate not found or expired. Run the scan again.");
    const settings = services.settings.get();
    res.json(
      await analyzeCandidate(stored, {
        evaluator: services.evaluator,
        analysis: services.analysisDeps(),
        log: services.decisions,
        now: () => services.now().getTime(),
        freshnessSeconds: settings.freshnessThresholdSeconds,
      }),
    );
  });

  router.get("/autonomous/decisions", (req, res) => {
    const { limit } = parseInput(z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }), req.query);
    res.json({ counts: services.decisions.counts(), decisions: services.decisions.recent(limit), evaluator: { provider: services.evaluator.provider, model: services.evaluator.model } });
  });

  router.get("/dev/usage", (_req, res) => {
    res.json({ usage: services.usage.snapshot(), stream: services.market.streamStatus(), dataMode: services.market.mode });
  });

  router.get("/journal", (req, res) => {
    res.json(services.journal.list(parseInput(journalFiltersSchema, req.query)));
  });

  router.get("/journal/:id", (req, res) => {
    const entry = services.journal.get(parseInput(idParam, req.params.id));
    if (!entry) throw new HttpError(404, "Journal entry not found");
    res.json(entry);
  });

  router.patch("/journal/:id/outcome", (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const entry = services.journal.updateOutcome(id, parseInput(outcomeSchema, req.body), services.now());
    if (!entry) throw new HttpError(404, "Journal entry not found");
    res.json(entry);
  });

  router.delete("/journal/:id", (req, res) => {
    if (!services.journal.delete(parseInput(idParam, req.params.id))) throw new HttpError(404, "Journal entry not found");
    res.status(204).end();
  });

  router.get("/dashboard", (_req, res) => {
    const settings = services.settings.get();
    const account = services.accountState(settings, services.now());
    const entries = services.journal.list();
    const data: DashboardData = {
      currency: settings.currency,
      account,
      limits: computeLimits(settings, account),
      stats: journalStats(entries),
      scoreVsOutcome: scoreVsOutcome(entries),
      recent: entries.slice(0, 8),
    };
    res.json(data);
  });

  router.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  router.use(errorHandler);
  return router;
}
