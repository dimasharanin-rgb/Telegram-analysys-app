import { describe, expect, it } from "vitest";

import { segmentConversations } from "@/lib/analysis/segmentation";
import { computeStatistics, tokenize, WEEKDAY_LABELS } from "@/lib/stats";
import { parseTelegramExport } from "@/lib/telegram/parser";
import { loadFixtureConversation, rawExport } from "./helpers";

/**
 * A hand-built conversation with numbers that can be checked by hand:
 *
 *   day 1  09:00 Ana   "Hey, are you free later?"      <- starts conversation 1
 *          09:02 Ben   "yes"                            <- 2 min reply
 *          09:03 Ana   "Great!"                         <- 1 min reply
 *   day 1  20:00 Ben   "I'm back, sorry"                <- starts conversation 2
 *          20:10 Ana   "no worries at all 🙂"           <- 10 min reply
 *   day 3  09:00 Ana   "Morning! coffee?"               <- starts conversation 3
 *          09:01 Ana   "or tea"
 *          09:30 Ben   "coffee"                         <- 29 min reply
 */
const SMALL = rawExport([
  ["a", 0, "Hey, are you free later?"],
  ["b", 2, "yes"],
  ["a", 3, "Great!"],
  ["b", 11 * 60, "I'm back, sorry"],
  ["a", 11 * 60 + 10, "no worries at all 🙂"],
  ["a", 48 * 60, "Morning! coffee?"],
  ["a", 48 * 60 + 1, "or tea"],
  ["b", 48 * 60 + 30, "coffee"],
]);

function smallStats() {
  return computeStatistics(parseTelegramExport(SMALL), { conversationGapMinutes: 360 });
}

describe("general statistics", () => {
  it("counts messages and shares per participant", () => {
    const { statistics } = smallStats();
    expect(statistics.general.totalMessages).toBe(8);
    expect(statistics.general.perParticipant.user1).toBe(5);
    expect(statistics.general.perParticipant.user2).toBe(3);
    expect(statistics.general.sharePerParticipant.user1).toBe(62.5);
    expect(statistics.general.sharePerParticipant.user2).toBe(37.5);
  });

  it("reports the date range and active days", () => {
    const { statistics } = smallStats();
    expect(statistics.general.dateRange.start).toBe("2024-03-01");
    expect(statistics.general.dateRange.end).toBe("2024-03-03");
    expect(statistics.general.dateRange.spanDays).toBe(3);
    // Messages fall on 1 March and 3 March only.
    expect(statistics.general.activeDays).toBe(2);
  });

  it("measures message length", () => {
    const { statistics } = smallStats();
    expect(statistics.general.length.averageCharacters).toBeGreaterThan(5);
    expect(statistics.general.lengthPerParticipant.user2?.averageCharacters).toBeLessThan(
      statistics.general.lengthPerParticipant.user1!.averageCharacters,
    );
  });
});

describe("conversation segmentation and initiation", () => {
  it("splits on the configured gap", () => {
    const conversation = parseTelegramExport(SMALL);
    expect(segmentConversations(conversation.messages, 360)).toHaveLength(3);
    // A 24-hour gap rule merges the first two conversations of day one.
    expect(segmentConversations(conversation.messages, 24 * 60)).toHaveLength(2);
  });

  it("attributes each conversation to whoever spoke first", () => {
    const { statistics } = smallStats();
    expect(statistics.initiation.totalConversations).toBe(3);
    expect(statistics.initiation.perParticipant.user1).toBe(2);
    expect(statistics.initiation.perParticipant.user2).toBe(1);
    expect(statistics.initiation.sharePerParticipant.user1).toBeCloseTo(66.7, 1);
  });

  it("documents the heuristic it used", () => {
    const { statistics } = smallStats();
    expect(statistics.initiation.algorithm).toContain("6 hours");
    expect(statistics.initiation.algorithm).toContain("approximation");
  });
});

describe("response behaviour", () => {
  it("measures replies only across a change of speaker inside one conversation", () => {
    const { statistics } = smallStats();
    // Ben replies after 2 min and 29 min; Ana after 1 min and 10 min.
    expect(statistics.response.perParticipant.user2?.count).toBe(2);
    expect(statistics.response.perParticipant.user2?.medianSeconds).toBe(
      (120 + 1740) / 2,
    );
    expect(statistics.response.perParticipant.user1?.count).toBe(2);
    expect(statistics.response.perParticipant.user1?.medianSeconds).toBe((60 + 600) / 2);
  });

  it("excludes gaps that cross a conversation boundary", () => {
    const { statistics } = smallStats();
    // Four replies in total; the 11-hour and 37-hour gaps are conversation
    // breaks rather than slow replies, so neither appears here.
    expect(statistics.response.overall.count).toBe(4);
    expect(statistics.response.overall.slowestSeconds).toBe(1740);
  });

  it("reports the longest silence separately from the longest reply", () => {
    const { statistics } = smallStats();
    expect(statistics.response.longestResponse?.seconds).toBe(1740);
    // 3 March 09:00 minus 1 March 20:10.
    expect(statistics.response.longestSilence?.seconds).toBe(
      (48 * 60 - (11 * 60 + 10)) * 60,
    );
  });

  it("buckets response times", () => {
    const { statistics } = smallStats();
    const total = statistics.response.distribution.reduce(
      (sum, bucket) => sum + bucket.count,
      0,
    );
    expect(total).toBe(4);
    expect(
      statistics.response.distribution.find((bucket) => bucket.id === "1to5m")?.count,
    ).toBe(2);
    expect(
      statistics.response.distribution.find((bucket) => bucket.id === "5to15m")?.count,
    ).toBe(1);
    expect(
      statistics.response.distribution.find((bucket) => bucket.id === "15to60m")?.count,
    ).toBe(1);
  });
});

