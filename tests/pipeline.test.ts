import { beforeEach, describe, expect, it } from "vitest";

import { resetServerConfigCache } from "@/lib/config";
import { computeStatistics } from "@/lib/stats";
import { segmentConversations } from "@/lib/analysis/segmentation";
import { selectExcerpts } from "@/lib/pipeline/excerpts";
import { chooseStrategy } from "@/lib/pipeline/strategy";
import { buildAnalysisRequest, buildPseudonyms, humanise } from "@/lib/pipeline/payload";
import { runAnalysisPipeline, type ProgressEvent } from "@/lib/pipeline/run";
import type { Analysis, ChunkFindings, Excerpt } from "@/lib/ai/schema";
import type { AIAnalysisService, UsageTotals } from "@/lib/ai/types";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";
import { loadFixtureConversation } from "./helpers";

/* -------------------------------------------------------------------------
 * Stub provider
 * ---------------------------------------------------------------------- */

function analysisWithEvidence(ids: string[]): Analysis {
  return {
    overview: { summary: "Summary for Participant A and Participant B.", confidence: "medium" },
    patterns: [
      {
        title: "A pattern",
        category: "communication",
        observation: "Participant A writes longer messages.",
        interpretation: "One reading is a difference in style.",
        uncertainty: "Length alone says little.",
        evidence: [{ messageIds: ids, excerpt: "example" }],
        confidence: "medium",
      },
    ],
    strengths: [],
    watchouts: [],
    suggestions: [],
    recurringTopics: [],
  };
}

class StubService implements AIAnalysisService {
  readonly provider = "stub";
  readonly model = "stub-model";
  readonly chunkCalls: number[] = [];
  singlePassCalls = 0;
  synthesisCalls = 0;

  constructor(private readonly evidenceIds: string[] = []) {}

  async analyzeConversation(): Promise<Analysis> {
    this.singlePassCalls += 1;
    return analysisWithEvidence(this.evidenceIds);
  }

  async analyzeCommunicationPatterns(
    _excerpts: Excerpt[],
    context: { chunkIndex: number },
  ): Promise<ChunkFindings> {
    this.chunkCalls.push(context.chunkIndex);
    return {
      periodSummary: `Period ${context.chunkIndex + 1}`,
      observations: [],
      topics: [],
    };
  }

  async generateFinalSummary(): Promise<Analysis> {
    this.synthesisCalls += 1;
    return analysisWithEvidence(this.evidenceIds);
  }

