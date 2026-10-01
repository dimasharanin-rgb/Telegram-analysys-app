import { useEffect, useState } from "react";
import type { RiskReport } from "@/types/risk";
import type { TradeInput } from "@/types/trade";
import { api } from "@/lib/apiClient";

/** Debounced call to the server's risk engine as the user types; cancels superseded requests. */
export function useRiskPreview(trade: TradeInput | null, refreshKey: unknown, delayMs = 300) {
  const [report, setReport] = useState<RiskReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = trade ? JSON.stringify(trade) : null;

  useEffect(() => {
    if (!key) {
      setReport(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .risk(JSON.parse(key) as TradeInput, controller.signal)
        .then((r) => {
          setReport(r);
          setError(null);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, refreshKey, delayMs]);

  return { report, loading, error };
}
