import type { AiAssessment } from "@/shared/types/ai";
import type { Decision, MarketCheck, UnavailableReason } from "@/shared/types/analysis";
import type { RiskReport } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";

export interface DecisionInput {
  risk: RiskReport;
  unavailable: UnavailableReason | null;
  assessment: AiAssessment | null;
  marketChecks: MarketCheck[];
  settings: AccountSettings;
}

/**
 * Combines the deterministic checks with the AI's verdict. Order matters:
 *
 * 1. A BLOCK from the risk engine is final. The AI is not consulted and cannot override it.
 * 2. Missing or unverifiable data, or a failed AI call, means no verdict at all.
 * 3. Otherwise the AI's verdict stands, except that application rules may LOWER
 *    it (warnings and the minimum setup score cap it at CAUTION). They never raise it.
 */
export function decide(input: DecisionInput): Decision {
  const { risk, unavailable, assessment, marketChecks, settings } = input;

  if (risk.status === "BLOCKED") {
    return {
      finalVerdict: "BLOCKED",
      headline: "TRADE BLOCKED",
      reasons: risk.checks.filter((c) => c.status === "BLOCK").map((c) => `${c.label}: ${c.detail}`),
      aiVerdict: null,
      capped: false,
    };
  }

  if (unavailable || !assessment) {
    return {
      finalVerdict: "UNAVAILABLE",
      headline: "ANALYSIS UNAVAILABLE",
      reasons: [unavailable?.message ?? "The analysis did not complete."],
      aiVerdict: null,
      capped: false,
    };
  }

  const caps: string[] = [];
  for (const c of risk.checks) if (c.status === "WARNING") caps.push(`${c.label}: ${c.detail}`);
  for (const c of marketChecks) if (c.status === "WARNING" && c.capsVerdict) caps.push(`${c.label}: ${c.detail}`);
  if (assessment.setupQuality < settings.minSetupScore) {
    caps.push(`Setup score ${assessment.setupQuality} is below your minimum of ${settings.minSetupScore}.`);
  }

  const capped = assessment.verdict === "ACCEPTABLE" && caps.length > 0;
  const finalVerdict = capped ? "CAUTION" : assessment.verdict;
  return {
    finalVerdict,
    headline: finalVerdict,
    reasons: caps,
    aiVerdict: assessment.verdict,
    capped,
  };
}