  usage(): UsageTotals {
    return {
      calls: this.singlePassCalls + this.chunkCalls.length + this.synthesisCalls,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

/* -------------------------------------------------------------------------
 * Excerpt selection
 * ---------------------------------------------------------------------- */

describe("excerpt selection", () => {
  const conversation = loadFixtureConversation();
  const segments = segmentConversations(conversation.messages, 360);
  const pseudonyms = buildPseudonyms(conversation);

  it("respects the character budget", () => {
    const selection = selectExcerpts(
      conversation.messages,
      segments,
      pseudonyms.toPseudonym,
      { charBudget: 6_000 },
    );
    expect(selection.totalCharacters).toBeLessThanOrEqual(8_000);
    expect(selection.excerpts.length).toBeGreaterThan(0);
  });

  it("spreads the selection across the timeline", () => {
    const selection = selectExcerpts(
      conversation.messages,
      segments,
      pseudonyms.toPseudonym,
      { charBudget: 45_000, maxSegments: 12 },
    );
    const months = new Set(selection.excerpts.map((excerpt) => excerpt.startIso.slice(0, 7)));
    expect(months.size).toBeGreaterThan(3);
  });

  it("uses pseudonymous participant ids and keeps real message ids", () => {
    const selection = selectExcerpts(
      conversation.messages,
      segments,
      pseudonyms.toPseudonym,
      { charBudget: 20_000 },
    );
    const first = selection.excerpts[0]!.messages[0]!;
    expect(["A", "B"]).toContain(first.p);
    expect(selection.includedIds.has(first.id)).toBe(true);
  });

  it("marks media instead of sending it", () => {
    const selection = selectExcerpts(
      conversation.messages,
      segments,
      pseudonyms.toPseudonym,
      { charBudget: 200_000, maxSegments: 200 },
    );
    const media = selection.excerpts
      .flatMap((excerpt) => excerpt.messages)
      .filter((message) => message.media !== undefined);
    expect(media.length).toBeGreaterThan(0);
    for (const message of media) {
      expect(["photo", "voice", "video", "sticker", "file", "location", "contact", "poll"]).toContain(
        message.media,
      );
    }
  });

  it("truncates long messages", () => {
    const selection = selectExcerpts(
      conversation.messages,
      segments,
      pseudonyms.toPseudonym,
      { charBudget: 200_000, maxCharsPerMessage: 20, maxSegments: 200 },
    );
    for (const excerpt of selection.excerpts) {
      for (const message of excerpt.messages) {
        expect(message.t.length).toBeLessThanOrEqual(20);
      }
    }
  });
});

/* -------------------------------------------------------------------------
 * Payload
 * ---------------------------------------------------------------------- */

describe("analysis request payload", () => {
  const conversation = loadFixtureConversation();
  const { statistics, segments } = computeStatistics(conversation);
  const built = buildAnalysisRequest(conversation, statistics, segments);

  it("never includes real participant names", () => {
    const serialised = JSON.stringify(built.request);
    for (const participant of conversation.participants) {
      expect(serialised).not.toContain(participant.name);
    }
    expect(built.request.participants.map((p) => p.label)).toEqual([
      "Participant A",
      "Participant B",
    ]);
  });

  it("carries a digest rather than the full statistics object", () => {
    const serialised = JSON.stringify(built.request.statistics);
    expect(serialised).not.toContain("daily");
    expect(serialised).not.toContain("byHourPerParticipant");
    expect(built.request.statistics.totalMessages).toBe(statistics.general.totalMessages);
  });

  it("records consent with the request", () => {
    expect(built.request.consent.accepted).toBe(true);
    expect(built.request.consent.scope).toBe("text-only");
  });

  it("puts the real names back for display", () => {
    const [first] = conversation.participants;
    expect(
      humanise("Participant A sends more messages.", built.pseudonyms.toDisplayName),
    ).toBe(`${first!.name} sends more messages.`);
  });
});

/* -------------------------------------------------------------------------
 * Strategy
 * ---------------------------------------------------------------------- */

describe("strategy selection", () => {
  function excerpt(id: string, messageCount: number, size: number): Excerpt {
    return {
      id,
      startIso: "2024-01-01T10:00:00",
      endIso: "2024-01-01T11:00:00",
      totalMessages: messageCount,
      messages: Array.from({ length: messageCount }, (_, index) => ({
        id: `${id}-${index}`,
        p: index % 2 === 0 ? "A" : "B",
        m: index,
        t: "x".repeat(Math.max(1, Math.round(size / messageCount))),
      })),
    };
  }

  it("uses a single pass for a small conversation", () => {
    const strategy = chooseStrategy([excerpt("s0", 10, 500), excerpt("s1", 10, 500)], {
      totalMessages: 200,
      singlePassMaxMessages: 800,
      excerptCharBudget: 45_000,
      maxChunks: 8,
    });
    expect(strategy.kind).toBe("single-pass");
  });

  it("chunks once the message count passes the documented threshold", () => {
    const excerpts = Array.from({ length: 6 }, (_, index) =>
      excerpt(`s${index}`, 20, 4_000),
    );
    const strategy = chooseStrategy(excerpts, {
      totalMessages: 5_000,
      singlePassMaxMessages: 800,
      excerptCharBudget: 10_000,
      maxChunks: 8,
    });
    expect(strategy.kind).toBe("chunked");
    if (strategy.kind === "chunked") {
      expect(strategy.chunks.length).toBeGreaterThan(1);
      expect(strategy.chunks.flat()).toHaveLength(excerpts.length);
    }
  });

  it("never exceeds the configured chunk ceiling", () => {
    const excerpts = Array.from({ length: 40 }, (_, index) =>
      excerpt(`s${index}`, 20, 8_000),
    );
    const strategy = chooseStrategy(excerpts, {
      totalMessages: 20_000,
      singlePassMaxMessages: 800,
      excerptCharBudget: 5_000,
      maxChunks: 4,
    });
    expect(strategy.kind).toBe("chunked");
    if (strategy.kind === "chunked") {
      expect(strategy.chunks.length).toBeLessThanOrEqual(4);
      expect(strategy.chunks.flat()).toHaveLength(excerpts.length);
    }
  });
});

/* -------------------------------------------------------------------------
 * Orchestration
 * ---------------------------------------------------------------------- */

describe("runAnalysisPipeline", () => {
  const conversation = loadFixtureConversation();
  const { statistics, segments } = computeStatistics(conversation);

  beforeEach(() => {
    resetServerConfigCache();
    delete process.env.ANALYSIS_SINGLE_PASS_MAX_MESSAGES;
    delete process.env.ANALYSIS_EXCERPT_CHAR_BUDGET;
  });

  it("runs a single pass for a small conversation and reports real stages", async () => {
    process.env.ANALYSIS_SINGLE_PASS_MAX_MESSAGES = "20000";
    resetServerConfigCache();

    const built = buildAnalysisRequest(conversation, statistics, segments);
    const service = new StubService([built.includedIds[0]!]);
    const events: ProgressEvent[] = [];

    const result = await runAnalysisPipeline({
      request: built.request,
      service,
      onProgress: (event) => events.push(event),
    });

    expect(result.strategy).toBe("single-pass");
    expect(service.singlePassCalls).toBe(1);
    expect(service.chunkCalls).toHaveLength(0);
    expect(events.map((event) => event.stage)).toEqual([
      "preparing",
      "analyzing",
      "validating",
      "done",
    ]);
    expect(events.at(-1)?.percent).toBe(100);
  });

  it("maps over chunks then synthesises for a large conversation", async () => {
    process.env.ANALYSIS_SINGLE_PASS_MAX_MESSAGES = "50";
    process.env.ANALYSIS_EXCERPT_CHAR_BUDGET = "4000";
    resetServerConfigCache();

    const built = buildAnalysisRequest(conversation, statistics, segments, {
      charBudget: 40_000,
    });
    const service = new StubService();
    const events: ProgressEvent[] = [];

    const result = await runAnalysisPipeline({
      request: built.request,
      service,
      onProgress: (event) => events.push(event),
    });

    expect(result.strategy).toBe("chunked");
    expect(result.chunks).toBeGreaterThan(1);
    expect(service.chunkCalls).toHaveLength(result.chunks);
    expect(service.synthesisCalls).toBe(1);

    const readingEvents = events.filter((event) => event.stage === "reading");
    expect(readingEvents).toHaveLength(result.chunks);
    // Progress only moves forward.
    const percents = events.map((event) => event.percent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });

  it("strips evidence the model invented", async () => {
    process.env.ANALYSIS_SINGLE_PASS_MAX_MESSAGES = "20000";
    resetServerConfigCache();

    const built = buildAnalysisRequest(conversation, statistics, segments);
    const service = new StubService(["not-a-real-id"]);

    const result = await runAnalysisPipeline({ request: built.request, service });
    expect(result.analysis.patterns[0]!.evidence[0]!.messageIds).toEqual([]);
  });

  it("surfaces a provider failure as an AppError", async () => {
    const built = buildAnalysisRequest(conversation, statistics, segments);
    const failing: AIAnalysisService = {
      provider: "stub",
      model: "stub",
      analyzeConversation: async () => {
        throw new Error("boom");
      },
      analyzeCommunicationPatterns: async () => {
        throw new Error("boom");
      },
      generateFinalSummary: async () => {
        throw new Error("boom");
      },
      usage: () => ({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    };

    await expect(
      runAnalysisPipeline({ request: built.request, service: failing }),
    ).rejects.toMatchObject({ name: "AppError" });
  });
});

/* -------------------------------------------------------------------------
 * Rate limiting
 * ---------------------------------------------------------------------- */

describe("rate limiting", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then refuses", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit("ip", 3, 60_000, 1000).allowed).toBe(true);
    }
    const blocked = checkRateLimit("ip", 3, 60_000, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    checkRateLimit("ip", 1, 60_000, 1000);
    expect(checkRateLimit("ip", 1, 60_000, 1000).allowed).toBe(false);
    expect(checkRateLimit("ip", 1, 60_000, 120_000).allowed).toBe(true);
  });

  it("tracks callers separately", () => {
    checkRateLimit("a", 1, 60_000, 1000);
    expect(checkRateLimit("b", 1, 60_000, 1000).allowed).toBe(true);
  });
});