describe("message characteristics", () => {
  it("counts questions, exclamations, emoji and consecutive runs", () => {
    const { statistics } = smallStats();
    const ana = statistics.characteristics.perParticipant.user1!;
    expect(ana.questions).toBe(2);
    expect(ana.exclamations).toBe(2);
    expect(ana.messagesWithEmoji).toBe(1);
    expect(ana.totalEmoji).toBe(1);
    // "Morning! coffee?" + "or tea" is a run of two.
    expect(ana.maxConsecutiveMessages).toBe(2);
  });

  it("counts links", () => {
    const conversation = parseTelegramExport(
      rawExport([
        ["a", 0, "look https://example.com/thing"],
        ["b", 1, "nice"],
      ]),
    );
    const { statistics } = computeStatistics(conversation);
    expect(statistics.characteristics.perParticipant.user1?.links).toBe(1);
    expect(statistics.characteristics.totalLinks).toBe(1);
  });

  it("counts a repeated message only when the same person sends it twice", () => {
    const conversation = parseTelegramExport(
      rawExport([
        ["a", 0, "are we still on for tomorrow"],
        ["b", 1, "are we still on for tomorrow"],
        ["a", 2, "are we still on for tomorrow"],
      ]),
    );
    const { statistics } = computeStatistics(conversation);
    expect(statistics.characteristics.perParticipant.user1?.repeatedMessages).toBe(1);
    expect(statistics.characteristics.perParticipant.user2?.repeatedMessages).toBe(0);
  });
});

describe("time patterns", () => {
  it("bins by hour and weekday in the export's own clock", () => {
    const { statistics } = computeStatistics(
      parseTelegramExport(
        rawExport(
          [
            ["a", 0, "one"],
            ["b", 1, "two"],
          ],
          { offsetMinutes: 120 },
        ),
      ),
    );
    // 09:00 UTC is 11:00 local.
    expect(statistics.time.byHour[11]).toBe(2);
    expect(statistics.time.busiestHour).toBe(11);
    // 1 March 2024 was a Friday; index 4 with Monday first.
    expect(statistics.time.byWeekday[4]).toBe(2);
    expect(WEEKDAY_LABELS[statistics.time.busiestWeekday!]).toBe("Friday");
  });

  it("produces daily and monthly series", () => {
    const { statistics } = smallStats();
    expect(statistics.time.daily.map((point) => point.date)).toEqual([
      "2024-03-01",
      "2024-03-03",
    ]);
    expect(statistics.time.monthly).toHaveLength(1);
    expect(statistics.time.monthly[0]?.count).toBe(8);
  });
});

describe("words", () => {
  it("tokenizes across alphabets", () => {
    expect(tokenize("Hello, мир! 123")).toEqual(["hello", "мир", "123"]);
  });

  it("removes stopwords and pure numbers from the ranking", () => {
    const conversation = parseTelegramExport(
      rawExport([
        ["a", 0, "the coffee was good and the coffee was hot 123"],
        ["b", 1, "coffee coffee"],
      ]),
    );
    const { statistics } = computeStatistics(conversation);
    const words = statistics.words.top.map((entry) => entry.word);
    expect(words[0]).toBe("coffee");
    expect(words).not.toContain("the");
    expect(words).not.toContain("was");
    expect(words).not.toContain("123");
  });

  it("only builds phrases from words that were actually adjacent", () => {
    const conversation = parseTelegramExport(
      rawExport([
        ["a", 0, "flat viewing again"],
        ["b", 1, "flat viewing again"],
        ["a", 2, "flat viewing again"],
        ["b", 3, "ok"],
      ]),
    );
    const { statistics } = computeStatistics(conversation);
    expect(statistics.words.phrases.map((entry) => entry.phrase)).toContain(
      "flat viewing",
    );
  });
});

describe("the synthetic fixture", () => {
  it("produces a coherent set of statistics", () => {
    const conversation = loadFixtureConversation();
    const { statistics, segments } = computeStatistics(conversation, {
      conversationGapMinutes: 360,
    });

    expect(statistics.general.totalMessages).toBe(conversation.messages.length);
    expect(segments.length).toBeGreaterThan(50);

    const shares = Object.values(statistics.general.sharePerParticipant);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 0);

    const initiationShares = Object.values(statistics.initiation.sharePerParticipant);
    expect(initiationShares.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 0);

    // Alex was generated as the slower replier and the more frequent initiator.
    const alex = conversation.participants.find((p) => p.name.startsWith("Alex"))!;
    const sam = conversation.participants.find((p) => p.name.startsWith("Sam"))!;
    expect(statistics.initiation.sharePerParticipant[alex.id]!).toBeGreaterThan(
      statistics.initiation.sharePerParticipant[sam.id]!,
    );
    expect(statistics.response.perParticipant[alex.id]!.medianSeconds).toBeGreaterThan(
      statistics.response.perParticipant[sam.id]!.medianSeconds,
    );

    expect(statistics.words.top.length).toBeGreaterThan(10);
    expect(statistics.meta.mediaMessages).toBeGreaterThan(0);
  });

  it("changes conversation counts when the gap rule changes", () => {
    const conversation = loadFixtureConversation();
    const tight = computeStatistics(conversation, { conversationGapMinutes: 60 });
    const loose = computeStatistics(conversation, { conversationGapMinutes: 720 });
    expect(tight.statistics.initiation.totalConversations).toBeGreaterThan(
      loose.statistics.initiation.totalConversations,
    );
  });
});
