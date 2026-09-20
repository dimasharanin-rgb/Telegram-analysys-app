import type { Analysis, ChunkFindings, Excerpt } from "@/lib/ai/schema";
import type {
  AIAnalysisService,
  ModuleRunOptions,
  UsageEvent,
  UsageTotals,
} from "@/lib/ai/types";

export function baseAnalysis(evidenceIds: string[] = []): Analysis {
  return {
    overview: {
      summary: "Participant A writes more; Participant B replies faster.",
      confidence: "medium",
    },
    patterns: [
      {
        title: "Follow-ups after short replies",
        category: "conversation-dynamics",
        observation: "Participant A often sends another message after a one-word reply.",
        interpretation: "One reading is that a short reply feels unfinished.",
        uncertainty: "The messages cannot show what was intended.",
        evidence: [{ messageIds: evidenceIds.slice(0, 2), excerpt: "example" }],
        confidence: "medium",
      },
    ],
    strengths: [],
    watchouts: [],
    suggestions: [],
    recurringTopics: [],
  };
}

/**
 * A provider stub that records what it was asked, so tests can assert on the
 * shape of a run without making a request.
 */
export class StubAiService implements AIAnalysisService {
  readonly provider = "stub";
  readonly model = "stub-model";

  readonly moduleCalls: { moduleId: string; systemContext: string; task: string }[] = [];
  baseCalls = 0;
  failOnModule: string | null = null;
  failBase = false;

  private listener: ((event: UsageEvent) => void) | null = null;

  constructor(
    private readonly evidenceIds: string[] = [],
    private readonly moduleResults: Record<string, unknown> = {},
  ) {}

  async analyzeConversation(): Promise<Analysis> {
    this.baseCalls += 1;
    if (this.failBase) throw new Error("base pass failed");
    this.emit("base");
    return baseAnalysis(this.evidenceIds);
  }

  async analyzeCommunicationPatterns(
    _excerpts: Excerpt[],
    context: { chunkIndex: number },
  ): Promise<ChunkFindings> {
    this.emit(`chunk_${context.chunkIndex}`);
    return { periodSummary: "period", observations: [], topics: [] };
  }

  async generateFinalSummary(): Promise<Analysis> {
    this.emit("synthesis");
    return baseAnalysis(this.evidenceIds);
  }

  async runModule<T>(options: ModuleRunOptions<T>): Promise<T> {
    this.moduleCalls.push({
      moduleId: options.moduleId,
      systemContext: options.systemContext,
      task: options.task,
    });
    if (this.failOnModule === options.moduleId) {
      throw new Error(`${options.moduleId} failed`);
    }
    this.emit(options.moduleId);

    const canned = this.moduleResults[options.moduleId];
    const parsed = options.schema.safeParse(canned);
    if (!parsed.success) {
      throw new Error(
        `Test stub has no valid canned result for ${options.moduleId}: ${parsed.error.issues[0]?.message}`,
      );
    }
    return parsed.data;
  }

  onUsage(listener: (event: UsageEvent) => void): void {
    this.listener = listener;
  }

  usage(): UsageTotals {
    return { calls: this.moduleCalls.length + this.baseCalls, inputTokens: 0, outputTokens: 0 };
  }

  private emit(module: string): void {
    this.listener?.({
      module,
      model: this.model,
      inputTokens: 1_000,
      outputTokens: 500,
      cachedInputTokens: module === "base" ? 0 : 900,
    });
  }
}

/** Canned module outputs that satisfy every module schema. */
export function cannedModuleResults(evidenceIds: string[], candidateId: string) {
  const evidence = [{ messageIds: evidenceIds.slice(0, 2), excerpt: "example" }];
  return {
    INTERACTION: {
      summary: "Turn-taking is even.",
      patterns: [
        {
          title: "Even turn-taking",
          observation: "Both sides reply within the same conversation.",
          interpretation: "One reading is a shared rhythm.",
          uncertainty: "Balance says nothing about satisfaction.",
          evidence,
          confidence: "medium" as const,
        },
      ],
    },
    EMOTIONAL_LANGUAGE: {
      summary: "Gratitude appears often.",
      observations: [
        {
          title: "Thanks is frequent",
          observation: "Many messages contain a word of thanks.",
          interpretation: "One reading is routine politeness.",
          uncertainty: "Counting words is not measuring feeling.",
          evidence,
          confidence: "medium" as const,
        },
      ],
    },
    CONFLICT: {
      summary: "One exchange looks like a disagreement.",
      conflicts: [
        {
          candidateId,
          title: "A decision with a deadline",
          trigger: "An external deadline was mentioned.",
          escalation: "Messages get longer.",
          responses: [{ participant: "Participant A", description: "Explains." }],
          repair: "An apology follows the next morning.",
          resolution: "resolved" as const,
          recurrence: "The subject appears again later.",
          evidence,
          confidence: "medium" as const,
        },
        {
          // Refers to a shortlist entry that does not exist; must be dropped.
          candidateId: "cf-not-real",
          title: "Invented",
          trigger: "x",
          escalation: "x",
          responses: [],
          repair: "x",
          resolution: "unclear" as const,
          recurrence: "x",
          evidence: [],
          confidence: "low" as const,
        },
      ],
    },
    TIMELINE: {
      summary: "Messages got shorter.",
      changes: [
        {
          title: "Shorter messages",
          earlier: "Longer messages early on.",
          later: "Shorter messages recently.",
          interpretation: "One reading is familiarity.",
          uncertainty: "Length alone says little.",
          evidence,
          confidence: "medium" as const,
        },
      ],
      continuities: ["Reply speed did not change."],
    },
    PERSONAL_PROFILES: {
      profiles: [
        {
          participantId: "A",
          headline: "Writes at length and follows up quickly.",
          traits: [
            { label: "Message elaboration", level: "high" as const, basis: "7.9 words per message." },
          ],
          strengths: ["Asks a lot of questions."],
          watchouts: ["Sends follow-ups before a reply arrives."],
          evidence,
          confidence: "medium" as const,
        },
        {
          // Not a participant we sent; must be dropped.
          participantId: "Z",
          headline: "Should not survive validation.",
          traits: [],
          strengths: [],
          watchouts: [],
          evidence: [],
          confidence: "low" as const,
        },
      ],
    },
  };
}
