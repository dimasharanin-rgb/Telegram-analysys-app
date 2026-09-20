"use client";

import * as React from "react";
import type { InsightCardModel } from "@/lib/client/insights";
import { cx } from "@/lib/client/format";
import { Button } from "./ui/Button";
import { InsightCard } from "./InsightCard";
import type { EvidenceLookup } from "./EvidenceDrawer";

export interface InsightDeckProps {
  primary: InsightCardModel[];
  extra: InsightCardModel[];
  messages: EvidenceLookup;
}

const SWIPE_THRESHOLD = 48;

export function InsightDeck({ primary, extra, messages }: InsightDeckProps) {
  const [showAll, setShowAll] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const regionRef = React.useRef<HTMLDivElement>(null);

  const cards = React.useMemo(
    () => (showAll ? [...primary, ...extra] : primary),
    [showAll, primary, extra],
  );

  const total = cards.length;
  const current = cards[Math.min(index, total - 1)];

  const go = React.useCallback(
    (next: number) => {
      setIndex((value) => {
        const target = Math.max(0, Math.min(total - 1, next));
        return target === value ? value : target;
      });
    },
    [total],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      go(0);
    } else if (event.key === "End") {
      event.preventDefault();
      go(total - 1);
    }
  };

  if (total === 0 || !current) {
    return (
      <p className="py-16 text-center text-muted">
        The analysis produced no insights for this conversation.
      </p>
    );
  }

  return (
    <div>
      <div
        ref={regionRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Analysis insights"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          const touch = event.changedTouches[0];
          touchStart.current = null;
          if (!start || !touch) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          // Ignore mostly-vertical drags so page scrolling still works.
          if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
          go(dx < 0 ? index + 1 : index - 1);
        }}
        className="rounded-xl outline-none"
      >
        <InsightCard
          key={current.id}
          card={current}
          index={index}
          total={total}
          messages={messages}
        />
      </div>

      {/* Controls sit below the card so the thumb reaches them on mobile. */}
      <div className="mt-5 flex items-center justify-between gap-4">
        <Button
          variant="secondary"
          size="md"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Previous insight"
          className="min-w-24"
        >
          ← Back
        </Button>

        <div className="flex flex-col items-center gap-2">
          <p className="text-sm tabular-nums text-muted" aria-live="polite">
            <span className="font-semibold text-ink">{index + 1}</span> / {total}
          </p>
          <div className="flex max-w-40 flex-wrap justify-center gap-1.5">
            {cards.map((card, cardIndex) => (
              <button
                key={card.id}
                type="button"
                aria-label={`Go to insight ${cardIndex + 1}: ${card.title}`}
                aria-current={cardIndex === index}
                onClick={() => go(cardIndex)}
                className={cx(
                  "h-1.5 rounded-full transition-all duration-200",
                  cardIndex === index ? "w-5 bg-brand-600" : "w-1.5 bg-line hover:bg-brand-200",
                )}
              />
            ))}
          </div>
        </div>

        <Button
          size="md"
          onClick={() => go(index + 1)}
          disabled={index === total - 1}
          aria-label="Next insight"
          className="min-w-24"
        >
          Next →
        </Button>
      </div>

      <p className="mt-4 text-center text-xs text-faint">
        Swipe, or use the arrow keys, to move between insights.
      </p>

      {extra.length > 0 && !showAll ? (
        <div className="mt-6 text-center">
          <Button variant="ghost" onClick={() => setShowAll(true)}>
            Show {extra.length} more {extra.length === 1 ? "insight" : "insights"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
