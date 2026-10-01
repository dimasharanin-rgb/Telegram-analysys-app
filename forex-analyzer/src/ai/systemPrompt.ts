import { readFileSync } from "node:fs";

let cached: string | null = null;

/** The analyst system prompt lives in prompts/trade-analyst.system.md so it can be reviewed and edited as text. */
export function getSystemPrompt(): string {
  cached ??= readFileSync(new URL("./prompts/trade-analyst.system.md", import.meta.url), "utf8").trim();
  return cached;
}
