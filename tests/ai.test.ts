import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import AnthropicSDK from "@anthropic-ai/sdk";

import { AppError } from "@/lib/errors";
import { resetServerConfigCache } from "@/lib/config";
import { ClaudeAnalysisService, recoverJson, translateProviderError } from "@/lib/ai/claude";
import { containsInternalId } from "@/lib/ai/prose";
import {
  analysisRequestSchema,
  analysisSchema,
  sanitiseAnalysis,
  type Analysis,
} from "@/lib/ai/schema";
import type { AnalysisContext } from "@/lib/ai/types";

/* -------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------- */

const VALID_ANALYSIS: Analysis = {
  overview: { summary: "A steady, mostly warm conversation.", confidence: "medium" },
  patterns: [
    {
      title: "Follow-up messages after short replies",
      category: "conversation-dynamics",
      observation: "Participant A often sends a second message after a one-word reply.",
      interpretation: "One reading is that a short reply feels unfinished.",
      uncertainty: "The messages alone cannot show what either person intended.",
      evidence: [{ messageIds: ["1", "999"], excerpt: "A: ... / B: ok / A: ..." }],
      confidence: "medium",
    },
  ],
  strengths: [
    {
      title: "Direct repair after conflict",
      description: "Both return to the subject calmly the next day.",
      evidence: [{ messageIds: ["2"], excerpt: "I'm sorry, that was a rubbish thing to say" }],
    },
  ],
  watchouts: [],
  suggestions: [
    {
      title: "Name the deadline separately",
      description: "Separate the decision from the time pressure.",
      do: "Say what you need and by when, as two sentences.",
      avoid: "Attaching an external deadline to a personal question.",
    },
  ],
  recurringTopics: [{ topic: "the flat", description: "A possible move.", frequency: "often" }],
};

const CONTEXT: AnalysisContext = {
  participants: [
    { id: "A", label: "Participant A" },
    { id: "B", label: "Participant B" },
  ],
  statistics: {
    totalMessages: 100,
    dateRange: { start: "2024-01-01", end: "2024-06-01" },
    activeDays: 40,
    spanDays: 150,
    messageShare: { A: 60, B: 40 },
    initiationShare: { A: 70, B: 30 },
    totalConversations: 20,
    averageMessagesPerConversation: 5,
    medianResponseSeconds: { A: 300, B: 120 },
    averageResponseSeconds: { A: 900, B: 300 },
    averageMessageCharacters: { A: 60, B: 20 },
    questionRate: { A: 22, B: 8 },
    emojiRate: { A: 10, B: 25 },
    averageConsecutiveMessages: { A: 1.8, B: 1.1 },
    busiestHour: 20,
    busiestWeekday: "Friday",
    topWords: ["coffee", "flat"],
    topPhrases: ["flat viewing"],
    mediaMessages: 4,
  },
};

function fakeClient(responses: unknown[]): {
  client: Anthropic;
  parse: ReturnType<typeof vi.fn>;
} {
  const parse = vi.fn();
  for (const response of responses) parse.mockResolvedValueOnce(response);
  return {
    client: { messages: { parse } } as unknown as Anthropic,
    parse,
  };
}

function okResponse(parsedOutput: unknown) {
  return {
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 500 },
    content: [{ type: "text", text: JSON.stringify(parsedOutput) }],
    parsed_output: parsedOutput,
  };
}

beforeEach(() => {
  resetServerConfigCache();
});

/* -------------------------------------------------------------------------
 * Tests
 * ---------------------------------------------------------------------- */

