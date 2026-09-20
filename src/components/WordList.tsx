import * as React from "react";
import type { WordCount } from "@/lib/stats";
import { formatNumber } from "@/lib/client/format";

/**
 * Most-used meaningful words.
 *
 * A list rather than a cloud: weight is carried by a readable count and a
 * gentle fill, so the ranking is actually readable instead of decorative.
 */
export function WordList({ words }: { words: WordCount[] }) {
  if (words.length === 0) {
    return <p className="text-sm text-muted">Not enough text to rank words.</p>;
  }

  const max = Math.max(...words.map((word) => word.count), 1);

  return (
    <ul className="flex flex-wrap gap-2">
      {words.map((word) => {
        const intensity = word.count / max;
        return (
          <li key={word.word}>
            <span
              className="inline-flex items-baseline gap-2 rounded-full border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: intensity > 0.55 ? "#dbeafe" : "#f8fafc",
                borderColor: intensity > 0.55 ? "#bfdbfe" : "#e2e8f0",
                color: intensity > 0.55 ? "#1d4ed8" : "#0f172a",
              }}
            >
              <span className="font-medium">{word.word}</span>
              <span className="text-xs tabular-nums opacity-70">
                {formatNumber(word.count)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
