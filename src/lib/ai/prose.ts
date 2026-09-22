/**
 * Prose hygiene for model output.
 *
 * Three jobs, all of them defensive. The prompts ask for concise, ID-free,
 * non-repetitive writing; this module assumes the model will sometimes ignore
 * that and fixes it anyway, because a prompt is a request and a user-visible
 * report is a promise.
 *
 *  1. Internal message ids must never reach a reader. They are rendered into
 *     the excerpts as `[461273]` so the model can cite them in the structured
 *     `messageIds` field, and a model that has been shown a citation format
 *     will sometimes also paste it into prose: "she replies within a minute
 *     ([461273]-[461279], [493338]-[493345])". The evidence mapping stays;
 *     the raw identifiers come out of the sentence.
 *
 *  2. Filler openers ("It is important to note that…") carry no information
 *     and are most of what makes generated text read as generated.
 *
 *  3. Two findings that say the same thing in different words are worse than
 *     one, so near-duplicates are detected structurally rather than trusted
 *     not to appear.
 */

/* -------------------------------------------------------------------------
 * Internal identifiers
 * ---------------------------------------------------------------------- */

/**
 * A bracketed message id: `[461273]`, `[m12]`, `[#87]`.
 *
 * Deliberately narrow. Bracketed prose that is not an identifier - `[sic]`,
 * `[...]` - has letters without digits and is left alone.
 */
const BRACKETED_ID = /\[\s*#?[A-Za-z]{0,3}\d{1,12}\s*\]/g;

/** `ids: 461273, 461279` / `message ids 12-19` / `msg #87`. */
const LABELLED_IDS =
  /\b(?:message\s+ids?|msg\s+ids?|ids?)\s*[:#]?\s*#?\d{1,12}(?:\s*(?:[–—-]|,|and|to)\s*#?\d{1,12})*/gi;

/**
 * Tidies punctuation left behind once identifiers are removed.
 *
 * Removing `[461273]-[461279]` from "(…)" leaves "( - , )", which looks worse
 * than the thing it replaced, so the wreckage is cleared in one pass.
 */
function repairPunctuation(text: string): string {
  return (
    text
      // Parentheses/brackets holding nothing but separators.
      .replace(/\(\s*(?:[–—\-,;:&]|and|to|\s)*\s*\)/gi, "")
      .replace(/\[\s*(?:[–—\-,;:&]|and|to|\s)*\s*\]/gi, "")
      // Separators orphaned inside a parenthetical: "(, 493338)" style leftovers.
      .replace(/\(\s*[,;]\s*/g, "(")
      .replace(/\s*[,;]\s*\)/g, ")")
      // A dangling range dash between spaces.
      .replace(/\s+[–—-]\s+(?=[,.;:)]|$)/g, "")
      // Collapse whitespace and repair spacing around punctuation.
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,.;:])(?=[^\s\d)\]"'’”])/g, "$1 ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      // A sentence that ended up with a doubled full stop.
      .replace(/\.\s*\./g, ".")
  );
}

/** Removes every internal identifier from a piece of user-visible text. */
export function stripInternalIds(text: string): string {
  if (!text) return text;
  const withoutIds = text.replace(LABELLED_IDS, "").replace(BRACKETED_ID, "");
  return withoutIds === text ? text : repairPunctuation(withoutIds);
}

/** True when a string still contains something that reads as an internal id. */
export function containsInternalId(text: string): boolean {
  BRACKETED_ID.lastIndex = 0;
  LABELLED_IDS.lastIndex = 0;
  return BRACKETED_ID.test(text) || LABELLED_IDS.test(text);
}

/* -------------------------------------------------------------------------
 * Filler
 * ---------------------------------------------------------------------- */

/**
 * Openers that add nothing. Each is stripped only at the start of a sentence,
 * so "the thing to note" inside a sentence survives.
 */
const FILLER_OPENERS = [
  "it(?:'|’)?s important to note that",
  "it is important to note that",
  "it(?:'|’)?s worth noting that",
  "it is worth noting that",
  "it should be noted that",
  "this analysis reveals that",
  "this analysis shows that",
  "the analysis reveals that",
  "overall,? the conversation demonstrates that",
  "overall,? the conversation shows that",
  "overall,? the data suggests that",
  "one notable pattern that emerges is that",
  "one pattern that emerges is that",
  "what(?:'|’)?s interesting here is that",
  "interestingly,",
  "notably,",
  "in summary,",
  "to summarise,",
  "to summarize,",
  "in conclusion,",
];

