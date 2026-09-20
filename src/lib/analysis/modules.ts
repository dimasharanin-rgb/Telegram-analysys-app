/**
 * The analysis modules a product can unlock.
 *
 * Replacing "one analysis" with selectable modules is what makes tiers
 * meaningful: a product is a set of modules plus limits, not a price check
 * scattered through the code.
 *
 * `batch: true` modules run as part of an analysis job. The two advice modules
 * run on demand instead - they answer a question about a specific moment the
 * user picked, so there is nothing to precompute.
 */

export const ANALYSIS_MODULES = [
  "COMMUNICATION",
  "INTERACTION",
  "TOPICS",
  "EMOTIONAL_LANGUAGE",
  "CONFLICT",
  "TIMELINE",
  "PERSONAL_PROFILES",
  "RESPONSE_ADVICE",
  "AVOIDANCE_PATTERNS",
] as const;

export type AnalysisModule = (typeof ANALYSIS_MODULES)[number];

export interface ModuleDefinition {
  id: AnalysisModule;
  name: string;
  description: string;
  /** Runs inside an analysis job, rather than on demand. */
  batch: boolean;
  /** Roughly how many model requests this module costs, for estimation. */
  requestWeight: number;
  /** Modules that must also run for this one to have anything to work with. */
  requires: AnalysisModule[];
}

export const MODULE_DEFINITIONS: Record<AnalysisModule, ModuleDefinition> = {
  COMMUNICATION: {
    id: "COMMUNICATION",
    name: "Communication patterns",
    description:
      "How each person writes and what recurs in the way they message — length, questions, follow-ups, initiation.",
    batch: true,
    requestWeight: 1,
    requires: [],
  },
  INTERACTION: {
    id: "INTERACTION",
    name: "Interaction dynamics",
    description:
      "How the two sides fit together — balance, reciprocity, who carries topics, repair and withdrawal.",
    batch: true,
    requestWeight: 1,
    requires: [],
  },
  TOPICS: {
    id: "TOPICS",
    name: "Recurring topics",
    description: "What the conversation keeps coming back to, and how it is discussed.",
    batch: true,
    requestWeight: 1,
    requires: [],
  },
  EMOTIONAL_LANGUAGE: {
    id: "EMOTIONAL_LANGUAGE",
    name: "Emotional language",
    description:
      "Where warmth, tension, reassurance and distance show up in the wording — described, not diagnosed.",
    batch: true,
    requestWeight: 1,
    requires: [],
  },
  CONFLICT: {
    id: "CONFLICT",
    name: "Difficult moments",
    description:
      "Exchanges that look like disagreements: what preceded them, how each side responded, whether they were repaired.",
    batch: true,
    requestWeight: 1,
    requires: [],
  },
  TIMELINE: {
    id: "TIMELINE",
    name: "Change over time",
    description:
      "Early, middle and recent periods compared on the measurable things, and what appears to have shifted.",
    batch: true,
    requestWeight: 1,
    requires: [],
  },
  PERSONAL_PROFILES: {
    id: "PERSONAL_PROFILES",
    name: "Communication profiles",
    description:
      "A per-person description of observable messaging behaviour, with evidence and explicit gaps.",
    batch: true,
    requestWeight: 1,
    requires: [],
  },
  RESPONSE_ADVICE: {
    id: "RESPONSE_ADVICE",
    name: "What could I say?",
    description:
      "Suggested replies, in several styles, for a moment you choose. Suggestions, not correct answers.",
    batch: false,
    requestWeight: 1,
    requires: [],
  },
  AVOIDANCE_PATTERNS: {
    id: "AVOIDANCE_PATTERNS",
    name: "What might land badly?",
    description:
      "Wording in a chosen exchange that tends to escalate, and a different way to put it.",
    batch: false,
    requestWeight: 1,
    requires: [],
  },
};

export function isAnalysisModule(value: string): value is AnalysisModule {
  return (ANALYSIS_MODULES as readonly string[]).includes(value);
}

export function batchModules(modules: readonly AnalysisModule[]): AnalysisModule[] {
  // Keep the canonical order, so a job's stages always run in the same sequence.
  return ANALYSIS_MODULES.filter(
    (id) => MODULE_DEFINITIONS[id].batch && modules.includes(id),
  );
}

export function estimateRequestCount(modules: readonly AnalysisModule[]): number {
  const batch = batchModules(modules);
  // Every job also pays for one synthesis pass.
  return batch.reduce((sum, id) => sum + MODULE_DEFINITIONS[id].requestWeight, 0) + 1;
}

/* -------------------------------------------------------------------------
 * Content types
 * ---------------------------------------------------------------------- */

export const CONTENT_TYPES = ["TEXT", "IMAGES", "AUDIO", "VIDEO"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Everything this build can actually analyse. */
export const SUPPORTED_CONTENT_TYPES: readonly ContentType[] = ["TEXT"];

export const ANALYSIS_DEPTHS = ["standard", "deep"] as const;
export type AnalysisDepth = (typeof ANALYSIS_DEPTHS)[number];

export interface AnalysisConfiguration {
  analysisType: string;
  modules: AnalysisModule[];
  contentTypes: ContentType[];
  depth: AnalysisDepth;
}
