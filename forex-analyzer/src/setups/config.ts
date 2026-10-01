import type { SetupDetectionConfig } from "@/shared/types/setup";

/** The detector's only source of thresholds. Callers override fields; nothing in the detector hard-codes them. */
export const DEFAULT_SETUP_CONFIG: SetupDetectionConfig = {
  enabled: true,
  allowedTimeframes: ["M15", "H1"],
  allowedSetupTypes: ["CONTINUATION", "PULLBACK", "BREAKOUT"],
  allowedSymbols: [],
  minimumAtrPercent: null,
  requireTrendAlignment: true,
  requireHigherTimeframeAgreement: true,
  maxDistanceFromLevelAtr: 1,
  compressionMaxRangeAtr: 3,
  minimumCompleteness: 0,
};

export function setupConfig(overrides: Partial<SetupDetectionConfig> = {}): SetupDetectionConfig {
  return { ...DEFAULT_SETUP_CONFIG, ...overrides };
}