describe("ClaudeAnalysisService", () => {
  it("returns validated output and records usage", async () => {
    const { client, parse } = fakeClient([okResponse(VALID_ANALYSIS)]);
    const service = new ClaudeAnalysisService(client);

    const result = await service.analyzeConversation([], CONTEXT);

    expect(result.patterns).toHaveLength(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(service.usage()).toEqual({ calls: 1, inputTokens: 1000, outputTokens: 500 });
  });

  it("sends the exact statistics rather than asking the model to compute them", async () => {
    const { client, parse } = fakeClient([okResponse(VALID_ANALYSIS)]);
    await new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT);

    const body = parse.mock.calls[0]![0] as {
      system: string;
      messages: { content: string }[];
      output_config: { format: unknown; effort: string };
    };
    expect(body.messages[0]!.content).toContain("Detected conversations: 20");
    expect(body.messages[0]!.content).toContain("Participant A");
    expect(body.system).toContain("Do not recompute");
    expect(body.output_config.format).toBeDefined();
  });

  it("repairs once when the first response fails validation", async () => {
    const broken = { ...VALID_ANALYSIS, overview: { summary: "", confidence: "certain" } };
    const { client, parse } = fakeClient([
      okResponse(broken),
      okResponse(VALID_ANALYSIS),
    ]);

    const result = await new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT);

    expect(result.overview.confidence).toBe("medium");
    expect(parse).toHaveBeenCalledTimes(2);
    const repaired = parse.mock.calls[1]![0] as { messages: { content: string }[] };
    expect(repaired.messages[0]!.content).toContain("did not satisfy the required output schema");
  });

  it("repairs when the SDK's own structured-output check rejects the response", async () => {
    // The SDK validates against the schema itself and throws synchronously on
    // a violation, wrapping its own message twice - this is that shape,
    // reproduced from a real run where a field came back over its length limit.
    const sdkRejection = new AnthropicSDK.AnthropicError(
      [
        "Failed to parse structured output: Error: Failed to parse structured output: [",
        '  {"origin":"string","code":"too_big","maximum":900,"inclusive":true,"path":["summary"]}',
        "]",
        "Validation issues:",
        "  - summary: String must contain at most 900 character(s)",
      ].join("\n"),
    );
    const parse = vi.fn();
    parse.mockRejectedValueOnce(sdkRejection);
    parse.mockResolvedValueOnce(okResponse(VALID_ANALYSIS));
    const client = { messages: { parse } } as unknown as Anthropic;

    const result = await new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT);

    expect(result.overview.summary).toContain("steady");
    expect(parse).toHaveBeenCalledTimes(2);
    const repaired = parse.mock.calls[1]![0] as { messages: { content: string }[] };
    expect(repaired.messages[0]!.content).toContain("did not satisfy the required output schema");
    expect(repaired.messages[0]!.content).toContain("summary");
    expect(repaired.messages[0]!.content).toContain("900 character");
  });

  it("still fails cleanly, as AI_INVALID_RESPONSE, if the repair also gets rejected by the SDK", async () => {
    const sdkRejection = new AnthropicSDK.AnthropicError(
      "Failed to parse structured output: Error: Failed to parse structured output: [...]\nValidation issues:\n  - summary: String must contain at most 900 character(s)",
    );
    const parse = vi.fn();
    parse.mockRejectedValueOnce(sdkRejection);
    parse.mockRejectedValueOnce(sdkRejection);
    const client = { messages: { parse } } as unknown as Anthropic;

    await expect(
      new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
  });

  it("does not mistake a genuine API failure for a schema problem", async () => {
    // A real rate-limit error from the SDK is an APIError, not the bare
    // AnthropicError the structured-output check throws - it must still fail
    // outright rather than being retried as if the model wrote bad JSON.
    const rateLimited = AnthropicSDK.APIError.generate(
      429,
      { error: { message: "rate limited" } },
      "rate limited",
      new Headers(),
    );
    const { client, parse } = fakeClient([]);
    parse.mockReset();
    parse.mockRejectedValueOnce(rateLimited);

    await expect(
      new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT),
    ).rejects.toMatchObject({ code: "AI_RATE_LIMITED" });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("gives up with a safe error after two failed attempts", async () => {
    const broken = { nonsense: true };
    const { client } = fakeClient([okResponse(broken), okResponse(broken)]);

    await expect(
      new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
  });

  it("recovers JSON from the response text when structured output did not bind", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [
          {
            type: "text",
            text: `Here you go:\n\`\`\`json\n${JSON.stringify(VALID_ANALYSIS)}\n\`\`\``,
          },
        ],
        parsed_output: null,
      },
    ]);

    const result = await new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT);
    expect(result.overview.summary).toContain("steady");
  });

  it("treats a refusal as its own error rather than a schema problem", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "refusal",
        usage: { input_tokens: 10, output_tokens: 0 },
        content: [],
        parsed_output: null,
      },
    ]);

    await expect(
      new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT),
    ).rejects.toMatchObject({ code: "AI_REFUSED" });
  });

  it("asks for a shorter analysis when the response hit the token ceiling", async () => {
    const { client, parse } = fakeClient([
      {
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 8000 },
        content: [{ type: "text", text: "{\"overview\"" }],
        parsed_output: null,
      },
      okResponse(VALID_ANALYSIS),
    ]);

    await new ClaudeAnalysisService(client).analyzeConversation([], CONTEXT);
    const repaired = parse.mock.calls[1]![0] as { messages: { content: string }[] };
    expect(repaired.messages[0]!.content).toContain("cut off");
  });
});

describe("recoverJson", () => {
  it("extracts the outermost balanced object", () => {
    expect(recoverJson([{ type: "text", text: 'noise {"a":{"b":1}} trailing' }])).toEqual({
      a: { b: 1 },
    });
  });

  it("is not confused by braces inside strings", () => {
    expect(
      recoverJson([{ type: "text", text: '{"a":"} not the end {","b":2}' }]),
    ).toEqual({ a: "} not the end {", b: 2 });
  });

  it("returns null when there is nothing parseable", () => {
    expect(recoverJson([{ type: "text", text: "no json here" }])).toBeNull();
    expect(recoverJson([{ type: "text", text: "{unclosed" }])).toBeNull();
    expect(recoverJson("not an array")).toBeNull();
  });
});

