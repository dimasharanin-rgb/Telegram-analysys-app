import type { PriceLevel, SwingPoint } from "@/types/technical";

/** Swings closer together than this many ATRs are treated as the same level. */
const CLUSTER_ATR = 0.35;
const MAX_LEVELS = 3;

/**
 * Support and resistance from swing points: nearby swing prices are clustered
 * (averaged) and each cluster counts its touches. Levels below the current
 * price are support, above are resistance; the nearest ones are returned.
 */
export function findLevels(
  swings: SwingPoint[],
  currentPrice: number,
  atr: number | null,
): { support: PriceLevel[]; resistance: PriceLevel[] } {
  const tolerance = atr !== null && atr > 0 ? atr * CLUSTER_ATR : currentPrice * 0.0005;
  const prices = swings.map((s) => s.price).sort((a, b) => a - b);

  const clusters: number[][] = [];
  for (const p of prices) {
    const current = clusters.at(-1);
    if (current && p - current[current.length - 1]! <= tolerance) current.push(p);
    else clusters.push([p]);
  }

  const levels = clusters.map((c) => {
    const price = c.reduce((a, b) => a + b, 0) / c.length;
    return { price, touches: c.length };
  });

  const toLevel = (l: { price: number; touches: number }, kind: PriceLevel["kind"]): PriceLevel => ({
    price: l.price,
    touches: l.touches,
    kind,
    distanceAtr: atr !== null && atr > 0 ? Math.abs(l.price - currentPrice) / atr : null,
  });

  const support = levels
    .filter((l) => l.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, MAX_LEVELS)
    .map((l) => toLevel(l, "SUPPORT"));
  const resistance = levels
    .filter((l) => l.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_LEVELS)
    .map((l) => toLevel(l, "RESISTANCE"));
  return { support, resistance };
}
