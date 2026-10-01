import type { AnalysisResult } from "@/types/analysis";
import type { DashboardData } from "@/types/dashboard";
import type { InstrumentSpec } from "@/types/instrument";
import type { JournalEntry, JournalFilters, JournalSummary, OutcomeUpdate } from "@/types/journal";
import type { MarketPrice } from "@/types/market";
import type { AccountLimitsSnapshot, AccountState, RiskReport } from "@/types/risk";
import type { AccountSettings } from "@/types/settings";
import type { AppStatus } from "@/types/status";
import type { TradeInput } from "@/types/trade";

/** Browser-side client for the server API. No secrets ever pass through here. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
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
  const data = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.fields);
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
  instruments: () => request<InstrumentSpec[]>("GET", "/instruments"),
  settings: () => request<AccountSettings>("GET", "/settings"),
  saveSettings: (settings: AccountSettings) => request<AccountSettings>("PUT", "/settings", settings),
  resetSettings: () => request<AccountSettings>("POST", "/settings/reset", {}),
  account: () => request<AccountSummary>("GET", "/account"),
  risk: (trade: TradeInput, signal?: AbortSignal) => request<RiskReport>("POST", "/risk", trade, signal),
  analyze: (trade: TradeInput) => request<AnalysisResult>("POST", "/analyze", trade),
  quote: (pair: string) => request<{ quote: MarketPrice; stale: string | null }>("GET", `/market/quote${query({ pair })}`),
  journal: (filters: JournalFilters = {}) =>
    request<JournalSummary[]>("GET", `/journal${query(filters as Record<string, string | number | undefined>)}`),
  journalEntry: (id: string) => request<JournalEntry>("GET", `/journal/${encodeURIComponent(id)}`),
  updateOutcome: (id: string, outcome: OutcomeUpdate) =>
    request<JournalEntry>("PATCH", `/journal/${encodeURIComponent(id)}/outcome`, outcome),
  deleteEntry: (id: string) => request<void>("DELETE", `/journal/${encodeURIComponent(id)}`),
  dashboard: () => request<DashboardData>("GET", "/dashboard"),
};
