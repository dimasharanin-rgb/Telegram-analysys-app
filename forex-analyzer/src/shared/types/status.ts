import type { DataMode, StreamStatus } from "./market";

export interface AppStatus {
  dataMode: DataMode;
  /** Whether TWELVE_DATA_API_KEY is configured on the server. */
  liveConfigured: boolean;
  marketSource: string;
  stream: StreamStatus;
  ai: { provider: "anthropic" | "mock"; model: string; isMock: boolean };
  execution: "disabled";
}
