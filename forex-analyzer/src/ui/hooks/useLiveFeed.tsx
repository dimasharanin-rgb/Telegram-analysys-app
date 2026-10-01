import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Quote, StreamStatus } from "@/shared/types/market";
import { loadLocal, saveLocal } from "@/ui/lib/storage";
import { useAppData } from "./useAppData";

interface LiveFeed {
  symbol: string;
  setSymbol: (symbol: string) => void;
  quote: Quote | null;
  /** Server-reported stream status; null until the first message. */
  status: StreamStatus | null;
  /** Whether this browser is connected to the server's event stream. */
  connected: boolean;
}

const Ctx = createContext<LiveFeed | null>(null);
const KEY = "fx-analyzer:symbol";

/**
 * One server-sent-events connection for the selected symbol. Prices arrive
 * from this application's server (which holds the Twelve Data WebSocket), so
 * the browser never sees an API key. Prices only update the screen; they never
 * trigger analysis.
 */
export function LiveFeedProvider({ children }: { children: ReactNode }) {
  const { settings, status: appStatus } = useAppData();
  const [symbol, setSymbolState] = useState<string>(() => loadLocal(KEY, { s: "EUR/USD" }).s);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const mode = settings?.dataMode ?? appStatus?.dataMode;

  const setSymbol = (s: string) => {
    setSymbolState(s);
    saveLocal(KEY, { s });
  };

  useEffect(() => {
    setQuote(null);
    setStatus(null);
    const source = new EventSource(`/api/stream?symbol=${encodeURIComponent(symbol)}`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // EventSource reconnects by itself
    source.addEventListener("quote", (e) => {
      const q = JSON.parse((e as MessageEvent<string>).data) as Quote;
      if (q.symbol === symbol) setQuote(q);
    });
    source.addEventListener("status", (e) => setStatus(JSON.parse((e as MessageEvent<string>).data) as StreamStatus));
    return () => source.close();
  }, [symbol, mode]);

  return <Ctx.Provider value={{ symbol, setSymbol, quote, status, connected }}>{children}</Ctx.Provider>;
}

export function useLiveFeed(): LiveFeed {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLiveFeed must be used inside LiveFeedProvider");
  return ctx;
}

/** What the connection dot says: LIVE, RECONNECTING or OFFLINE. */
export function feedState(feed: LiveFeed): { label: "LIVE" | "RECONNECTING" | "OFFLINE"; reason: string | null } {
  if (!feed.connected) return { label: "RECONNECTING", reason: "Lost connection to the application server." };
  const s = feed.status;
  if (!s) return { label: "RECONNECTING", reason: "Connecting…" };
  if (s.state === "LIVE") return { label: "LIVE", reason: s.reason };
  if (s.state === "CONNECTING" || s.state === "RECONNECTING") return { label: "RECONNECTING", reason: s.reason };
  if (s.transport === "rest-poll") return { label: "OFFLINE", reason: s.reason };
  return { label: "OFFLINE", reason: s.reason };
}
