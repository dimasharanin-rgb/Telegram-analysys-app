import type { TradeAnalyst } from "@/ai/analyst";
import { ClaudeAnalyst } from "@/ai/claudeAnalyst";
import { MockAnalyst } from "@/ai/mockAnalyst";
import type { AnalysisDeps } from "@/analysis/analysisService";
import { MarketDataService } from "@/data/marketDataService";
import { MockMarketDataProvider } from "@/data/mock/mockProvider";
import { MockPriceStream } from "@/data/mock/mockStream";
import { TwelveDataPriceStream } from "@/data/twelvedata/priceStream";
import { TwelveDataProvider } from "@/data/twelvedata/provider";
import { UsageTracker } from "@/data/usage";
import { openDatabase, type Db } from "@/journal/db";
import { JournalRepository } from "@/journal/journalRepository";
import { deriveAccountState } from "@/risk";
import type { AccountState } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";
import type { AppConfig } from "./config";
import { SettingsRepository } from "./settingsRepository";

export interface Services {
  config: AppConfig;
  db: Db;
  settings: SettingsRepository;
  journal: JournalRepository;
  market: MarketDataService;
  analyst: TradeAnalyst;
  usage: UsageTracker;
  now(): Date;
  accountState(settings: AccountSettings, now: Date): AccountState;
  analysisDeps(): AnalysisDeps;
  /** Applies settings that affect running services (data mode). */
  applySettings(settings: AccountSettings): void;
}

export interface ServiceOverrides {
  db?: Db;
  market?: MarketDataService;
  analyst?: TradeAnalyst;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export function createServices(config: AppConfig, overrides: ServiceOverrides = {}): Services {
  const db = overrides.db ?? openDatabase(config.databasePath);
  const settings = new SettingsRepository(db);
  const journal = new JournalRepository(db);
  const now = overrides.now ?? (() => new Date());
  const usage = new UsageTracker();

  const mockProvider = new MockMarketDataProvider({ now });
  const td = config.twelveData;
  const market =
    overrides.market ??
    new MarketDataService({
      live: td.apiKey
        ? {
            provider: new TwelveDataProvider({ apiKey: td.apiKey, baseUrl: td.restUrl, usage, fetchImpl: overrides.fetchImpl }),
            stream: new TwelveDataPriceStream({ apiKey: td.apiKey, url: td.wsUrl, usage }),
          }
        : null,
      liveUnavailableReason: "TWELVE_DATA_API_KEY is not set on the server.",
      mock: { provider: mockProvider, stream: new MockPriceStream(mockProvider) },
      mode: settings.get().dataMode,
      usage,
      candleTtlSeconds: td.candleTtlSeconds,
      restPollMs: td.restPollMs,
      now: () => now().getTime(),
    });

  const baseAnalyst =
    overrides.analyst ??
    (config.anthropic.apiKey
      ? new ClaudeAnalyst({ apiKey: config.anthropic.apiKey, model: config.anthropic.model, timeoutMs: config.anthropic.timeoutMs, effort: config.anthropic.effort })
      : new MockAnalyst());
  // Count Claude usage for the developer panel without the analyst knowing about it.
  const analyst: TradeAnalyst = {
    provider: baseAnalyst.provider,
    model: baseAnalyst.model,
    analyze: async (payload) => {
      if (baseAnalyst.provider === "anthropic") usage.claudeRequest();
      try {
        return await baseAnalyst.analyze(payload);
      } catch (error) {
        if (baseAnalyst.provider === "anthropic") usage.claudeError(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };

  const accountState = (s: AccountSettings, at: Date) => deriveAccountState(s, journal.accountRecords(), at);

  return {
    config,
    db,
    settings,
    journal,
    market,
    analyst,
    usage,
    now,
    accountState,
    applySettings: (s) => market.setMode(s.dataMode),
    analysisDeps: () => {
      const s = settings.get();
      return {
        market,
        analyst,
        getSettings: () => s,
        getAccountState: accountState,
        saveAnalysis: (result) => journal.insert(result),
        now,
        maxQuoteAgeSeconds: s.freshnessThresholdSeconds,
      };
    },
  };
}
