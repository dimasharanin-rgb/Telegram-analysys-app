/** Counters for the developer panel: what the app has spent on external APIs. */
export interface UsageSnapshot {
  twelveData: { requests: number; errors: number; byEndpoint: Record<string, number>; lastError: string | null; lastRequestAt: number | null };
  websocket: { messages: number; connects: number; reconnects: number; lastMessageAt: number | null };
  claude: { requests: number; errors: number; lastError: string | null; lastRequestAt: number | null };
  cache: { hits: number; misses: number };
  lastMarketUpdate: number | null;
}
