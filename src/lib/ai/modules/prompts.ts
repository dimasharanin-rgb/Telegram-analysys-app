/**
 * Module prompts.
 *
 * Every module in a job sees the *same* context block - principles,
 * statistics, advanced statistics and excerpts - and differs only in the task
 * instruction. That is deliberate: an identical prefix is cacheable, so a job
 * running six modules pays full price for the conversation once rather than
 * six times.
 *
 * The task instructions stay short for the same reason, and because a long
 * instruction tends to produce a model writing to the instruction rather than
 * to the conversation.
 */

import { ANALYSIS_PRINCIPLES, renderExcerpts, renderStatistics } from "@/lib/ai/prompts";
import type { Excerpt, StatisticsDigest } from "@/lib/ai/schema";
import type { ParticipantRef } from "@/lib/ai/types";
import { CATEGORY_DESCRIPTIONS, INDICATOR_CATEGORIES } from "@/lib/stats/lexicon";
import type { AdvancedDigest } from "./input";

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function label(participants: ParticipantRef[], id: string): string {
  return participants.find((participant) => participant.id === id)?.label ?? id;
}

/* -------------------------------------------------------------------------
 * Shared context
 * ---------------------------------------------------------------------- */

export function renderAdvancedStatistics(
  advanced: AdvancedDigest,
  participants: ParticipantRef[],
): string {
  const lines: string[] = ["EXACT INTERACTION STATISTICS (computed locally; use as given)"];

  for (const participant of participants) {
    const stats = advanced.interaction.perParticipant[participant.id];
    if (!stats) continue;
    lines.push(
      `${participant.label}: ${stats.doubleTexts} double texts, ${stats.bursts} bursts of 3+ messages (longest ${stats.longestRun}), ` +
        `ended ${stats.unansweredEndings} conversations without a reply, asked ${stats.questionsAsked} questions ` +
        `(${stats.questionAnswerRate}% answered), ${stats.averageWordsPerMessage} words per message, ` +
        `vocabulary diversity ${stats.vocabularyDiversity}`,
    );
  }

  const reciprocity = advanced.interaction.reciprocity;
  lines.push(
    `Balance (1.0 = perfectly even): messages ${reciprocity.messageBalance}, initiation ${reciprocity.initiationBalance}, message length ${reciprocity.lengthBalance}`,
    `Slower median reply is ${reciprocity.responseTimeRatio}x the faster one`,
    `${reciprocity.turns} speaker changes overall, ${reciprocity.averageTurnsPerConversation} per conversation`,
    "",
    `EMOTIONAL LANGUAGE INDICATORS (messages containing a word from a fixed list, out of ${advanced.emotional.messagesScored} messages with text)`,
  );

  for (const participant of participants) {
    const counts = advanced.emotional.perParticipant[participant.id];
    if (!counts) continue;
    const parts = INDICATOR_CATEGORIES.map(
      (category) => `${category} ${counts[category]}`,
    );
    lines.push(`${participant.label}: ${parts.join(", ")}`);
  }
  lines.push(
    "These are word counts, not measurements of feeling. Treat them as a place to look, not as a conclusion.",
  );

  return lines.join("\n");
}

export function renderTimeline(
  advanced: AdvancedDigest,
  participants: ParticipantRef[],
): string {
  if (!advanced.timeline.comparable) {
    return `PERIOD COMPARISON\nNot available. ${advanced.timeline.note}`;
  }

  const lines = ["PERIOD COMPARISON (equal thirds by message count)"];
  for (const period of advanced.timeline.periods) {
    const initiation = participants
      .map((p) => `${p.label} ${period.initiationShare[p.id] ?? 0}%`)
      .join(", ");
    lines.push(
      `${period.label} (${period.startDate} → ${period.endDate}): ${period.messages} messages, ` +
        `avg ${period.averageLength} chars, median reply ${formatSeconds(period.medianResponseSeconds)}, ` +
        `${period.questionRate}% questions, ${period.emojiRate}% emoji, ` +
        `${period.conversations} conversations at ${period.averageMessagesPerConversation} messages each; ` +
        `initiation ${initiation}; ` +
        `indicators warmth ${period.indicators.warmth}, tension ${period.indicators.tension}, apology ${period.indicators.apology}, absolutes ${period.indicators.absolutes}; ` +
        `words: ${period.topWords.join(", ")}`,
    );
  }

  lines.push("", "MEASURED CHANGES, EARLY → RECENT");
  for (const change of advanced.timeline.changes) {
    lines.push(
      `${change.label}: ${change.earlyLabel} → ${change.recentLabel} (${change.direction}, ${change.changePercent}%)`,
    );
  }
  return lines.join("\n");
}

