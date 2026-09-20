/**
 * The categorical series palette.
 *
 * Validated for colour-vision deficiency separation and used in exactly this
 * order everywhere - charts, comparison bars, participant badges and the PDF -
 * so a participant keeps one colour across the entire product. Colour is never
 * the only cue: every series also carries a visible label.
 */

export const SERIES_COLORS = ["#2563eb", "#0ea5e9", "#7c3aed", "#d97706"] as const;

export const SERIES_TINTS = ["#dbeafe", "#e0f2fe", "#ede9fe", "#fef3c7"] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

export function seriesTint(index: number): string {
  return SERIES_TINTS[index % SERIES_TINTS.length]!;
}

export const CHART_INK = {
  axis: "#94a3b8",
  grid: "#f1f5f9",
  label: "#64748b",
  bar: "#2563eb",
  barSoft: "#bfdbfe",
} as const;