const FILLER_PATTERN = new RegExp(
  `(^|(?<=[.!?]\\s))\\s*(?:${FILLER_OPENERS.join("|")})\\s*`,
  "gi",
);

/** Drops filler openers and re-capitalises whatever now starts the sentence. */
export function stripFiller(text: string): string {
  if (!text) return text;
  const stripped = text.replace(FILLER_PATTERN, "$1");
  if (stripped === text) return text;
  return stripped
    .replace(/(^|[.!?]\s+)([a-z])/g, (_match, lead: string, letter: string) =>
      `${lead}${letter.toUpperCase()}`,
    )
    .trim();
}

/** The whole treatment: no internal ids, no filler, tidy whitespace. */
export function tidyProse(text: string): string {
  if (!text) return text;
  return repairPunctuation(stripFiller(stripInternalIds(text)));
}

/* -------------------------------------------------------------------------
 * Near-duplicate detection
 * ---------------------------------------------------------------------- */

/** Words carrying no distinguishing signal when comparing two findings. */
const COMPARISON_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "do",
  "does", "for", "from", "had", "has", "have", "in", "is", "it", "its", "may",
  "more", "most", "not", "of", "often", "on", "one", "or", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "to", "was",
  "were", "when", "which", "while", "who", "with", "you", "your",
]);

/**
 * Enough stemming to stop a plural counting as a different word.
 *
 * "messages" and "message" are the same word for this purpose, and the
 * duplicates worth catching routinely differ only by that. Anything more
 * ambitious would need a real stemmer and would not earn its keep here.
 */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && (word.endsWith("ses") || word.endsWith("hes"))) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

function comparisonTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !COMPARISON_STOPWORDS.has(word))
      .map(stem),
  );
}

/**
 * Overlap between two statements, 0..1, by Sørensen–Dice over content words.
 *
 * Word overlap rather than anything cleverer: the duplicates worth catching
 * are rephrasings of one observation ("writes longer messages during
 * conflict" / "message length increases during disagreements"), which share
 * most of their content words. It will not catch a genuine paraphrase with no
 * shared vocabulary, and does not try to.
 */
export function statementSimilarity(a: string, b: string): number {
  const left = comparisonTokens(a);
  const right = comparisonTokens(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/**
 * Above this, two findings are treated as the same finding.
 *
 * Calibrated against the gap this metric actually produces: two phrasings of
 * one observation land around 0.6, two genuinely different observations below
 * 0.2. Anywhere in between is safe; the cost of being wrong is asymmetric
 * (a lost finding is worse than a surviving duplicate), so it sits high.
 */
export const DUPLICATE_THRESHOLD = 0.55;

export interface DedupeOptions<T> {
  /** The text that decides whether two entries say the same thing. */
  statement: (item: T) => string;
  /** Higher wins when two entries collide. Defaults to source order. */
  rank?: (item: T) => number;
  threshold?: number;
}

/**
 * Keeps the strongest of each group of near-identical entries, in the order
 * the survivors originally appeared.
 */
export function dedupeStatements<T>(items: T[], options: DedupeOptions<T>): T[] {
  const threshold = options.threshold ?? DUPLICATE_THRESHOLD;
  const kept: { item: T; index: number; statement: string; rank: number }[] = [];

  items.forEach((item, index) => {
    const statement = options.statement(item);
    const rank = options.rank?.(item) ?? items.length - index;

    const clash = kept.find(
      (entry) => statementSimilarity(entry.statement, statement) >= threshold,
    );
    if (!clash) {
      kept.push({ item, index, statement, rank });
      return;
    }
    // Same finding twice: keep whichever is stronger, at the earlier slot.
    if (rank > clash.rank) {
      clash.item = item;
      clash.statement = statement;
      clash.rank = rank;
    }
  });

  return kept.sort((a, b) => a.index - b.index).map((entry) => entry.item);
}