describe("translateProviderError", () => {
  it("never leaks provider detail into the user-facing message", () => {
    const translated = translateProviderError(
      new Error("x-api-key sk-ant-secret123456 was rejected"),
    );
    expect(translated).toBeInstanceOf(AppError);
    expect(translated.toUserFacing().message).not.toContain("sk-ant");
  });

  it("passes an AppError through unchanged", () => {
    const original = new AppError("AI_RATE_LIMITED");
    expect(translateProviderError(original)).toBe(original);
  });
});

describe("output sanitisation", () => {
  it("drops evidence pointing at message ids that were never sent", () => {
    const sanitised = sanitiseAnalysis(VALID_ANALYSIS, new Set(["1", "2"]));
    expect(sanitised.patterns[0]!.evidence[0]!.messageIds).toEqual(["1"]);
    expect(sanitised.strengths[0]!.evidence[0]!.messageIds).toEqual(["2"]);
  });

  it("hides ids the model pasted into prose without breaking the mapping", () => {
    const leaky: Analysis = {
      ...VALID_ANALYSIS,
      overview: {
        ...VALID_ANALYSIS.overview,
        summary: "It's important to note that replies are fast ([1], [2]).",
      },
      patterns: [
        {
          ...VALID_ANALYSIS.patterns[0]!,
          observation: "She answers within a minute ([1]-[2]).",
          interpretation: "One reading is that the subject matters to her [1].",
        },
      ],
    };

    const sanitised = sanitiseAnalysis(leaky, new Set(["1", "2"]));

    // Nothing a reader sees carries an identifier...
    expect(containsInternalId(sanitised.overview.summary)).toBe(false);
    expect(containsInternalId(sanitised.patterns[0]!.observation)).toBe(false);
    expect(containsInternalId(sanitised.patterns[0]!.interpretation)).toBe(false);
    expect(sanitised.overview.summary).toBe("Replies are fast.");
    expect(sanitised.patterns[0]!.observation).toBe("She answers within a minute.");

    // ...while the evidence still points at the real messages, which is what
    // makes the evidence drawer work.
    expect(sanitised.patterns[0]!.evidence[0]!.messageIds).toEqual(["1"]);
  });

  it("collapses two patterns that state the same finding twice", () => {
    const repetitive: Analysis = {
      ...VALID_ANALYSIS,
      patterns: [
        {
          ...VALID_ANALYSIS.patterns[0]!,
          title: "Longer messages during conflict",
          observation: "You write longer messages during conflict.",
          confidence: "low",
          evidence: [],
        },
        {
          ...VALID_ANALYSIS.patterns[0]!,
          title: "Message length during conflict",
          observation: "Message length increases during conflicts.",
          confidence: "high",
          evidence: [{ messageIds: ["1"], excerpt: "a long one" }],
        },
        {
          ...VALID_ANALYSIS.patterns[0]!,
          title: "Evening conversations",
          observation: "Most exchanges begin after 18:00.",
          evidence: [],
        },
      ],
    };

    const sanitised = sanitiseAnalysis(repetitive, new Set(["1"]));

    expect(sanitised.patterns).toHaveLength(2);
    // The better-evidenced version of the duplicated finding is the survivor.
    expect(sanitised.patterns[0]!.confidence).toBe("high");
    expect(sanitised.patterns[1]!.observation).toContain("18:00");
  });

  it("keeps an evidence entry that still has a usable excerpt", () => {
    const sanitised = sanitiseAnalysis(VALID_ANALYSIS, new Set());
    expect(sanitised.patterns[0]!.evidence).toHaveLength(1);
    expect(sanitised.patterns[0]!.evidence[0]!.messageIds).toEqual([]);
  });

  it("rejects an analysis missing required fields", () => {
    expect(analysisSchema.safeParse({ overview: {} }).success).toBe(false);
  });
});

describe("analysisRequestSchema", () => {
  const valid = {
    consent: { accepted: true, acceptedAt: "2024-06-01T10:00:00Z", scope: "text-only" },
    participants: [
      { id: "A", label: "Participant A", messageCount: 10, sharePercent: 60 },
      { id: "B", label: "Participant B", messageCount: 7, sharePercent: 40 },
    ],
    statistics: CONTEXT.statistics,
    excerpts: [
      {
        id: "s0",
        startIso: "2024-01-01T10:00:00",
        endIso: "2024-01-01T10:30:00",
        totalMessages: 4,
        messages: [{ id: "1", p: "A", m: 0, t: "hello" }],
      },
    ],
  };

  it("accepts a well-formed request", () => {
    expect(analysisRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a request that has not been consented to", () => {
    expect(
      analysisRequestSchema.safeParse({
        ...valid,
        consent: { ...valid.consent, accepted: false },
      }).success,
    ).toBe(false);
  });

  it("refuses a request with only one participant", () => {
    expect(
      analysisRequestSchema.safeParse({ ...valid, participants: [valid.participants[0]] })
        .success,
    ).toBe(false);
  });

  it("refuses a request with no excerpts", () => {
    expect(analysisRequestSchema.safeParse({ ...valid, excerpts: [] }).success).toBe(false);
  });
});
