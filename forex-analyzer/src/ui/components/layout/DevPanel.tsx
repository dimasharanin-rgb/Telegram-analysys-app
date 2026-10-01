import { useEffect, useState } from "react";
import type { StreamStatus } from "@/shared/types/market";
import type { UsageSnapshot } from "@/shared/types/usage";
import { api } from "@/ui/lib/apiClient";

const ago = (t: number | null) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))} s ago` : "never");

/** Developer Mode: what the app has spent on Twelve Data and Claude since the server started. */
export function DevPanel() {
  const [data, setData] = useState<{ usage: UsageSnapshot; stream: StreamStatus; dataMode: string } | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = () => api.devUsage().then((d) => !cancelled && setData(d)).catch(() => undefined);
    void load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  if (!data) return null;
  const { usage, stream } = data;
  return (
    <aside className="border-t border-line bg-panel px-4 py-1.5 text-[11px] text-muted" aria-label="API usage">
      <button className="label mr-3 hover:text-fg" onClick={() => setOpen(!open)}>
        Developer · API usage {open ? "▾" : "▸"}
      </button>
      {open && (
        <span className="num inline-flex flex-wrap gap-x-4 gap-y-0.5">
          <span>Twelve Data requests {usage.twelveData.requests}</span>
          <span className={usage.twelveData.errors ? "text-warn" : ""}>errors {usage.twelveData.errors}</span>
          <span title={JSON.stringify(usage.twelveData.byEndpoint)}>
            {Object.entries(usage.twelveData.byEndpoint).map(([k, v]) => `${k} ${v}`).join(" · ") || "no REST calls"}
          </span>
          <span>cache hit/miss {usage.cache.hits}/{usage.cache.misses}</span>
          <span>
            WebSocket {stream.transport === "websocket" ? stream.state : stream.transport} ({stream.subscribed.join(",") || "none"}) · msgs {usage.websocket.messages} · reconnects {usage.websocket.reconnects}
          </span>
          <span>Claude requests {usage.claude.requests}</span>
          <span className={usage.claude.errors ? "text-warn" : ""}>errors {usage.claude.errors}</span>
          <span>last market update {ago(usage.lastMarketUpdate)}</span>
          {usage.twelveData.lastError && <span className="text-warn" title={usage.twelveData.lastError}>last TD error: {usage.twelveData.lastError.slice(0, 80)}</span>}
        </span>
      )}
    </aside>
  );
}
