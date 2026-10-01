import type { AiAssessment } from "@/shared/types/ai";

/** A schema-valid AI assessment, shaped like the example in the specification. */
export function validAssessment(patch: Partial<AiAssessment> = {}): AiAssessment {
  const c = (score: number | null, rating: AiAssessment["stopPlacement"]["rating"]) => ({ score, rating, note: "n" });
  return {
    verdict: "ACCEPTABLE",
    setupQuality: 74,
    directionalBias: "BULLISH",
    technicalAssessment: { score: 78, trendAlignment: "GOOD", momentum: "GOOD", structure: "GOOD", entryQuality: "MODERATE" },
    riskAssessment: { score: 92, riskReward: 2, riskLevel: "ACCEPTABLE" },
    scoreBreakdown: {
      trendAlignment: c(80, "GOOD"),
      marketStructure: c(75, "GOOD"),
      momentum: c(70, "GOOD"),
      entryQuality: c(55, "MODERATE"),
      riskReward: c(80, "GOOD"),
      volatility: c(null, "UNKNOWN"),
      higherTimeframeAlignment: c(85, "GOOD"),
    },
    stopPlacement: { rating: "GOOD", note: "Below structure." },
    targetPlacement: { rating: "MODERATE", note: "Near resistance." },
    warnings: ["Price is approaching H1 resistance."],
    positiveFactors: ["H4 and H1 structure are bullish."],
    conflictingSignals: [],
    invalidation: ["M15 structure breaks below the recent swing low."],
    summary: "Bullish structure with acceptable R:R; nearby resistance reduces entry quality.",
    ...patch,
  };
}
