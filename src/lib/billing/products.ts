/**
 * Product catalogue.
 *
 * A product is a configuration object: which modules it unlocks, what limits
 * apply, which model runs it and what it costs. Nothing in the codebase
 * branches on a price - it asks the catalogue what a product allows.
 *
 * Prices are placeholders driven by environment variables. They are amounts in
 * the currency's minor unit (cents), so no floating point ever touches money.
 */

import {
  ANALYSIS_MODULES,
  type AnalysisDepth,
  type AnalysisModule,
  type ContentType,
} from "@/lib/analysis/modules";

export interface AnalysisProduct {
  id: string;
  name: string;
  description: string;
  analysisType: string;
  /** Largest conversation this product will analyse. */
  maxMessages: number;
  maxMedia: number;
  maxAudioMinutes: number;
  maxVideoMinutes: number;
  allowedModules: AnalysisModule[];
  contentTypes: ContentType[];
  depth: AnalysisDepth;
  /** null means "whatever the server is configured to use". */
  model: string | null;
  /** Output token ceiling per model call for this product. */
  tokenLimit: number;
  priceMinor: number;
  currency: string;
  /** Analyses granted per purchase. */
  credits: number;
  /** false when the product is defined but this build cannot deliver it. */
  available: boolean;
  /** Shown instead of a buy button when unavailable. */
  unavailableReason?: string;
}

function money(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY?.trim() || "EUR";

const TEXT_MODULES: AnalysisModule[] = [
  "COMMUNICATION",
  "INTERACTION",
  "TOPICS",
  "EMOTIONAL_LANGUAGE",
  "CONFLICT",
  "TIMELINE",
  "PERSONAL_PROFILES",
  "RESPONSE_ADVICE",
  "AVOIDANCE_PATTERNS",
];

export const PRODUCTS: AnalysisProduct[] = [
  {
    id: "free",
    name: "Free",
    description:
      "Every statistic, computed on your device, plus one pass of communication analysis.",
    analysisType: "text",
    maxMessages: 3_000,
    maxMedia: 0,
    maxAudioMinutes: 0,
    maxVideoMinutes: 0,
    allowedModules: ["COMMUNICATION"],
    contentTypes: ["TEXT"],
    depth: "standard",
    model: null,
    tokenLimit: 6_000,
    priceMinor: 0,
    currency: CURRENCY,
    credits: 1,
    available: true,
  },
  {
    id: "deep-text",
    name: "Deep text analysis",
    description:
      "All text modules: patterns, dynamics, topics, emotional language, difficult moments, change over time, per-person profiles, and the response advice tools.",
    analysisType: "text",
    maxMessages: 60_000,
    maxMedia: 0,
    maxAudioMinutes: 0,
    maxVideoMinutes: 0,
    allowedModules: TEXT_MODULES,
    contentTypes: ["TEXT"],
    depth: "deep",
    model: null,
    tokenLimit: 8_000,
    priceMinor: money(process.env.NEXT_PUBLIC_PRICE_DEEP_TEXT_MINOR, 900),
    currency: CURRENCY,
    credits: 1,
    available: true,
  },
  {
    id: "pro-credits",
    name: "Five analyses",
    description:
      "Five deep text analyses to use whenever you like — for different chats, or the same one over time.",
    analysisType: "text",
    maxMessages: 60_000,
    maxMedia: 0,
    maxAudioMinutes: 0,
    maxVideoMinutes: 0,
    allowedModules: TEXT_MODULES,
    contentTypes: ["TEXT"],
    depth: "deep",
    model: null,
    tokenLimit: 8_000,
    priceMinor: money(process.env.NEXT_PUBLIC_PRICE_PRO_CREDITS_MINOR, 3_500),
    currency: CURRENCY,
    credits: 5,
    available: true,
  },
  {
    id: "multimodal",
    name: "Multimodal",
    description:
      "Text, plus the photos and voice notes that the conversation actually turned on. Screenshots are read for their text, voice messages are transcribed, and private images are counted without being examined.",
    analysisType: "multimodal",
    maxMessages: 60_000,
    maxMedia: 2_000,
    maxAudioMinutes: 180,
    // V3 analyses no video. Kept at zero rather than removed so the field does
    // not have to be reintroduced by a version that adds it.
    maxVideoMinutes: 0,
    allowedModules: TEXT_MODULES,
    // No VIDEO: a participant cannot consent to video analysis that does not
    // exist, and listing it would make the consent document claim otherwise.
    contentTypes: ["TEXT", "IMAGES", "AUDIO"],
    depth: "deep",
    model: null,
    tokenLimit: 8_000,
    priceMinor: money(process.env.NEXT_PUBLIC_PRICE_MULTIMODAL_MINOR, 1_900),
    currency: CURRENCY,
    credits: 1,
    // Offered only where the deployment can actually deliver it.
    //
    // Multimodal needs a moderation provider before any image is examined and
    // a transcription key before any voice note is heard. With neither set the
    // pipeline still runs, correctly, and produces an analysis of the text plus
    // a list of attachments it did not open - which is not what someone paying
    // for "Multimodal" thinks they are buying. So the operator turns it on once
    // the providers are configured, and the server refuses it independently if
    // they are not.
    get available(): boolean {
      return mediaOffered();
    },
    get unavailableReason(): string | undefined {
      return mediaOffered()
        ? undefined
        : "Media analysis is not enabled on this deployment.";
    },
  },
];

/**
 * Whether to offer media analysis in the interface.
 *
 * A public flag because the plan picker is a client component and cannot read
 * whether an API key exists. It answers "should we sell this?"; the server
 * separately answers "can we run it?", and both have to be true.
 */
export function mediaOffered(): boolean {
  return process.env.NEXT_PUBLIC_MEDIA_ENABLED === "1";
}

export const DEFAULT_PRODUCT_ID = "free";

export function getProduct(id: string): AnalysisProduct | null {
  return PRODUCTS.find((product) => product.id === id) ?? null;
}

export function availableProducts(): AnalysisProduct[] {
  return PRODUCTS.filter((product) => product.available);
}

export function isFree(product: AnalysisProduct): boolean {
  return product.priceMinor === 0;
}

/** Narrows a requested module list to what the product actually allows. */
export function allowedModulesFor(
  product: AnalysisProduct,
  requested: readonly string[],
): AnalysisModule[] {
  return ANALYSIS_MODULES.filter(
    (id) => product.allowedModules.includes(id) && requested.includes(id),
  );
}

export function formatPrice(product: AnalysisProduct): string {
  if (product.priceMinor === 0) return "Free";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: product.currency,
  }).format(product.priceMinor / 100);
}
