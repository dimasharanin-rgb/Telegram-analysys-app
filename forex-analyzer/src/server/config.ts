import { existsSync } from "node:fs";
import type { Effort } from "@/ai/claudeAnalyst";
import { DEFAULT_CANDLE_TTL_SECONDS } from "@/data/candleCache";
import { TIMEFRAMES, type Timeframe } from "@/shared/types/trade";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface AppConfig {
  production: boolean;
  port: number;
  host: string;
  databasePath: string;
  anthropic: { apiKey: string | null; model: string; timeoutMs: number; effort: Effort };
  twelveData: {
    apiKey: string | null;
    restUrl: string;
    wsUrl: string;
    /** REST quote polling interval per watched symbol, used only while the WebSocket is down. */
    restPollMs: number;
    candleTtlSeconds: Record<Timeframe, number>;
  };
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** "M5=20,H1=90" → overrides of the default candle cache lifetimes. */
function ttl(raw: string | undefined): Record<Timeframe, number> {
  const out = { ...DEFAULT_CANDLE_TTL_SECONDS };
  for (const part of (raw ?? "").split(",")) {
    const [tf, value] = part.split("=").map((s) => s.trim());
    if (tf && (TIMEFRAMES as readonly string[]).includes(tf)) out[tf as Timeframe] = num(value, out[tf as Timeframe]);
  }
  return out;
}

/** Reads .env (if present) and the environment. Secrets stay in this server-side object. */
export function loadConfig(argv = process.argv, env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env && existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
  const effort = env.ANTHROPIC_EFFORT?.trim().toLowerCase() as Effort | undefined;
  return {
    production: argv.includes("--production") || env.NODE_ENV === "production",
    port: num(env.PORT, 5173),
    host: env.HOST?.trim() || "127.0.0.1",
    databasePath: env.DATABASE_PATH?.trim() || "./data/forex-analyzer.db",
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
      model: env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5",
      timeoutMs: num(env.ANTHROPIC_TIMEOUT_SECONDS, 120) * 1000,
      effort: effort && EFFORTS.includes(effort) ? effort : "high",
    },
    twelveData: {
      apiKey: env.TWELVE_DATA_API_KEY?.trim() || env.MARKET_DATA_API_KEY?.trim() || null,
      restUrl: env.TWELVE_DATA_REST_URL?.trim() || "https://api.twelvedata.com",
      wsUrl: env.TWELVE_DATA_WS_URL?.trim() || "wss://ws.twelvedata.com",
      restPollMs: num(env.TWELVE_DATA_REST_POLL_SECONDS, 30) * 1000,
      candleTtlSeconds: ttl(env.CANDLE_CACHE_TTL_SECONDS),
    },
  };
}
