import type { TradeAnalyst } from "@/ai/analyst";
import { ClaudeAnalyst } from "@/ai/claudeAnalyst";
import { MockAnalyst } from "@/ai/mockAnalyst";
import { openDatabase, type Db } from "@/database/client";
import { JournalRepository } from "@/database/journalRepository";
import { SettingsRepository } from "@/database/settingsRepository";
import { deriveAccountState } from "@/risk";
import type { AnalysisDeps } from "@/services/analysis/analysisService";
import { CachedMarketDataProvider } from "@/services/market/cachedProvider";
import { MockMarketDataProvider } from "@/services/market/mockProvider";
import { TwelveDataProvider } from "@/services/market/twelveDataProvider";
import type { MarketDataProvider } from "@/services/market/types";
import type { AccountState } from "@/types/risk";
import type { AccountSettings } from "@/types/settings";
import type { AppConfig } from "./config";

export interface Services {
  config: AppConfig;
  db: Db;
  settings: SettingsRepository;
  journal: JournalRepository;
  market: MarketDataProvider;
  analyst: TradeAnalyst;
  now(): Date;
  accountState(settings: AccountSettings, now: Date): AccountState;
  analysisDeps(): AnalysisDeps;
}

export interface ServiceOverrides {
  db?: Db;
  market?: MarketDataProvider;
  analyst?: TradeAnalyst;
  now?: () => Date;
}

export function createServices(config: AppConfig, overrides: ServiceOverrides = {}): Services {
  const db = overrides.db ?? openDatabase(config.databasePath);
  const settings = new SettingsRepository(db);
  const journal = new JournalRepository(db);
  const now = overrides.now ?? (() => new Date());

  const market =
    overrides.market ??
    new CachedMarketDataProvider(
      config.marketData.provider === "twelvedata" && config.marketData.apiKey
        ? new TwelveDataProvider({ apiKey: config.marketData.apiKey })
        : new MockMarketDataProvider({ now }),
    );

  const analyst =
    overrides.analyst ??
    (config.anthropic.apiKey
      ? new ClaudeAnalyst({
          apiKey: config.anthropic.apiKey,
          model: config.anthropic.model,
          timeoutMs: config.anthropic.timeoutMs,
          effort: config.anthropic.effort,
        })
      : new MockAnalyst());

  const accountState = (s: AccountSettings, at: Date) => deriveAccountState(s, journal.accountRecords(), at);

  return {
    config,
    db,
    settings,
    journal,
    market,
    analyst,
    now,
    accountState,
    analysisDeps: () => ({
      market,
      analyst,
      getSettings: () => settings.get(),
      getAccountState: accountState,
      saveAnalysis: (result) => journal.insert(result),
      now,
      maxQuoteAgeSeconds: config.marketData.maxQuoteAgeSeconds,
    }),
  };
}
