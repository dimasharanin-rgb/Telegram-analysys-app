import { readFileSync } from "node:fs";

/** Recorded with every result, so analyses made with different prompts can be told apart later. */
export const AUTONOMOUS_PROMPT_VERSION = "autonomous-analysis-v1";

let cached: string | null = null;

export function getAutonomousSystemPrompt(): string {
  cached ??= readFileSync(new URL(`./prompts/${AUTONOMOUS_PROMPT_VERSION}.system.md`, import.meta.url), "utf8").trim();
  return cached;
}
