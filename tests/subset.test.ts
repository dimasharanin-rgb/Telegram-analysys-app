import { describe, expect, it } from "vitest";

import { selectExcerpts } from "@/lib/pipeline/excerpts";
import { segmentConversations } from "@/lib/analysis/segmentation";
import { MessageType, type NormalizedMessage } from "@/lib/model/message";

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2020, 0, 1, 12);

interface Turn {
  text?: string;
  media?: boolean;
}

/**
 * Builds a conversation of `days` daily exchanges, so the gap-based segmenter
 * produces one segment per day and a segment's position in the array is its
 * position in time.
 */
function conversation(days: readonly Turn[][]): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  let id = 0;

  days.forEach((turns, day) => {
    turns.forEach((turn, index) => {
      id += 1;
      const epochMs = START + day * DAY_MS + index * 60_000;
      const hasMedia = turn.media === true;
      messages.push({
        id: String(id),
        timestamp: new Date(epochMs).toISOString(),
        epochMs,
        localIso: new Date(epochMs).toISOString().slice(0, 19),
        senderId: index % 2 === 0 ? "a" : "b",
        senderName: index % 2 === 0 ? "Alex" : "Sam",
        text: turn.text ?? `message ${id}`,
        replyTo: null,
        type: hasMedia ? MessageType.IMAGE : MessageType.TEXT,
        hasMedia,
        media: hasMedia ? [{ kind: MessageType.IMAGE, mimeType: "image/jpeg" }] : [],
        reactions: [],
        edited: false,
        forwarded: false,
      });
    });
  });

  return messages;
}

/** Plain two-person exchange, deliberately unremarkable. */
function plainDay(count = 4): Turn[] {
  return Array.from({ length: count }, () => ({}));
}

const PARTICIPANTS = new Map([
  ["a", "P1"],
  ["b", "P2"],
]);

function pick(messages: NormalizedMessage[], charBudget: number, maxSegments = 3) {
  const segments = segmentConversations(messages, 360);
  return selectExcerpts(messages, segments, PARTICIPANTS, {
    charBudget,
    maxSegments,
  });
}

/** Which day (0-based) each chosen excerpt came from. */
function chosenDays(
  selection: ReturnType<typeof selectExcerpts>,
  messages: NormalizedMessage[],
): number[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  return selection.excerpts.map((excerpt) => {
    const first = byId.get(excerpt.messages[0]!.id)!;
    return Math.floor((first.epochMs - START) / DAY_MS);
  });
}

describe("a subset is chosen, not a prefix", () => {
  it("spreads across the whole period rather than reading the start", () => {
    const messages = conversation(Array.from({ length: 30 }, () => plainDay()));
    const selection = pick(messages, 1_200, 3);
    const days = chosenDays(selection, messages);

    expect(days.length).toBeGreaterThan(1);
    // The last day reached is far from the beginning: this is not a prefix.
    expect(Math.max(...days)).toBeGreaterThan(10);
  });

  it("stays inside the character budget", () => {
    const messages = conversation(Array.from({ length: 40 }, () => plainDay(10)));
    const selection = pick(messages, 900, 5);
    expect(selection.totalCharacters).toBeLessThanOrEqual(1_200);
  });

  it("reads everything when everything fits", () => {
    const messages = conversation([plainDay(6), plainDay(6)]);
    const selection = pick(messages, 100_000, 10);
    expect(selection.includedIds.size).toBe(messages.length);
  });
});

describe("the signals section 30 asks for actually change the choice", () => {
  it("prefers a dense burst over a quiet day", () => {
    const days = Array.from({ length: 12 }, () => plainDay(3));
    // One day several times the usual length, in the middle of the period so
    // recency cannot be what selects it.
    days[6] = plainDay(40);
    const messages = conversation(days);

    const selection = pick(messages, 2_000, 2);
    expect(chosenDays(selection, messages)).toContain(6);
  });

  it("prefers a day of considered messages over a day of one-word replies", () => {
    const days = Array.from({ length: 12 }, () => plainDay(6));
    days[5] = Array.from({ length: 6 }, () => ({ text: "x".repeat(400) }));
    const messages = conversation(days);

    const selection = pick(messages, 4_000, 2);
    expect(chosenDays(selection, messages)).toContain(5);
  });

  it("prefers a media-rich exchange over a bare one", () => {
    const days = Array.from({ length: 12 }, () => plainDay(6));
    days[4] = Array.from({ length: 6 }, () => ({ media: true, text: "look at this" }));
    const messages = conversation(days);

    const selection = pick(messages, 2_000, 2);
    expect(chosenDays(selection, messages)).toContain(4);
  });

  it("weights the recent end when nothing else distinguishes the days", () => {
    // Every day identical, so recency is the only remaining signal.
    const messages = conversation(Array.from({ length: 20 }, () => plainDay(5)));
    const selection = pick(messages, 700, 1);
    const days = chosenDays(selection, messages);

    expect(days[0]).toBeGreaterThan(9);
  });

  it("does not let recency read only the last few days", () => {
    // The bonus is bounded, so an early exchange that is genuinely busier
    // still beats a recent quiet one - otherwise the analysis could never say
    // what changed, which is most of its value.
    const days = Array.from({ length: 20 }, () => plainDay(3));
    days[1] = plainDay(40);
    const messages = conversation(days);

    const selection = pick(messages, 2_000, 2);
    expect(chosenDays(selection, messages)).toContain(1);
  });
});

describe("shortlisted moments are never dropped for budget", () => {
  it("includes a priority segment even when the budget is already spent", () => {
    const messages = conversation(Array.from({ length: 20 }, () => plainDay(8)));
    const segments = segmentConversations(messages, 360);
    const target = segments[15]!;

    const selection = selectExcerpts(messages, segments, PARTICIPANTS, {
      // Far too small for even one segment.
      charBudget: 10,
      maxSegments: 2,
      prioritySegmentIndices: [target.index],
    });

    const ids = new Set(selection.excerpts.flatMap((e) => e.messages.map((m) => m.id)));
    expect(ids.has(messages[target.startIndex]!.id)).toBe(true);
  });
});
