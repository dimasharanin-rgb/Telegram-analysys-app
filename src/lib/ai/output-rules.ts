/**
 * How the model is told to write.
 *
 * Separate from `ANALYSIS_PRINCIPLES`, which governs what may be *claimed*
 * (observation vs interpretation, no diagnosis, no invented figures). This
 * governs what the writing *looks like*, and it exists because the V2 reports
 * read like generated text: filler openers, the same finding restated in four
 * sections, a summary after every section, and internal message ids pasted
 * into sentences.
 *
 * Everything here is also enforced after the fact in `prose.ts`. The prompt
 * asks; the post-processing makes sure. Neither alone is enough - the prompt
 * because models drift, the post-processing because it can delete a bad
 * sentence but cannot write a good one.
 */

import type { AnalysisLanguage } from "@/lib/analysis/language";

export const OUTPUT_DISCIPLINE = `
HOW TO WRITE.
  Short sentences. Concrete nouns. No throat-clearing.
  Every sentence must carry information the reader did not already have.

  Never open with, or anywhere write: "it's important to note", "it's worth
  noting", "this analysis reveals", "overall, the conversation demonstrates",
  "one notable pattern that emerges", "interestingly", "in summary",
  "in conclusion". Start with the finding itself.

  Do not restate the request, describe what you are about to do, or explain
  your method. Do not add a summary paragraph after a section. Do not add
  headings; the application supplies them.

  Write this:  "You write longer messages when the subject is money."
  Not this:    "One notable pattern that emerges from the analysed
                conversation is that there appears to be a tendency for you
                to compose messages of greater length when financial topics
                arise."

NO REPETITION.
  Each finding appears once, in the section it belongs to. If an observation
  is already the point of another finding, do not restate it - either say
  something new about it or leave it out.
  Do not produce two findings that differ only in wording.
  Prefer few strong findings to many weak ones. A thin section is better than
  a padded one; return fewer items rather than inventing filler.

NEVER PRINT INTERNAL IDENTIFIERS.
  The excerpts are labelled with numeric ids in square brackets so you can
  cite them in the structured evidence fields. Those ids are internal.
  Never write an id, an id range or a bracketed number into any prose field -
  not as a citation, not in parentheses, not as "(message ids 12-19)".
  Prose refers to a moment in words: "the exchange the evening the deposit
  was due". The structured evidence field is where the ids go.

CAVEATS.
  State a limitation once, in the field meant for it, in one sentence.
  Do not hedge every sentence. Do not repeat a caveat you have already given.

NO GENERIC ADVICE.
  Anything that would be true of any conversation is not worth saying. No
  therapy-speak, no relationship platitudes, no "communication is key".
  If you cannot ground it in this conversation, leave it out.
`.trim();

/**
 * Tells the model which language to answer in.
 *
 * Only the output is translated. The excerpts stay in the language they were
 * written in, and quoted evidence is rendered from the stored messages rather
 * than from anything the model echoes back, so a quote is never a translation
 * presented as a quote.
 */
export function languageDirective(language: AnalysisLanguage): string {
  if (language.code === "en") {
    return `
OUTPUT LANGUAGE.
  Write every field in English.
  The conversation itself may be in another language; analyse it as written
  and report in English. Do not translate quoted wording inside your prose -
  if you need to refer to a phrase the participants used, give it as they
  wrote it.
`.trim();
  }

  return `
OUTPUT LANGUAGE.
  Write every field in ${language.name} (${language.nativeName}). This applies
  to every string you produce: headlines, observations, interpretations,
  uncertainty, suggestions - all of it. Do not answer in English.
  The conversation itself may be in a different language. Analyse it as
  written and report in ${language.name}. Where you refer to a phrase the
  participants actually used, give it as they wrote it rather than
  translating it, so the reader can find it in their own messages.
`.trim();
}

/**
 * Length guidance for a card the reader should be able to take in at a glance.
 *
 * Stated as sentence counts rather than characters because the schema already
 * caps characters, and a model told "max 600 characters" writes to 600.
 */
export const BREVITY_BUDGET = `
LENGTH.
  headline: one line, under 10 words, no trailing full stop.
  observation: 1-2 sentences, what is literally there.
  interpretation: 1-2 sentences, one reading among several.
  uncertainty: one sentence, or empty if there is nothing real to say.
  Never write three paragraphs where one sentence carries the finding.
`.trim();
