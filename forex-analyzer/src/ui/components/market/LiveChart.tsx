import { useEffect, useState } from "react";
import type { Candle } from "@/shared/types/market";
import { PRIMARY_TIMEFRAMES, type Timeframe } from "@/shared/types/trade";
import { api } from "@/ui/lib/apiClient";
import { loadLocal, saveLocal } from "@/ui/lib/storage";
import { feedState, useLiveFeed } from "@/ui/hooks/useLiveFeed";
import { TradeChart, type TradeLevels } from "@/ui/components/charts/TradeChart";
import { Notice } from "@/ui/components/ui/Notice";

const CHART_TIMEFRAMES: Timeframe[] = [...PRIMARY_TIMEFRAMES].reverse(); // M5, M15, H1, H4
/** Re-sync with the server's (cached) candles now and then; live ticks keep the forming bar current in between. */
const RESYNC_MS = 5 * 60_000;

/** Candles from the active data source for the selected pair, kept current by the live price stream. */
export function LiveChart({ trade, height = 420 }: { trade?: TradeLevels; height?: number }) {
  const feed = useLiveFeed();
  const [tf, setTf] = useState<Timeframe>(() => loadLocal("fx-analyzer:chart-tf", { tf: "M15" as Timeframe }).tf);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const mode = feed.status?.mode;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .candles(feed.symbol, tf, 300)
      .then((r) => {
        if (cancelled) return;
        setCandles(r.candles);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCandles([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !cancelled && setLoading(false));
    const t = setTimeout(() => setNonce((n) => n + 1), RESYNC_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [feed.symbol, tf, nonce, mode]);

  const live = feedState(feed).label === "LIVE" && feed.status?.transport !== "rest-poll";
  return (
    <div className="flex flex-col">
      {error && (
        <Notice tone="block" className="m-2">
          {error}
        </Notice>
      )}
      <TradeChart
        symbol={feed.symbol}
        timeframe={tf}
        timeframes={CHART_TIMEFRAMES}
        onTimeframeChange={(t) => {
          setTf(t);
          saveLocal("fx-analyzer:chart-tf", { tf: t });
        }}
        candles={candles}
        liveQuote={feed.quote}
        trade={trade}
        live={live}
        simulated={mode === "MOCK"}
        loading={loading}
        height={height}
      />
    </div>
  );
}
