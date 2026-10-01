import type { AnalysisResult, AnalysisSnapshot } from "@/shared/types/analysis";
import type { TimeframeAnalysis } from "@/shared/types/technical";
import type { ScanResult } from "@/shared/types/setup";
import type { AutonomousAnalysisResult } from "@/shared/types/autonomous";
import type { DashboardData } from "@/shared/types/dashboard";
import type { JournalEntry, JournalFilters, JournalSummary, OutcomeUpdate } from "@/shared/types/journal";
import type { Candle, CandleCacheInfo, Instrument, MarketDataMetadata, MarketDataSnapshot, Quote, StreamStatus } from "@/shared/types/market";
import type { Timeframe } from "@/shared/types/trade";
import type { UsageSnapshot } from "@/shared/types/usage";
import type { AccountLimitsSnapshot, AccountState, RiskReport } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";
import type { AppStatus } from "@/shared/types/status";
import type { TradeInput } from "@/shared/types/trade";

/** Browser-side client for the server API. No secrets ever pass through here. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "The server could not be reached.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string>; code?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.fields, data?.code);
  return data as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export interface AccountSummary {
  currency: string;
  account: AccountState;
  limits: AccountLimitsSnapshot;
}

export const api = {
  status: () => request<AppStatus>("GET", "/status"),
  settings: () => request<AccountSettings>("GET", "/settings"),
  saveSettings: (settings: AccountSettings) => request<AccountSettings>("PUT", "/settings", settings),
  resetSettings: () => request<AccountSettings>("POST", "/settings/reset", {}),
  account: () => request<AccountSummary>("GET", "/account"),
  risk: (trade: TradeInput, signal?: AbortSignal) => request<RiskReport>("POST", "/risk", trade, signal),
  analyze: (trade: TradeInput) => request<AnalysisResult>("POST", "/analyze", trade),
  quote: (symbol: string) => request<Quote>("GET", `/market/quote${query({ symbol })}`),
  candles: (symbol: string, timeframe: Timeframe, limit = 300) =>
    request<{ candles: Candle[]; info: CandleCacheInfo; metadata: MarketDataMetadata; retrievedAt: number }>("GET", `/market/candles${query({ symbol, timeframe, limit })}`),
  snapshot: (symbol: string) => request<MarketDataSnapshot>("GET", `/market/snapshot${query({ symbol })}`),
  searchSymbols: (q: string) => request<Instrument[]>("GET", `/market/search${query({ q })}`),
  marketContext: (symbol: string) =>
    request<{ symbol: string; asOf: number; metadata: AnalysisSnapshot["metadata"]; stale: boolean; staleReasons: string[]; timeframes: TimeframeAnalysis[] }>(
      "GET",
      `/market/context${query({ symbol })}`,
    ),
  scan: (body: { symbols: string[]; timeframes: Timeframe[] }) => request<ScanResult>("POST", "/scan", body),
  analyzeCandidate: (candidateId: string) => request<AutonomousAnalysisResult>("POST", "/autonomous/analyze", { candidateId }),
  decisions: (limit = 50) =>
    request<{ counts: { total: number; trade: number; noTrade: number }; decisions: AutonomousAnalysisResult[]; evaluator: { provider: string; model: string } }>(
      "GET",
      `/autonomous/decisions${query({ limit })}`,
    ),
  devUsage: () => request<{ usage: UsageSnapshot; stream: StreamStatus; dataMode: string }>("GET", "/dev/usage"),
  journal: (filters: JournalFilters = {}) =>
    request<JournalSummary[]>("GET", `/journal${query(filters as Record<string, string | number | undefined>)}`),
  journalEntry: (id: string) => request<JournalEntry>("GET", `/journal/${encodeURIComponent(id)}`),
  updateOutcome: (id: string, outcome: OutcomeUpdate) =>
    request<JournalEntry>("PATCH", `/journal/${encodeURIComponent(id)}/outcome`, outcome),
  deleteEntry: (id: string) => request<void>("DELETE", `/journal/${encodeURIComponent(id)}`),
  dashboard: () => request<DashboardData>("GET", "/dashboard"),
};
