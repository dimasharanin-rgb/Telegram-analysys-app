/**
 * Output language for an analysis.
 *
 * The conversation is analysed in whatever language it was written in; only
 * the report comes back in the chosen language. Nothing is pre-translated,
 * because translating the messages first would put a second model's reading
 * of them between the analysis and the evidence a reader can check.
 *
 * The list is configuration, not a constant scattered through the code:
 * `ANALYSIS_LANGUAGES` in the environment overrides it with a comma-separated
 * list of codes.
 */

export interface AnalysisLanguage {
  /** BCP-47 primary subtag. */
  code: string;
  /** English name, for logs and for the label in an English UI. */
  name: string;
  /** The language's own name, which is what the picker shows. */
  nativeName: string;
}

const CATALOGUE: AnalysisLanguage[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "lv", name: "Latvian", nativeName: "Latviešu" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
];

export const DEFAULT_LANGUAGE_CODE = "en";

/**
 * The languages this deployment offers, in catalogue order.
 *
 * Read on every call rather than memoised: the list is tiny, and a cached
 * copy would make the environment override untestable.
 */
export function analysisLanguages(): AnalysisLanguage[] {
  const configured = process.env.NEXT_PUBLIC_ANALYSIS_LANGUAGES?.trim();
  if (!configured) return CATALOGUE;

  const wanted = new Set(
    configured
      .split(",")
      .map((code) => code.trim().toLowerCase())
      .filter(Boolean),
  );
  const offered = CATALOGUE.filter((language) => wanted.has(language.code));
  // A misconfigured list must not leave the picker empty.
  return offered.length > 0 ? offered : CATALOGUE;
}

export function getLanguage(code: string | null | undefined): AnalysisLanguage | null {
  if (!code) return null;
  const normalised = code.trim().toLowerCase().split("-")[0];
  return analysisLanguages().find((language) => language.code === normalised) ?? null;
}

/** Falls back to the default whenever the requested language is not offered. */
export function resolveLanguage(code: string | null | undefined): AnalysisLanguage {
  return (
    getLanguage(code) ??
    getLanguage(DEFAULT_LANGUAGE_CODE) ??
    analysisLanguages()[0]!
  );
}

/**
 * Picks a sensible default for someone who has never chosen.
 *
 * `accept-language` is a preference the browser already knows, so asking the
 * user to state it again is a question with a free answer available.
 */
export function languageFromAcceptHeader(header: string | null): AnalysisLanguage {
  if (!header) return resolveLanguage(DEFAULT_LANGUAGE_CODE);

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      return {
        code: (tag ?? "").trim().toLowerCase().split("-")[0] ?? "",
        quality: quality ? Number(quality.slice(2)) : 1,
      };
    })
    .filter((entry) => entry.code.length > 0 && Number.isFinite(entry.quality))
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    const match = getLanguage(entry.code);
    if (match) return match;
  }
  return resolveLanguage(DEFAULT_LANGUAGE_CODE);
}
