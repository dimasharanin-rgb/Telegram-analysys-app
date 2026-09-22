import { afterEach, describe, expect, it } from "vitest";

import {
  analysisLanguages,
  DEFAULT_LANGUAGE_CODE,
  getLanguage,
  languageFromAcceptHeader,
  resolveLanguage,
} from "@/lib/analysis/language";
import { languageDirective } from "@/lib/ai/output-rules";
import { sharedContextBlock } from "@/lib/ai/modules/prompts";
import type { AdvancedDigest } from "@/lib/ai/modules/input";
import type { StatisticsDigest } from "@/lib/ai/schema";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ANALYSIS_LANGUAGES;
});

describe("the offered languages are configuration", () => {
  it("ships a catalogue including the ones the product names", () => {
    const codes = analysisLanguages().map((language) => language.code);
    expect(codes).toContain("en");
    expect(codes).toContain("lv");
    expect(codes).toContain("ru");
    expect(codes).toContain("es");
    expect(codes).toContain("de");
  });

  it("can be narrowed from the environment", () => {
    process.env.NEXT_PUBLIC_ANALYSIS_LANGUAGES = "en,lv";
    expect(analysisLanguages().map((l) => l.code)).toEqual(["en", "lv"]);
  });

  it("ignores a misconfigured list rather than emptying the picker", () => {
    process.env.NEXT_PUBLIC_ANALYSIS_LANGUAGES = "klingon,elvish";
    expect(analysisLanguages().length).toBeGreaterThan(1);
  });

  it("carries each language's own name, which is what a picker should show", () => {
    expect(getLanguage("lv")?.nativeName).toBe("Latviešu");
    expect(getLanguage("ru")?.nativeName).toBe("Русский");
  });
});

describe("resolving a requested language", () => {
  it("accepts a region subtag and keeps the base language", () => {
    expect(resolveLanguage("de-AT").code).toBe("de");
    expect(resolveLanguage("RU").code).toBe("ru");
  });

  it("falls back to the default for anything not offered", () => {
    expect(resolveLanguage("klingon").code).toBe(DEFAULT_LANGUAGE_CODE);
    expect(resolveLanguage(null).code).toBe(DEFAULT_LANGUAGE_CODE);
  });

  it("never falls back to a language the deployment removed", () => {
    process.env.NEXT_PUBLIC_ANALYSIS_LANGUAGES = "lv,ru";
    // English is not offered here, so the fallback has to be one that is.
    expect(["lv", "ru"]).toContain(resolveLanguage("klingon").code);
  });
});

describe("defaulting from the browser", () => {
  it("picks the highest-quality offered language", () => {
    expect(languageFromAcceptHeader("lv-LV,lv;q=0.9,en;q=0.8").code).toBe("lv");
  });

  it("skips languages it cannot offer", () => {
    expect(languageFromAcceptHeader("ja;q=0.9,de;q=0.8").code).toBe("de");
  });

  it("falls back when the header is absent or useless", () => {
    expect(languageFromAcceptHeader(null).code).toBe(DEFAULT_LANGUAGE_CODE);
    expect(languageFromAcceptHeader("").code).toBe(DEFAULT_LANGUAGE_CODE);
  });
});

describe("the directive reaches the model", () => {
  it("names the language, in English and in its own script", () => {
    const directive = languageDirective(getLanguage("lv")!);
    expect(directive).toContain("Latvian");
    expect(directive).toContain("Latviešu");
    expect(directive).toContain("Do not answer in English");
  });

  it("still tells an English report not to translate quoted wording", () => {
    const directive = languageDirective(getLanguage("en")!);
    expect(directive).toContain("English");
    expect(directive).toContain("Do not translate quoted wording");
  });

  const statistics = {
    totalMessages: 10,
    dateRange: { start: "2024-01-01", end: "2024-02-01" },
    activeDays: 5,
    spanDays: 31,
    messageShare: { A: 50, B: 50 },
    initiationShare: { A: 50, B: 50 },
    totalConversations: 3,
    averageMessagesPerConversation: 3,
    medianResponseSeconds: { A: 60, B: 60 },
    averageResponseSeconds: { A: 60, B: 60 },
    averageMessageCharacters: { A: 20, B: 20 },
    questionRate: { A: 10, B: 10 },
    emojiRate: { A: 1, B: 1 },
    averageConsecutiveMessages: { A: 1, B: 1 },
    busiestHour: 20,
    busiestWeekday: "Friday",
    topWords: ["flat"],
    topPhrases: [],
    mediaMessages: 0,
  } satisfies StatisticsDigest;

  const advanced = {
    interaction: {
      perParticipant: {},
      reciprocity: {
        messageBalance: 1,
        initiationBalance: 1,
        lengthBalance: 1,
        responseTimeRatio: 1,
        turns: 4,
        averageTurnsPerConversation: 2,
      },
    },
    emotional: { messagesScored: 10, perParticipant: {} },
    timeline: { comparable: false, periods: [], changes: [] },
    conflictCandidates: [],
  } as unknown as AdvancedDigest;

  const context = {
    participants: [
      { id: "A", label: "Participant A" },
      { id: "B", label: "Participant B" },
    ],
    statistics,
    advanced,
    excerpts: [],
  };

  it("puts the chosen language into the shared context every module reads", () => {
    const block = sharedContextBlock({ ...context, language: "ru" });
    expect(block).toContain("Russian");
  });

  it("defaults to English when a job carries no language", () => {
    expect(sharedContextBlock(context)).toContain("Write every field in English");
  });

  it("keeps the context identical for one job, so it is still cacheable", () => {
    const first = sharedContextBlock({ ...context, language: "lv" });
    const second = sharedContextBlock({ ...context, language: "lv" });
    expect(first).toBe(second);
  });
});
