import type { UsageSnapshot } from "@/shared/types/usage";

export type { UsageSnapshot };

export class UsageTracker {
  private data: UsageSnapshot = {
    twelveData: { requests: 0, errors: 0, byEndpoint: {}, lastError: null, lastRequestAt: null },
    websocket: { messages: 0, connects: 0, reconnects: 0, lastMessageAt: null },
    claude: { requests: 0, errors: 0, lastError: null, lastRequestAt: null },
    cache: { hits: 0, misses: 0 },
    lastMarketUpdate: null,
  };

  twelveDataRequest(endpoint: string): void {
    const t = this.data.twelveData;
    t.requests++;
    t.byEndpoint[endpoint] = (t.byEndpoint[endpoint] ?? 0) + 1;
    t.lastRequestAt = Date.now();
  }
  twelveDataError(message: string): void {
    this.data.twelveData.errors++;
    this.data.twelveData.lastError = message;
  }
  wsMessage(): void {
    this.data.websocket.messages++;
    this.data.websocket.lastMessageAt = Date.now();
  }
  wsConnect(reconnect: boolean): void {
    this.data.websocket.connects++;
    if (reconnect) this.data.websocket.reconnects++;
  }
  claudeRequest(): void {
    this.data.claude.requests++;
    this.data.claude.lastRequestAt = Date.now();
  }
  claudeError(message: string): void {
    this.data.claude.errors++;
    this.data.claude.lastError = message;
  }
  cacheHit(): void {
    this.data.cache.hits++;
  }
  cacheMiss(): void {
    this.data.cache.misses++;
  }
  marketUpdate(at: number): void {
    this.data.lastMarketUpdate = Math.max(this.data.lastMarketUpdate ?? 0, at);
  }
  snapshot(): UsageSnapshot {
    return structuredClone(this.data);
  }
}
