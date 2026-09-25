/**
 * The V2 analysis pipeline.
 *
 * Runs the base pass (the MVP pipeline, unchanged) and then whichever extra
 * modules the job's product unlocked, against a single shared context block
 * that the provider can cache. A six-module job therefore costs roughly one
 * full read of the conversation plus six short task prompts, rather than six
 * full reads.
 *
 * Every module's output is validated, and every piece of evidence is checked
 * against the ids actually sent before it can reach the UI.
 */

import { batchModules, type AnalysisModule } from "@/lib/analysis/modules";
import { JOB_STAGE_MESSAGES, type JobStage } from "@/lib/analysis/job";
import { serverConfig } from "@/lib/config";
import { asAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import {
  pruneUnknownEvidence,
  sanitiseAnalysis,
  type Analysis,
  type Confidence,
} from "@/lib/ai/schema";
import type { AnalysisJobInput } from "@/lib/ai/modules/input";
import type { Coverage } from "@/lib/analysis/clipping";
import {
  CONFLICT_TASK,
  EMOTIONAL_TASK,
  INTERACTION_TASK,
  PROFILES_TASK,
  sharedContextBlock,
  TIMELINE_TASK,
} from "@/lib/ai/modules/prompts";
import {
  conflictFindingsSchema,
  emotionalFindingsSchema,
  interactionFindingsSchema,
  profileFindingsSchema,
  timelineFindingsSchema,
  type ConflictFindings,
  type EmotionalFindings,
  type InteractionFindings,
  type ProfileFindings,
  type TimelineFindings,
} from "@/lib/ai/modules/schemas";
import {
  removeCrossModuleEcho,
  tidyConflicts,
  tidyEmotional,
  tidyInteraction,
  tidyProfiles,
  tidyTimeline,
} from "@/lib/ai/modules/sanitise";
import type { AIAnalysisService, UsageTotals } from "@/lib/ai/types";
import { runAnalysisPipeline } from "./run";

/* -------------------------------------------------------------------------
 * Result
 * ---------------------------------------------------------------------- */

export const ANALYSIS_RESULT_VERSION = 3;

/**
 * What the media pipeline did, as the report may describe it.
 *
 * Counts and safe labels only: no classification names, no provider names, no
 * file paths. §19 asks for one canonical result that the web page and the PDF
 * both read, and this is the media part of it - so the two cannot disagree
 * about how many voice messages were transcribed.
 */
export interface MediaFindings {
  /** Attachments the analysis intended to look at. */
  considered: number;
  /** Images and documents that were described. */
  described: number;
  transcribed: number;
  /** Present but not examined: sensitive, irrelevant, or beyond the allowance. */
  withheld: number;
  /** A provider failed. The message survived; the attachment went unread. */
  failed: number;
  /** One line per attachment the reader may see, in conversation order. */
  items: MediaFindingItem[];
}

export interface MediaFindingItem {
  /** Wall-clock time of the message it was attached to. */
  at: string;
  /** Pseudonymous participant label, matching the rest of the report. */
  participant: string;
  /** Safe label: "Voice message — transcript available", "Private image — not analyzed". */
  label: string;
  /** What was read, when anything was. Never a classification. */
  detail: string | null;
}

export interface AnalysisResultV2 {
  version: typeof ANALYSIS_RESULT_VERSION;
  generatedAt: string;
  modules: AnalysisModule[];
  strategy: string;
  confidence: Confidence;
  /**
   * What the analysis actually read. Carried on the result so the page and
   * the PDF disclose the same thing without recomputing it.
   */
  coverage: Coverage | null;
  /** What happened to the attachments. Null when there were none. */
  media: MediaFindings | null;
  /** Everything the MVP produced, unchanged in shape. */
  base: Analysis;
  interaction: InteractionFindings | null;
  emotional: EmotionalFindings | null;
  conflicts: ConflictFindings | null;
  timeline: TimelineFindings | null;
  profiles: ProfileFindings | null;
}

export interface ModularProgressEvent {
  stage: JobStage;
  message: string;
  percent: number;
  step: number;
  totalSteps: number;
}

export interface ModularRunOptions {
  input: AnalysisJobInput;
  service: AIAnalysisService;
  onProgress?: (event: ModularProgressEvent) => void;
  signal?: AbortSignal;
}

export interface ModularRunResult {
  result: AnalysisResultV2;
  usage: UsageTotals;
  strategy: string;
}

/** Which stage each optional module reports as. */
const MODULE_STAGE: Partial<Record<AnalysisModule, JobStage>> = {
  COMMUNICATION: "communication",
  TOPICS: "topics",
  INTERACTION: "interaction",
  EMOTIONAL_LANGUAGE: "emotional",
  CONFLICT: "conflict",
  TIMELINE: "timeline",
  PERSONAL_PROFILES: "profiles",
};

/**
 * Modules handled by the base pass rather than a call of their own: the MVP
 * pipeline already produces patterns and recurring topics.
 */
const COVERED_BY_BASE: AnalysisModule[] = ["COMMUNICATION", "TOPICS"];

export async function runModularAnalysis(
  options: ModularRunOptions,
): Promise<ModularRunResult> {
  const { input, service, signal } = options;
  const config = serverConfig();

  const selected = batchModules(input.modules);
  const extras = selected.filter((id) => !COVERED_BY_BASE.includes(id));

  // Base pass, plus one call per extra module, plus validation and the final
  // "done" marker. Every `emit()` call below advances `step` by exactly one
  // towards this total, so "Step X of Y" and the percentage both land on Y at
  // the last one. Previously the count stopped at the module calls, so
  // validation and completion were reported as steps beyond the stated total
  // (e.g. "Step 7 of 6") - not a failure, but indistinguishable from one in
  // the UI, which does not clamp the step text the way it clamps the bar.
  const totalSteps = 1 + extras.length + 2;
  let step = 0;

  const emit = (stage: JobStage, currentStep: number) => {
    options.onProgress?.({
      stage,
      message: JOB_STAGE_MESSAGES[stage],
      percent: Math.round((currentStep / totalSteps) * 100),
      step: currentStep,
      totalSteps,
    });
  };

  emit("preparing", 0);

  const knownIds = new Set(
    input.excerpts.flatMap((excerpt) => excerpt.messages.map((message) => message.id)),
  );

  const context = {
    participants: input.participants.map((p) => ({ id: p.id, label: p.label })),
    statistics: input.statistics,
    advanced: input.advanced,
    excerpts: input.excerpts,
    // One job has one language, so this stays identical across its modules
    // and the shared prefix is still cached.
    ...(input.language ? { language: input.language } : {}),
  };
  const systemContext = sharedContextBlock(context);

  try {
    /* --- base pass ---------------------------------------------------- */
    step += 1;
    emit("communication", step);

    const base = await runAnalysisPipeline({
      request: input,
      service,
      ...(signal ? { signal } : {}),
      // The base pipeline reports its own sub-stages; the job only needs to
      // know which module is running, so they are not forwarded.
    });

    /* --- optional modules --------------------------------------------- */
    let interaction: InteractionFindings | null = null;
    let emotional: EmotionalFindings | null = null;
    let conflicts: ConflictFindings | null = null;
    let timeline: TimelineFindings | null = null;
    let profiles: ProfileFindings | null = null;

    const runOne = async <T>(
      moduleId: AnalysisModule,
      task: string,
      schema: Parameters<AIAnalysisService["runModule"]>[0]["schema"],
    ): Promise<T> => {
      signal?.throwIfAborted();
      step += 1;
      emit(MODULE_STAGE[moduleId] ?? "synthesis", step);
      return service.runModule({
        moduleId,
        // Every analysis module id is also a routing task, so the module
        // decides its own tier through the routing table rather than through
        // an effort value passed down from here.
        aiTask: moduleId,
        systemContext,
        task,
        schema,
        ...(signal ? { signal } : {}),
      }) as Promise<T>;
    };

    for (const moduleId of extras) {
      switch (moduleId) {
        case "INTERACTION":
          interaction = await runOne<InteractionFindings>(
            moduleId,
            INTERACTION_TASK,
            interactionFindingsSchema,
          );
          break;
        case "EMOTIONAL_LANGUAGE":
          emotional = await runOne<EmotionalFindings>(
            moduleId,
            EMOTIONAL_TASK,
            emotionalFindingsSchema,
          );
          break;
        case "CONFLICT":
          // Nothing shortlisted means nothing to read; skip the call rather
          // than pay for a model confirming there was no argument.
          if (input.advanced.conflictCandidates.length === 0) {
            log.info("pipeline.module_skipped", { module: moduleId, reason: "no_candidates" });
            break;
          }
          conflicts = await runOne<ConflictFindings>(
            moduleId,
            CONFLICT_TASK,
            conflictFindingsSchema,
          );
          break;
        case "TIMELINE":
          if (!input.advanced.timeline.comparable) {
            log.info("pipeline.module_skipped", { module: moduleId, reason: "not_comparable" });
            break;
          }
          timeline = await runOne<TimelineFindings>(
            moduleId,
            TIMELINE_TASK,
            timelineFindingsSchema,
          );
          break;
        case "PERSONAL_PROFILES":
          profiles = await runOne<ProfileFindings>(
            moduleId,
            PROFILES_TASK,
            profileFindingsSchema,
          );
          break;
        default:
          break;
      }
    }

    /* --- validation ---------------------------------------------------- */
    step += 1;
    emit("validating", step);

    // Evidence first, then prose, then repetition - in that order, because
    // deduping compares the cleaned text.
    const cleanedBase = sanitiseAnalysis(base.analysis, knownIds);

    const cleanedInteraction = interaction
      ? tidyInteraction({
          ...interaction,
          patterns: pruneUnknownEvidence(interaction.patterns, knownIds),
        })
      : null;
    const cleanedEmotional = emotional
      ? tidyEmotional({
          ...emotional,
          observations: pruneUnknownEvidence(emotional.observations, knownIds),
        })
      : null;
    const cleanedTimeline = timeline
      ? tidyTimeline({
          ...timeline,
          changes: pruneUnknownEvidence(timeline.changes, knownIds),
        })
      : null;

    // Sections the reader meets later yield to the ones they have already
    // read, so one observation is not restated in three places.
    const deduped = removeCrossModuleEcho({
      basePatternStatements: cleanedBase.patterns.map(
        (pattern) => `${pattern.title} ${pattern.observation}`,
      ),
      interaction: cleanedInteraction,
      emotional: cleanedEmotional,
      timeline: cleanedTimeline,
    });

    const result: AnalysisResultV2 = {
      version: ANALYSIS_RESULT_VERSION,
      generatedAt: new Date().toISOString(),
      modules: selected,
      strategy: base.strategy,
      confidence: base.analysis.overview.confidence,
      coverage: input.coverage ?? null,
      // Filled in by the job service, which is where the media stage runs. The
      // pipeline itself never sees an attachment.
      media: null,
      base: cleanedBase,
      interaction: deduped.interaction,
      emotional: deduped.emotional,
      conflicts: conflicts
        ? tidyConflicts({
            ...conflicts,
            conflicts: pruneUnknownEvidence(
              conflicts.conflicts.filter((entry) =>
                input.advanced.conflictCandidates.some(
                  (candidate) => candidate.id === entry.candidateId,
                ),
              ),
              knownIds,
            ),
          })
        : null,
      timeline: deduped.timeline,
      profiles: profiles
        ? tidyProfiles({
            profiles: pruneUnknownEvidence(
              // A profile for a participant we never sent is not a profile.
              profiles.profiles.filter((profile) =>
                input.participants.some((p) => p.id === profile.participantId),
              ),
              knownIds,
            ),
          })
        : null,
    };

    step += 1;
    emit("done", step);

    const usage = service.usage();
    log.info("pipeline.modular_complete", {
      modules: selected.join(","),
      strategy: base.strategy,
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    return { result, usage, strategy: base.strategy };
  } catch (error) {
    const appError = asAppError(error);
    log.error("pipeline.modular_failed", {
      code: appError.code,
      detail: appError.message,
      modules: selected.join(","),
    });
    throw appError;
  }
}

