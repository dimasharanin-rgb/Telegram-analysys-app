/**
 * Fitting a conversation into the budget it was bought with.
 *
 * The rule is that a message is either analysed or it is not. Cutting a
 * string at character 30,000 would leave half a sentence, and half a
 * sentence is worse than no sentence: the model reads it as complete and
 * draws conclusions from a fragment. So the budget is spent whole messages
 * at a time, and the first message that will not fit ends the run.
 *
 * What comes back says exactly what was read, because an analysis of part of
 * a conversation that does not admit it is an analysis nobody can trust.
 */

import type { NormalizedMessage } from "@/lib/model/message";

export interface Coverage {
  totalMessages: number;
  analysedMessages: number;
  totalCharacters: number;
  analysedCharacters: number;
  /** True when the analysis did not cover the whole conversation. */
  partial: boolean;
  /** The budget applied, or null when there was none. */
  budgetCharacters: number | null;
  /** Where the analysed window ends, when it is not the end of the chat. */
  analysedThrough: string | null;
}

export interface ClipResult {
  messages: NormalizedMessage[];
  coverage: Coverage;
}

/**
 * What one message costs against the budget.
 *
 * The text plus a small per-message overhead, because every message also
 * carries a sender label and a timestamp into the prompt. A conversation of
 * 5,000 one-word messages is not free to read just because the words are
 * short.
 */
const PER_MESSAGE_OVERHEAD = 16;

export function messageCost(message: NormalizedMessage): number {
  return message.text.length + PER_MESSAGE_OVERHEAD;
}

export function totalCost(messages: readonly NormalizedMessage[]): number {
  return messages.reduce((sum, message) => sum + messageCost(message), 0);
}

/**
 * Takes messages until the next one would not fit.
 *
 * Chronological from the start, which is the honest reading of "the first
 * 30,000 characters" and keeps the conversation's own order intact. It never
 * splits a message, and never returns an empty analysis when there is at
 * least one message to read - a single message longer than the whole budget
 * is still analysed, because refusing it would be stranger than exceeding
 * the estimate slightly.
 */
export function clipToBudget(
  messages: readonly NormalizedMessage[],
  budgetCharacters: number | null,
): ClipResult {
  const totalCharacters = totalCost(messages);
  const full = (): ClipResult => ({
    messages: [...messages],
    coverage: {
      totalMessages: messages.length,
      analysedMessages: messages.length,
      totalCharacters,
      analysedCharacters: totalCharacters,
      partial: false,
      budgetCharacters,
      analysedThrough: null,
    },
  });

  if (budgetCharacters === null || totalCharacters <= budgetCharacters) return full();

  const kept: NormalizedMessage[] = [];
  let spent = 0;

  for (const message of messages) {
    const cost = messageCost(message);
    if (spent + cost > budgetCharacters) {
      // Always read something: one message over budget beats none.
      if (kept.length === 0) {
        kept.push(message);
        spent += cost;
      }
      break;
    }
    kept.push(message);
    spent += cost;
  }

  const partial = kept.length < messages.length;
  return {
    messages: kept,
    coverage: {
      totalMessages: messages.length,
      analysedMessages: kept.length,
      totalCharacters,
      analysedCharacters: spent,
      partial,
      budgetCharacters,
      analysedThrough: partial ? (kept[kept.length - 1]?.localIso ?? null) : null,
    },
  };
}

/* -------------------------------------------------------------------------
 * Saying so
 * ---------------------------------------------------------------------- */

const NUMBER = new Intl.NumberFormat("en-US");

/** "Analyzing 30,000 / 94,000 characters", for the screen before the run. */
export function describeCoverage(coverage: Coverage): string {
  if (!coverage.partial) {
    return `Analyzing all ${NUMBER.format(coverage.totalCharacters)} characters`;
  }
  return `Analyzing ${NUMBER.format(coverage.analysedCharacters)} / ${NUMBER.format(
    coverage.totalCharacters,
  )} characters`;
}

/**
 * The disclaimer that travels with a partial analysis.
 *
 * Goes on the result and into the PDF, because the report outlives the
 * screen that explained the choice.
 */
export function partialDisclaimer(coverage: Coverage): string | null {
  if (!coverage.partial) return null;
  const share = Math.round(
    (coverage.analysedCharacters / Math.max(1, coverage.totalCharacters)) * 100,
  );
  return (
    `This written analysis is based on ${NUMBER.format(coverage.analysedMessages)} of ` +
    `${NUMBER.format(coverage.totalMessages)} messages — about ${share}% of the ` +
    `conversation, selected as whole exchanges spread across the whole period. ` +
    `The statistics cover every message.`
  );
}

/* -------------------------------------------------------------------------
 * Coverage of what was actually sent
 * ---------------------------------------------------------------------- */

/**
 * Coverage measured from the excerpts the analysis will read.
 *
 * The statistics are exact arithmetic over the whole export and stay that
 * way - they are computed on the device and cost nothing, so there is no
 * reason to limit them. It is the *reading* that is budgeted, and that is
 * what this describes: how much of the conversation the written analysis
 * actually saw.
 */
export function coverageFromExcerpts(
  allMessages: readonly NormalizedMessage[],
  excerpts: readonly { messages: readonly { id: string; t: string }[] }[],
  budgetCharacters: number | null,
): Coverage {
  const sentIds = new Set<string>();
  let analysedCharacters = 0;

  for (const excerpt of excerpts) {
    for (const message of excerpt.messages) {
      if (sentIds.has(message.id)) continue;
      sentIds.add(message.id);
      analysedCharacters += message.t.length + PER_MESSAGE_OVERHEAD;
    }
  }

  const partial = sentIds.size < allMessages.length;
  const lastSent = [...allMessages].reverse().find((m) => sentIds.has(m.id));

  return {
    totalMessages: allMessages.length,
    analysedMessages: sentIds.size,
    totalCharacters: totalCost(allMessages),
    analysedCharacters,
    partial,
    budgetCharacters,
    analysedThrough: partial ? (lastSent?.localIso ?? null) : null,
  };
}