export function renderConflictCandidates(advanced: AdvancedDigest): string {
  if (advanced.conflictCandidates.length === 0) {
    return "SHORTLISTED EXCHANGES\nThe heuristic found no exchanges with tension or absolute wording.";
  }
  const lines = [
    "SHORTLISTED EXCHANGES",
    "A local heuristic nominated these as possible disagreements, from wording, pacing and the silence that follows. It is a shortlist to read, not a finding.",
    "",
  ];
  for (const candidate of advanced.conflictCandidates) {
    lines.push(
      `${candidate.id} — ${candidate.startIso.slice(0, 10)} to ${candidate.endIso.slice(0, 10)}; ` +
        `signals: ${candidate.signals.join("; ") || "none recorded"}; ` +
        `silence afterwards ${formatSeconds(candidate.followedBySilenceSeconds)}; ` +
        `apology in the next conversation: ${candidate.repairFollowed ? "yes" : "no"}; ` +
        `message ids: ${candidate.messageIds.slice(0, 40).join(", ")}`,
    );
  }
  return lines.join("\n");
}

export interface ModuleContext {
  participants: ParticipantRef[];
  statistics: StatisticsDigest;
  advanced: AdvancedDigest;
  excerpts: Excerpt[];
}

/**
 * The cacheable prefix. Identical for every module in one job, so it is paid
 * for once and read cheaply thereafter.
 */
export function sharedContextBlock(context: ModuleContext): string {
  return [
    ANALYSIS_PRINCIPLES,
    "",
    `PARTICIPANTS: ${context.participants.map((p) => `${p.label} (${p.id})`).join(", ")}`,
    "",
    renderStatistics(context.statistics, context.participants),
    "",
    renderAdvancedStatistics(context.advanced, context.participants),
    "",
    renderTimeline(context.advanced, context.participants),
    "",
    renderConflictCandidates(context.advanced),
    "",
    renderExcerpts(context.excerpts, context.participants),
  ].join("\n");
}

/* -------------------------------------------------------------------------
 * Task instructions
 * ---------------------------------------------------------------------- */

export const INTERACTION_TASK = `
TASK — INTERACTION DYNAMICS

Describe how these two sides fit together, not what each is like separately.

Cover what the evidence supports: conversational balance, who asks and who
answers, mutual initiation, asymmetry in reply speed or message length,
reciprocity, who carries which topics, attempts at repair after friction, and
moments where one side withdraws.

Use the balance figures as given. A balance of 0.97 is close to even; say so
rather than hunting for an imbalance that is not there. Where a number is
lopsided, the observation is the number; the interpretation is one reading of
it; the uncertainty is what the number cannot settle.

summary: 3-5 sentences. patterns: up to 6, each with evidence.
`.trim();

export const EMOTIONAL_TASK = `
TASK — EMOTIONAL LANGUAGE

Describe how feeling shows up in the wording, using the indicator counts as a
starting point and the excerpts as the actual evidence.

The counts tell you how many messages contain a word from a list. They do not
tell you that someone felt something, and a low count does not mean an absence
of feeling - it may mean the feeling was expressed in words not on the list.
Say so where it matters.

Useful things to look for: where warmth appears and where it thins out, what
tends to precede tension wording, whether apologies come from one side or both,
whether hedging clusters around particular subjects.

Never state what someone felt. State what they wrote.

summary: 3-5 sentences. observations: up to 5, each with evidence.

Indicator meanings:
${INDICATOR_CATEGORIES.map((category) => `  ${category}: ${CATEGORY_DESCRIPTIONS[category]}`).join("\n")}
`.trim();

