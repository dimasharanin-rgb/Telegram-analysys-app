import express, { Router } from "express";
import { z } from "zod";
import { INSTRUMENTS, getInstrument } from "@/lib/instruments";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { journalFiltersSchema, outcomeSchema, settingsSchema, tradeInputSchema } from "@/lib/schemas";
import { computeLimits } from "@/risk";
import { analyzeTrade, evaluateRisk } from "@/services/analysis/analysisService";
import { quoteProblem } from "@/services/market/freshness";
import { MarketDataError } from "@/services/market/types";
import { journalStats, scoreVsOutcome } from "@/services/statsService";
import type { DashboardData } from "@/types/dashboard";
import type { Services } from "@/server/container";
import { HttpError, errorHandler, parseInput } from "./http";

const idParam = z.uuid();

/**
 * JSON API. Everything that needs a secret (Claude, the market data key) runs
 * behind these routes; the browser only ever sees results.
 */
export function createApiRouter(services: Services): Router {
  const router = Router();
  router.use(express.json({ limit: "64kb" }));

  router.get("/status", (_req, res) => {
    res.json({
      marketData: { id: services.market.id, name: services.market.name, isMock: services.market.isMock },
      ai: { provider: services.analyst.provider, model: services.analyst.model, isMock: services.analyst.provider === "mock" },
      maxQuoteAgeSeconds: services.config.marketData.maxQuoteAgeSeconds,
      execution: "disabled",
    });
  });

  router.get("/instruments", (_req, res) => {
    res.json(INSTRUMENTS);
  });

  router.get("/settings", (_req, res) => {
    res.json(services.settings.get());
  });

  router.put("/settings", (req, res) => {
    const settings = parseInput(settingsSchema, req.body);
    res.json(services.settings.save(settings));
  });

  router.post("/settings/reset", (_req, res) => {
    res.json(services.settings.save(structuredClone(DEFAULT_SETTINGS)));
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

  router.get("/market/quote", async (req, res) => {
    const { pair } = parseInput(z.object({ pair: z.string().min(3).max(12) }), req.query);
    if (!getInstrument(pair)) throw new HttpError(400, "Unknown instrument", { pair: "Unknown instrument" });
    try {
      const quote = await services.market.getCurrentPrice(pair);
      res.json({ quote, stale: quoteProblem(quote, services.now(), services.config.marketData.maxQuoteAgeSeconds) });
    } catch (error) {
      if (error instanceof MarketDataError) throw new HttpError(502, error.message);
      throw error;
    }
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
