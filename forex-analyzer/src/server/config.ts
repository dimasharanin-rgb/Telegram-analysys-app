import { existsSync } from "node:fs";
import type { Effort } from "@/ai/claudeAnalyst";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface AppConfig {
  production: boolean;
  port: number;
  host: string;
  databasePath: string;
  anthropic: { apiKey: string | null; model: string; timeoutMs: number; effort: Effort };
  marketData: { provider: "mock" | "twelvedata"; apiKey: string | null; maxQuoteAgeSeconds: number };
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Reads .env (if present) and the environment. Secrets stay in this server-side object. */
export function loadConfig(argv = process.argv, env = process.env): AppConfig {
  if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || null;
  const marketKey = env.MARKET_DATA_API_KEY?.trim() || null;
  const requested = env.MARKET_DATA_PROVIDER?.trim().toLowerCase();
  const provider = requested === "mock" || requested === "twelvedata" ? requested : marketKey ? "twelvedata" : "mock";
  const effort = env.ANTHROPIC_EFFORT?.trim().toLowerCase() as Effort | undefined;

  return {
    production: argv.includes("--production") || env.NODE_ENV === "production",
    port: num(env.PORT, 5173),
    host: env.HOST?.trim() || "127.0.0.1",
    databasePath: env.DATABASE_PATH?.trim() || "./data/forex-analyzer.db",
    anthropic: {
      apiKey,
      model: env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5",
      timeoutMs: num(env.ANTHROPIC_TIMEOUT_SECONDS, 120) * 1000,
      effort: effort && EFFORTS.includes(effort) ? effort : "high",
    },
    marketData: {
      provider,
      apiKey: marketKey,
      maxQuoteAgeSeconds: num(env.MARKET_DATA_MAX_AGE_SECONDS, 300),
    },
  };
}
