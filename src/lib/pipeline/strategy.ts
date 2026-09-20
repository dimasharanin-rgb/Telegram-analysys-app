/**
 * Strategy selection for large conversations.
 *
 * A short conversation fits comfortably in one request, and one request is
 * both cheaper and better (the model sees everything at once). A long one is
 * split into periods, each analysed on its own, and then synthesised against
 * the complete statistics.
 *
 * The threshold is `ANALYSIS_SINGLE_PASS_MAX_MESSAGES` (default 800 messages)
 * combined with the excerpt character budget: whichever is exceeded first
 * pushes the run into the chunked path.
 */

import type { Excerpt } from "@/lib/ai/schema";

export type AnalysisStrategy =
  | { kind: "single-pass"; excerpts: Excerpt[] }
  | { kind: "chunked"; chunks: Excerpt[][] };

export interface StrategyOptions {
  totalMessages: number;
  singlePassMaxMessages: number;
  excerptCharBudget: number;
  maxChunks: number;
}

function excerptSize(excerpt: Excerpt): number {
  return excerpt.messages.reduce(
    (sum, message) => sum + message.t.length + message.id.length + 8,
    0,
  );
}

export function chooseStrategy(
  excerpts: Excerpt[],
  options: StrategyOptions,
): AnalysisStrategy {
  const totalCharacters = excerpts.reduce((sum, excerpt) => sum + excerptSize(excerpt), 0);

  const fitsInOnePass =
    options.totalMessages <= options.singlePassMaxMessages &&
    totalCharacters <= options.excerptCharBudget;

  if (fitsInOnePass || excerpts.length <= 1) {
    return { kind: "single-pass", excerpts };
  }

  // Pack excerpts into chronological chunks under the per-call budget, then
  // rebalance if that produced more chunks than we are allowed to make.
  const chunks = packChunks(excerpts, options.excerptCharBudget);
  if (chunks.length <= options.maxChunks) return { kind: "chunked", chunks };

  const perChunk = Math.ceil(excerpts.length / options.maxChunks);
  const limited: Excerpt[][] = [];
  for (let i = 0; i < excerpts.length; i += perChunk) {
    limited.push(excerpts.slice(i, i + perChunk));
  }
  return { kind: "chunked", chunks: limited };
}

function packChunks(excerpts: Excerpt[], budget: number): Excerpt[][] {
  const chunks: Excerpt[][] = [];
  let current: Excerpt[] = [];
  let currentSize = 0;

  for (const excerpt of excerpts) {
    const size = excerptSize(excerpt);
    if (current.length > 0 && currentSize + size > budget) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(excerpt);
    currentSize += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