export const CONFLICT_TASK = `
TASK — DIFFICULT MOMENTS

Read the shortlisted exchanges and report on the ones that really are
disagreements. The shortlist is a heuristic: if an exchange turns out to be
banter, a logistical snag or someone quoting a film, leave it out and do not
pad the list.

For each one you keep, set candidateId to the shortlist id it came from, and
fill in:
  trigger     — what the exchange appears to start from, in the messages.
  escalation  — what changes as it develops: length, pace, repetition, silence.
  responses   — how each participant responds, one entry each, by label.
  repair      — apologies, clarification, reassurance, humour, changing the
                subject. If there is none, say there is none.
  resolution  — resolved, paused, unresolved or unclear. Prefer "unclear" over
                a confident guess.
  recurrence  — whether the same subject appears elsewhere in the conversation.

A disagreement is not evidence of a problem with anyone. Describe the exchange.

summary: 3-5 sentences on what difficult moments look like here overall.
`.trim();

export const TIMELINE_TASK = `
TASK — CHANGE OVER TIME

Compare the periods using the measured changes supplied. Every change you
report must rest on one of those figures or on excerpts from the periods
concerned.

A change of less than about 10% is noise at this sample size; do not build a
story on it. Where the numbers are flat, saying "this did not change" is a
useful finding, not a failure.

For each change: earlier is what the early period looked like, later is the
recent period, interpretation is one reading, uncertainty is what a difference
in these numbers cannot establish - such as why.

continuities: up to 4 things that did NOT change, which are often the more
reassuring finding.

summary: 3-5 sentences. changes: up to 6.
`.trim();

export const PROFILES_TASK = `
TASK — COMMUNICATION PROFILES

One profile per participant, describing observable messaging behaviour.

This is the section where it is easiest to slip into describing a person
instead of their messages. Do not. "Writes long messages and follows up
quickly" is a profile. "Anxious" is not, and neither is "avoidant",
"over-thinker", "people-pleaser" or any other label for a kind of person.

traits: each has a label naming a behaviour (for example "Message elaboration",
"Question frequency", "Conversation initiation", "Follow-up after silence",
"Persistence in disagreement"), a level, and a basis that names the countable
thing it rests on.

Use "insufficient-evidence" freely. It is a more useful answer than a guess,
and the conversation genuinely cannot show some things.

strengths: what this person does well in conversation. watchouts: patterns
worth their attention, framed as behaviour rather than character.

participantId must be the short pseudonymous id, such as "A".
`.trim();

/* -------------------------------------------------------------------------
 * On-demand advice
 * ---------------------------------------------------------------------- */

export function responseAdviceSystemPrompt(): string {
  return `${ANALYSIS_PRINCIPLES}

TASK — SUGGESTED REPLIES

You are given a short stretch of conversation and asked what the person could
say next. Produce several options in different styles, so they can choose the
one that matches what they actually want.

  direct           — plain, unhedged, no softening.
  warm             — acknowledges the other person first.
  short            — one or two lines, no elaboration.
  boundary-setting — states a limit without an accusation.
  de-escalating    — lowers the temperature, defers the disagreement.

Rules:
  Write the message itself, ready to send, in the voice of someone messaging a
  person they know. Not an essay, not a template with blanks.
  Match the register of the conversation you were shown.
  Never put words in the other person's mouth, and never suggest a message that
  asserts what they think or feel.
  Do not suggest anything manipulative, guilt-tripping or deliberately vague.
  "reading" states what you understood the situation to be, in two sentences,
  so the person can tell you got it wrong.
  "caution" names the main thing these suggestions cannot know.

These are options, not correct answers. There is no correct answer.`;
}

export function avoidanceSystemPrompt(): string {
  return `${ANALYSIS_PRINCIPLES}

TASK — WHAT MIGHT LAND BADLY

You are given a short stretch of conversation. Identify wording in the selected
person's own messages that tends to make exchanges harder, and offer a
different way to put the same thing.

Things worth flagging when they are actually present:
  absolute statements ("you always", "you never")
  repeating an accusation after it has been answered
  stacking unrelated grievances into one message
  long bursts of messages without a pause
  replying to an assumption rather than to what was written
  continuing after the other person has clearly disengaged
  asking the same question again without addressing the answer given

Rules:
  Only flag what is in the excerpt. If the excerpt is fine, say so and return
  few or no patterns - an empty list is a valid, useful answer.
  Critique the wording, never the person.
  The alternative must say the same thing, not a softer thing. Do not suggest
  suppressing a real complaint.
  This is about how a message is likely to land, not about who is right.`;
}
