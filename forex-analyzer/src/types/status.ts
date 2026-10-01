export interface AppStatus {
  marketData: { id: string; name: string; isMock: boolean };
  ai: { provider: "anthropic" | "mock"; model: string; isMock: boolean };
  maxQuoteAgeSeconds: number;
  execution: "disabled";
}
