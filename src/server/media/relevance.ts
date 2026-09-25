/**
 * Whether looking at an attachment would tell us anything.
 *
 * §10: deeply analysing every ordinary image is the expensive mistake. A
 * screenshot someone brought into an argument changes what the surrounding
 * messages mean; a landscape photograph next to "nice weather today" does not.
 *
 * The signal has to come from the text, because the only way to know an image
 * is a screenshot is to look at it - and deciding whether to look is exactly
 * what this is for. So it reads what was said around the attachment, which is
 * free, and spends the budget on the images the conversation itself pointed at.
 */

/**
 * Phrases that mean "this attachment is the point".
 *
 * Kept multilingual because these conversations are: the same sentence appears
 * in Latvian and Russian in the exports this was built against, and an
 * English-only list would quietly rate every non-English chat as irrelevant.
 */
const REFERRING = [
  // English
  "screenshot", "screen shot", "look at", "look what", "see this", "see what",
  "here's", "here is", "this is what", "read this", "check this", "proof",
  "she said", "he said", "they said", "wrote", "sent me", "forwarded",
  // Latvian
  "paskaties", "redzi", "lūk", "luk", "šo", "izlasi", "atsūtīja", "rakstīja",
  // Russian
  "смотри", "посмотри", "вот", "это", "прочитай", "написал", "написала",
  "прислал", "прислала", "скриншот",
];

/** How far either side of the attachment counts as context. */
export const CONTEXT_MESSAGES = 2;

export interface RelevanceInput {
  /** The text of the message the attachment is attached to. */
  text: string;
  /** Text of the messages immediately before and after it. */
  neighbours: readonly string[];
}

export interface Relevance {
  score: number;
  /** Short internal reason, for the observability record. */
  reason: string;
}

/**
 * Scores one attachment.
 *
 * Higher is more worth reading. Zero means the conversation gave no reason to
 * open it, and the gateway will record it as present but unexamined.
 */
export function relevanceOf(input: RelevanceInput): Relevance {
  const own = input.text.toLowerCase();
  const around = input.neighbours.join(" ").toLowerCase();

  // Someone saying "look at this" about the thing they just sent is the
  // strongest signal there is, and it costs nothing to notice.
  if (REFERRING.some((phrase) => own.includes(phrase))) {
    return { score: 10, reason: "referred_to_directly" };
  }
  if (REFERRING.some((phrase) => around.includes(phrase))) {
    return { score: 7, reason: "referred_to_nearby" };
  }

  // An attachment sent with no words at all is the message. It may be a
  // screenshot dropped into a silence, which is worth a look.
  if (own.trim().length === 0) {
    return { score: 4, reason: "sent_without_words" };
  }

  // A question either side means the attachment is probably an answer.
  if (own.includes("?") || around.includes("?")) {
    return { score: 3, reason: "near_a_question" };
  }

  // A caption long enough to be a thought usually says what the image is, so
  // the image adds less than the caption already did.
  if (own.length > 120) {
    return { score: 1, reason: "long_caption_already_explains" };
  }

  return { score: 0, reason: "nothing_pointed_at_it" };
}

/** Text around a message, from the excerpt text the analysis already holds. */
export function neighbourTexts(
  orderedIds: readonly string[],
  textById: ReadonlyMap<string, string>,
  messageId: string,
  window = CONTEXT_MESSAGES,
): string[] {
  const index = orderedIds.indexOf(messageId);
  if (index === -1) return [];

  const from = Math.max(0, index - window);
  const to = Math.min(orderedIds.length - 1, index + window);
  const out: string[] = [];

  for (let i = from; i <= to; i += 1) {
    if (i === index) continue;
    const text = textById.get(orderedIds[i]!);
    if (text !== undefined && text.length > 0) out.push(text);
  }

  return out;
}
