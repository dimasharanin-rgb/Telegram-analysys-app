/**
 * How much conversation an analysis reads.
 *
 * V2 had one budget and rejected anything past it. V3 keeps a default size
 * and makes the rest a product decision: a longer conversation costs more to
 * read, so reading more of it is something you buy rather than something the
 * application silently does or silently refuses.
 *
 * Measured in characters of message text, because that is what the model is
 * actually charged for - message counts vary wildly in cost, and a limit
 * expressed in messages would mean something different for every chat.
 *
 * Every figure is configurable. Nothing here is hard-coded anywhere else.
 */

export type SizeTierId = "standard" | "extended" | "large" | "full";

export interface SizeTier {
  id: SizeTierId;
  name: string;
  /** null means "no fixed limit" - the hierarchical path handles the size. */
  maxCharacters: number | null;
  description: string;
}

function budget(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function sizeTiers(): SizeTier[] {
  return [
    {
      id: "standard",
      name: "Standard",
      maxCharacters: budget(process.env.NEXT_PUBLIC_SIZE_STANDARD_CHARS, 30_000),
      description: "Enough for most conversations, or a representative slice of a long one.",
    },
    {
      id: "extended",
      name: "Extended",
      maxCharacters: budget(process.env.NEXT_PUBLIC_SIZE_EXTENDED_CHARS, 60_000),
      description: "Twice the reading, for conversations that run to years.",
    },
    {
      id: "large",
      name: "Large",
      maxCharacters: budget(process.env.NEXT_PUBLIC_SIZE_LARGE_CHARS, 120_000),
      description: "For long histories where the early period matters as much as the recent one.",
    },
    {
      id: "full",
      name: "Full",
      maxCharacters: null,
      description:
        "No fixed limit. Very large conversations are read in sections and brought together.",
    },
  ];
}

export const DEFAULT_SIZE_TIER: SizeTierId = "standard";

export function getSizeTier(id: string | null | undefined): SizeTier | null {
  if (!id) return null;
  return sizeTiers().find((tier) => tier.id === id) ?? null;
}

export function resolveSizeTier(id: string | null | undefined): SizeTier {
  return getSizeTier(id) ?? getSizeTier(DEFAULT_SIZE_TIER)!;
}

/**
 * Which tier a product includes.
 *
 * Explicit rather than derived, so adding a product does not hand out a
 * budget nobody chose.
 */
const PRODUCT_TIER: Record<string, SizeTierId> = {
  free: "standard",
  "deep-text": "extended",
  "pro-credits": "large",
  multimodal: "large",
};

export function sizeTierFor(productId: string): SizeTier {
  return resolveSizeTier(PRODUCT_TIER[productId] ?? DEFAULT_SIZE_TIER);
}
