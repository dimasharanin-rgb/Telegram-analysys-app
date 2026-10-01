/** Relative tolerance for comparisons against configured limits, so 0.5 vs 0.50000000001 is not a breach. */
const EPS = 1e-9;

export function lte(a: number, b: number): boolean {
  return a <= b + EPS * Math.max(1, Math.abs(b));
}

export function gte(a: number, b: number): boolean {
  return a >= b - EPS * Math.max(1, Math.abs(b));
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Round down to a multiple of `step`, tolerant of binary floating point (0.15/0.01 = 14.999...). */
export function floorToStep(value: number, step: number): number {
  if (!(value > 0)) return 0;
  const steps = Math.floor(value / step + 1e-9);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return round(steps * step, decimals);
}

export function isMultipleOf(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-7;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
